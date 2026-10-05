// Replication signature for the standby server (BIS 5.6): "<unix ms>.<HMAC-SHA256 of it under DX_REPLICATION_KEY>".
// Valid for one minute, so a copied header soon stops working.
import crypto from 'node:crypto';

const mac = (key, ts) => crypto.createHmac('sha256', key).update('dx-replica\n' + ts).digest('hex');
export const signReplica = (key, now = Date.now()) => `${now}.${mac(key, String(now))}`;
export function checkReplicaAuth(key, header, now = Date.now()) {
  const m = String(header || '').match(/^(\d{10,16})\.([0-9a-f]{64})$/);
  if (!key || !m || Math.abs(now - Number(m[1])) > 60e3) return false;
  const want = Buffer.from(mac(key, m[1]), 'hex'), got = Buffer.from(m[2], 'hex');
  return crypto.timingSafeEqual(want, got);
}
