// Small shared helpers: time, numbers, HTTP errors and JSON bodies.
import crypto from 'node:crypto';

export const iso = d => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
export const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
export const randHex = bytes => crypto.randomBytes(bytes).toString('hex');
export const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

// Error carrying an HTTP status; the router turns it into a JSON error body.
export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
export const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

export function need(cond, status, message, extra) { if (!cond) fail(status, message, extra); }

export async function readBody(req, limit = 1 << 20) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) fail(413, 'request body too large'); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  const ct = String(req.headers['content-type'] || '');
  if (ct.startsWith('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw); } catch { fail(400, 'body is not valid JSON'); }
}

export const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const isEmail = s => /^[^\s@<>()]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s);
