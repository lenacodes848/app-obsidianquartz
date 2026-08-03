'use strict';

const http = require('http');
const crypto = require('crypto');
const querystring = require('querystring');
const bcrypt = require('bcryptjs');

const PORT = 8081;
const COOKIE_NAME = 'kb_session';
const SESSION_DAYS = 90;
const LOGIN_PATH = '/_kb-auth/login';
const VERIFY_PATH = '/_kb-auth/verify';
const LOGOUT_PATH = '/_kb-auth/logout';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} must be set — see DEPLOY.md`);
    process.exit(1);
  }
  return value;
}

const AUTH_HTPASSWD = requireEnv('KB_AUTH_HTPASSWD');
const SESSION_SECRET = requireEnv('KB_SESSION_SECRET');
const PASSWORD_HASH = AUTH_HTPASSWD.slice(AUTH_HTPASSWD.indexOf(':') + 1);

let QUESTIONS;
try {
  QUESTIONS = JSON.parse(requireEnv('KB_SECURITY_QUESTIONS'));
  if (!Array.isArray(QUESTIONS) || QUESTIONS.length === 0) {
    throw new Error('must be a non-empty JSON array');
  }
  for (const entry of QUESTIONS) {
    if (typeof entry.q !== 'string' || typeof entry.a !== 'string') {
      throw new Error('each entry needs string "q" and "a" fields');
    }
  }
} catch (err) {
  console.error(`KB_SECURITY_QUESTIONS is invalid: ${err.message}`);
  process.exit(1);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeAnswer(str) {
  return String(str || '').trim().toLowerCase();
}

// Converts a variable-length comparison into a fixed-length one so string
// length/content differences aren't observable via timing.
function constantTimeStringEqual(a, b) {
  const digestA = crypto.createHash('sha256').update(a).digest();
  const digestB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

function issueSessionCookie() {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const sig = sign(payload);
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${COOKIE_NAME}=${payload}.${sig}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function isValidSession(cookieValue) {
  if (!cookieValue) return false;
  const dot = cookieValue.lastIndexOf('.');
  if (dot === -1) return false;
  const payload = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expectedSig = sign(payload);
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

// Only ever allow redirecting back to a same-origin relative path — never an
// absolute/external URL — to avoid turning the login page into an open redirect.
function sanitizeRedirect(rd) {
  if (!rd || typeof rd !== 'string') return '/';
  if (!rd.startsWith('/') || rd.startsWith('//') || rd.includes('://')) return '/';
  return rd;
}

function renderLoginPage({ rd, error }) {
  const questionFields = QUESTIONS.map(
    (entry, i) => `
      <label for="q${i}">${escapeHtml(entry.q)}</label>
      <input type="text" id="q${i}" name="q${i}" autocomplete="off" required>`
  ).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sign in</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 4rem auto; padding: 0 1rem; }
  label { display: block; margin-top: 1rem; font-weight: 600; }
  input { width: 100%; padding: 0.5rem; margin-top: 0.25rem; box-sizing: border-box; font-size: 1rem; }
  button { margin-top: 1.5rem; padding: 0.6rem 1.2rem; font-size: 1rem; cursor: pointer; }
  .error { color: #b00020; margin-top: 1rem; }
</style>
</head>
<body>
  <h1>Sign in</h1>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
  <form method="post" action="${LOGIN_PATH}">
    <input type="hidden" name="rd" value="${escapeHtml(rd)}">
    <label for="password">Password</label>
    <input type="password" id="password" name="password" autocomplete="off" required>
    ${questionFields}
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://internal');

  if (req.method === 'GET' && url.pathname === LOGIN_PATH) {
    const rd = sanitizeRedirect(url.searchParams.get('rd'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderLoginPage({ rd, error: null }));
    return;
  }

  if (req.method === 'POST' && url.pathname === LOGIN_PATH) {
    const body = querystring.parse(await readBody(req));
    const rd = sanitizeRedirect(body.rd);

    const passwordOk = typeof body.password === 'string' && bcrypt.compareSync(body.password, PASSWORD_HASH);
    const answersOk = QUESTIONS.every((entry, i) =>
      constantTimeStringEqual(normalizeAnswer(body[`q${i}`]), normalizeAnswer(entry.a))
    );

    if (passwordOk && answersOk) {
      res.writeHead(302, {
        'Set-Cookie': issueSessionCookie(),
        Location: rd,
      });
      res.end();
      return;
    }

    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderLoginPage({ rd, error: 'Incorrect — check your password and answers.' }));
    return;
  }

  if (req.method === 'GET' && url.pathname === VERIFY_PATH) {
    const cookies = parseCookies(req.headers.cookie);
    if (isValidSession(cookies[COOKIE_NAME])) {
      res.writeHead(200);
      res.end();
      return;
    }
    const host = req.headers['x-forwarded-host'] || req.headers.host || '';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const uri = req.headers['x-forwarded-uri'] || '/';
    const rd = sanitizeRedirect(uri);
    const target = `${LOGIN_PATH}?rd=${encodeURIComponent(rd)}`;
    res.writeHead(302, { Location: target });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === LOGOUT_PATH) {
    res.writeHead(302, {
      'Set-Cookie': clearSessionCookie(),
      Location: '/',
    });
    res.end();
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`kb-auth-service listening on ${PORT}`);
});
