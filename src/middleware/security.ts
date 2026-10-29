import type { Context, Next } from 'hono';
import { config } from '../config';
import { getRedis } from '../lib/queue/redis';

/**
 * API key auth. Enforced only when API_KEY is set in the environment,
 * so local development works without any setup. Uses constant-time
 * comparison to avoid timing attacks.
 */
export function apiKeyAuth() {
  return async (c: Context, next: Next) => {
    if (!config.apiKey) {
      return next();
    }

    // x-api-key for REST clients; Authorization: Bearer for MCP clients; either may match
    const bearer = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? '';
    const headerKey = c.req.header('x-api-key') ?? '';
    const valid = timingSafeEqual(headerKey, config.apiKey) || timingSafeEqual(bearer, config.apiKey);
    if (!valid) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    return next();
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) {
    diff |= bufA[i] ^ bufB[i];
  }
  return diff === 0;
}

interface WindowState {
  count: number;
  resetAt: number;
}

const memoryWindows = new Map<string, WindowState>();
let redisAvailable = true;

/**
 * Fixed-window rate limiter keyed by client IP.
 * Prefers Redis (works across instances); falls back to an in-memory
 * window if Redis is unreachable so the API stays protected either way.
 */
export function rateLimit() {
  return async (c: Context, next: Next) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown';

    const allowed = redisAvailable
      ? await checkRedisWindow(ip).catch(() => {
          redisAvailable = false;
          return checkMemoryWindow(ip);
        })
      : checkMemoryWindow(ip);

    if (!allowed) {
      return c.json(
        { success: false, error: 'Rate limit exceeded. Try again later.' },
        429
      );
    }

    return next();
  };
}

async function checkRedisWindow(ip: string): Promise<boolean> {
  const redis = getRedis();
  const windowSeconds = Math.ceil(config.rateLimitWindowMs / 1000);
  const key = `ratelimit:${ip}`;

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return count <= config.rateLimitMax;
}

function checkMemoryWindow(ip: string): boolean {
  const now = Date.now();
  const state = memoryWindows.get(ip);

  if (!state || now >= state.resetAt) {
    memoryWindows.set(ip, { count: 1, resetAt: now + config.rateLimitWindowMs });
    pruneMemoryWindows(now);
    return true;
  }

  memoryWindows.set(ip, { ...state, count: state.count + 1 });
  return state.count + 1 <= config.rateLimitMax;
}

function pruneMemoryWindows(now: number): void {
  if (memoryWindows.size < 10_000) return;
  for (const [key, state] of memoryWindows) {
    if (now >= state.resetAt) {
      memoryWindows.delete(key);
    }
  }
}
