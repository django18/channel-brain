import { Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createKnowledgeMcpServer } from '../mcp/server';

const mcp = new Hono();

const MAX_BODY_BYTES = 256 * 1024;

const rpcError = (code: number, message: string) => ({ jsonrpc: '2.0', error: { code, message }, id: null });

/**
 * Read and parse the JSON-RPC body ourselves (size-capped) and hand it to
 * the transport pre-parsed. Generic body-limit middleware re-wraps the
 * request stream, which the MCP transport then fails to parse.
 */
interface BodySource {
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

async function readBody(request: BodySource): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 413; message: string }> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return { ok: false, status: 413, message: 'Request body too large' };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return { ok: false, status: 413, message: 'Request body too large' };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, message: 'Parse error: Invalid JSON' };
  }
}

/**
 * MCP over Streamable HTTP, stateless: a fresh server + transport per
 * request, so concurrent agents never share request ids or state.
 */
// stateless mode has no standalone SSE stream or session to delete
mcp.on(['GET', 'DELETE'], '/', (c) =>
  c.json(rpcError(-32000, 'Method not allowed. Use POST.'), 405, {
    Allow: 'POST',
  })
);

mcp.post('/', async (c) => {
  const parsed = await readBody(c.req.raw.clone());
  if (!parsed.ok) {
    return c.json(rpcError(parsed.status === 413 ? -32000 : -32700, parsed.message), parsed.status);
  }
  const server = createKnowledgeMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(c.req.raw, { parsedBody: parsed.body });
  } catch (error) {
    console.error('MCP request failed:', error);
    return c.json(rpcError(-32603, 'Internal error'), 500);
  } finally {
    // response is fully built (JSON mode), so the per-request server can go
    server.close().catch(error => console.warn('MCP server close failed:', error));
  }
});

export default mcp;
