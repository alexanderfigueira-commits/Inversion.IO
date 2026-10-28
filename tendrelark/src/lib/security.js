import crypto from 'node:crypto';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function hmac(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('base64url');
}

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // Still burn the comparison so timing does not reveal the length match.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/** Stateless unsubscribe token: "<subscriberId>.<signature>". Cannot be guessed or forged. */
export function unsubscribeToken(secret, subscriberId) {
  return `${subscriberId}.${hmac(secret, `unsubscribe:${subscriberId}`)}`;
}

export function parseUnsubscribeToken(secret, token) {
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{20,64})$/.exec(String(token ?? ''));
  if (!m) return null;
  return safeEqual(m[2], hmac(secret, `unsubscribe:${m[1]}`)) ? Number(m[1]) : null;
}

/**
 * Form timing token. Embedded in public forms when rendered; a submission is accepted only if the
 * token is genuine, at least `minAgeMs` old (a human takes longer than a script) and under a day old.
 */
export function formToken(secret, now = Date.now()) {
  return `${now}.${hmac(secret, `form:${now}`)}`;
}

export function checkFormToken(secret, token, { minAgeMs = 2000, maxAgeMs = 24 * 3600 * 1000, now = Date.now() } = {}) {
  const m = /^(\d{10,15})\.([A-Za-z0-9_-]{20,64})$/.exec(String(token ?? ''));
  if (!m) return false;
  if (!safeEqual(m[2], hmac(secret, `form:${m[1]}`))) return false;
  const age = now - Number(m[1]);
  return age >= minAgeMs && age <= maxAgeMs;
}

/** Fixed window rate limiter, in memory. Fine for one process. Keys expire on their own. */
export function createRateLimiter({ windowMs, max, now = () => Date.now() }) {
  const hits = new Map();
  return {
    /** Returns true if the request is allowed. */
    take(key) {
      const t = now();
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= t) {
        hits.set(key, { count: 1, resetAt: t + windowMs });
        if (hits.size > 10_000) this.sweep();
        return true;
      }
      entry.count += 1;
      return entry.count <= max;
    },
    sweep() {
      const t = now();
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    },
  };
}

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Returns the lowercased address, or null if it is not a plausible email. */
export function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  const [local] = email.split('@');
  if (!local || local.length > 64) return null;
  return EMAIL_RE.test(email) ? email : null;
}
