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
//   APIFY_TOKEN — по желанию: на «план-факт» бот сам смотрит открытые страницы Instagram (Apify), без него — по сводке;
//   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY — уже есть.
// Настройка вебхука один раз: открыть /api/telegram?setup=1.

const MAX_AUDIO = 20 * 1024 * 1024;
const { PF_RX, planFactText, liveDays, mergeLive, sinceMonday } = require('./_planfact');   // план-факт роликов: ответ по запросу и вечерний обзор   // Telegram Bot API отдаёт файлы до 20 МБ

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

// приветствие на /start и /help: что это за бот и как с ним работать
const START_TEXT = `Kaizen AI — голосовой помощник KaizenHub.

KaizenHub — приложение, где вы ведёте проекты, доски и задачи команды. Kaizen AI помогает заносить туда задачи голосом: не нужно открывать приложение и заполнять карточки вручную.

Что умеет
— разбирает голосовое или текст на отдельные задачи;
— сам определяет ответственного, отдел, срок и тип задачи;
— ставит напоминание, если вы назвали срок;
— отвечает на вопросы по списку и вносит правки;
— отправляет задачи на нужную доску в KaizenHub.

Как это работает
1. Запишите голосовое или напишите, что нужно сделать. Например: «До пятницы ассистентам снять три ролика, а мне в 15:00 созвониться с партнёром».
2. Бот пришлёт список задач. Проверьте его. Если что-то не так, скажите или напишите, что поменять: «вторую убери», «срок у первой — суббота». Можно спросить: «какие из них стратегические?»
3. Выберите доску и нажмите «Отправить». Задачи появятся в KaizenHub в колонке «К выполнению».

Типы задач
Стратегические — то, что напрямую влияет на деньги и что делаете вы сами: переговоры, созвоны, продажи, цены, продукт.
Операционные — рутина, которую можно отдать ассистентам: создать или прогреть аккаунт, опубликовать, оформить.

Напоминания
Если вы назвали время, напоминание придёт за 10 минут до него. Если только день — в 10:00 этого дня.

План-факт роликов
Спросите «какой план-факт?», «отстаём?» или нажмите «📊 План-факт» — бот ответит, сколько публикаций вышло против плана недели и месяца, по каждому аккаунту, и сколько осталось. Каждый вечер в 22:00 он сам присылает такой обзор.

Кнопки
Под каждым списком есть кнопки для частых вопросов и правок. Внизу чата — план-факт, текущий список, эта инструкция и отмена списка.`;
// постоянные кнопки внизу чата (только в личке; в каналах Telegram такие кнопки не показывает)
const MAIN_KB = { keyboard: [[{ text: '📊 План-факт' }, { text: '📝 Текущий список' }], [{ text: '❓ Как работать' }, { text: '✖ Отменить список' }]], resize_keyboard: true, is_persistent: true, input_field_placeholder: 'Наговорите или напишите задачи…' };
const BTN_LIST = /^(📝\s*)?текущий список$|^\/list\b/i, BTN_HELP = /^(❓\s*)?как работать$/i, BTN_NO = /^(✖\s*)?отменить список$/i;
const START_CONNECT = `

Чтобы начать, подключите этот чат к KaizenHub: откройте «Производство», в колонке «Входящие» нажмите «Подключить Telegram», скопируйте код и пришлите его сюда.`;

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
  const dir = (c.dirs || []).find(d => String(d.name || '').toLowerCase() === n || n.includes(String(d.name || '').toLowerCase()) && String(d.name || '').length >= 3);
  if (dir && dir.board && boardsOf(c).some(b => b.id === dir.board)) return boardsOf(c).find(b => b.id === dir.board);
  const wk = n.match(/(\d{1,2})/); const bs = boardsOf(c);
  return bs.find(b => String(b.label || b.name).toLowerCase() === n) || bs.find(b => String(b.name).toLowerCase() === n) || (wk && /нед/.test(n) ? bs.find(b => +b.week === +wk[1]) : null) || bs.find(b => String(b.label || b.name).toLowerCase().includes(n)) || null; };
