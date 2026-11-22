// Vercel-функция: вебхук Telegram-бота. Голосовые и посты подключённого канала → «Входящие» приложения.
//   • «/connect КОД» в канале — привязывает канал к человеку (код он получил кнопкой «Подключить Telegram»);
//   • голосовое / аудио / кружок — расшифровываем OpenAI Whisper и отдаём текст в базу (public.tg_drop);
//   • обычный текстовый пост — сразу в базу.
// Дальше приложение само забирает текст и Claude выделяет задачи без повторов.
// Диалог (если на сервере есть ANTHROPIC_API_KEY): бот сам разбирает голосовое на задачи и присылает список с кнопками
// «✅ Отправить» / «✖ Отмена». Правка — текстом или голосом в ответ («вторую убери, срок у первой пятница»): Claude
// переделывает список. «ок» или ✅ — задачи уходят владельцу (public.tg_drop_tasks), приложение ставит их в «К выполнению».
// Черновик хранится в базе (app_private.tg_drafts), контекст — отделы, люди, уже существующие задачи — пишет приложение (tg_links.ctx).
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

// ---------- Claude: разбор текста на задачи и правки списка ----------
const OK_RX = /^(ок|окей|ok|okay|да|ага|го|отправ\S*|подтвер\S*|верно|всё верно|все верно|👍|✅)[\s.!]*$/i;
const NO_RX = /^(\/cancel|отмена|отменить|отмени|cancel|не надо)[\s.!]*$/i;
const todayKz = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());

async function claude(prompt) {
  const key = env('ANTHROPIC_API_KEY'); if (!key) return null;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 40000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env('ANTHROPIC_MODEL') || 'claude-sonnet-5-5', max_tokens: 3000,
        system: 'Отвечай только одним валидным JSON-объектом, без пояснений и без markdown.', messages: [{ role: 'user', content: prompt }] })
    });
    if (!r.ok) return null;
    const j = await r.json(); const txt = (j.content || []).map(c => c.text || '').join('');
    const a = txt.indexOf('{'), b = txt.lastIndexOf('}'); if (a < 0 || b <= a) return null;
    return JSON.parse(txt.slice(a, b + 1));
  } catch (e) { return null; } finally { clearTimeout(t); }
}
// доски, куда можно отправить задачи (площадки и доски недель «12 недель»), и доска по умолчанию — текущей недели
const boardsOf = c => (Array.isArray(c.boards) ? c.boards : []).filter(b => b && b.id).slice(0, 16);
const boardName = (c, id) => { const b = boardsOf(c).find(b => b.id === id) || boardsOf(c).find(b => b.id === c.defBoard); return b ? b.label || b.name : ''; };
const boardByName = (c, name) => { const n = String(name || '').toLowerCase().trim(); if (!n) return null;
  const wk = n.match(/(\d{1,2})/); const bs = boardsOf(c);
  return bs.find(b => String(b.label || b.name).toLowerCase() === n) || bs.find(b => String(b.name).toLowerCase() === n) || (wk && /нед/.test(n) ? bs.find(b => +b.week === +wk[1]) : null) || bs.find(b => String(b.label || b.name).toLowerCase().includes(n)) || null; };
