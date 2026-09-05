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
  try {
    const setupSecret = process.env.TELEGRAM_SETUP_SECRET;
    const url = new URL(req.url, `https://${req.headers.host}`);
    const provided = url.searchParams.get('secret');

    if (!setupSecret || !provided || provided !== setupSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || setupSecret;
    const webhookUrl = `${url.origin}/api/telegram`;

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

    return res.status(200).json({ ok: true, webhook, menu, webhookUrl });
  } catch (error) {
    console.error('Telegram setup error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Telegram setup failed',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}
