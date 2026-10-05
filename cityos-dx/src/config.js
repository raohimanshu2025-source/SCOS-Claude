// All settings come from environment variables so the same build runs in test, staging and a pilot.
import path from 'node:path';

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const num = (k, d) => Number(env(k, d));
const bool = (k, d) => ['1', 'true', 'yes'].includes(String(env(k, d)).toLowerCase());

export function loadConfig(overrides = {}) {
  const dataDir = path.resolve(overrides.dataDir ?? env('DX_DATA_DIR', './data'));
  const kanpur = (overrides.cityProfile ?? env('DX_CITY_PROFILE', 'demo')) === 'kanpur';
  const cfg = {
    dataDir,
    dbFile: path.join(dataDir, 'dx.sqlite'),
    pkiDir: path.resolve(overrides.pkiDir ?? env('DX_PKI_DIR', './pki')),
    backupDir: path.resolve(env('DX_BACKUP_DIR', './backups')),
    host: env('DX_HOST', '0.0.0.0'),
    port: num('DX_PORT', 8443),
    mqttPort: num('DX_MQTT_PORT', 8883), // MQTT 5.0 over TLS for streams (BIS 6.5 AsyncAPI access); -1 switches it off
    publicName: env('DX_PUBLIC_NAME', 'dx.demo-city.example'),
    authHost: env('DX_AUTH_HOST', kanpur ? 'auth.kanpur-demo.example' : 'auth.demo-city.example'),
    uacUrl: env('DX_UAC_URL', 'https://uac.demo-city.example'),
    // 'demo' (made-up Demo City, the default) or 'kanpur' (Kanpur departments with synthetic demo data; see src/seed-kanpur.js).
    cityProfile: env('DX_CITY_PROFILE', 'demo'),
    cityName: env('DX_CITY_NAME', kanpur ? 'Kanpur (demo data)' : 'Demo City'),
    tokenTtlSec: num('DX_TOKEN_TTL', 3600),
    sessionTtlSec: num('DX_SESSION_TTL', 8 * 3600),
    // BIS 5.1: client TLS certificates are requested; API calls without a session need one.
    requestClientCert: bool('DX_REQUEST_CLIENT_CERT', 'true'),
    rateLimitPerMin: num('DX_RATE_LIMIT', 600),
    loginMaxFailures: num('DX_LOGIN_MAX_FAILURES', 5),
    schedulerMinuteMs: num('DX_SCHEDULER_MINUTE_MS', 60000),
    schedulerEnabled: bool('DX_SCHEDULER', 'true'),
    heartbeatMs: num('DX_HEARTBEAT_MS', 60000),
    // City OS Section 1: 'city' (one city), 'state' (peers are cities) or 'national' (peers are state nodes).
    tier: env('DX_TIER', 'city'),
    regionName: env('DX_REGION_NAME', 'Demo State'),
    centralPolicyUrl: env('DX_CENTRAL_POLICY_URL', ''), // state or national node whose central access rules this city applies
    federationPeers: env('DX_FEDERATION_PEERS', '').split(',').map(s => s.trim()).filter(Boolean),
    cilServiceEmail: env('DX_CIL_SERVICE_EMAIL', kanpur ? 'cil@iccc.kanpur-demo.example' : 'cil@mc.demo-city.example'),
    // CIL source layer (City OS Figure 11): folder for CSV/JSON file sources, and object store hosts (host:port) it may fetch from.
    cilSourceDir: env('DX_CIL_SOURCE_DIR', ''),
    cilObjectHosts: env('DX_CIL_OBJECT_HOSTS', '').split(',').map(s => s.trim()).filter(Boolean),
    federationCaFile: env('DX_FEDERATION_CA_FILE', ''),
    oidcIssuersFile: env('DX_OIDC_ISSUERS_FILE', ''),
    // BIS 5.4.2: certificates from licensed CAs in India (certified by the CCA). PEM bundle of their CA certificates,
    // and optionally their CRLs, so that TLS connections with those certificates are accepted and revocation is checked.
    trustedCaFile: env('DX_TRUSTED_CA_FILE', ''),
    trustedCrlFile: env('DX_TRUSTED_CRL_FILE', ''),
    // Optional web certificate from a public CA (for example Let's Encrypt) so browsers open the console without a warning.
    // Client certificates are still checked against the DX CA and the licensed CAs above.
    publicTlsCert: env('DX_PUBLIC_TLS_CERT', ''),
    publicTlsKey: env('DX_PUBLIC_TLS_KEY', ''),
    staticDir: path.resolve(env('DX_STATIC_DIR', new URL('../public', import.meta.url).pathname)),
    simulator: bool('DX_SIMULATOR', 'true'),
    simulatorMs: num('DX_SIMULATOR_MS', 60000),
    demoData: bool('DX_DEMO_DATA', 'true'),
    logRequests: bool('DX_LOG_REQUESTS', 'false'),
    rsDnsCheck: bool('DX_RS_DNS_CHECK', 'false'), // Figure 2 step 8: resource server host must resolve to the caller's address
  };
  return { ...cfg, ...overrides, dbFile: overrides.dbFile ?? cfg.dbFile };
}
