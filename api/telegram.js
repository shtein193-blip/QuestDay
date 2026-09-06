const APP_URL = 'https://quest-day-six.vercel.app';
export const runtime = 'nodejs';


async function registerTelegramUser(user) {
  const url = process.env.KV_REST_API_URL || process.env.KV_URL || process.env.REDIS_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token || !user?.id) return;
  const base = String(url).replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${token}` };
  const id = encodeURIComponent(String(user.id));
  const set = await fetch(`${base}/sadd/questday:users/${id}`, { headers });
  if (!set.ok) throw new Error(`KV user registration failed: ${set.status}`);
  const key = encodeURIComponent(`questday:user:${user.id}`);
  const exists = await fetch(`${base}/exists/${key}`, { headers });
  if (!exists.ok) throw new Error(`KV profile check failed: ${exists.status}`);
  const ej = await exists.json();
  if (Number(ej.result || 0) === 0) {
    const profile = { version:6, updatedAt:Date.now(), level:1,xp:0,totalXP:0,totalCompleted:0,streak:0,maxStreak:0,lastCompletedDate:null,completedDates:[],unlockedAchievements:{},quests:[],notes:{},stats:{strength:1,intelligence:1,endurance:1,discipline:1},profile:{name:'',age:null,height:null,weight:null,gender:'',goal:'balance',classId:null},user:{id:user.id,name:[user.first_name,user.last_name].filter(Boolean).join(' ')||'Искатель',username:user.username||null,language:user.language_code||'ru'},notifications:{wisdomDate:null},questScore:0,coins:0,title:'Новичок',boss:{weekKey:null,damage:0,defeated:false,rewardClaimed:false},bossesDefeated:0,friends:[],referral:{invitedBy:null,rewardClaimed:false}};
    const value = encodeURIComponent(JSON.stringify(profile));
    const saved = await fetch(`${base}/set/${key}/${value}`, { headers });
    if (!saved.ok) throw new Error(`KV profile creation failed: ${saved.status}`);
  }
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
    if (message?.from?.id) await registerTelegramUser(message.from);

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
