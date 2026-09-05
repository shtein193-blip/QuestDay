const APP_URL = 'https://quest-day-six.vercel.app';

async function telegram(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json();
}

export default async function handler(req) {
  if (req.method !== 'POST') return Response.json({ ok: true, service: 'QuestDay Telegram webhook' });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const update = await req.json();
    const message = update?.message;
    const chatId = message?.chat?.id;
    const text = message?.text || '';

    if (!chatId) return Response.json({ ok: true });

    if (text === '/start' || text.startsWith('/start ')) {
      await telegram('sendMessage', {
        chat_id: chatId,
        text: '🏰 Добро пожаловать в QuestDay!\n\nТвой путь героя начинается сегодня. Выполняй квесты, получай XP, прокачивай характеристики и не теряй свою серию!\n\nГотов начать приключение?',
        reply_markup: {
          inline_keyboard: [[
            { text: '⚔️ Начать приключение', web_app: { url: APP_URL } }
          ]]
        }
      });
      return Response.json({ ok: true });
    }

    if (text) {
      await telegram('sendMessage', {
        chat_id: chatId,
        text: '⚔️ QuestDay ждёт тебя! Нажми кнопку ниже, чтобы открыть своё приключение.',
        reply_markup: {
          inline_keyboard: [[
            { text: '⚔️ Начать приключение', web_app: { url: APP_URL } }
          ]]
        }
      });
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return Response.json({ error: 'Webhook error' }, { status: 500 });
  }
}
