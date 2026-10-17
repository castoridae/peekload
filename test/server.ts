// Manual test server: `node test/server.mjs` → http://localhost:8080
// /api/export (JSON) and /api/export.csv send Content-Disposition: attachment to exercise server downloads.

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 8080);
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.mjs': 'text/javascript' };

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/api/export') {
    const body = JSON.stringify({ source: 'server-attachment', at: new Date().toISOString(), rows: [1, 2, 3] });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="raport-serwer.json"',
    });
    return res.end(body);
  }

  if (pathname === '/api/export.csv') {
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="raport-serwer.csv"',
    });
    return res.end(`id;name;created\n1;Zażółć;${new Date().toISOString()}\n2;Gęślą;2026-01-01\n`);
  }

  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (file.includes('..')) return res.writeHead(400).end();
  try {
    const content = await readFile(join(dir, file));
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Test page: http://localhost:${port}`));