const ctxText = c => {
  const depts = (c.depts || []).slice(0, 60), people = (c.people || []).slice(0, 80), have = (c.existing || []).slice(0, 200);
  return `Сегодня ${todayKz()}. Отделы: ${depts.join(', ') || 'нет данных'}.
Команда (имя и роль/отдел): ${people.map(p => p.role ? `${p.name} (${p.role})` : p.name).join('; ') || 'нет данных'}.
Доски, куда можно отправить задачи: ${boardsOf(c).map(b => b.label || b.name).join('; ') || 'одна'}.
${(c.dirs || []).length ? `Направления (у каждого своя текущая доска): ${(c.dirs || []).map(d => `${d.name} → ${boardName(c, d.board) || 'нет доски'}`).join('; ')}. Если сказано «это в VPN», «для AntiSyllabus» и т.п. — board = текущая доска этого направления.\n` : ''}Руководитель (кто пишет боту): ${c.me || 'неизвестно'} — «на меня», «я сам», «мне» означает его.
Задачи, которые УЖЕ есть на досках (если задача из текста совпадает с одной из них по смыслу — всё равно включи её, но поставь "dup": true):
${have.length ? have.map(t => '- ' + t).join('\n') : '- нет'}`;
};
const TASK_RULES = `Каждая задача: title — коротко, с глагола, до 90 символов; dept — отдел из списка, если подходит, иначе короткое название нового отдела (1–2 слова);
не используй отдел со словом «Контент» (это отдельный раздел видео) — для задач про ролики и соцсети бери подходящий отдел из списка или «SMM»;
type — "strat" или "oper". СТРАТЕГИЧЕСКАЯ (strat) — напрямую влияет на деньги и прибыль: переговоры, созвоны, продажи, партнёрства, сделки, цены и экономика, а также то, что может сделать только руководитель лично (ключевые решения, доработка продукта). ОПЕРАЦИОННАЯ (oper) — рутина, которую можно отдать ассистенту: создать или прогреть аккаунт, полайкать, выложить, опубликовать, собрать, оформить, проверить по инструкции; due — дата YYYY-MM-DD, только если срок назван или однозначно следует из текста («до пятницы», «завтра»), иначе null;
time — время HH:MM, если оно названо («в 15:00», «к трём часам дня»), иначе null;
who — ответственный: если назван человек или роль («ассистентам», «монтажёру», «Ане») — ТОЧНОЕ ИМЯ человека из списка команды с подходящим именем или должностью (если подходят несколько — первый), если такого нет — слово из текста, иначе null.`;
const extractPrompt = (text, c) => `Ты помогаешь руководителю разобрать голосовое или сообщение на задачи.
${ctxText(c)}
Выдели только РЕАЛЬНЫЕ задачи — конкретные действия. Не включай обсуждения, мнения, факты, уже сделанное. Одна задача, сказанная несколько раз разными словами, — одна.
${TASK_RULES}
Если сказано, на какую доску или неделю отправить («на неделю 4», «в бэклог») — верни "board": точное название доски из списка, иначе null.
Ответь JSON: {"tasks":[{"title":"…","dept":"…","type":"oper","due":null,"time":null,"who":null,"dup":false}],"board":null}

Текст:
${String(text).slice(0, 12000)}`;
const editPrompt = (tasks, fix, c) => `Есть список задач (JSON). Руководитель пишет сообщение: это может быть ВОПРОС о задачах или ПРАВКА списка.
${ctxText(c)}
Текущий список:
${JSON.stringify(tasks)}
Сообщение руководителя: «${String(fix).slice(0, 4000)}»
Если это вопрос («какие из них стратегические?», «кому что лучше отдать?», «что важнее?») — ответь коротко и по делу в "answer" (простым текстом, можно списком с номерами задач), список не меняй, "changed": false.
Если это правка («операционные — ассистентам, стратегические — на меня», «вторую убери») — примени её к списку, "changed": true, в "answer" — одна короткая фраза, что сделано.
Применяя правку (у каждой задачи сохраняй её поле sid как есть): убери, добавь, переименуй, поменяй срок, ответственного, отдел или тип — как сказано. Остальное оставь как было.
Если в правке новые задачи — добавь их по тем же правилам.
${TASK_RULES}
Если правка про доску или неделю («отправь на неделю 5», «в бэклог») — верни "board": точное название доски из списка, задачи не меняй; иначе "board": null.
Ответь JSON: {"answer":"…","changed":true,"tasks":[…],"board":null}`;
const cleanTasks = res => (Array.isArray(res && res.tasks) ? res.tasks : []).filter(t => t && String(t.title || '').trim()).slice(0, 40).map(t => ({
  title: String(t.title).trim().slice(0, 200), dept: t.dept ? String(t.dept).slice(0, 40) : '', type: t.type === 'strat' ? 'strat' : 'oper',
  due: /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : null, time: /^\d{1,2}:\d{2}$/.test(t.time || '') ? t.time : null, who: t.who ? String(t.who).slice(0, 60) : null, ...(t.board ? { board: String(t.board).slice(0, 60) } : {}), ...(t.dup ? { dup: true } : {}), ...(t.sid ? { sid: String(t.sid).slice(0, 40) } : {}) }));
