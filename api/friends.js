import crypto from 'node:crypto';

const MAX_AGE = 24 * 60 * 60;
const REFERRAL_REWARD = 100; // Quest Coins for the inviter
const MAX_FRIENDS = 50;
const url = process.env.KV_REST_API_URL;
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
  const r = await fetch(`${url}/${command}/${args.map(encodeURIComponent).join('/')}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`KV ${r.status}`);
  return r.json();
}

async function getProfile(id) {
  const r = await kv('get', `questday:user:${id}`);
  return r.result ? JSON.parse(r.result) : null;
}

async function registerUser(id) {
  const r = await fetch(`${url}/sadd/questday:users/${encodeURIComponent(String(id))}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) throw new Error(`KV sadd ${r.status}`);
}

async function getRegisteredUserIds() {
  const r = await fetch(`${url}/smembers/questday:users`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) throw new Error(`KV smembers ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`KV smembers: ${j.error}`);
  return Array.isArray(j.result) ? j.result.map(String).filter(id => /^\d+$/.test(id)) : [];
}

async function updateLeaderboard(id, score) {
  const n = Number(score || 0);
  // Keep a sorted-set index so future leaderboard reads are fast and do not
  // need to scan every profile. Zero-score users are removed from the index.
  const r = await fetch(`${url}/zadd/questday:leaderboard/${encodeURIComponent(n)}/${encodeURIComponent(String(id))}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) throw new Error(`KV zadd ${r.status}`);
}

