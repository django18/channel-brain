import { Hono } from 'hono';
import { join } from 'path';

const app = new Hono();

const UI_DIR = join(import.meta.dir, '..', 'ui', 'app');

// explicit allow-list: no path from the request ever reaches the filesystem
const ASSETS: Record<string, string> = {
  'app.css': 'text/css; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'markdown.js': 'text/javascript; charset=utf-8',
};

async function serve(file: string, contentType: string): Promise<Response> {
  const asset = Bun.file(join(UI_DIR, file));
  if (!(await asset.exists())) return new Response('Not found', { status: 404 });
  return new Response(asset, { headers: { 'content-type': contentType } });
}

/** Channel chat UI: pick a channel, ask it anything. */
app.get('/', () => serve('index.html', 'text/html; charset=utf-8'));

app.get('/:asset', (c) => {
  const name = c.req.param('asset');
  if (!Object.hasOwn(ASSETS, name)) return c.notFound();
  return serve(name, ASSETS[name]);
});

export default app;
