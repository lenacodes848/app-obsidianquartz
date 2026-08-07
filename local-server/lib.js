'use strict';

// Pure, side-effect-free logic used by server.js — kept in its own module so
// it can be unit tested without needing real env vars set or a listening
// HTTP server.

const crypto = require('crypto');

const COOKIE_NAME = 'notes_session';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function issueSessionCookie(secret, days) {
  const exp = Date.now() + days * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const sig = sign(payload, secret);
  const maxAge = Math.max(0, Math.floor(days * 24 * 60 * 60));
  // No "Secure" attribute: this deploys over plain HTTP on a private LAN /
  // Tailscale tunnel (the tunnel itself is already encrypted end-to-end), and
  // browsers silently refuse to set/send "Secure" cookies over a plain HTTP
  // origin — marking it Secure here would silently break login instead of
  // failing loudly.
  return `${COOKIE_NAME}=${payload}.${sig}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
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

function isValidSession(cookieValue, secret) {
  if (!cookieValue || typeof cookieValue !== 'string') return false;
  const dot = cookieValue.lastIndexOf('.');
  if (dot === -1) return false;
  const payload = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expectedSig = sign(payload, secret);
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
//
// This has to be done by actually parsing the URL (the same way a browser
// would), not by pattern-matching the raw string: browsers normalize leading
// backslashes and stray whitespace/control characters into slashes before
// resolving a URL, so naive checks like "doesn't start with // and has no
// ://" are bypassable with values like "/\evil.com" or "/\t/evil.com" (a
// tab character), both of which a browser resolves to https://evil.com/
// despite starting with a single "/". Resolving against a fixed internal
// base and comparing origins catches all of these the same way the browser
// itself would interpret them.
const REDIRECT_BASE = 'http://notes-auth-internal.invalid';
function sanitizeRedirect(rd) {
  if (!rd || typeof rd !== 'string') return '/';
  try {
    const parsed = new URL(rd, REDIRECT_BASE);
    if (parsed.origin !== REDIRECT_BASE) return '/';
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return '/';
  }
}

// CSRF guard for the two state-changing endpoints (login submit, logout
// submit). Verifies Origin/Referer against the Host this request actually
// arrived on. Unlike the Traefik-fronted version this is ported from, there
// is no reverse proxy in front of this server (it binds directly to a host
// port), so there's no X-Forwarded-Host/Proto to trust — req.headers.host is
// already the real value, and the origin is always plain http:// here.
//
// Only rejects on a *positive mismatch* — if neither header is present at
// all, the request is allowed through. Real cross-site CSRF attempts (a form
// on an attacker's page, an auto-submitting script) are sent by a browser,
// and browsers reliably attach Origin and/or Referer to those. Requiring one
// of the headers to always be present risks rejecting legitimate users whose
// browser/privacy settings strip both — a worse tradeoff than the marginal
// CSRF exposure here (single-user, private network).
function isSameOriginRequest(req) {
  const host = req.headers.host;
  if (!host) return false;
  const expectedOrigin = `http://${host}`;
  const origin = req.headers['origin'];
  if (origin) return origin === expectedOrigin;
  const referer = req.headers['referer'];
  if (referer) return referer === expectedOrigin || referer.startsWith(`${expectedOrigin}/`);
  return true;
}

// Token-bucket login rate limiter. There's no reverse proxy in front of this
// server (unlike the public deployment's Traefik kb-ratelimit-login
// middleware), so throttling has to happen here — matching Traefik's values
// (average=5/min, burst=10) so behavior parity with the sibling deployment
// is intentional, not arbitrary. `now` is injectable so this is testable
// without fake timers. No pruning of stale buckets: this is a single-user
// LAN/Tailscale deployment with a tiny, effectively-fixed set of client IPs,
// so unbounded Map growth isn't a real concern here.
function createLoginRateLimiter({ capacity = 10, refillPerMs = 5 / 60000 } = {}) {
  const buckets = new Map(); // ip -> { tokens, last }
  return {
    check(ip, now = Date.now()) {
      let bucket = buckets.get(ip);
      if (!bucket) {
        bucket = { tokens: capacity, last: now };
        buckets.set(ip, bucket);
      }
      bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.last) * refillPerMs);
      bucket.last = now;
      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    },
  };
}

module.exports = {
  COOKIE_NAME,
  REDIRECT_BASE,
  escapeHtml,
  sign,
  issueSessionCookie,
  clearSessionCookie,
  parseCookies,
  isValidSession,
  sanitizeRedirect,
  isSameOriginRequest,
  createLoginRateLimiter,
};