const newSid = () => require('crypto').randomBytes(6).toString('hex');
const FIELDS = ['title', 'dept', 'type', 'due', 'time', 'who', 'board'];
const pub = t => { const o = {}; FIELDS.concat('sid').forEach(k => { if (t[k] != null && t[k] !== '') o[k] = t[k]; }); return o; };
const sameTask = (a, b) => FIELDS.every(k => String(a[k] || '') === String(b[k] || ''));
const SENT_TTL = 12 * 3600 * 1000;   // сколько помним отправленную пачку для правок
const isMemory = d => d && Array.isArray(d.tasks) && d.tasks.length && d.tasks.every(t => t.sent && !t.orig && !t.rm) && Date.now() - (d.tasks[0].sentAt || 0) < SENT_TTL;
const isUpdate = d => d && Array.isArray(d.tasks) && d.tasks.some(t => t.orig || t.rm || t.sent);
// правка уже отправленных: новый список сравниваем с отправленным (orig) — изменено / удалено / новая
function diffUpdate(sentList, next) {
  const out = []; const seen = new Set();
  next.forEach(t => { const o = t.sid && sentList.find(s => s.sid === t.sid);
    if (o){ seen.add(o.sid); out.push({ ...pub(t), sid:o.sid, sent:true, orig:pub(o.orig || o) }); } else out.push({ ...pub(t), sid:newSid() }); });
  sentList.forEach(o => { if (!seen.has(o.sid)) out.push({ ...pub(o.orig || o), sid:o.sid, sent:true, orig:pub(o.orig || o), rm:true }); });
  return out;
}
const updMark = t => t.rm ? ' — удалить' : !t.sent ? ' — новая' : !sameTask(t, t.orig || {}) ? ' — изменена' : '';
const afterSendPrompt = (sent, text, c) => `Руководитель недавно отправил в KaizenHub список задач (JSON, у каждой поле sid). Теперь он пишет новое сообщение.
${ctxText(c)}
Отправленные задачи:
${JSON.stringify(sent.map(pub))}
Сообщение руководителя: «${String(text).slice(0, 4000)}»
Определи, что это:
— "edit": правка ЭТИХ отправленных задач («сделай меня ответственным», «вторую убери», «срок у первой — суббота», «стратегические — на меня»). Верни весь список после правки; у существующих задач сохрани их sid без изменений; новых задач без sid можно добавить.
— "question": вопрос про эти задачи — ответь в "answer", список не меняй.
— "new": это НОВЫЕ задачи, не связанные с правкой отправленных, — верни "intent":"new" и пустой список.
${TASK_RULES}
Если правка про доску или направление — верни "board": точное название доски из списка, иначе null.
Ответь JSON: {"intent":"edit","answer":"…","tasks":[…],"board":null}`;
// напоминание: назвали время — за 10 минут, только день — в 10:00 (так же считает приложение, tgRemind)
const remTxt = t => { if (!t.due) return ''; if (!t.time) return '⏰ ' + fmtDate(t.due) + ' в 10:00'; const [h, m] = t.time.split(':').map(Number); const x = h * 60 + m - 10; return `⏰ ${fmtDate(t.due)} в ${String(Math.floor((x + 1440) % 1440 / 60)).padStart(2, '0')}:${String((x + 1440) % 60).padStart(2, '0')}`; };
const inTeam = (who, c) => !who || (c.people || []).some(p => String(p.name || '').toLowerCase() === String(who).toLowerCase());
const fmtDate = d => d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '';
const listText = (tasks, head, c = {}) => `${head}\n${boardLine(tasks, c)}\n${tasks.map((t, i) => `${i + 1}. ${t.title}${updMark(t)}${t.dup ? '  ♻️ уже есть на доске' : ''}\n    ${[t.who ? '👤 ' + t.who + (inTeam(t.who, c) ? '' : ' (нет в «Команде»)') : '👤 не назначен', t.dept ? '🏷 ' + t.dept : '', t.due ? '📅 до ' + fmtDate(t.due) + (t.time ? ' ' + t.time : '') : '', remTxt(t), t.type === 'strat' ? '⭐ стратегическая' : ''].filter(Boolean).join(' · ')}`).join('\n')}

Всё верно? Нажмите ✅ или напишите «ок» — задачи уйдут в «К выполнению».
Поправить — напишите или наговорите, что изменить.`;
const KB0 = [{ text: '✅ Отправить', callback_data: 'tg_ok' }, { text: '✖ Отмена', callback_data: 'tg_no' }];
// кнопки: «Отправить / Отмена» и ниже доски (выбранная — с ●), по две в ряд
// быстрые кнопки: вопрос и типовые правки — то же самое, что написать словами
const QUICK = {
  st: { label:'⭐ Какие стратегические?', text:'Какие из этих задач стратегические, а какие операционные? Ответь списком с номерами.' },
  oa: { label:'👥 Операционные → ассистентам', text:'Все операционные задачи назначь ассистентам.' },
  sm: { label:'🙋 Стратегические → на меня', text:'Все стратегические задачи назначь на меня.' },
  wh: { label:'💡 Кому что отдать?', text:'Подскажи, какие задачи лучше отдать ассистентам, а какие сделать мне самому. Ответь коротко.' } };
