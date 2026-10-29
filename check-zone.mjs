// Check helisikahelicopters.co.nz zone status + email-related DNS records. Never prints secrets.
import fs from 'node:fs';
import path from 'node:path';

const envPath = 'C:\\Users\\PC\\.openclaw\\workspace\\.env';
const env = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const token = env.CLOUDFLARE_API_TOKEN;
if (!token) { console.log('NO_TOKEN_IN_ENV_FILE'); process.exit(0); }
console.log('token: present (redacted), length', token.length);
console.log('RESEND_API_KEY in .env:', env.RESEND_API_KEY ? 'yes (redacted)' : 'no');

const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const zr = await fetch('https://api.cloudflare.com/client/v4/zones?name=helisikahelicopters.co.nz', { headers: H });
const zj = await zr.json();
if (!zj.success || zj.result.length === 0) {
  console.log('ZONE_NOT_FOUND in account. success=', zj.success, 'errors=', JSON.stringify(zj.errors));
  // List all zones to see what we do have
  const all = await fetch('https://api.cloudflare.com/client/v4/zones?per_page=50', { headers: H });
  const aj = await all.json();
  if (aj.success) {
    console.log('Zones in account:');
    for (const z of aj.result) console.log(`  - ${z.name} (${z.status}) id=${z.id}`);
  } else {
    console.log('List zones failed:', JSON.stringify(aj.errors));
  }
  process.exit(0);
}
const zone = zj.result[0];
console.log(`ZONE: ${zone.name} status=${zone.status} id=${zone.id}`);
console.log('nameservers:', (zone.name_servers || []).join(', '));

const dr = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records?per_page=100`, { headers: H });
const dj = await dr.json();
if (!dj.success) { console.log('DNS query failed:', JSON.stringify(dj.errors)); process.exit(0); }
console.log(`DNS records (${dj.result.length}):`);
for (const r of dj.result) {
  console.log(`  ${r.type} ${r.name} -> ${r.content}${r.priority != null ? ` prio=${r.priority}` : ''} proxied=${r.proxied}`);
}
