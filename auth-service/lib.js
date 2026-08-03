'use strict';

// Pure, side-effect-free logic used by server.js — kept in its own module so
// it can be unit tested without needing real env vars set or a listening
// HTTP server (server.js itself calls process.exit() on boot if env vars are
// missing, and starts listening immediately on require — neither of which is
// testable in isolation).

const crypto = require('crypto');

const COOKIE_NAME = 'kb_session';

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

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function issueSessionCookie(secret, days) {
  const exp = Date.now() + days * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const sig = sign(payload, secret);
  const maxAge = Math.max(0, Math.floor(days * 24 * 60 * 60));
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
const REDIRECT_BASE = 'http://kb-auth-internal.invalid';
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
// arrived on — no token/session needed, since Traefik's router rule already
// guarantees the Host matches ${DOMAIN} before this handler ever runs, so
// checking against the request's own Host header is self-consistent.
//
// Only rejects on a *positive mismatch* — if neither header is present at
// all, the request is allowed through. Real cross-site CSRF attempts (a form
// on an attacker's page, an auto-submitting script) are sent by a browser,
// and browsers reliably attach Origin and/or Referer to those. Requiring one
// of the headers to always be present risks rejecting legitimate users whose
// browser/privacy settings strip both — a worse tradeoff than the marginal
// CSRF exposure here (shared credential, not per-user accounts).
function isSameOriginRequest(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return false;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const expectedOrigin = `${proto}://${host}`;
  const origin = req.headers['origin'];
  if (origin) return origin === expectedOrigin;
  const referer = req.headers['referer'];
  if (referer) return referer === expectedOrigin || referer.startsWith(`${expectedOrigin}/`);
  return true;
}

module.exports = {
  COOKIE_NAME,
  REDIRECT_BASE,
  escapeHtml,
  normalizeAnswer,
  constantTimeStringEqual,
  sign,
  issueSessionCookie,
  clearSessionCookie,
  parseCookies,
  isValidSession,
  sanitizeRedirect,
  isSameOriginRequest,
};
