'use strict';
/**
 * S3 falso mínimo (path-style, em memória) para a suíte — substitui o RustFS.
 * Suporta o que o backend usa: Head/CreateBucket, Put/Get/Head/DeleteObject.
 */
const http = require('http');

const xmlErr = (code) => `<?xml version="1.0"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`;

function decodeAwsChunked(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const e = buf.indexOf('\r\n', i);
    if (e < 0) break;
    const n = parseInt(buf.slice(i, e).toString().split(';')[0], 16);
    if (!n) break;
    out.push(buf.slice(e + 2, e + 2 + n));
    i = e + 2 + n + 2;
  }
  return Buffer.concat(out);
}

function start(port = 0) {
  const buckets = new Map();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const [b, ...k] = decodeURIComponent(u.pathname).split('/').filter(Boolean);
      const key = k.join('/');
      const fail = (st, code) => {
        res.writeHead(st, { 'content-type': 'application/xml' });
        res.end(req.method === 'HEAD' ? undefined : xmlErr(code));
      };
      if (!b) { res.writeHead(200); return res.end(); }
      if (!key) {
        if (req.method === 'HEAD') return buckets.has(b) ? (res.writeHead(200), res.end()) : fail(404, 'NoSuchBucket');
        if (req.method === 'PUT') {
          if (buckets.has(b)) return fail(409, 'BucketAlreadyOwnedByYou');
          buckets.set(b, new Map());
          res.writeHead(200);
          return res.end();
        }
      }
      const bk = buckets.get(b);
      if (!bk) return fail(404, 'NoSuchBucket');
      if (req.method === 'PUT') {
        let body = Buffer.concat(chunks);
        if ((req.headers['content-encoding'] || '').includes('aws-chunked')
          || String(req.headers['x-amz-content-sha256'] || '').startsWith('STREAMING')) {
          body = decodeAwsChunked(body);
        }
        bk.set(key, { body, ct: req.headers['content-type'] });
        res.writeHead(200, { ETag: '"fake"' });
        return res.end();
      }
      const o = bk.get(key);
      if (!o) return fail(404, 'NoSuchKey');
      if (req.method === 'DELETE') { bk.delete(key); res.writeHead(204); return res.end(); }
      res.writeHead(200, { 'content-type': o.ct || 'application/octet-stream', 'content-length': o.body.length });
      return res.end(req.method === 'HEAD' ? undefined : o.body);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    port: server.address().port,
    buckets,
    close: () => new Promise((r) => server.close(r)),
  })));
}

module.exports = { start };
