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
  const setupSecret = process.env.TELEGRAM_SETUP_SECRET;
  const provided = new URL(req.url).searchParams.get('secret');
  if (!setupSecret || !provided || provided !== setupSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return Response.json({ error: 'TELEGRAM_BOT_TOKEN is missing' }, { status: 503 });
  }

  try {
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || setupSecret;
    const webhookUrl = `${new URL(req.url).origin}/api/telegram`;

    const webhook = await telegram('setWebhook', {
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ['message']
    });

    const menu = await telegram('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: '⚔️ Начать приключение',
        web_app: { url: APP_URL }
      }
    });

    return Response.json({ ok: true, webhook, menu, webhookUrl });
  } catch (error) {
    console.error('Telegram setup error:', error);
    return Response.json({ error: 'Telegram setup failed' }, { status: 500 });
  }
}