const QROWS = [[QUICK.st, 'st', QUICK.wh, 'wh'], [QUICK.oa, 'oa', QUICK.sm, 'sm']].map(r => [{ text:r[0].label, callback_data:'tg_q:' + r[1] }, { text:r[2].label, callback_data:'tg_q:' + r[3] }]);
const kbFor = (c, cur) => { const bs = boardsOf(c); const rows = [KB0, ...QROWS];
  for (let i = 0; i < bs.length; i += 2) rows.push(bs.slice(i, i + 2).map(b => ({ text: (b.id === cur ? '● ' : '') + String(b.label || b.name).slice(0, 28), callback_data: ('tg_b:' + b.id).slice(0, 64) })));
  return { inline_keyboard: rows }; };
const curBoard = (tasks, c) => (tasks.find(t => t.board) || {}).board || (boardsOf(c).length <= 1 ? c.defBoard || (boardsOf(c)[0] || {}).id || null : null);
const boardLine = (tasks, c) => { const id = curBoard(tasks, c); const n = id ? boardName(c, id) : ''; if (n) return `📋 Доска: ${n}${boardsOf(c).length > 1 ? ' (сменить — кнопками ниже или словами «на неделю 4»)' : ''}\n`;
  if (!boardsOf(c).length) return '📋 Доска: та, что открыта в KaizenHub. Чтобы выбирать доску здесь — откройте KaizenHub и обновите страницу.\n';
  return boardsOf(c).length > 1 ? '📋 В какую доску отправить? Выберите кнопкой ниже или скажите «на неделю 4».\n' : ''; };
