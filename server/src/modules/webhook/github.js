import crypto from 'node:crypto';

// Verifies GitHub's `x-hub-signature-256: sha256=<hex hmac of raw body>` header.
export function verifySignature(secret, rawBody, header) {
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  const wanted = Buffer.from(expected, 'hex');
  // timingSafeEqual throws on length mismatch, so check first.
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
}

// Extracts what a push-event run needs; returns null if the payload is malformed.
export function parsePush(payload) {
  const cloneUrl = payload?.repository?.clone_url;
  if (typeof cloneUrl !== 'string') return null;
  return {
    cloneUrl,
    sha: payload.after ?? null,           // commit to check out
    ref: payload.ref ?? null,             // e.g. refs/heads/main
    repoName: payload.repository?.name ?? null,
  };
}
