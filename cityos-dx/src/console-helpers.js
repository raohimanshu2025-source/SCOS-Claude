// Console helpers for the administrator and data officers: add a department, a person, or a dataset from the
// web console without writing JSON. Each helper only builds the request; the same identity and catalogue rules
// (BIS 5.4.2 certificate rules, 6.x catalogue model, ownership by DN) check it, and the same audit log records it.
import { need } from './util.js';
import { MODELS } from './dx/model.js';

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const slug = v => str(v, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const P = v => ({ type: 'Property', value: v }), Rl = v => ({ type: 'Relationship', value: v });
const tagsOf = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(t => str(t, 40)).filter(Boolean);

export function makeConsoleHelpers({ identity, accounts, catalogue, cfg }) {
  return {
    // A department joins: registered and white-listed, with its organisation certificate (class 0) so that it
    // can have employee and data officer certificates (BIS 5.4.2).
    addDepartment({ id, name, domain }, by) {
      const org = identity.registerOrg({ id, name, domain, whitelisted: true }, by);
      const c = identity.issueDirect({ cn: org.name, email: `dx@${org.domain}`, cls: 0, kind: 'org' }, by);
      return { org, orgCertificate: c.serial };
    },
    // A person gets a DX certificate (issued by the DX-hosted CA under the same rules as a request) and a console
    // login linked to it. The temporary password must be changed at first login.
    addPerson({ name, email, kind, cls, role, username, password }, by) {
      need(str(name), 400, 'name required');
      need(['officer', 'emp', 'ind'].includes(kind), 400, 'kind must be officer, emp or ind');
      const c = identity.issueDirect({ cn: str(name), email: str(email, 120).toLowerCase(), cls: Number(cls), kind }, by);
      const acct = accounts.create({ username: str(username, 64), password, role, certSerial: c.serial, displayName: str(name), mustChange: true }, by);
      return { account: acct, certificate: c.serial, cls: Number(cls) };
    },
    // Catalogue items of the caller's organisation, for the console's drop-down lists.
    mine(p) {
      need(p.orgId, 403, 'a provider certificate is needed');
      return catalogue.all().filter(i => i.owner_org === p.orgId).map(i => ({ id: i.id, type: i.item_type, name: i.doc.name?.value || i.doc.resourceId?.value, label: i.label }));
    },
    // Builds a provider, a resource server group or a resource item from a few form fields and creates it
    // through the normal Manage interface (catalogue.create).
    addItem(f, p) {
      const pre = `urn:${slug(cfg.cityName) || 'city'}-cat:`;
      if (f.type === 'provider') {
        const doc = { ...catalogue.base('provider', `${pre}provider/${p.orgId}`, str(f.name), str(f.description, 1000), ['provider', ...tagsOf(f.tags)]), organizationInfo: P({ email: p.email, url: str(f.url) || undefined }) };
        return catalogue.create(doc, p).doc;
      }
      if (f.type === 'group') {
        need(MODELS[f.model], 400, 'data model must be one of ' + Object.keys(MODELS).join(', '));
        const prov = catalogue.all('provider').find(i => i.owner_org === p.orgId);
        need(prov, 400, 'create your department\'s provider entry first');
        need(catalogue.get(str(f.resourceServer)), 400, 'unknown resource server');
        const doc = { ...catalogue.base('resourceServerGroup', `${pre}group/${slug(f.name)}`, str(f.name), str(f.description, 1000), ['group', ...tagsOf(f.tags)]),
          resourceServer: Rl(str(f.resourceServer)), refDataModel: Rl(`<catalogue-link>/${f.model}/${f.model}_dataModel.json`), provider: Rl(prov.id), accessObjectType: P(str(f.accessObjectType) || 'openAPI') };
        return catalogue.create(doc, p).doc;
      }
      if (f.type === 'dataset') {
        const g = catalogue.get(str(f.group)); need(g && g.item_type === 'resourceServerGroup', 400, 'pick one of your dataset groups');
        need(g.owner_org === p.orgId, 403, 'that group belongs to another organisation');
        const key = slug(f.key || f.name); need(key, 400, 'name required');
        const gk = g.id.split('/').pop();
        const doc = { ...catalogue.base('resourceItem', g.id.replace(/group\/([^/]+)$/, `$1/${key}`), str(f.name), str(f.description, 1000), tagsOf(f.tags)),
          resourceId: P(key), resourceType: P(f.resourceType || 'messageStream'), resourceServer: g.doc.resourceServer, resourceServerGroup: Rl(g.id), provider: g.doc.provider, refDataModel: g.doc.refDataModel,
          accessInformation: P([{ accessObjectType: g.doc.accessObjectType?.value || 'openAPI', accessObject: Rl(`<catalogue-link>/${gk}_api.json`), accessObjectVariables: P({ resourceId: key }) }]),
          authorizationServerInfo: P({ authServer: `https://${cfg.authHost}`, authType: 'dx-auth' }), accessPolicyLabel: P(f.label || 'public'), license: P(str(f.license) || 'Provider licence (demo)') };
        const lon = Number(f.lon), lat = Number(f.lat);
        if (f.lon !== undefined && f.lon !== '' && Number.isFinite(lon) && Number.isFinite(lat)) doc.location = { type: 'GeoProperty', value: { geometry: { type: 'Point', coordinates: [lon, lat] } } };
        return catalogue.create(doc, p).doc;
      }
      need(false, 400, 'type must be provider, group or dataset');
    },
  };
}
