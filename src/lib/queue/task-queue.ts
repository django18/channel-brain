import { getRedis } from './redis';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Job<T = any> {
  id: string;
  type: 'scrape-video' | 'scrape-channel';
  payload: T;
  status: JobStatus;
  progress: number;
  result?: any;
  error?: string;
  attempts?: number;
  createdAt: string;
  updatedAt: string;
}

const JOBS_KEY = `${config.queuePrefix}:jobs`;
const QUEUE_KEY = `${config.queuePrefix}:queue`;
const PROCESSING_KEY = `${config.queuePrefix}:processing`;
const HEARTBEAT_KEY = `${config.queuePrefix}:heartbeats`;

const VISIBILITY_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;

export async function enqueueJob(type: Job['type'], payload: any): Promise<string> {
  const redis = getRedis();
  const id = uuidv4();

  const job: Job = {
    id,
    type,
    payload,
    status: 'pending',
    progress: 0,
    attempts: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await redis.hset(JOBS_KEY, id, JSON.stringify(job));
  await redis.lpush(QUEUE_KEY, id);

  return id;
}

export async function getJobStatus(id: string): Promise<Job | null> {
  const redis = getRedis();
  const data = await redis.hget(JOBS_KEY, id);
  return data ? JSON.parse(data) : null;
}

export async function updateJob(id: string, updates: Partial<Job>): Promise<void> {
  const redis = getRedis();
  const existing = await getJobStatus(id);

  if (existing) {
    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await redis.hset(JOBS_KEY, id, JSON.stringify(updated));
  }
}

/**
 * Atomically move job id from queue to processing list. Crash-safe: if worker
 * dies mid-job, the id stays in processing until the reaper recovers it.
 */
export async function popNextJob(): Promise<Job | null> {
  const redis = getRedis();
  const id = await redis.rpoplpush(QUEUE_KEY, PROCESSING_KEY);

  if (!id) return null;

  const job = await getJobStatus(id);
  if (!job) {
    await redis.lrem(PROCESSING_KEY, 1, id);
    return null;
  }

  const attempts = (job.attempts ?? 0) + 1;
  await updateJob(id, { status: 'processing', attempts });
  await heartbeat(id);

  return { ...job, status: 'processing', attempts };
}

export async function heartbeat(id: string): Promise<void> {
  await getRedis().hset(HEARTBEAT_KEY, id, Date.now().toString());
}

/**
 * Mark job done — remove from processing list + heartbeat tracking.
 */
export async function completeJob(id: string, result?: any): Promise<void> {
  const redis = getRedis();
  await updateJob(id, { status: 'completed', progress: 100, result });
  await redis.lrem(PROCESSING_KEY, 1, id);
  await redis.hdel(HEARTBEAT_KEY, id);
}

/**
 * Mark job failed. If under MAX_ATTEMPTS, re-queue. Otherwise leave in failed state.
 */
export async function failJob(id: string, error: string): Promise<void> {
  const redis = getRedis();
  const job = await getJobStatus(id);
  const attempts = job?.attempts ?? 0;

  await redis.lrem(PROCESSING_KEY, 1, id);
  await redis.hdel(HEARTBEAT_KEY, id);

  if (attempts < MAX_ATTEMPTS) {
    await updateJob(id, { status: 'pending', error });
    await redis.lpush(QUEUE_KEY, id);
    console.log(`↻ Job ${id} retry (attempt ${attempts}/${MAX_ATTEMPTS}): ${error}`);
  } else {
    await updateJob(id, { status: 'failed', error });
    console.error(`✗ Job ${id} permanently failed after ${attempts} attempts: ${error}`);
  }
}

/**
 * Recovery: scan processing list, return any job whose heartbeat is stale
 * back to the queue. Run on worker startup + periodically.
 */
export async function reapStaleJobs(): Promise<number> {
  const redis = getRedis();
  const ids = await redis.lrange(PROCESSING_KEY, 0, -1);
  if (ids.length === 0) return 0;

  const now = Date.now();
  let recovered = 0;

  for (const id of ids) {
    const hb = await redis.hget(HEARTBEAT_KEY, id);
    const age = hb ? now - parseInt(hb, 10) : Infinity;

    if (age > VISIBILITY_TIMEOUT_MS) {
      const moved = await redis.lrem(PROCESSING_KEY, 1, id);
      if (moved > 0) {
        await redis.hdel(HEARTBEAT_KEY, id);
        await redis.lpush(QUEUE_KEY, id);
        await updateJob(id, { status: 'pending' });
        recovered++;
        console.warn(`↻ Reaped stale job ${id} (heartbeat age ${age}ms)`);
      }
    }
  }

  return recovered;
}