const say = (chat, text, extra) => tg('sendMessage', { chat_id: chat, text: text.slice(0, 4000), ...(extra || {}) });
// план-факт роликов по сводке владельца чата; strict — вопрос задан кнопкой/командой (тогда объясняем, если сводки нет).
// Есть APIFY_TOKEN — бот сам идёт смотреть открытые страницы аккаунтов (Apify instagram-reel-scraper, около минуты):
// запускает сбор и отвечает, когда Apify позовёт вебхук ?pflive (подпись = HMAC секрета вебхука по чату).
const APIFY_ACTOR = 'apify~instagram-reel-scraper';
const pfSig = chat => require('crypto').createHmac('sha256', whSecret()).update('pflive:' + chat).digest('hex').slice(0, 32);
let HOST = '';
async function startLive(chat, accounts) {
  const hook = [{ eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT', 'ACTOR.RUN.ABORTED'],
    requestUrl: `https://${HOST}/api/telegram?pflive=${chat}&sig=${pfSig(chat)}` }];
  const r = await fetch(`https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs?token=${env('APIFY_TOKEN')}&webhooks=${Buffer.from(JSON.stringify(hook)).toString('base64')}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: accounts, resultsLimit: 40, onlyPostsNewerThan: `${sinceMonday()} days` })
  });
  if (!r.ok) throw new Error(r.status === 402 ? 'закончился лимит Apify' : 'Apify ответил ' + r.status);
}
async function planFact(chat, q, strict) {
  const s = await db('pf_get', { p_chat: chat }).catch(() => undefined);
  if (s && !s.none) {
    const accs = Array.isArray(s.accounts) ? s.accounts.filter(a => /^[\w.]{1,30}$/.test(a)) : [];
    if (env('APIFY_TOKEN') && HOST && accs.length) {
      const err = await startLive(chat, accs).then(() => null, e => e.message);
      if (!err) { await say(chat, `🔎 Смотрю страницы ${accs.map(a => '@' + a).join(', ')} прямо сейчас. Пришлю отчёт через 1–2 минуты.`); return true; }
      await say(chat, `⚠️ Живая проверка не получилась: ${err}. Показываю последнюю сводку.\n\n` + planFactText(s, q), { disable_web_page_preview: true });
      return true;
    }
    await say(chat, planFactText(s, q), { disable_web_page_preview: true }); return true;
  }
  if (!strict) return false;
  await say(chat, s === null ? 'Этот чат не подключён к KaizenHub. Подключите его кодом из приложения («Подключить Telegram»).' : s === undefined ? '⚠️ Не получилось прочитать план-факт. Попробуйте чуть позже.' : 'Сводки по роликам пока нет: она появится после вечерней проверки.');
  return true;
}
// Apify закончил сбор: статус и данные читаем у самого Apify своим токеном (телу запроса не верим)
async function finishLive(chat, body) {
  const id = body && body.resource && body.resource.id;
  if (!/^\w{5,40}$/.test(String(id || ''))) return;
  const s = await db('pf_get', { p_chat: chat }).catch(() => null);
  if (!s || s.none) return;
  const run = await fetch(`https://api.apify.com/v2/actor-runs/${id}?token=${env('APIFY_TOKEN')}`).then(r => r.json()).then(j => j.data || {}).catch(() => ({}));
  let items = null;
  if (run.status === 'SUCCEEDED' && run.defaultDatasetId) items = await fetch(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?clean=1&token=${env('APIFY_TOKEN')}`).then(r => r.json()).catch(() => null);
  if (!Array.isArray(items)) { await say(chat, '⚠️ Страницы посмотреть не получилось. Последняя сводка:\n\n' + planFactText(s, ''), { disable_web_page_preview: true }); return; }
  await say(chat, '🔎 Проверил страницы только что.\n\n' + planFactText(mergeLive(s, liveDays(items)), ''), { disable_web_page_preview: true });
}
const unkb = (chat, msg) => msg ? tg('editMessageReplyMarkup', { chat_id: chat, message_id: msg, reply_markup: { inline_keyboard: [] } }) : null;

async function approve(chat) {
  const d = await db('tg_draft_get', { p_chat: chat }).catch(() => null);
  if (!d || !Array.isArray(d.tasks) || !d.tasks.length || isMemory(d)) { await say(chat, 'Нечего отправлять — пришлите голосовое или текст с задачами.'); return; }
  if (!isUpdate(d) && !d.tasks.some(t => t.board)) { const info0 = await db('tg_ctx', { p_chat: chat }).catch(() => null); const c0 = (info0 && info0.ctx) || {};
    if (boardsOf(c0).length > 1){ await say(chat, '👇 Сначала выберите доску — кнопкой под списком или словами «на неделю 4».'); return; } }
  const upd = isUpdate(d);
  // правка отправленных: в KaizenHub уходят только изменения (op: upd / rm / add); обычный список — целиком
  const ops = upd ? d.tasks.map(t => t.rm ? { op:'rm', sid:t.sid, title:t.title } : !t.sent ? { op:'add', ...pub(t) } : !sameTask(t, t.orig || {}) ? { op:'upd', ...pub(t) } : null).filter(Boolean)
    : d.tasks.map(t => ({ ...pub(t), sid:t.sid || newSid() }));
  if (!ops.length) { await say(chat, 'Изменений нет — в KaizenHub всё как было.'); return; }
  const ok = await db('tg_drop_tasks', { p_chat: chat, p_tasks: ops }).catch(() => false);
  await unkb(chat, d.msg_id);
  const info = await db('tg_ctx', { p_chat: chat }).catch(() => null); const bn = boardName((info && info.ctx) || {}, curBoard(d.tasks, {}));
  if (ok){   // запоминаем отправленное: следующую правку бот применит к этим задачам
    const now = Date.now(); const keep = upd ? d.tasks.filter(t => !t.rm).map(t => ({ ...pub(t), sent:true, sentAt:now })) : ops.map(t => ({ ...t, sent:true, sentAt:now }));
    if (keep.length) await db('tg_draft_set', { p_chat: chat, p_tasks: keep, p_msg: null }).catch(() => false); }
  await say(chat, !ok ? 'Не получилось отправить. Попробуйте ещё раз.' : upd ? `Обновил в KaizenHub: ${ops.length} ${ops.length === 1 ? 'изменение' : 'изменений'}.` : `Отправлено: ${ops.length} — задачи в «К выполнению»${bn ? ` доски «${bn}»` : ''} KaizenHub.\nЕсли нужно что-то поправить в них — просто напишите или скажите.`);
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
// показать текущий список ещё раз (кнопка «📝 Текущий список» или /list)
async function showList(chat) {
  const d = await db('tg_draft_get', { p_chat: chat }).catch(() => null);
  if (!d || !Array.isArray(d.tasks) || !d.tasks.length) { await say(chat, 'Сейчас списка нет. Наговорите или напишите задачи — я разберу их.'); return; }
  const info = await db('tg_ctx', { p_chat: chat }).catch(() => null); const c = (info && info.ctx) || {};
  if (isMemory(d)){ await say(chat, listText(d.tasks, `Последние отправленные задачи (${d.tasks.length}):`, c) + '\n\nЧтобы что-то в них поменять — просто напишите или скажите.'); return; }
  await unkb(chat, d.msg_id);
  const m = await say(chat, listText(d.tasks, `📝 Текущий список (${d.tasks.length}):`, c), { reply_markup: kbFor(c, curBoard(d.tasks, c)) });
  await db('tg_draft_set', { p_chat: chat, p_tasks: d.tasks, p_msg: (m.result && m.result.message_id) || null }).catch(() => false);
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
  let d = await db('tg_draft_get', { p_chat: chat }).catch(() => null);
  if (d && Array.isArray(d.tasks) && d.tasks.length && d.tasks.every(t => t.sent && !t.orig && !t.rm) && !isMemory(d)) d = null;   // старая память — забываем
  // после отправки: правка этих задач, вопрос о них или новые задачи
  if (isMemory(d)){
    const r0 = await claude(afterSendPrompt(d.tasks, text, c)); if (!r0) return false;
    if (r0.intent === 'question' && r0.answer){ await say(chat, String(r0.answer).slice(0, 3500)); return true; }
    if (r0.intent === 'edit'){
      const next = cleanTasks(r0); const named = r0.board ? boardByName(c, r0.board) : null; if (named) next.forEach(t => { t.board = named.id; });
      next.forEach(t => { const o = d.tasks.find(s => s.sid === t.sid); if (!t.board && o && o.board) t.board = o.board; if (!t.board && !o) t.board = d.tasks[0].board; });
      const list = diffUpdate(d.tasks, next);
      if (!list.some(t => updMark(t))){ await say(chat, 'Не понял, что поменять в отправленных задачах. Скажите конкретнее: «вторую — на меня», «срок у первой — суббота».'); return true; }
      const m = await say(chat, (r0.answer ? String(r0.answer).slice(0, 600) + '\n\n' : '') + listText(list.filter(t => !t.rm || true), 'Правка уже отправленных задач:', c) + '\n\nПодтвердите — и изменения уйдут в KaizenHub.', { reply_markup: { inline_keyboard: [[{ text: '✅ Обновить в KaizenHub', callback_data: 'tg_ok' }, { text: '✖ Отмена', callback_data: 'tg_no' }]] } });
      await db('tg_draft_set', { p_chat: chat, p_tasks: list, p_msg: (m.result && m.result.message_id) || null }).catch(() => false);
      return true;
    }
    d = null;   // новые задачи — обычный разбор
  }
  // ещё раз правка уже подготовленного обновления
  if (isUpdate(d)){
    const live = d.tasks.filter(t => !t.rm);
    const r1 = await claude(editPrompt(live.map(pub), text, c)); if (!r1) return false;
    if (r1.changed === false && r1.answer && !r1.board){ await say(chat, String(r1.answer).slice(0, 3500)); return true; }
    const sentList = d.tasks.filter(t => t.sent).map(t => ({ ...t.orig, sid:t.sid, sent:true }));
    const next = cleanTasks(r1); next.forEach(t => { const o = d.tasks.find(s => s.sid === t.sid); if (!t.board && o) t.board = o.board; });
    const list = diffUpdate(sentList, next); await unkb(chat, d.msg_id);
    const m = await say(chat, listText(list, 'Правка уже отправленных задач:', c) + '\n\nПодтвердите — и изменения уйдут в KaizenHub.', { reply_markup: { inline_keyboard: [[{ text: '✅ Обновить в KaizenHub', callback_data: 'tg_ok' }, { text: '✖ Отмена', callback_data: 'tg_no' }]] } });
    await db('tg_draft_set', { p_chat: chat, p_tasks: list, p_msg: (m.result && m.result.message_id) || null }).catch(() => false);
    return true;
  }
  const res = await claude(d && d.tasks && d.tasks.length ? editPrompt(d.tasks, text, c) : extractPrompt(text, c));
  if (!res) return false;
  // вопрос о задачах: отвечаем, список и кнопки не трогаем
  if (d && d.tasks && d.tasks.length && res.changed === false && !res.board && res.answer) { await say(chat, '💬 ' + String(res.answer).slice(0, 3500) + '\n\nПоправить — напишите что изменить; отправить — ✅ под списком или «ок».'); return true; }
  const tasks = cleanTasks(res); tasks.forEach(t => { if (!t.sid) t.sid = newSid(); });
  // доска: названа в голосовом/правке → её id; иначе — прежняя из черновика или доска текущей недели
  const named = res.board ? boardByName(c, res.board) : null; const prev = d && d.tasks ? curBoard(d.tasks, {}) : null;
  const bid = (named && named.id) || prev || curBoard([], c); tasks.forEach(t => { if (bid) t.board = bid; else delete t.board; });
  if (!tasks.length) { await say(chat, d ? 'После правки задач не осталось. Напишите «отмена» или пришлите новое голосовое.' : 'Задач в сообщении не нашёл 🤔 Попробуйте сказать конкретнее: что сделать, кому и к какому сроку.'); if (d) await db('tg_draft_set', { p_chat: chat, p_tasks: [], p_msg: null }).catch(() => false); return true; }
  if (d) await unkb(chat, d.msg_id);
  const m = await say(chat, (d && res.answer ? '💬 ' + String(res.answer).slice(0, 600) + '\n\n' : '') + listText(tasks, d ? `✏️ Поправил. Задачи (${tasks.length}):` : `📝 Нашёл задачи (${tasks.length}):`, c) + (tasks.some(t => t.who && !inTeam(t.who, c)) ? '\n\n💡 «нет в «Команде»» — в KaizenHub → «Команда» впишите людям должность (например, «Ассистент»), тогда бот найдёт ответственного сам.' : ''), { reply_markup: kbFor(c, bid) });
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
      if (q.digest) {   // вечерний обзор: Vercel Cron (vercel.json) в 22:00 по Алматы; без CRON_SECRET не работает
        if (!env('CRON_SECRET') || req.headers.authorization !== 'Bearer ' + env('CRON_SECRET')) return res.status(401).end();
        const rows = await db('pf_digest', {}).catch(() => []);
        let sent = 0;
        for (const r of Array.isArray(rows) ? rows : []) {
          if (!r || !r.chat_id || !r.data) continue;
          const m = await say(r.chat_id, '🌙 Вечерний обзор\n\n' + planFactText(r.data, 'вечер'), { disable_web_page_preview: true });
          if (m && m.ok) sent++;
        }
        return res.status(200).json({ ok: true, sent });
      }
      if (q.me) { const m = await tg('getMe'); return res.status(200).json({ bot: (m.result && m.result.username) || '' }); }
      if (q.setup && whSecret()) {   // адрес всегда наш, секрет — наш: ставить вебхук безопасно
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        await tg('setMyDescription', { description: 'Kaizen AI — голосовой помощник KaizenHub. Наговорите или напишите задачи: бот разберёт их, определит ответственных, сроки и тип задачи и после вашего подтверждения отправит на нужную доску в KaizenHub.' });
        await tg('setMyShortDescription', { short_description: 'Голосовой помощник KaizenHub: задачи голосом прямо на доску.' });
        await tg('setMyCommands', { commands: [{ command: 'start', description: 'Как пользоваться' }, { command: 'planfact', description: 'План-факт роликов' }, { command: 'list', description: 'Показать текущий список задач' }, { command: 'cancel', description: 'Отменить текущий список' }, { command: 'help', description: 'Что умеет бот' }] });
        const r = await tg('setWebhook', { url: `https://${host}/api/telegram`, secret_token: whSecret(), allowed_updates: ['channel_post', 'message', 'callback_query'] });
        return res.status(200).json({ ok: !!r.ok, description: r.description || '' });
      }
      return res.status(404).json({ ok: false });
    }
    if (req.method !== 'POST') return res.status(405).end();
    HOST = req.headers['x-forwarded-host'] || req.headers.host || '';
    if (req.query && req.query.pflive) {   // вебхук Apify: живая проверка план-факта готова
      const chat = String(req.query.pflive);
      if (!whSecret() || !/^-?\d{1,20}$/.test(chat) || req.query.sig !== pfSig(chat)) return res.status(401).end();
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      await finishLive(+chat, b).catch(() => {});
      return res.status(200).json({ ok: true });
    }
    if (!whSecret() || req.headers['x-telegram-bot-api-secret-token'] !== whSecret()) return res.status(401).end();

    const u = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (u.callback_query) {                                  // кнопки ✅ / ✖ под списком
      const q = u.callback_query; const ch = q.message && q.message.chat && q.message.chat.id;
      await tg('answerCallbackQuery', { callback_query_id: q.id });
      if (ch && q.data === 'tg_ok') await approve(ch); else if (ch && q.data === 'tg_no') await cancel(ch);
      else if (ch && /^tg_b:/.test(q.data || '')) await pickBoard(ch, q.data.slice(5));
      else if (ch && /^tg_q:/.test(q.data || '') && QUICK[q.data.slice(5)]) { const ok = await dialog(ch, QUICK[q.data.slice(5)].text).catch(() => false); if (!ok) await say(ch, '⚠️ Не получилось — попробуйте ещё раз или напишите словами.'); }
      return res.status(200).json({ ok: true });
    }
    const m = u.channel_post || u.message;
    if (!m || !m.chat) return res.status(200).json({ ok: true });
    const chat = m.chat.id, title = m.chat.title || m.chat.username || [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') || 'Telegram';
    const text = String(m.text || m.caption || '').trim();

    // личка с ботом: /start — приветствие и как подключиться; код можно прислать и без /connect
    if (/^\/start\b/i.test(text) || /^\/help\b/i.test(text) || BTN_HELP.test(text)) {
      const linked = await db('tg_ctx', { p_chat: chat }).catch(() => null);
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'kaizenhub-nu.vercel.app';
      await tg('sendPhoto', { chat_id: chat, photo: `https://${host}/icons/voice-welcome.jpg`, caption: 'Kaizen AI — голосовой помощник KaizenHub' });
      await say(chat, (linked ? 'Этот чат подключён к KaizenHub.\n\n' : '') + START_TEXT + (linked ? '' : START_CONNECT), m.chat.type === 'private' ? { reply_markup: MAIN_KB } : undefined);
      return res.status(200).json({ ok: true });
    }
    if (BTN_LIST.test(text)) { await showList(chat); return res.status(200).json({ ok: true }); }
    if (/^\/planfact\b|^(📊\s*)?план-факт$/i.test(text)) { await planFact(chat, text, true); return res.status(200).json({ ok: true }); }
    if (BTN_NO.test(text)) { await cancel(chat); return res.status(200).json({ ok: true }); }
    const con = text.match(/^(?:\/connect(?:@\w+)?\s+)?([a-f0-9]{32})$/i) || text.match(/^\/connect(?:@\w+)?\s+([a-f0-9]{16,64})\b/i);
    if (con) {
      const ok = await db('tg_link', { p_token: con[1].toLowerCase(), p_chat: chat, p_title: title }).catch(() => false);
      await tg('sendMessage', { chat_id: chat, text: ok ? (m.chat.type === 'private' ? '✅ Готово — этот чат подключён к KaizenHub. Наговорите или напишите задачи, я разберу их и спрошу, на какую доску отправить.' : '✅ Канал подключён к «Входящим» KaizenHub. Голосовые и посты отсюда будут разбираться на задачи.') : '⚠️ Код не подошёл. Нажмите «Подключить Telegram» в приложении ещё раз и пришлите новый код.' });
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
    if (PF_RX.test(plain) && await planFact(chat, plain, false)) return res.status(200).json({ ok: true });   // «какой план-факт?», «отстаём?»
    if (body.startsWith('/')) return res.status(200).json({ ok: true });
    const done = env('ANTHROPIC_API_KEY') ? await dialog(chat, plain).catch(() => false) : false;
    if (!done) await db('tg_drop', { p_chat: chat, p_text: body }).catch(() => false);   // без Claude — как раньше, во «Входящие»
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: true });   // Telegram не должен повторять запрос бесконечно
  }
};
