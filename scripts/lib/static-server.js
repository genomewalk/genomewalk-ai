// Adapted from Genomewalk’s file-only preview (MIT); no application endpoints.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript; charset=utf-8',
  '.gz': 'application/gzip',
  '.txt': 'text/plain; charset=utf-8',
};

/** File-only local preview. It intentionally has no SSR, API or upload handlers. */
export function createStaticServer(directory) {
  const root = path.resolve(directory);
  return createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let file = path.resolve(root, `.${pathname}`);
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      let stat = await fs.promises.stat(file);
      if (stat.isDirectory()) {
        file = path.join(file, 'index.html');
        stat = await fs.promises.stat(file);
      }
      if (!stat.isFile()) {
        res.writeHead(404).end();
        return;
      }
      const headers = {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      };
      if (file.endsWith('.gz')) headers['Content-Encoding'] = 'identity';
      let start = 0,
        end = stat.size - 1,
        status = 200;
      if (req.headers.range) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (range && (range[1] || range[2])) {
          start = range[1] ? +range[1] : Math.max(0, stat.size - +range[2]);
          end = range[1] && range[2] ? Math.min(+range[2], end) : end;
        } else start = -1;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          start > end
        ) {
          res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` }).end();
          return;
        }
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      }
      res.writeHead(status, { ...headers, 'Content-Length': stat.size ? end - start + 1 : 0 });
      if (req.method === 'HEAD' || !stat.size) {
        res.end();
        return;
      }
      const stream = fs.createReadStream(file, { start, end });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 400).end('File not found');
    }
  });
}
