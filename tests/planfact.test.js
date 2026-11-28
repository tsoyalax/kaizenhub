// План-факт роликов в боте (api/_planfact.js + api/telegram.js): ответ по запросу и вечерний обзор. Сеть подменена.
const assert = require('assert');
let n = 0; const ok = m => { n++; console.log('PASS ' + m); };
Object.assign(process.env, { TG_BOT_TOKEN: '1:test', TG_DB_SECRET: 'sec', SUPABASE_URL: 'https://sb.test', SUPABASE_PUBLISHABLE_KEY: 'pk', ANTHROPIC_API_KEY: 'sk-ant-test', OPENAI_API_KEY: 'sk-oa', CRON_SECRET: 'cron' });
const handler = require('../api/telegram.js');
const { PF_RX, planFactText } = require('../api/_planfact.js');
const secret = require('crypto').createHash('sha256').update('wh:1:test').digest('hex').slice(0, 48);

// четверг 26.11.2026, 18:00 по Алматы
const NOW = Date.UTC(2026, 10, 26, 13, 0);
const snap = {
  title: 'План-факт роликов Скалы', page: 'https://claude.ai/artifact/x', digest: true,
  accounts: ['rockvpn_news', 'therock_vpn', 'techno_dima'], weekPlan: 56, weekPlans: {},
  best: { url: 'https://www.instagram.com/reel/a/', views: 170, account: 'techno_dima' },
  days: {
    '2026-11-23': { pubs: 1, fresh: 0, views: 1, acc: { techno_dima: 1 } },
    '2026-11-24': { pubs: 6, fresh: 4, views: 836, acc: { rockvpn_news: 2, therock_vpn: 2, techno_dima: 2 } },
    '2026-11-26': { pubs: 6, fresh: 6, views: 444, acc: { rockvpn_news: 3, techno_dima: 3 } }
  },
  checked_at: '2026-11-26T16:48+05:00'
};

const sent = []; let calls = []; const apify = []; let apifyFail = false, apifyBody = null;
const reel = (code, acc, iso, dur, views) => ({ shortCode: code, url: 'https://www.instagram.com/p/' + code + '/', ownerUsername: acc, timestamp: iso, videoDuration: dur, videoUrl: 'v', videoPlayCount: views });
// живая проверка: 27.11 (пт) вышло 4 публикации, из них 1 повтор того же ролика в другом аккаунте
const LIVE = [reel('a1', 'rockvpn_news', '2026-11-27T05:00:00Z', 30.5, 100), reel('a2', 'therock_vpn', '2026-11-27T06:00:00Z', 30.5, 50),
  reel('a3', 'techno_dima', '2026-11-27T07:00:00Z', 41.2, 900), reel('a4', 'techno_dima', '2026-11-27T08:00:00Z', 12.0, 10),
  reel('old', 'techno_dima', '2026-11-20T08:00:00Z', 9.0, 10)];