const ctxText = c => {
  const depts = (c.depts || []).slice(0, 60), people = (c.people || []).slice(0, 80), have = (c.existing || []).slice(0, 200);
  return `Сегодня ${todayKz()}. Отделы: ${depts.join(', ') || 'нет данных'}.
Команда (имя и роль/отдел): ${people.map(p => p.role ? `${p.name} (${p.role})` : p.name).join('; ') || 'нет данных'}.
Доски, куда можно отправить задачи: ${boardsOf(c).map(b => b.label || b.name).join('; ') || 'одна'}.
Задачи, которые УЖЕ есть (не повторяй их, даже если сказано другими словами):
${have.length ? have.map(t => '- ' + t).join('\n') : '- нет'}`;
};
const TASK_RULES = `Каждая задача: title — коротко, с глагола, до 90 символов; dept — отдел из списка, если подходит, иначе короткое название нового отдела (1–2 слова);
не используй отдел со словом «Контент» (это отдельный раздел видео) — для задач про ролики и соцсети бери подходящий отдел из списка или «SMM»;
type — "strat" (стратегия и рост) или "oper" (текущая работа); due — дата YYYY-MM-DD, только если срок назван или однозначно следует из текста («до пятницы», «завтра»), иначе null;
time — время HH:MM, если оно названо («в 15:00», «к трём часам дня»), иначе null;
who — ответственный: если назван человек или роль («ассистентам», «монтажёру», «Ане») — ТОЧНОЕ ИМЯ человека из списка команды с подходящим именем или должностью (если подходят несколько — первый), если такого нет — слово из текста, иначе null.`;
const extractPrompt = (text, c) => `Ты помогаешь руководителю разобрать голосовое или сообщение на задачи.
${ctxText(c)}
Выдели только РЕАЛЬНЫЕ задачи — конкретные действия. Не включай обсуждения, мнения, факты, уже сделанное. Одна задача, сказанная несколько раз разными словами, — одна.
${TASK_RULES}
Если сказано, на какую доску или неделю отправить («на неделю 4», «в бэклог») — верни "board": точное название доски из списка, иначе null.
Ответь JSON: {"tasks":[{"title":"…","dept":"…","type":"oper","due":null,"time":null,"who":null}],"board":null}

Текст:
${String(text).slice(0, 12000)}`;
const editPrompt = (tasks, fix, c) => `Есть список задач (JSON). Руководитель просит его поправить.
${ctxText(c)}
Текущий список:
${JSON.stringify(tasks)}
Правка руководителя: «${String(fix).slice(0, 4000)}»
Примени правку: убери, добавь, переименуй, поменяй срок, ответственного, отдел или тип — как сказано. Остальное оставь как было.
Если в правке новые задачи — добавь их по тем же правилам.
${TASK_RULES}
Если правка про доску или неделю («отправь на неделю 5», «в бэклог») — верни "board": точное название доски из списка, задачи не меняй; иначе "board": null.
Ответь JSON: {"tasks":[…],"board":null}`;
const cleanTasks = res => (Array.isArray(res && res.tasks) ? res.tasks : []).filter(t => t && String(t.title || '').trim()).slice(0, 40).map(t => ({
  title: String(t.title).trim().slice(0, 200), dept: t.dept ? String(t.dept).slice(0, 40) : '', type: t.type === 'strat' ? 'strat' : 'oper',
  due: /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : null, time: /^\d{1,2}:\d{2}$/.test(t.time || '') ? t.time : null, who: t.who ? String(t.who).slice(0, 60) : null, ...(t.board ? { board: String(t.board).slice(0, 60) } : {}) }));
// напоминание: назвали время — за 10 минут, только день — в 10:00 (так же считает приложение, tgRemind)
const remTxt = t => { if (!t.due) return ''; if (!t.time) return '⏰ ' + fmtDate(t.due) + ' в 10:00'; const [h, m] = t.time.split(':').map(Number); const x = h * 60 + m - 10; return `⏰ ${fmtDate(t.due)} в ${String(Math.floor((x + 1440) % 1440 / 60)).padStart(2, '0')}:${String((x + 1440) % 60).padStart(2, '0')}`; };
const inTeam = (who, c) => !who || (c.people || []).some(p => String(p.name || '').toLowerCase() === String(who).toLowerCase());
const fmtDate = d => d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '';
const listText = (tasks, head, c = {}) => `${head}\n${boardLine(tasks, c)}\n${tasks.map((t, i) => `${i + 1}. ${t.title}\n    ${[t.who ? '👤 ' + t.who + (inTeam(t.who, c) ? '' : ' (нет в «Команде»)') : '👤 не назначен', t.dept ? '🏷 ' + t.dept : '', t.due ? '📅 до ' + fmtDate(t.due) + (t.time ? ' ' + t.time : '') : '', remTxt(t), t.type === 'strat' ? '⭐ стратегическая' : ''].filter(Boolean).join(' · ')}`).join('\n')}

Всё верно? Нажмите ✅ или напишите «ок» — задачи уйдут в «К выполнению».
Поправить — напишите или наговорите, что изменить.`;
const KB0 = [{ text: '✅ Отправить', callback_data: 'tg_ok' }, { text: '✖ Отмена', callback_data: 'tg_no' }];
// кнопки: «Отправить / Отмена» и ниже доски (выбранная — с ●), по две в ряд
const kbFor = (c, cur) => { const bs = boardsOf(c); const rows = [KB0];
  for (let i = 0; i < bs.length; i += 2) rows.push(bs.slice(i, i + 2).map(b => ({ text: (b.id === cur ? '● ' : '') + String(b.label || b.name).slice(0, 28), callback_data: ('tg_b:' + b.id).slice(0, 64) })));
  return { inline_keyboard: rows }; };
