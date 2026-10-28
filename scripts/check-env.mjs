import { readFileSync } from 'node:fs';

let source;
try { source = readFileSync('.env', 'utf8'); }
catch { console.error('FAIL  .env does not exist. Copy .env.example to .env first.'); process.exit(1); }

const values = new Map();
for (const line of source.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  values.set(match[1], value);
}

const checks = [
  ['DATABASE_URL', value => /^postgresql:\/\/.+@.+:\d+\/.+/.test(value), 'a PostgreSQL connection URL'],
  ['ERP_API_TOKEN', value => value.length >= 24 && !value.includes('change-me'), 'at least 24 random characters, without the demo placeholder'],
  ['CASHFREE_CLIENT_ID', value => value.length >= 12 && value.toUpperCase().includes('TEST'), 'a Cashfree Payment Gateway test client ID'],
  ['CASHFREE_CLIENT_SECRET', value => value.length >= 24 && value.toLowerCase().includes('test'), 'a newly rotated Cashfree test client secret'],
  ['CASHFREE_API_VERSION', value => /^\d{4}-\d{2}-\d{2}$/.test(value), 'a YYYY-MM-DD API version'],
  ['PUBLIC_BASE_URL', value => /^https?:\/\//.test(value) && !value.includes('.example') && !value.includes('replace-with'), 'your current public HTTPS tunnel origin or local URL'],
];

let failed = false;
for (const [name, valid, expectation] of checks) {
  const value = values.get(name) ?? '';
  if (valid(value)) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}: expected ${expectation}`); failed = true; }
}

const port = Number(values.get('PORT') ?? '');
if (Number.isInteger(port) && port > 0 && port <= 65535) console.log('PASS  PORT');
else { console.log('FAIL  PORT: expected an integer from 1 to 65535'); failed = true; }

if (failed) {
  console.error('\nEnvironment is incomplete. No secret values were printed.');
  process.exit(1);
}
console.log('\nEnvironment shape is ready. This does not contact Cashfree or PostgreSQL.');
