// Tokens from a provider's own authorization server (BIS 4.5.2.3: "The resource server ... grants access to resources
// after validating tokens issued by the DX authorization server or the provider's own authorization server").
// A provider registers its authorization server (issuer name and public key) and switches some of its items to it.
// Those items then also accept signed JWT access tokens (RFC 7519) from that server, checked by the resource
// server itself: signature, issuer, expiry, the consumer (sub must be the certificate holder) and the item list.
// The provider's server decides who gets a token; the DX only checks and logs. DX tokens keep working too.
import crypto from 'node:crypto';
import { q } from '../db.js';
import { iso, need, fail, str } from '../util.js';
import { actorOf } from '../identity/identity.js';

const ALGS = { EdDSA: 'ed25519', ES256: 'ec', RS256: 'rsa' };
const b64json = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
export const isJwt = t => typeof t === 'string' && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(t);

export function makeProviderAuth({ db, audit, catalogue }) {
  const issuerRow = iss => q.get(db, 'SELECT * FROM provider_issuers WHERE issuer=?', iss);
  const setAuthServer = (p, ids, info) => {
    for (const id of ids) {
      const it = catalogue.get(String(id)); need(it && it.item_type === 'resourceItem', 404, 'no such resource item: ' + id);
      catalogue.assertOwner(it, p, 'set the authorization server of');
      catalogue.update(it.id, { ...it.doc, authorizationServerInfo: { type: 'Property', value: info } }, p);
    }
  };

  const api = {
    // POST /auth/v1/provider-auth-server {issuer, publicKeyPem, items}
    register(p, { issuer, publicKeyPem, items = [] }) {
      need(p.email, 401, 'a provider certificate is required');
      const iss = str(issuer, 200);
      need(/^https:\/\/[\w.-]+(:\d+)?(\/\S*)?$/.test(iss), 400, 'issuer must be the https URL of your authorization server');
      let key;
      try { key = crypto.createPublicKey(String(publicKeyPem || '')); } catch { fail(400, 'publicKeyPem must be a PEM public key'); }
      const alg = Object.entries(ALGS).find(([, t]) => t === key.asymmetricKeyType)?.[0];
      need(alg, 400, 'the key must be Ed25519 (EdDSA), EC P-256 (ES256) or RSA (RS256)');
      if (alg === 'ES256') need(key.asymmetricKeyDetails?.namedCurve === 'prime256v1', 400, 'EC keys must use the P-256 curve');
      if (alg === 'RS256') need(key.asymmetricKeyDetails?.modulusLength >= 2048, 400, 'RSA keys must be at least 2048 bits');
      need(Array.isArray(items) && items.length <= 200, 400, 'items must be a list of your resource item ids');
      // check every item first, so a refused request stores nothing
      for (const id of items) {
        const it = catalogue.get(String(id)); need(it && it.item_type === 'resourceItem', 404, 'no such resource item: ' + id);
        catalogue.assertOwner(it, p, 'set the authorization server of');
      }
      const old = issuerRow(iss);
      need(!old || old.owner_dn === p.dn, 409, 'this issuer is registered by another provider');
      q.run(db, 'INSERT OR REPLACE INTO provider_issuers (issuer, owner_dn, owner, alg, key_pem, created_at) VALUES (?,?,?,?,?,?)', iss, p.dn, p.email, alg, key.export({ type: 'spki', format: 'pem' }), iso(Date.now()));
      setAuthServer(p, items, { authServer: iss, authType: 'provider-own', alg });
      audit.log('Authorization', actorOf(p), 'Provider authorization server registered', `${iss} (${alg}) for ${items.length} item(s)`);
      return { issuer: iss, alg, items };
    },
    // POST /auth/v1/provider-auth-server/remove {issuer, items}: items go back to the DX authorization server.
    unregister(p, { issuer, items = [] }, dxAuthHost) {
      const r = issuerRow(str(issuer, 200)); need(r, 404, 'no such issuer');
      need(r.owner_dn === p.dn, 403, 'only the provider that registered this issuer can remove it');
      setAuthServer(p, items, { authServer: `https://${dxAuthHost}`, authType: 'dx-auth' });
      const still = catalogue.all('resourceItem').some(i => i.doc.authorizationServerInfo?.value?.authServer === r.issuer);
      if (!still) q.run(db, 'DELETE FROM provider_issuers WHERE issuer=?', r.issuer);
      audit.log('Authorization', actorOf(p), 'Provider authorization server removed', `${r.issuer} from ${items.length} item(s)${still ? '' : '; issuer deleted'}`);
      return { issuer: r.issuer, items, issuerRemoved: !still };
    },
    list: p => q.all(db, 'SELECT issuer, owner, alg, created_at FROM provider_issuers WHERE owner_dn=? ORDER BY issuer', p.dn || ''),
    // Called by the resource server for items whose authorizationServerInfo names the provider's own server.
    verify(p, it, srv, token, S) {
      const info = it.doc.authorizationServerInfo?.value || {};
      const refuse = why => { S(9, 'provider token check: ' + why, false); audit.log('Resource', actorOf(p), 'Access refused', `${it.id}: provider token ${why}`, false); fail(403, 'invalid access token from the provider\'s authorization server: ' + why); };
      let head, claims;
      try { const [h, b] = token.split('.'); head = b64json(h); claims = b64json(b); } catch { refuse('not a JWT'); }
      const r = issuerRow(claims.iss);
      if (!r || claims.iss !== info.authServer) refuse(`issuer ${claims.iss} is not the authorization server of this item`);
      if (r.owner_dn !== it.owner_dn) refuse('issuer belongs to another provider');
      if (head.alg !== r.alg) refuse(`algorithm ${head.alg} does not match the registered key (${r.alg})`);
      const [h, b, sig] = token.split('.');
      const key = crypto.createPublicKey(r.key_pem);
      const ok = r.alg === 'ES256'
        ? crypto.verify('sha256', Buffer.from(h + '.' + b), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))
        : crypto.verify(r.alg === 'EdDSA' ? null : 'sha256', Buffer.from(h + '.' + b), key, Buffer.from(sig, 'base64url'));
      if (!ok) refuse('signature invalid');
      const now = Date.now() / 1000;
      if (!Number.isFinite(claims.exp) || claims.exp <= now) refuse('expired');
      if (Number.isFinite(claims.nbf) && claims.nbf > now + 60) refuse('not valid yet');
      if (claims.exp - (claims.iat ?? now) > 24 * 3600) refuse('lifetime longer than 24 hours');
      if (claims.aud && claims.aud !== srv.host && claims.aud !== it.id) refuse(`audience ${claims.aud} is not this resource server`);
      if (!p.email || claims.sub !== p.email) refuse('issued to another consumer (sub must be the certificate holder)');
      const items = Array.isArray(claims.items) ? claims.items : String(claims.scope || '').split(' ');
      if (!items.includes(it.id)) refuse('does not cover this item');
      S(9, `provider token valid: issuer ${claims.iss}, consumer ${claims.sub}`);
      return { tail: token.slice(-8), via: 'provider authorization server ' + claims.iss };
    },
  };
  return api;
}
