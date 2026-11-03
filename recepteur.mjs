const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
const TG = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const WH = { apikey: KEY, 'Content-Type': 'application/json' };

async function tg(m, body) {
  const r = await fetch(`${TG}/${m}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}


let offset = 0;
const upd = await tg('getUpdates', { timeout: 0, allowed_updates: ['message'] });
if (!upd.ok) { console.error('getUpdates', JSON.stringify(upd)); process.exit(1); }

for (const u of upd.result) {
  offset = u.update_id + 1;
  const m = u.message;
  if (!m || !m.text) continue;
  const mt = m.text.match(/^\/start\s+([a-f0-9]{16})$/i);
  if (!mt) {
    await tg('sendMessage', { chat_id: m.chat.id, text: 'Bienvenue sur UpAlert. Pour recevoir tes alertes ici, utilise le bouton « Connecter mon Telegram » depuis ton tableau de bord.' });
    continue;
  }
  const code = mt[1].toLowerCase();
  const r = await fetch(`${BASE}/rest/v1/profils?telegram_code=eq.${code}`, { method: 'PATCH', headers: { ...WH, Prefer: 'return=representation' }, body: JSON.stringify({ telegram_chat_id: m.chat.id }) });
  const rows = r.ok ? await r.json() : [];
  await tg('sendMessage', { chat_id: m.chat.id, text: rows.length ? 'Telegram connecté ✅ Tu recevras tes alertes UpAlert ici.' : 'Code inconnu ou expiré. Reprends le lien depuis ton tableau de bord.' });
}

if (offset) await tg('getUpdates', { offset, timeout: 0 });
console.log('traité:', upd.result.length);
