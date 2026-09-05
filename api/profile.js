import crypto from 'node:crypto';

const MAX_AGE = 24 * 60 * 60;
const url = process.env.KV_REST_API_URL;
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
  const r = await fetch(`${url}/${command}/${args.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) throw new Error(`KV ${r.status}`);
  return r.json();
}

export default async function handler(req) {
  if (!url || !token || !process.env.TELEGRAM_BOT_TOKEN) {
    return Response.json({ error: 'Cloud storage is not configured. Add KV_REST_API_URL, KV_REST_API_TOKEN and TELEGRAM_BOT_TOKEN.' }, { status: 503 });
  }

  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('tma ')) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let user;
  try { user = validateInitData(auth.slice(4), process.env.TELEGRAM_BOT_TOKEN); }
  catch { user = null; }
  if (!user?.id) return Response.json({ error: 'Invalid Telegram init data' }, { status: 401 });

  const key = `questday:user:${user.id}`;

  try {
    if (req.method === 'GET') {
      const result = await kv('get', key);
      const data = result.result ? JSON.parse(result.result) : null;
      return Response.json({ ok: true, data });
    }
    if (req.method === 'POST') {
      const body = await req.json();
      if (!body?.data || typeof body.data !== 'object') return Response.json({ error: 'Invalid data' }, { status: 400 });
      body.data.user = { ...(body.data.user || {}), id: user.id, name: [user.first_name, user.last_name].filter(Boolean).join(' ') || body.data.user?.name || 'Искатель', username: user.username || null, language: user.language_code || 'ru' };
      await kv('set', key, JSON.stringify(body.data));
      return Response.json({ ok: true, data: body.data });
    }
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST' } });
  } catch (e) {
    return Response.json({ error: 'Storage error' }, { status: 500 });
  }
}
