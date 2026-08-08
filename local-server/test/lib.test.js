'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeRedirect,
  issueSessionCookie,
  isValidSession,
  isSameOriginRequest,
  createLoginRateLimiter,
} = require('../lib');

const SECRET = 'test-secret-only-for-unit-tests';

function extractCookieValue(setCookieHeader) {
  const match = /^notes_session=([^;]+)/.exec(setCookieHeader);
  assert.ok(match, 'expected a notes_session cookie in the Set-Cookie header');
  return match[1];
}

test('sanitizeRedirect: same-origin relative paths pass through unchanged', () => {
  assert.equal(sanitizeRedirect('/family/photos'), '/family/photos');
  assert.equal(sanitizeRedirect('/family/photos?x=1#y'), '/family/photos?x=1#y');
  assert.equal(sanitizeRedirect('/'), '/');
});

test('sanitizeRedirect: rejects absolute URLs', () => {
  assert.equal(sanitizeRedirect('https://evil.com'), '/');
  assert.equal(sanitizeRedirect('http://evil.com/x'), '/');
});

test('sanitizeRedirect: rejects protocol-relative URLs', () => {
  assert.equal(sanitizeRedirect('//evil.com'), '/');
});

test('sanitizeRedirect: rejects backslash-normalization bypass', () => {
  // Browsers treat a leading backslash as slash-equivalent when resolving a
  // URL — this is the bypass found in PR #5 review.
  assert.equal(sanitizeRedirect('/\\evil.com'), '/');
  assert.equal(sanitizeRedirect('/\\evil.com/x'), '/');
});

test('sanitizeRedirect: rejects tab/control-character bypass', () => {
  // A tab character is also normalized away by browsers before resolution.
  assert.equal(sanitizeRedirect('/\t/evil.com'), '/');
});

test('sanitizeRedirect: handles non-string/empty/missing input', () => {
  assert.equal(sanitizeRedirect(null), '/');
  assert.equal(sanitizeRedirect(undefined), '/');
  assert.equal(sanitizeRedirect(''), '/');
  assert.equal(sanitizeRedirect(42), '/');
});

test('issueSessionCookie + isValidSession: valid unexpired cookie round-trips', () => {
  const header = issueSessionCookie(SECRET, 90);
  const value = extractCookieValue(header);
  assert.equal(isValidSession(value, SECRET), true);
});

test('issueSessionCookie: sets expected cookie attributes', () => {
  const header = issueSessionCookie(SECRET, 90);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Path=\//);
  // Deliberately NOT "Secure" — this deploys over plain HTTP on a private
  // LAN/Tailscale tunnel, and a "Secure" cookie would silently never be sent
  // by the browser over plain HTTP, breaking login.
  assert.doesNotMatch(header, /Secure/);
});

test('isValidSession: tampered signature fails', () => {
  const header = issueSessionCookie(SECRET, 90);
  const value = extractCookieValue(header);
  const [payload] = value.split('.');
  const tampered = `${payload}.${'deadbeef'.repeat(8)}`;
  assert.equal(isValidSession(tampered, SECRET), false);
});

test('isValidSession: wrong secret fails', () => {
  const header = issueSessionCookie(SECRET, 90);
  const value = extractCookieValue(header);
  assert.equal(isValidSession(value, 'a-completely-different-secret'), false);
});

test('isValidSession: malformed/missing cookie values fail', () => {
  assert.equal(isValidSession('not-a-valid-cookie-value', SECRET), false);
  assert.equal(isValidSession('', SECRET), false);
  assert.equal(isValidSession(undefined, SECRET), false);
  assert.equal(isValidSession(null, SECRET), false);
});

test('isValidSession: expired session fails', () => {
  const header = issueSessionCookie(SECRET, -1); // already-expired
  const value = extractCookieValue(header);
  assert.equal(isValidSession(value, SECRET), false);
});

test('isSameOriginRequest: matching Origin header passes', () => {
  const req = { headers: { host: 'notes.example:8285', origin: 'http://notes.example:8285' } };
  assert.equal(isSameOriginRequest(req), true);
});

test('isSameOriginRequest: mismatched Origin header fails', () => {
  const req = { headers: { host: 'notes.example:8285', origin: 'http://evil.com' } };
  assert.equal(isSameOriginRequest(req), false);
});

test('isSameOriginRequest: matching Referer header passes when Origin absent', () => {
  const req = {
    headers: { host: 'notes.example:8285', referer: 'http://notes.example:8285/_notes-auth/login' },
  };
  assert.equal(isSameOriginRequest(req), true);
});

test('isSameOriginRequest: mismatched Referer header fails when Origin absent', () => {
  const req = { headers: { host: 'notes.example:8285', referer: 'http://evil.com/attack' } };
  assert.equal(isSameOriginRequest(req), false);
});

test('isSameOriginRequest: neither header present fails open (allowed)', () => {
  const req = { headers: { host: 'notes.example:8285' } };
  assert.equal(isSameOriginRequest(req), true);
});

test('isSameOriginRequest: no Host header fails closed (rejected)', () => {
  const req = { headers: {} };
  assert.equal(isSameOriginRequest(req), false);
});

test('createLoginRateLimiter: allows up to capacity requests in a burst', () => {
  const limiter = createLoginRateLimiter({ capacity: 10, refillPerMs: 5 / 60000 });
  const now = 1000;
  for (let i = 0; i < 10; i++) {
    assert.equal(limiter.check('1.2.3.4', now), true, `request ${i + 1} should be allowed`);
  }
});

test('createLoginRateLimiter: blocks the request after capacity is exhausted', () => {
  const limiter = createLoginRateLimiter({ capacity: 10, refillPerMs: 5 / 60000 });
  const now = 1000;
  for (let i = 0; i < 10; i++) limiter.check('1.2.3.4', now);
  assert.equal(limiter.check('1.2.3.4', now), false);
});

test('createLoginRateLimiter: refills over time', () => {
  const limiter = createLoginRateLimiter({ capacity: 10, refillPerMs: 5 / 60000 });
  const start = 1000;
  for (let i = 0; i < 10; i++) limiter.check('1.2.3.4', start);
  assert.equal(limiter.check('1.2.3.4', start), false);
  // 5/min refill rate = 1 token per 12s.
  assert.equal(limiter.check('1.2.3.4', start + 12000), true);
  assert.equal(limiter.check('1.2.3.4', start + 12000), false);
});

test('createLoginRateLimiter: tracks each IP independently', () => {
  const limiter = createLoginRateLimiter({ capacity: 10, refillPerMs: 5 / 60000 });
  const now = 1000;
  for (let i = 0; i < 10; i++) limiter.check('1.2.3.4', now);
  assert.equal(limiter.check('1.2.3.4', now), false);
  assert.equal(limiter.check('5.6.7.8', now), true);
});
