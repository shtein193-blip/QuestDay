const APP_URL = 'https://quest-day-six.vercel.app';
export const runtime = 'nodejs';

async function telegram(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed: ${JSON.stringify(data)}`);
  }
  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true, service: 'QuestDay Telegram webhook' });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const message = update?.message;
    const chatId = message?.chat?.id;
    const text = message?.text || '';
    if (!chatId) return res.status(200).json({ ok: true });

    const reply = {
      chat_id: chatId,
      text: text === '/start' || text.startsWith('/start ')
        ? '🏰 Добро пожаловать в QuestDay!\n\nТвой путь героя начинается сегодня. Выполняй квесты, получай XP, прокачивай характеристики и не теряй свою серию!\n\nГотов начать приключение?'
        : '⚔️ QuestDay ждёт тебя! Нажми кнопку ниже, чтобы открыть своё приключение.',
      reply_markup: { inline_keyboard: [[{ text: '⚔️ Начать приключение', web_app: { url: APP_URL } }]] }
    };

    if (text) await telegram('sendMessage', reply);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return res.status(500).json({ ok: false, error: 'Webhook error', detail: error instanceof Error ? error.message : String(error) });
  }
}
