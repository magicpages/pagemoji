import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createApp } from './app.js';
import { openStore } from './db.js';
import { Shield } from './shield.js';

const port = Number(process.env.PORT ?? 3000);
const databasePath = process.env.DATABASE_PATH ?? './data/pagemoji.db';
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const proxyHeader = process.env.TRUST_PROXY_HEADER?.trim();

mkdirSync(dirname(databasePath), { recursive: true });
const store = openStore(databasePath);
const widget = readFileSync(
  createRequire(import.meta.url).resolve('@magicpages/pagemoji/pagemoji.js'),
  'utf8',
);

const app = createApp({
  store,
  shield: new Shield(),
  allowedOrigins,
  widget,
  clientIp(c) {
    // The last address is the one our own proxy added; anything before it is
    // whatever the client chose to send.
    const forwarded = proxyHeader ? c.req.header(proxyHeader)?.split(',').at(-1)?.trim() : '';
    return forwarded || (getConnInfo(c).remote.address ?? '');
  },
});

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`pagemoji: listening on port ${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
