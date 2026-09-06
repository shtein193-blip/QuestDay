import crypto from 'node:crypto';

const MAX_AGE = 24 * 60 * 60;
const url = process.env.KV_REST_API_URL || process.env.KV_URL || process.env.REDIS_URL;
const token = process.env.KV_REST_API_TOKEN;

function validateInitData(raw, botToken) {
  if (!raw || !botToken) return null;
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!hash || !authDate || Math.floor(Date.now() / 1000) - authDate > MAX_AGE) return null;
  const pairs = [...params.entries()]
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculated = crypto.createHmac('sha256', secret).update(pairs).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(hash))) return null;
  const user = params.get('user');
  return user ? JSON.parse(user) : null;
}

async function kv(command, ...args) {
  const endpoint = `${String(url).replace(/\/$/, '')}/${command}/${args.map(encodeURIComponent).join('/')}`;
  const r = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { j = { error: text }; }
  if (!r.ok || j.error) throw new Error(`KV ${r.status}: ${String(j.error || j.message || 'request failed').slice(0,160)}`);
  return j;
}

async function registerUser(id) {
  const r = await fetch(`${url}/sadd/questday:users/${encodeURIComponent(String(id))}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) throw new Error(`KV users ${r.status}`);
}

async function updateLeaderboard(id, score) {
  const n = Number(score || 0);
  if (n <= 0) return;
  const r = await fetch(`${String(url).replace(/\/$/, '')}/zadd/questday:leaderboard/${encodeURIComponent(n)}/${encodeURIComponent(String(id))}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`KV leaderboard ${r.status}: ${t.slice(0,120)}`);
  }
}

export default async function handler(req) {
  if (!url || !token || !process.env.TELEGRAM_BOT_TOKEN) {
    return Response.json({ error: 'Cloud storage is not configured. Connect Upstash and provide KV_REST_API_URL, KV_REST_API_TOKEN and TELEGRAM_BOT_TOKEN.' }, { status: 503 });
  }

  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('tma ')) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let user;
  try { user = validateInitData(auth.slice(4), process.env.TELEGRAM_BOT_TOKEN); }
  catch { user = null; }
  if (!user?.id) return Response.json({ error: 'Invalid Telegram init data' }, { status: 401 });

  const key = `questday:user:${user.id}`;

  try {
    await registerUser(user.id);
    if (req.method === 'GET') {
      const result = await kv('get', key);
      const data = result.result ? JSON.parse(result.result) : null;
      if (data) {
        data.user = { ...(data.user || {}), id: user.id, name: [user.first_name, user.last_name].filter(Boolean).join(' ') || data.user?.name || 'Искатель', username: user.username || null, language: user.language_code || 'ru' };
        if (Number(data.pendingReferralCoins || 0) > 0) {
          data.coins = Number(data.coins || 0) + Number(data.pendingReferralCoins || 0);
          data.pendingReferralCoins = 0;
          data.updatedAt = Date.now();
          await kv('set', key, JSON.stringify(data));
        }
        await updateLeaderboard(user.id, data.questScore);
      }
      return Response.json({ ok: true, data });
    }
    if (req.method === 'POST') {
      const body = await req.json();
      if (!body?.data || typeof body.data !== 'object') return Response.json({ error: 'Invalid data' }, { status: 400 });
      const existing = await kv('get', key);
      const existingData = existing.result ? JSON.parse(existing.result) : {};
      body.data.friends = Array.isArray(existingData.friends) ? existingData.friends.map(String) : (Array.isArray(body.data.friends) ? body.data.friends.map(String) : []);
      body.data.referral = existingData.referral || body.data.referral || { invitedBy: null, rewardClaimed: false };
      const pendingReferralCoins = Number(existingData.pendingReferralCoins || 0);
      if (pendingReferralCoins > 0) {
        body.data.coins = Number(body.data.coins || 0) + pendingReferralCoins;
        body.data.pendingReferralCoins = 0;
      }
      body.data.user = { ...(body.data.user || {}), id: user.id, name: [user.first_name, user.last_name].filter(Boolean).join(' ') || body.data.user?.name || 'Искатель', username: user.username || null, language: user.language_code || 'ru' };
      await kv('set', key, JSON.stringify(body.data));
      await updateLeaderboard(user.id, body.data.questScore);
      return Response.json({ ok: true, data: body.data });
    }
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST' } });
  } catch (e) {
    return Response.json({ ok: false, error: 'Storage error', detail: e?.message ? String(e.message).slice(0,220) : 'Unknown error' }, { status: 500 });
  }
}
