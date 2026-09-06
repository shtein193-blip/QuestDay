import crypto from 'node:crypto';

const MAX_AGE = 24 * 60 * 60;
const REFERRAL_REWARD = 100;
const MAX_FRIENDS = 50;
const url = process.env.KV_REST_API_URL || process.env.KV_URL || process.env.REDIS_URL;
const token = process.env.KV_REST_API_TOKEN;

function validateInitData(raw, botToken) {
  if (!raw || !botToken) return null;
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!hash || !authDate || Math.floor(Date.now() / 1000) - authDate > MAX_AGE) return null;
  const pairs = [...params.entries()].filter(([k]) => k !== 'hash').sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculated = crypto.createHmac('sha256', secret).update(pairs).digest('hex');
  if (calculated.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(hash))) return null;
  try { return { user: JSON.parse(params.get('user') || 'null'), startParam: params.get('start_param') || '' }; } catch { return null; }
}

async function kv(command, ...args) {
  if (!url || !token) throw new Error('KV_REST_API_URL/KV_REST_API_TOKEN are missing');
  const endpoint = `${String(url).replace(/\/$/, '')}/${command}/${args.map(encodeURIComponent).join('/')}`;
  const r = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  const text = await r.text();
  let j; try { j = text ? JSON.parse(text) : {}; } catch { j = { error: text }; }
  if (!r.ok || j.error) throw new Error(`KV ${r.status}: ${String(j.error || j.message || 'request failed').slice(0,160)}`);
  return j;
}

async function getProfile(id) {
  const r = await kv('get', `questday:user:${id}`);
  return r.result ? JSON.parse(r.result) : null;
}

async function registerUser(id) {
  await kv('sadd', 'questday:users', String(id));
}

function publicPlayer(id, profile) {
  const p = profile || {};
  const u = p.user || {};
  const pr = p.profile || {};
  const classMap = { warrior:{icon:'⚔️',name:'Воин'}, guardian:{icon:'🛡️',name:'Страж'}, mage:{icon:'🧙',name:'Маг'}, monk:{icon:'🥋',name:'Монах'} };
  const cls = classMap[pr.classId] || {icon:'🧙',name:'Герой'};
  return {
    id:String(id), name:String(pr.name || u.name || 'Искатель').slice(0,40), username:u.username || null,
    score:Number(p.questScore || 0), level:Number(p.level || 1), streak:Number(p.streak || 0),
    title:String(p.title || 'Новичок').slice(0,40), classId:pr.classId || null, classIcon:cls.icon, className:cls.name
  };
}

export default async function handler(req, res) {
  if (!url || !token || !process.env.TELEGRAM_BOT_TOKEN) return res.status(503).json({ok:false,error:'Cloud storage is not configured.',detail:'Need KV_REST_API_URL, KV_REST_API_TOKEN and TELEGRAM_BOT_TOKEN.'});
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('tma ')) return res.status(401).json({ok:false,error:'Unauthorized'});
  let verified;
  try { verified = validateInitData(auth.slice(4), process.env.TELEGRAM_BOT_TOKEN); } catch { verified = null; }
  const user = verified?.user;
  if (!user?.id) return res.status(401).json({ok:false,error:'Invalid Telegram init data'});

  try {
    await registerUser(user.id);
    let me = await getProfile(user.id);

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      if ((body.action || 'register') !== 'register') return res.status(400).json({ok:false,error:'Unknown action'});
      if (!me) {
        me = { version:6, updatedAt:Date.now(), level:1,xp:0,totalXP:0,totalCompleted:0,streak:0,maxStreak:0,lastCompletedDate:null,completedDates:[],unlockedAchievements:{},quests:[],notes:{},stats:{strength:1,intelligence:1,endurance:1,discipline:1},profile:{name:'',age:null,height:null,weight:null,gender:'',goal:'balance',classId:null},user:{id:user.id,name:[user.first_name,user.last_name].filter(Boolean).join(' ')||'Искатель',username:user.username||null,language:user.language_code||'ru'},notifications:{wisdomDate:null},questScore:0,coins:0,title:'Новичок',boss:{weekKey:null,damage:0,defeated:false,rewardClaimed:false},bossesDefeated:0,friends:[],referral:{invitedBy:null,rewardClaimed:false}};
      }
      return res.status(200).json({ok:true,registered:true,hasProfile:Boolean(me),score:Number(me.questScore||0)});
    }

    if (req.method === 'GET') {
      const idsResult = await kv('smembers','questday:users');
      const ids = Array.isArray(idsResult.result) ? idsResult.result.map(String).filter(id => /^\d+$/.test(id)) : [];
      // Always include the authenticated player, even if an older database missed the set entry.
      if (!ids.includes(String(user.id))) ids.push(String(user.id));
      const players=[];
      for (const id of ids.slice(0,500)) {
        const profile = id === String(user.id) ? me : await getProfile(id);
        if (profile && Number(profile.questScore || 0) > 0) players.push(publicPlayer(id,profile));
      }
      players.sort((a,b)=>b.score-a.score || b.streak-a.streak || b.level-a.level || a.name.localeCompare(b.name,'ru'));
      return res.status(200).json({ok:true,players,playerCount:players.length,self:publicPlayer(user.id,me || {user})});
    }
    return res.status(405).json({ok:false,error:'Method not allowed'});
  } catch (error) {
    console.error('Friends API error:',error);
    return res.status(500).json({ok:false,error:'Friends service error',detail:error?.message?String(error.message).slice(0,220):'Unknown error'});
  }
}
