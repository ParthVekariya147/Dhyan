/**
 * Minimal static server that applies public/_headers the way Cloudflare Pages does.
 *
 * `vite preview` sends `Cache-Control: no-cache` for everything and ignores _headers,
 * so it cannot show real caching behaviour. This mirrors production closely enough to
 * verify that returning visitors re-download nothing.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', 'dist');
const HEADERS_FILE = path.resolve(import.meta.dirname, '..', 'public', '_headers');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

// Parse the Cloudflare _headers format: a path pattern, then indented "Key: value" lines.
function parseHeaders() {
  if (!fs.existsSync(HEADERS_FILE)) return [];
  const rules = [];
  let current = null;
  for (const raw of fs.readFileSync(HEADERS_FILE, 'utf8').split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: {} };
      rules.push(current);
    } else if (current) {
      const i = raw.indexOf(':');
      if (i > 0) current.headers[raw.slice(0, i).trim()] = raw.slice(i + 1).trim();
    }
  }
  return rules;
}

const RULES = parseHeaders();

const matches = (pattern, pathname) =>
  pattern.endsWith('*') ? pathname.startsWith(pattern.slice(0, -1)) : pattern === pathname;

export function createServer() {
  return http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(ROOT, pathname);

    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(ROOT, 'index.html'); // SPA fallback
    }

    const body = fs.readFileSync(file);
    const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' };
    for (const rule of RULES) {
      if (matches(rule.pattern, pathname)) Object.assign(headers, rule.headers);
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers).end(req.method === 'HEAD' ? undefined : body);
  });
}

if (import.meta.filename === process.argv[1]) {
  const port = Number(process.env.PORT || 4180);
  createServer().listen(port, () => console.log(`serving dist/ on http://localhost:${port}`));
}
