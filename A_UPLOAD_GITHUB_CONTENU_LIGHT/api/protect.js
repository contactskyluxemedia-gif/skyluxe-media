const fs = require('fs/promises');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function getRequestPath(req) {
  const value = req.query && req.query.path;
  const rawPath = Array.isArray(value) ? value.join('/') : value || '';

  try {
    return decodeURIComponent(String(rawPath).split('?')[0]).replace(/^\/+/, '');
  } catch (_) {
    return '';
  }
}

function isAuthorized(req) {
  const user = process.env.SITE_LOCK_USER;
  const password = process.env.SITE_LOCK_PASSWORD;

  if (!user || !password) {
    return false;
  }

  const expected = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  return req.headers.authorization === expected;
}

async function resolveFile(root, requestPath) {
  if (!requestPath || requestPath.endsWith('/')) {
    requestPath = `${requestPath}index.html`;
  }

  if (requestPath.startsWith('api/') || requestPath.startsWith('.') || requestPath === 'vercel.json') {
    return null;
  }

  let filePath = path.join(root, requestPath);
  const normalizedRoot = `${path.resolve(root)}${path.sep}`;
  const normalizedFile = path.resolve(filePath);

  if (!normalizedFile.startsWith(normalizedRoot)) {
    return null;
  }

  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    return filePath;
  } catch (_) {
    if (!path.extname(filePath)) {
      const htmlPath = `${filePath}.html`;
      try {
        await fs.stat(htmlPath);
        return htmlPath;
      } catch (__) {
        return null;
      }
    }
    return null;
  }
}

module.exports = async function handler(req, res) {
  const user = process.env.SITE_LOCK_USER;
  const password = process.env.SITE_LOCK_PASSWORD;

  if (!user || !password) {
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store');
    res.end('Site temporairement indisponible.');
    return;
  }

  if (!isAuthorized(req)) {
    res.statusCode = 401;
    res.setHeader('WWW-Authenticate', 'Basic realm="SkyLuxe Media", charset="UTF-8"');
    res.setHeader('Cache-Control', 'no-store');
    res.end('Acces reserve.');
    return;
  }

  const root = process.cwd();
  const requestPath = getRequestPath(req);
  const filePath = await resolveFile(root, requestPath);

  if (!filePath) {
    res.statusCode = 404;
    res.setHeader('Cache-Control', 'no-store');
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const body = await fs.readFile(filePath);

  res.statusCode = 200;
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(body);
};
