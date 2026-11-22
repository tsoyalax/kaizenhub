// Бот Telegram (api/telegram.js): диалог «голосовое → список задач → правка → ок → в KaizenHub». Сеть подменена.
const assert = require('assert');
let n = 0; const ok = m => { n++; console.log('PASS ' + m); };
Object.assign(process.env, { TG_BOT_TOKEN: '1:test', TG_DB_SECRET: 'sec', SUPABASE_URL: 'https://sb.test', SUPABASE_PUBLISHABLE_KEY: 'pk', ANTHROPIC_API_KEY: 'sk-ant-test', OPENAI_API_KEY: 'sk-oa' });
const handler = require('../api/telegram.js');
const secret = require('crypto').createHash('sha256').update('wh:1:test').digest('hex').slice(0, 48);

const db = { draft: null, dropped: [], raw: [] }; const sent = []; let claudeOut = null; let claudeIn = '';
global.fetch = async (url, o = {}) => {
  const body = o.body && typeof o.body === 'string' ? JSON.parse(o.body) : {};
  const J = v => ({ ok: true, status: 200, json: async () => v });
  if (url.includes('/rest/v1/rpc/')) {
    const fn = url.split('/rpc/')[1]; assert.equal(body.p_secret, 'sec');
    if (fn === 'tg_ctx') return J(body.p_chat === 5 ? { kind: 'info', ctx: { depts: ['Трафик'], people: [{ name: 'Аня', role: 'Ассистент' }], existing: [], boards: [{ id: 'b3', name: 'Неделя 3', week: 3, label: 'Неделя 3' }, { id: 'b4', name: 'Неделя 4', week: 4, label: 'Неделя 4' }, { id: 'bl', name: 'Бэклог', label: 'Бэклог' }], defBoard: 'b3' } } : null);
    if (fn === 'tg_draft_get') return J(db.draft);
    if (fn === 'tg_draft_set') { db.draft = body.p_tasks ? { tasks: body.p_tasks, msg_id: body.p_msg } : null; return J(true); }
    if (fn === 'tg_drop_tasks') { db.dropped.push(body.p_tasks); db.draft = null; return J(true); }
    if (fn === 'tg_drop') { db.raw.push(body.p_text); return J(true); }
    return J(null);
  }
  if (url.includes('api.anthropic.com')) { claudeIn = body.messages[0].content; return J({ content: [{ type: 'text', text: JSON.stringify(claudeOut) }] }); }
  if (url.includes('api.telegram.org')) { const m = url.split('/').pop(); sent.push({ m, body }); return J({ ok: true, result: { message_id: 100 + sent.length } }); }
  throw new Error('нет подмены для ' + url);
};
const post = async upd => { const res = { code: 0, status(c){ this.code = c; return this; }, json(){ return this; }, end(){ return this; } };
  await handler({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': secret }, body: upd }, res); return res; };
const msg = text => ({ channel_post: { chat: { id: 5, title: 'Kaizen Voice' }, text } });

(async () => {
  claudeOut = { tasks: [{ title: 'Снять 3 ролика', dept: 'Трафик', type: 'oper', due: '2099-01-09', time: '15:00', who: 'Аня' }, { title: 'Позвонить амбассадору', type: 'strat', who: 'Ассистенты' }] };
  await post(msg('Надо снять три ролика до пятницы, это ассистентам. И позвонить амбассадору.'));
  const list = sent.find(s => s.m === 'sendMessage' && s.body.reply_markup);
  assert.ok(list && /1\. Снять 3 ролика/.test(list.body.text) && /👤 Аня/.test(list.body.text) && /до 09\.01/.test(list.body.text)); assert.ok(/⏰ 09\.01 в 14:50/.test(list.body.text) && /Ассистенты \(нет в «Команде»\)/.test(list.body.text)); ok('бот: прислал список задач с ответственным и сроком и кнопками ✅/✖');
  assert.ok(/Аня \(Ассистент\)/.test(claudeIn)); ok('бот: Claude знает команду и роли пространства');
  assert.equal(db.draft.tasks.length, 2); ok('бот: черновик сохранён');
  assert.ok(/📋 Доска: Неделя 3/.test(list.body.text) && list.body.reply_markup.inline_keyboard.flat().some(b => b.text === '● Неделя 3') && db.draft.tasks.every(x => x.board === 'b3')); ok('бот: по умолчанию — доска текущей недели, под списком кнопки досок');
  sent.length = 0; await post({ callback_query: { id: 'q0', data: 'tg_b:b4', message: { chat: { id: 5 } } } });
  assert.ok(db.draft.tasks.every(x => x.board === 'b4') && sent.some(s => s.m === 'editMessageText' && /Доска: Неделя 4/.test(s.body.text))); ok('бот: кнопка доски — задачи переезжают на «Неделя 4», список обновлён');
  claudeOut = { tasks: db.draft.tasks, board: 'Бэклог' }; sent.length = 0; await post(msg('отправь в бэклог'));
  assert.ok(db.draft.tasks.every(x => x.board === 'bl')); ok('бот: «отправь в бэклог» словами — доска меняется');

  claudeOut = { tasks: [{ title: 'Снять 3 ролика', dept: 'Трафик', type: 'oper', due: '2099-01-10', who: 'Аня' }] };
  sent.length = 0; await post(msg('вторую убери, срок у первой суббота'));
  assert.ok(/Правка руководителя: «вторую убери/.test(claudeIn) && /Позвонить амбассадору/.test(claudeIn)); ok('бот: правка уходит Claude вместе с текущим списком');
  assert.ok(sent.some(s => s.m === 'editMessageReplyMarkup') && sent.some(s => /Поправил/.test(s.body.text || ''))); ok('бот: старые кнопки убраны, новый список прислан');

  sent.length = 0; await post(msg('ок'));
  assert.equal(db.dropped.length, 1); assert.equal(db.dropped[0][0].due, '2099-01-10'); assert.ok(sent.some(s => /Отправлено: 1/.test(s.body.text || ''))); ok('бот: «ок» — задачи уходят в KaizenHub');

  claudeOut = { tasks: [{ title: 'Запустить рекламу' }] }; await post(msg('запустить рекламу'));
  sent.length = 0; await post({ callback_query: { id: 'q1', data: 'tg_ok', message: { chat: { id: 5 } } } });
  assert.equal(db.dropped.length, 2); assert.ok(sent.some(s => s.m === 'answerCallbackQuery')); ok('бот: кнопка ✅ тоже отправляет');

  claudeOut = { tasks: [{ title: 'Что-то' }] }; await post(msg('что-то сделать'));
  await post(msg('отмена')); assert.equal(db.draft, null); assert.equal(db.dropped.length, 2); ok('бот: «отмена» стирает черновик');

  process.env.ANTHROPIC_API_KEY = ''; await post(msg('купить микрофон')); assert.deepEqual(db.raw, ['купить микрофон']); ok('бот: без Claude текст уходит во «Входящие», как раньше');

  const r = await handler({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'wrong' }, body: msg('x') }, { status(c){ this.code = c; return this; }, end(){ return this; }, json(){ return this; } });
  assert.equal(r.code, 401); ok('бот: чужой вебхук без секрета не принимается');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
