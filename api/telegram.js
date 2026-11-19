// Vercel-функция: вебхук Telegram-бота. Голосовые и посты подключённого канала → «Входящие» приложения.
//   • «/connect КОД» в канале — привязывает канал к человеку (код он получил кнопкой «Подключить Telegram»);
//   • голосовое / аудио / кружок — расшифровываем OpenAI Whisper и отдаём текст в базу (public.tg_drop);
//   • обычный текстовый пост — сразу в базу.
// Дальше приложение само забирает текст и Claude выделяет задачи без повторов.
// Переменные окружения Vercel (в код и логи не попадают):
//   TG_BOT_TOKEN — токен бота от @BotFather (из него же выводится секрет вебхука);
//   TG_DB_SECRET — секрет из app_private.tg_config (миграция 20261119); OPENAI_API_KEY — для Whisper;
//   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY — уже есть.
// Настройка вебхука один раз: открыть /api/telegram?setup=1.

const MAX_AUDIO = 20 * 1024 * 1024;   // Telegram Bot API отдаёт файлы до 20 МБ

const env = k => process.env[k] || '';
// секрет вебхука выводим из токена бота — отдельная переменная не нужна (TG_WEBHOOK_SECRET, если задан, важнее)
const whSecret = () => env('TG_WEBHOOK_SECRET') || (env('TG_BOT_TOKEN') ? require('crypto').createHash('sha256').update('wh:' + env('TG_BOT_TOKEN')).digest('hex').slice(0, 48) : '');
const tg = (method, body) => fetch(`https://api.telegram.org/bot${env('TG_BOT_TOKEN')}/${method}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
}).then(r => r.json()).catch(() => ({}));

async function db(fn, args) {
  const url = env('SUPABASE_URL').replace(/\/$/, ''), key = env('SUPABASE_PUBLISHABLE_KEY');
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_secret: env('TG_DB_SECRET'), ...args })
  });
  if (!r.ok) throw new Error('db ' + fn + ' ' + r.status);
  return r.json();
}

async function transcribe(fileId) {
  const f = await tg('getFile', { file_id: fileId });
  const path = f && f.result && f.result.file_path;
  if (!path) throw new Error('getFile');
  const a = await fetch(`https://api.telegram.org/file/bot${env('TG_BOT_TOKEN')}/${path}`);
  if (!a.ok) throw new Error('download');
  const buf = Buffer.from(await a.arrayBuffer());
  if (buf.length > MAX_AUDIO) throw new Error('too_big');
  const name = path.split('/').pop() || 'voice.ogg';
  const form = new FormData();
  form.append('file', new Blob([buf]), /\.(oga|ogg|mp3|m4a|wav|webm|mp4|mpeg|mpga|flac)$/i.test(name) ? name.replace(/\.oga$/i, '.ogg') : name + '.ogg');
  form.append('model', 'whisper-1');
  form.append('language', 'ru');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + env('OPENAI_API_KEY') }, body: form
  });
  if (!r.ok) throw new Error('whisper ' + r.status);
  const j = await r.json();
  return String(j.text || '').trim();
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      if (q.check) {   // самопроверка настроек: только да/нет, сами значения не показываем
        let dbs = 'нет переменной TG_DB_SECRET';
        if (env('TG_DB_SECRET')) dbs = await db('tg_drop', { p_chat: 0, p_text: 'check' }).then(() => 'ok', e => /401|403/.test(e.message) ? 'не совпадает с базой' : 'ошибка базы: ' + e.message);
        return res.status(200).json({ bot: !!env('TG_BOT_TOKEN'), db_secret: dbs, openai: !!env('OPENAI_API_KEY'), supabase: !!(env('SUPABASE_URL') && env('SUPABASE_PUBLISHABLE_KEY')) });
      }
      if (q.me) { const m = await tg('getMe'); return res.status(200).json({ bot: (m.result && m.result.username) || '' }); }
      if (q.setup && whSecret()) {   // адрес всегда наш, секрет — наш: ставить вебхук безопасно
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const r = await tg('setWebhook', { url: `https://${host}/api/telegram`, secret_token: whSecret(), allowed_updates: ['channel_post', 'message'] });
        return res.status(200).json({ ok: !!r.ok, description: r.description || '' });
      }
      return res.status(404).json({ ok: false });
    }
    if (req.method !== 'POST') return res.status(405).end();
    if (!whSecret() || req.headers['x-telegram-bot-api-secret-token'] !== whSecret()) return res.status(401).end();

    const u = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const m = u.channel_post || u.message;
    if (!m || !m.chat) return res.status(200).json({ ok: true });
    const chat = m.chat.id, title = m.chat.title || m.chat.username || [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') || 'Telegram';
    const text = String(m.text || m.caption || '').trim();

    const con = text.match(/^\/connect(?:@\w+)?\s+([a-f0-9]{16,64})\b/i);
    if (con) {
      const ok = await db('tg_link', { p_token: con[1].toLowerCase(), p_chat: chat, p_title: title }).catch(() => false);
      await tg('sendMessage', { chat_id: chat, text: ok ? '✅ Канал подключён к «Входящим» KaizenHub. Голосовые и посты отсюда будут разбираться на задачи.' : '⚠️ Код не подошёл. Нажмите «Подключить Telegram» в приложении ещё раз и пришлите новый код.' });
      return res.status(200).json({ ok: true });
    }

    const media = m.voice || m.audio || m.video_note;
    let body = text;
    if (media && media.file_id) {
      if (media.file_size && media.file_size > MAX_AUDIO) return res.status(200).json({ ok: true });
      const said = await transcribe(media.file_id).catch(() => '');
      body = [said, text].filter(Boolean).join('\n');
    }
    if (body && !body.startsWith('/')) await db('tg_drop', { p_chat: chat, p_text: body }).catch(() => false);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: true });   // Telegram не должен повторять запрос бесконечно
  }
};
