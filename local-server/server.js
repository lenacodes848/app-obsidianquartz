'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const bcrypt = require('bcryptjs');
const sirv = require('sirv');
const {
  COOKIE_NAME,
  escapeHtml,
  issueSessionCookie,
  clearSessionCookie,
  parseCookies,
  isValidSession,
  sanitizeRedirect,
  isSameOriginRequest,
} = require('./lib');

const PORT = Number(process.env.PORT) || 8080;
const SESSION_DAYS = 90;
const LOGIN_PATH = '/_notes-auth/login';
const LOGOUT_PATH = '/_notes-auth/logout';
const STATIC_DIR = path.join(__dirname, 'public');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} must be set — see DEPLOY.md`);
    process.exit(1);
  }
  return value;
}

const AUTH_HTPASSWD = requireEnv('NOTES_AUTH_HTPASSWD');
const SESSION_SECRET = requireEnv('NOTES_SESSION_SECRET');
const PASSWORD_HASH = AUTH_HTPASSWD.slice(AUTH_HTPASSWD.indexOf(':') + 1);

function renderLoginPage({ rd, error }) {
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
    <input type="password" id="password" name="password" autocomplete="current-password" required autofocus>
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;
}

function renderLogoutConfirmPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Log out</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 4rem auto; padding: 0 1rem; }
  button { margin-top: 1rem; padding: 0.6rem 1.2rem; font-size: 1rem; cursor: pointer; }
</style>
</head>
<body>
  <h1>Log out</h1>
  <form method="post" action="${LOGOUT_PATH}">
    <button type="submit">Log out</button>
  </form>
</body>
</html>`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      if (data.length > 1e6) return; // already rejected below; ignore further chunks
      data += chunk;
      // Reject directly rather than calling req.destroy() here: destroy()
      // with no argument only emits 'close' (never 'end' or 'error'), so a
      // caller awaiting this promise would hang forever once the guard
      // trips. Just as important, destroy() tears down the *socket* that
      // the response also needs — calling it here would make it impossible
      // for the caller to send back a clean error response at all (the
      // connection resets instead). The stream stays in flowing mode (we're
      // already subscribed to 'data'), so the rest of an oversized body is
      // drained and discarded harmlessly; 'end' still fires once the client
      // finishes sending, but resolve() there is a no-op by then since a
      // promise only settles once.
      if (data.length > 1e6) reject(new Error('Request body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Serves the Quartz build output, gated behind a valid session cookie. Only
// reached once isValidSession has already passed (see the main handler
// below) — sirv itself has no notion of auth, it just serves files.
const serveStatic = sirv(STATIC_DIR, { etag: true });

// sirv's own send() hardcodes a 200/206 status for any file it finds, so it
// can't be reused to serve 404.html *with* a 404 status. Quartz's build
// output doesn't change while the process is running, so it's simplest and
// cheapest to just read the 404 page into memory once at startup and hand it
// back directly.
let notFoundBody;
try {
  notFoundBody = fs.readFileSync(path.join(STATIC_DIR, '404.html'));
} catch {
  notFoundBody = null;
}

function sendNotFound(req, res) {
  if (notFoundBody) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(notFoundBody);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
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
    let body;
    try {
      body = querystring.parse(await readBody(req));
    } catch {
      // Oversized or malformed body — readBody() rejects rather than
      // hanging (see its own comment). Respond and stop instead of letting
      // this become an unhandled rejection, which would crash the process.
      // Connection: close rather than leaving this keep-alive: readBody()
      // deliberately doesn't destroy the socket (that would kill this very
      // response too), so any of an oversized body still in flight is
      // drained in the background rather than interleaved with whatever the
      // client sends next on the same connection.
      res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
      res.end('Payload Too Large');
      return;
    }
    const rd = sanitizeRedirect(body.rd);

    // CSRF guard: a forged cross-site submission wouldn't carry a matching
    // Origin/Referer. Checked before touching credentials.
    if (!isSameOriginRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    // bcrypt.compare (not compareSync) so this doesn't block the event loop —
    // this same process also serves every static file on the site, so a
    // synchronous ~200ms hash compare here would stall anyone else browsing
    // at that moment.
    const passwordOk = typeof body.password === 'string' && (await bcrypt.compare(body.password, PASSWORD_HASH));

    if (passwordOk) {
      res.writeHead(302, {
        'Set-Cookie': issueSessionCookie(SESSION_SECRET, SESSION_DAYS),
        Location: rd,
      });
      res.end();
      return;
    }

    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderLoginPage({ rd, error: 'Incorrect password.' }));
    return;
  }

  // GET just shows a confirmation button — no state change — so a bare link
  // or <img> can't log someone out. The actual logout only happens on POST,
  // which carries the same Origin/Referer check as login.
  if (req.method === 'GET' && url.pathname === LOGOUT_PATH) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderLogoutConfirmPage());
    return;
  }

  if (req.method === 'POST' && url.pathname === LOGOUT_PATH) {
    if (!isSameOriginRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    res.writeHead(302, {
      'Set-Cookie': clearSessionCookie(),
      Location: '/',
    });
    res.end();
    return;
  }

  // Everything else: the actual notes site. Gated behind a valid session —
  // this is the single choke point every other path funnels through, so
  // there's exactly one place auth can go wrong instead of it being spread
  // across a reverse-proxy config and an app config that both have to agree.
  const cookies = parseCookies(req.headers.cookie);
  if (!isValidSession(cookies[COOKIE_NAME], SESSION_SECRET)) {
    const rd = sanitizeRedirect(url.pathname + url.search);
    res.writeHead(302, { Location: `${LOGIN_PATH}?rd=${encodeURIComponent(rd)}` });
    res.end();
    return;
  }

  serveStatic(req, res, () => sendNotFound(req, res));
});

server.listen(PORT, () => {
  console.log(`notes server listening on ${PORT}`);
});
