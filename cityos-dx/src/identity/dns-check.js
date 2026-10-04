// Figure 2 step 8, "Verify resource-server's identity through DNS": the host named in the resource server's
// class 1 certificate must resolve (A/AAAA) to the network address the introspection call came from.
// Off by default because demo host names do not resolve; switch on with DX_RS_DNS_CHECK=true in a real deployment.
import dns from 'node:dns/promises';
import { fail } from '../util.js';

const bare = ip => String(ip || '').replace(/^::ffff:/, '');

export async function checkRsDns(host, ip, lookup = h => dns.lookup(h, { all: true })) {
  let addrs;
  try { addrs = (await lookup(host)).map(a => bare(a.address)); }
  catch { fail(403, `resource server ${host} could not be verified through DNS: the name does not resolve (BIS Figure 2 step 8)`); }
  if (!addrs.includes(bare(ip))) fail(403, `resource server ${host} could not be verified through DNS: it resolves to ${addrs.join(', ')}, not to the caller ${bare(ip)} (BIS Figure 2 step 8)`);
  return { host, ip: bare(ip), addresses: addrs };
}
