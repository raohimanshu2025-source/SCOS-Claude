// Creates the root CA, DX CA, server certificate, audit key and demo identity-provider key (once).
import { loadConfig } from '../src/config.js';
import { initPki } from '../src/identity/ca.js';
const cfg = loadConfig();
const extra = (process.env.DX_ALT_NAMES || '').split(',').map(s => s.trim()).filter(Boolean);
const p = initPki(cfg.pkiDir, { publicName: cfg.publicName, altNames: extra });
console.log(`PKI ready in ${p.dir}\n  root CA: ${p.rootCrt}\n  DX CA:   ${p.caCrt}\n  server:  ${p.serverCrt} (for ${cfg.publicName}, localhost${extra.length ? ', ' + extra.join(', ') : ''})\nKeep ${p.dir} private: it holds the CA keys.`);
