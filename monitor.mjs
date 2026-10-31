import dns from 'node:dns/promises';
import net from 'node:net';

const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
const WH = { apikey: KEY, 'Content-Type': 'application/json' };

async function get(p) {
  const r = await fetch(`${BASE}/rest/v1/${p}`, { headers: { apikey: KEY } });
  if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
  return r.json();
}
async function send(p, method, body) {
  const r = await fetch(`${BASE}/rest/v1/${p}`, { method, headers: WH, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
}

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') ||
    l.startsWith('fe80') || l.startsWith('::ffff:');
}

async function safe(u) {
  const x = new URL(u);
  if (!['http:', 'https:'].includes(x.protocol)) return false;
  const addrs = await dns.lookup(x.hostname, { all: true });
  return addrs.length > 0 && addrs.every(a => !isPrivate(a.address));
}

async function check(u) {
  let last = { statut: 'down', code: null, ms: null };
  for (let i = 0; i < 2; i++) {
    const t = Date.now();
    try {
      const r = await fetch(u, {
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'UpAlert-Monitor/1.0' },
      });
      const ms = Date.now() - t;
      if (r.status < 400) return { statut: ms > 3000 ? 'degraded' : 'up', code: r.status, ms };
      last = { statut: 'down', code: r.status, ms };
    } catch {
      last = { statut: 'down', code: null, ms: null };
    }
    if (i === 0) await new Promise(r => setTimeout(r, 3000));
  }
  return last;
}

const sites = await get('sites?select=id,url');
for (const s of sites) {
  try {
    if (!(await safe(s.url).catch(() => false))) { console.log('ignoré (URL non sûre):', s.url); continue; }
    const res = await check(s.url);
    await send('checks', 'POST', { site_id: s.id, code_http: res.code, temps_reponse_ms: res.ms, statut: res.statut });
    await send(`sites?id=eq.${s.id}`, 'PATCH', { statut: res.statut, dernier_temps_reponse: res.ms });
    const open = await get(`incidents?site_id=eq.${s.id}&fin=is.null&select=id`);
    if (res.statut === 'down' && open.length === 0) await send('incidents', 'POST', { site_id: s.id });
    if (res.statut !== 'down' && open.length > 0)
      await send(`incidents?site_id=eq.${s.id}&fin=is.null`, 'PATCH', { fin: new Date().toISOString() });
    console.log(s.url, res.statut, res.ms);
  } catch (e) { console.error(s.url, e.message); }
}

const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
await fetch(`${BASE}/rest/v1/checks?date=lt.${cutoff}`, { method: 'DELETE', headers: { apikey: KEY } });
