import crypto from 'node:crypto';

const MAX_AGE = 24 * 60 * 60;

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
  if (calculated.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(hash))) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}

async function telegram(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`Telegram ${method} failed`);
  return data;
}

function clean(value, max = 180) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

function buildMessage(event, payload) {
  const title = clean(payload?.title, 100) || 'Квест';
  const xp = Math.max(0, Math.min(10000, Number(payload?.xp) || 0));
  const level = Math.max(1, Math.min(999, Number(payload?.level) || 1));
  const streak = Math.max(0, Math.min(9999, Number(payload?.streak) || 0));
  const achievement = clean(payload?.achievement, 100);
  const reward = clean(payload?.reward, 80);
  const wisdom = clean(payload?.wisdom, 700);

  switch (event) {
    case 'quest_completed':
      return `⚔️ Квест выполнен!\n\n«${title}»\n🎁 +${xp} XP\n\nПродолжай путь, герой!`;
    case 'achievement':
      return `🏆 Новое достижение!\n\n${achievement || 'Новое достижение'}\n${reward ? `🎁 Награда: ${reward}\n` : ''}\nТвой подвиг записан в летопись QuestDay.`;
    case 'level_up':
      return `🎉 Уровень повышен!\n\n⭐ Теперь ты — уровень ${level}!\n\nСтановись сильнее и продолжай приключение.`;
    case 'streak':
      return `🔥 Серия продолжается!\n\nТы держишь серию ${streak} ${streak === 1 ? 'день' : streak < 5 ? 'дня' : 'дней'}.\n\nНе дай огню погаснуть!`;
    case 'wisdom':
      return `💡 Мудрость дня\n\n${wisdom || 'Каждый день — новый шанс прокачать себя.'}\n\n⚔️ Твой следующий квест уже ждёт.`;
    default:
      return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('tma ')) return res.status(401).json({ error: 'Unauthorized' });
    const user = validateInitData(auth.slice(4), process.env.TELEGRAM_BOT_TOKEN);
    if (!user?.id) return res.status(401).json({ error: 'Invalid Telegram init data' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const event = clean(body?.event, 40);
    const text = buildMessage(event, body?.data || {});
    if (!text) return res.status(400).json({ error: 'Unknown event' });

    await telegram('sendMessage', { chat_id: user.id, text });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Telegram notification error:', error);
    return res.status(500).json({ ok: false, error: 'Notification failed' });
  }
}