async function getLeaderboardIds(limit = 100) {
  const r = await fetch(`${url}/zrevrange/questday:leaderboard/0/${Math.max(0, limit - 1)}/WITHSCORES`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) throw new Error(`KV zrevrange ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`KV zrevrange: ${j.error}`);
  const result = Array.isArray(j.result) ? j.result : [];
  const ids = [];
  for (let i = 0; i < result.length; i += 2) {
    const id = String(result[i]);
    if (/^\d+$/.test(id)) ids.push(id);
  }
  return ids;
}

async function setProfile(id, profile) {
  profile.updatedAt = Date.now();
  await kv('set', `questday:user:${id}`, JSON.stringify(profile));
  if (Number(profile.questScore || 0) > 0) await updateLeaderboard(id, profile.questScore);
}

function publicPlayer(id, profile) {
  const p = profile || {};
  const u = p.user || {};
  const pr = p.profile || {};
  const classMap = {
    warrior: { icon: '⚔️', name: 'Воин' },
    guardian: { icon: '🛡️', name: 'Страж' },
    mage: { icon: '🧙', name: 'Маг' },
    monk: { icon: '🥋', name: 'Монах' }
  };
  const cls = classMap[pr.classId] || { icon: '🧙', name: 'Герой' };
  return {
    id: String(id),
    name: String(pr.name || u.name || 'Искатель').slice(0, 40),
    username: u.username || null,
    score: Number(p.questScore || 0),
    level: Number(p.level || 1),
    streak: Number(p.streak || 0),
    title: String(p.title || 'Новичок').slice(0, 40),
    classId: pr.classId || null,
    classIcon: cls.icon,
    className: cls.name
  };
}

export default async function handler(req, res) {
  if (!url || !token || !process.env.TELEGRAM_BOT_TOKEN) return res.status(503).json({ error: 'Cloud storage is not configured.' });
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('tma ')) return res.status(401).json({ error: 'Unauthorized' });

  let verified;
  try { verified = validateInitData(auth.slice(4), process.env.TELEGRAM_BOT_TOKEN); } catch { verified = null; }
  const user = verified?.user;
  if (!user?.id) return res.status(401).json({ error: 'Invalid Telegram init data' });

  try {
    await registerUser(user.id);
    let me = await getProfile(user.id);
    const startParam = verified.startParam;

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const action = body.action || 'register';
      if (action !== 'register') return res.status(400).json({ error: 'Unknown action' });

      const currentFriends = Array.isArray(me?.friends) ? me.friends.map(String) : [];
      const referral = me?.referral || { invitedBy: null, rewardClaimed: false };
      let bonus = 0;
      let invitedBy = referral.invitedBy || null;

      if (!me) {
        me = {
          version: 6,
          updatedAt: Date.now(),
          level: 1, xp: 0, totalXP: 0, totalCompleted: 0, streak: 0, maxStreak: 0,
          lastCompletedDate: null, completedDates: [], unlockedAchievements: {}, quests: [], notes: {},
          stats: { strength: 1, intelligence: 1, endurance: 1, discipline: 1 },
          profile: { name: '', age: null, height: null, weight: null, gender: '', goal: 'balance', classId: null },
          user: { id: user.id, name: [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Искатель', username: user.username || null, language: user.language_code || 'ru' },
          notifications: { wisdomDate: null }, questScore: 0, coins: 0, title: 'Новичок',
          boss: { weekKey: null, damage: 0, defeated: false, rewardClaimed: false }, bossesDefeated: 0,
          friends: [], referral: { invitedBy: null, rewardClaimed: false }
        };
      }

      const refMatch = /^ref_(\d+)$/.exec(startParam || '');
      const inviterId = refMatch ? refMatch[1] : null;
      if (!invitedBy && inviterId && inviterId !== String(user.id)) {
        const inviter = await getProfile(inviterId);
        if (inviter) {
          const inviterFriends = Array.isArray(inviter.friends) ? inviter.friends.map(String) : [];
          if (!inviterFriends.includes(String(user.id))) inviterFriends.push(String(user.id));
          inviter.friends = inviterFriends.slice(0, MAX_FRIENDS);
          inviter.pendingReferralCoins = Number(inviter.pendingReferralCoins || 0) + REFERRAL_REWARD;
          inviter.updatedAt = Date.now();
          await setProfile(inviterId, inviter);

          invitedBy = inviterId;
          referral.invitedBy = inviterId;
          referral.rewardClaimed = true;
          me.coins = Number(me.coins || 0);
          me.friends = [...new Set([...currentFriends, inviterId])].slice(0, MAX_FRIENDS);
          bonus = 0;
        }
      }

      me.friends = [...new Set([...(Array.isArray(me.friends) ? me.friends.map(String) : []), ...(invitedBy ? [invitedBy] : [])])].slice(0, MAX_FRIENDS);
      me.referral = referral;
      me.user = { ...(me.user || {}), id: user.id, name: [user.first_name, user.last_name].filter(Boolean).join(' ') || me.user?.name || 'Искатель', username: user.username || null, language: user.language_code || 'ru' };
      await setProfile(user.id, me);
      return res.status(200).json({ ok: true, bonus, friends: me.friends });
    }

    if (req.method === 'GET') {
      // Global rating uses a dedicated player directory. No Redis SCAN is needed.
      if (Number(me?.questScore || 0) > 0) await updateLeaderboard(user.id, me.questScore);
      const registeredIds = await getRegisteredUserIds();
      const indexedIds = await getLeaderboardIds(100);
      const ids = [...new Set([...registeredIds, ...indexedIds])].slice(0, 500);
      const players = [];
      for (const id of ids) {
        const profile = id === String(user.id) ? me : await getProfile(id);
        if (profile && Number(profile.questScore || 0) > 0) {
          players.push(publicPlayer(id, profile));
          await updateLeaderboard(id, profile.questScore);
        }
      }
      players.sort((a, b) => b.score - a.score || b.streak - a.streak || b.level - a.level || a.name.localeCompare(b.name, 'ru'));
      return res.status(200).json({ ok: true, players, playerCount: players.length });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Friends API error:', error);
    return res.status(500).json({ ok: false, error: 'Friends service error', detail: error?.message ? String(error.message).slice(0, 160) : 'Unknown error' });
  }
}