const curBoard = (tasks, c) => (tasks.find(t => t.board) || {}).board || c.defBoard || (boardsOf(c)[0] || {}).id || null;
const boardLine = (tasks, c) => { const n = boardName(c, curBoard(tasks, c)); return n ? `📋 Доска: ${n}${boardsOf(c).length > 1 ? ' (сменить — кнопками ниже или словами «на неделю 4»)' : ''}\n` : ''; };
const say = (chat, text, extra) => tg('sendMessage', { chat_id: chat, text: text.slice(0, 4000), ...(extra || {}) });
const unkb = (chat, msg) => msg ? tg('editMessageReplyMarkup', { chat_id: chat, message_id: msg, reply_markup: { inline_keyboard: [] } }) : null;

async function approve(chat) {
  const d = await db('tg_draft_get', { p_chat: chat }).catch(() => null);
  if (!d || !Array.isArray(d.tasks) || !d.tasks.length) { await say(chat, 'Нечего отправлять — пришлите голосовое или текст с задачами.'); return; }
  const ok = await db('tg_drop_tasks', { p_chat: chat, p_tasks: d.tasks }).catch(() => false);
  await unkb(chat, d.msg_id);
  const info = await db('tg_ctx', { p_chat: chat }).catch(() => null); const bn = boardName((info && info.ctx) || {}, curBoard(d.tasks, {}));
  await say(chat, ok ? `✅ Отправлено: ${d.tasks.length} — задачи в «К выполнению»${bn ? ` доски «${bn}»` : ''} KaizenHub.` : '⚠️ Не получилось отправить. Попробуйте ещё раз.');
}
// кнопка доски под списком: все задачи черновика — на эту доску, список перерисовывается
async function pickBoard(chat, id) {
  const d = await db('tg_draft_get', { p_chat: chat }).catch(() => null); if (!d || !Array.isArray(d.tasks) || !d.tasks.length) return;
  const info = await db('tg_ctx', { p_chat: chat }).catch(() => null); const c = (info && info.ctx) || {};
  if (!boardsOf(c).some(b => b.id === id)) return;
  d.tasks.forEach(t => { t.board = id; });
  await db('tg_draft_set', { p_chat: chat, p_tasks: d.tasks, p_msg: d.msg_id || null }).catch(() => false);
  if (d.msg_id) await tg('editMessageText', { chat_id: chat, message_id: d.msg_id, text: listText(d.tasks, `📝 Задачи (${d.tasks.length}):`, c).slice(0, 4000), reply_markup: kbFor(c, id) });
}
async function cancel(chat) {
  const d = await db('tg_draft_get', { p_chat: chat }).catch(() => null);
  await db('tg_draft_set', { p_chat: chat, p_tasks: null, p_msg: null }).catch(() => false);
  if (d) await unkb(chat, d.msg_id);
  await say(chat, 'Отменено. Пришлите новое голосовое, когда будет нужно.');
}
// разбор нового текста или правка черновика; false — Claude недоступен (тогда текст уйдёт во «Входящие» как раньше)
async function dialog(chat, text) {
  const info = await db('tg_ctx', { p_chat: chat }).catch(() => null);
  if (!info) return true;                                   // канал не подключён — молчим
  const c = info.ctx || {};
  const d = await db('tg_draft_get', { p_chat: chat }).catch(() => null);
  const res = await claude(d && d.tasks && d.tasks.length ? editPrompt(d.tasks, text, c) : extractPrompt(text, c));
  if (!res) return false;
  const tasks = cleanTasks(res);
  // доска: названа в голосовом/правке → её id; иначе — прежняя из черновика или доска текущей недели
  const named = res.board ? boardByName(c, res.board) : null; const prev = d && d.tasks ? curBoard(d.tasks, {}) : null;
  const bid = (named && named.id) || prev || curBoard([], c); if (bid) tasks.forEach(t => { t.board = bid; });
  if (!tasks.length) { await say(chat, d ? 'После правки задач не осталось. Напишите «отмена» или пришлите новое голосовое.' : 'Задач в сообщении не нашёл 🤔 Попробуйте сказать конкретнее: что сделать, кому и к какому сроку.'); if (d) await db('tg_draft_set', { p_chat: chat, p_tasks: [], p_msg: null }).catch(() => false); return true; }
  if (d) await unkb(chat, d.msg_id);
  const m = await say(chat, listText(tasks, d ? `✏️ Поправил. Задачи (${tasks.length}):` : `📝 Нашёл задачи (${tasks.length}):`, c) + (tasks.some(t => t.who && !inTeam(t.who, c)) ? '\n\n💡 «нет в «Команде»» — в KaizenHub → «Команда» впишите людям должность (например, «Ассистент»), тогда бот найдёт ответственного сам.' : ''), { reply_markup: kbFor(c, bid) });
  await db('tg_draft_set', { p_chat: chat, p_tasks: tasks, p_msg: (m.result && m.result.message_id) || null }).catch(() => false);
  return true;
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
        const wi = await tg('getWebhookInfo'); const w = wi.result || {};
        return res.status(200).json({ webhook: { set: !!w.url, pending: w.pending_update_count || 0, last_error: w.last_error_message || '', last_error_at: w.last_error_date ? new Date(w.last_error_date * 1000).toISOString() : '', updates: w.allowed_updates || [] }, bot: !!env('TG_BOT_TOKEN'), db_secret: dbs, openai: !!env('OPENAI_API_KEY'), supabase: !!(env('SUPABASE_URL') && env('SUPABASE_PUBLISHABLE_KEY')), claude: !!env('ANTHROPIC_API_KEY') });
      }
      if (q.me) { const m = await tg('getMe'); return res.status(200).json({ bot: (m.result && m.result.username) || '' }); }
      if (q.setup && whSecret()) {   // адрес всегда наш, секрет — наш: ставить вебхук безопасно
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const r = await tg('setWebhook', { url: `https://${host}/api/telegram`, secret_token: whSecret(), allowed_updates: ['channel_post', 'message', 'callback_query'] });
        return res.status(200).json({ ok: !!r.ok, description: r.description || '' });
      }
      return res.status(404).json({ ok: false });
    }
    if (req.method !== 'POST') return res.status(405).end();
    if (!whSecret() || req.headers['x-telegram-bot-api-secret-token'] !== whSecret()) return res.status(401).end();

    const u = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (u.callback_query) {                                  // кнопки ✅ / ✖ под списком
      const q = u.callback_query; const ch = q.message && q.message.chat && q.message.chat.id;
      await tg('answerCallbackQuery', { callback_query_id: q.id });
      if (ch && q.data === 'tg_ok') await approve(ch); else if (ch && q.data === 'tg_no') await cancel(ch);
      else if (ch && /^tg_b:/.test(q.data || '')) await pickBoard(ch, q.data.slice(5));
      return res.status(200).json({ ok: true });
    }
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
      body = said || text ? '🎙 ' + [said, text].filter(Boolean).join('\n') : '';
      if (!said) { await say(chat, '⚠️ Не удалось расшифровать голосовое. Проверьте баланс OpenAI или пришлите текстом.'); return res.status(200).json({ ok: true }); }
    }
    if (!body) return res.status(200).json({ ok: true });
    const plain = body.replace(/^🎙\s*/, '').trim();
    if (NO_RX.test(plain)) { await cancel(chat); return res.status(200).json({ ok: true }); }
    if (OK_RX.test(plain)) { await approve(chat); return res.status(200).json({ ok: true }); }
    if (body.startsWith('/')) return res.status(200).json({ ok: true });
    const done = env('ANTHROPIC_API_KEY') ? await dialog(chat, plain).catch(() => false) : false;
    if (!done) await db('tg_drop', { p_chat: chat, p_text: body }).catch(() => false);   // без Claude — как раньше, во «Входящие»
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: true });   // Telegram не должен повторять запрос бесконечно
  }
};