global.fetch = async (url, o = {}) => {
  const body = o.body && typeof o.body === 'string' ? JSON.parse(o.body) : {};
  const J = v => ({ ok: true, status: 200, json: async () => v });
  if (url.includes('/rest/v1/rpc/')) {
    const fn = url.split('/rpc/')[1]; assert.equal(body.p_secret, 'sec'); calls.push(fn);
    if (fn === 'pf_get') return J(body.p_chat === 5 ? snap : body.p_chat === 6 ? { none: true } : null);
    if (fn === 'pf_digest') return J([{ chat_id: 5, data: snap }]);
    if (fn === 'tg_ctx') return J(body.p_chat === 5 ? { kind: 'info', ctx: {} } : null);
    if (fn === 'tg_draft_get') return J(null);
    return J(null);
  }
  if (url.includes('api.apify.com')) { apify.push(url);
    if (url.includes('/acts/')) { if (apifyFail) return { ok: false, status: 402, json: async () => ({}) }; apifyBody = body; return J({ data: { id: 'runAbc123' } }); }
    if (url.includes('/actor-runs/runAbc123')) return J({ data: { status: 'SUCCEEDED', defaultDatasetId: 'ds1' } });
    if (url.includes('/datasets/ds1/items')) return J(LIVE);
    return J({}); }
  if (url.includes('api.anthropic.com')) return J({ content: [{ type: 'text', text: '{"tasks":[]}' }] });
  if (url.includes('api.telegram.org')) { sent.push({ m: url.split('/').pop(), body }); return J({ ok: true, result: { message_id: 1 } }); }
  throw new Error('нет подмены для ' + url);
};
const mkRes = () => ({ code: 0, data: null, status(c) { this.code = c; return this; }, json(d) { this.data = d; return this; }, end() { return this; } });
const post = async upd => { const res = mkRes(); await handler({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': secret }, body: upd }, res); return res; };
const pm = (text, id = 5) => ({ message: { chat: { id, type: 'private', first_name: 'А' }, text } });

(async () => {
  const t = planFactText(snap, 'план-факт', NOW);
  assert.ok(/Неделя 23 ноя – 29 ноя: вышло 13 из 56 публикаций \(23%\)/.test(t)); ok('сводка: неделя — вышло 13 из 56');
  assert.ok(/🔴 Не успеваем: к сегодняшнему дню по плану 32\. Осталось 43, это примерно 11 в день до воскресенья/.test(t)); ok('сводка: светофор по темпу и сколько в день догонять');
  assert.ok(/@rockvpn_news: 5/.test(t) && /@therock_vpn: 2/.test(t) && /@techno_dima: 6/.test(t)); ok('сводка: по каждому аккаунту');
  assert.ok(/Новых роликов: 10\. Просмотров: 1 281 \(99 на публикацию\)/.test(t) && /Ноябрь: вышло 13 из 240/.test(t)); ok('сводка: новые ролики, просмотры и месяц');
  const ev = planFactText(snap, 'вечер', NOW);
  assert.ok(/Сегодня, 26 ноя: 6 публикаций, новых роликов 6, просмотров 444/.test(ev) && /Лучший ролик недели: 170 просм\., @techno_dima/.test(ev)); ok('вечерний обзор: итог дня и лучший ролик');
  const wp = planFactText({ ...snap, weekPlans: { '2026-11-23': 13 } }, '', NOW);
  assert.ok(/вышло 13 из 13/.test(wp) && /План недели выполнен/.test(wp)); ok('сводка: план конкретной недели важнее общего');

  for (const q of ['какой план-факт?', 'План факт', 'мы отстаём?', 'сколько роликов вышло на этой неделе', 'выполняем ли план', '/planfact']) assert.ok(PF_RX.test(q), q);
  for (const q of ['снять три ролика до пятницы', 'сколько роликов снять ассистентам', 'мы отстаём по срокам, надо ускориться']) assert.ok(!PF_RX.test(q), q);
  ok('вопросы про план-факт узнаются, обычные задачи — нет');

  sent.length = 0; await post(pm('📊 План-факт'));
  assert.ok(sent.some(s => s.m === 'sendMessage' && /вышло 13 из 56/.test(s.body.text))); ok('бот: кнопка «📊 План-факт» — присылает сводку');
  sent.length = 0; calls = []; await post(pm('Ну что, какой у нас план-факт?'));
  assert.ok(sent.some(s => /📊 План-факт роликов Скалы/.test(s.body.text || '')) && !calls.includes('tg_draft_get')); ok('бот: вопрос словами — сводка, а не разбор задач');
  sent.length = 0; await post(pm('📊 План-факт', 6)); assert.ok(sent.some(s => /Сводки по роликам пока нет/.test(s.body.text || ''))); ok('бот: сводки нет — объясняет');
  sent.length = 0; await post(pm('/planfact', 7)); assert.ok(sent.some(s => /не подключён/.test(s.body.text || ''))); ok('бот: чужой неподключённый чат сводку не получает');
  sent.length = 0; calls = []; await post(pm('какой план-факт?', 7)); assert.ok(!sent.some(s => /📊/.test(s.body.text || ''))); ok('бот: неподключённому чату на вопрос словами сводку не показывает');
  const kb = sent.length; await post(pm('/start')); const st = sent.slice(kb).find(s => s.body.reply_markup && s.body.reply_markup.keyboard);
  assert.ok(st && st.body.reply_markup.keyboard.flat().some(b => b.text === '📊 План-факт') && /План-факт роликов/.test(st.body.text)); ok('бот: кнопка «📊 План-факт» внизу и пункт в инструкции');

  let res = mkRes(); sent.length = 0; await handler({ method: 'GET', query: { digest: '1' }, headers: {} }, res);
  assert.equal(res.code, 401); assert.equal(sent.length, 0); ok('обзор: без ключа расписания не отправляется');
  res = mkRes(); await handler({ method: 'GET', query: { digest: '1' }, headers: { authorization: 'Bearer cron' } }, res);
  assert.equal(res.data.sent, 1); assert.ok(sent.some(s => s.body.chat_id === 5 && /^🌙 Вечерний обзор/.test(s.body.text))); ok('обзор: по расписанию уходит владельцу в личку');

  // живая проверка страниц
  const { liveDays, mergeLive } = require('../api/_planfact.js');
  const NOW2 = Date.UTC(2026, 10, 27, 13, 0);
  const lv = liveDays(LIVE, NOW2);
  assert.deepEqual(lv.days['2026-11-27'], { pubs: 4, fresh: 3, views: 1060, acc: { rockvpn_news: 1, therock_vpn: 1, techno_dima: 2 } });
  assert.ok(!lv.days['2026-11-20'] && lv.best.views === 900 && /\/reel\/a3/.test(lv.best.url)); ok('живая проверка: повтор по длительности, прошлая неделя не считается, лучший ролик');
  const mg = mergeLive({ ...snap, days: { ...snap.days, '2026-11-26': { pubs: 9, fresh: 6, views: 1, acc: {} } } }, { days: { '2026-11-26': { pubs: 6, fresh: 6, views: 2, acc: {} }, '2026-11-27': lv.days['2026-11-27'] }, best: lv.best }, NOW2);
  assert.equal(mg.days['2026-11-26'].pubs, 9); assert.equal(mg.days['2026-11-27'].pubs, 4); assert.equal(mg.fetch_error, null);
  ok('живая проверка: Apify пропустил ролики — оставляем больше из сводки');

  process.env.APIFY_TOKEN = 'ap';
  const hp = async upd => { const res = mkRes(); await handler({ method: 'POST', query: {}, headers: { 'x-telegram-bot-api-secret-token': secret, host: 'kz.test' }, body: upd }, res); return res; };
  sent.length = 0; apify.length = 0; await hp(pm('сколько роликов опубликовано на этой неделе?'));
  assert.ok(apify.some(u => u.includes('/acts/apify~instagram-reel-scraper/runs')) && apifyBody.username.length === 3 && /days$/.test(apifyBody.onlyPostsNewerThan));
  const hook = JSON.parse(Buffer.from(decodeURIComponent(apify[0].split('webhooks=')[1]), 'base64').toString());
  assert.ok(/^https:\/\/kz\.test\/api\/telegram\?pflive=5&sig=\w{32}$/.test(hook[0].requestUrl) && sent.some(s => /Смотрю страницы @rockvpn_news/.test(s.body.text)));
  ok('бот: на вопрос идёт смотреть страницы и обещает отчёт');
  const hookUrl = new URL(hook[0].requestUrl);
  let r2 = mkRes(); sent.length = 0;
  await handler({ method: 'POST', query: { pflive: '5', sig: 'bad' }, headers: {}, body: { resource: { id: 'runAbc123' } } }, r2);
  assert.equal(r2.code, 401); assert.equal(sent.length, 0); ok('вебхук Apify с чужой подписью отклоняется');
  r2 = mkRes(); await handler({ method: 'POST', query: { pflive: '5', sig: hookUrl.searchParams.get('sig') }, headers: {}, body: { resource: { id: 'runAbc123' } } }, r2);
  assert.equal(r2.code, 200); assert.ok(sent.some(s => s.body.chat_id === 5 && /^🔎 Проверил страницы только что/.test(s.body.text) && /Новых роликов/.test(s.body.text)));
  ok('вебхук Apify: отчёт по живым данным уходит в чат');
  apifyFail = true; sent.length = 0; await hp(pm('📊 План-факт'));
  assert.ok(sent.some(s => /Живая проверка не получилась: закончился лимит Apify/.test(s.body.text) && /вышло 13 из 56/.test(s.body.text))); ok('Apify без денег: честно пишет и даёт сводку');
  delete process.env.APIFY_TOKEN;

  console.log(`\nВсе проверки пройдены: ${n}`);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
