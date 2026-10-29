// Вход через Google и пометка приглашённых новичков исполнителями
const fs = require('fs'), assert = require('assert');
const { JSDOM } = require('jsdom');
const { makeBackend } = require('./fake-supabase');
const shimSrc = fs.readFileSync(__dirname + '/../claude-shim.js', 'utf8');
const cfgSrc = fs.readFileSync(__dirname + '/../config.js', 'utf8');
let n = 0; const ok = m => { n++; console.log('PASS ' + m); };
const wait = ms => new Promise(r => setTimeout(r, ms));

function boot(backend, userId, extra, url, session) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: url || 'https://kz.test/', pretendToBeVisual: true });
  const w = dom.window;
  if (session) for (const k in session) w.sessionStorage.setItem(k, session[k]);
  w.supabase = { createClient: () => backend.client(userId, extra) };
  w.eval(cfgSrc); w.eval(shimSrc);
  return w;
}
(async () => {
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', N = 'nnnnnnnn-0000-0000-0000-000000000005';

  // 1) экран входа: кнопка Google, приглашение не теряется по дороге
  const be1 = makeBackend();
  const w1 = boot(be1, N, { noSession: true }, 'https://kz.test/?invite=abcdefgh12');
  w1.claude.use('user'); await wait(50);
  const g = w1.document.getElementById('kzGoogle');
  assert.ok(g && /Google/.test(g.textContent)); ok('на экране входа есть «Войти через Google»');
  g.click(); await wait(50);
  const call = (be1.oauthCalls || [])[0];
  assert.equal(call && call.provider, 'google'); ok('кнопка запускает вход через Google');
  assert.ok(call.options.redirectTo.includes('invite=abcdefgh12')); ok('после Google человек вернётся по той же ссылке-приглашению');
  assert.equal(w1.sessionStorage.getItem('kz-invite'), 'abcdefgh12'); ok('код приглашения сохранён на время входа');

  // 2) вернулся с Google без кода в адресе: код восстанавливается из sessionStorage
  const be2 = makeBackend();
  const w2 = boot(be2, N, {}, 'https://kz.test/', { 'kz-invite': 'abcdefgh12' });
  assert.ok(w2.location.search.includes('invite=abcdefgh12')); ok('код приглашения вернулся в адрес после входа');
  const me2 = await (await w2.claude.use('user')).me();
  assert.equal(me2.isOwner, false); ok('новичок по приглашению стал исполнителем');
  assert.deepEqual(be2.updateCalls, [{ data: { role: 'guest' } }]); ok('роль записана в профиль один раз');

  // 3) владелец со своими данными открывает приглашение: остаётся владельцем
  const be3 = makeBackend();
  be3.put('data/users/' + A + '/meta', { json: '{}' });
  const w3 = boot(be3, A, {}, 'https://kz.test/?invite=abcdefgh12');
  assert.equal((await (await w3.claude.use('user')).me()).isOwner, true); ok('владелец по чужой ссылке остаётся владельцем');
  assert.equal((be3.updateCalls || []).length, 0); ok('профиль владельца не меняется');

  // 4) вход без приглашения: обычный владелец своего пространства
  const be4 = makeBackend();
  const w4 = boot(be4, N, {}, 'https://kz.test/');
  assert.equal((await (await w4.claude.use('user')).me()).isOwner, true); ok('без приглашения новичок — владелец своего пространства');

  // 5) ошибка входа через Google: понятное сообщение, приглашение сохранено
  const be5 = makeBackend();
  const w5 = boot(be5, N, { noSession: true }, 'https://kz.test/?invite=abcdefgh12#error=access_denied');
  w5.claude.use('user'); await wait(50);
  assert.ok(/Google/.test(w5.document.getElementById('kzNote').textContent)); ok('ошибка Google показана по-русски');
  assert.ok(w5.location.search.includes('invite=abcdefgh12') && !w5.location.hash.includes('error')); ok('после ошибки ссылка-приглашение на месте');

  // 6) вкладки «Руководитель / Исполнитель» на экране входа
  const be6 = makeBackend();
  const w6 = boot(be6, N, { noSession: true }, 'https://kz.test/');
  w6.claude.use('user'); await wait(50);
  const d6 = w6.document, sel = k => d6.querySelector(`[data-who="${k}"]`).getAttribute('aria-selected');
  assert.ok(d6.getElementById('kzLead') && d6.getElementById('kzWorker')); ok('вход: вкладки «Руководитель» и «Исполнитель»');
  assert.equal(sel('lead'), 'true'); assert.ok(/руководител/i.test(d6.getElementById('kzNote').textContent)); ok('вход: без ссылки открыта вкладка руководителя');
  d6.getElementById('kzWorker').click(); await wait(20);
  assert.equal(sel('worker'), 'true'); assert.ok(/исполнител/i.test(d6.getElementById('kzNote').textContent)); ok('вход: переключение на «Исполнитель»');
  d6.getElementById('kzGoogle').click(); await wait(50);
  assert.equal(w6.sessionStorage.getItem('kz-who'), 'worker'); ok('вход: выбор вкладки сохраняется на время входа через Google');
  const w6i = boot(makeBackend(), N, { noSession: true }, 'https://kz.test/?invite=abcdefgh12');
  w6i.claude.use('user'); await wait(50);
  assert.equal(w6i.document.querySelector('[data-who="worker"]').getAttribute('aria-selected'), 'true'); ok('вход: по ссылке сразу открыта вкладка исполнителя');
  // вернулся с Google после вкладки «Исполнитель» без ссылки — новичок становится исполнителем
  const be7 = makeBackend();
  const w7 = boot(be7, N, {}, 'https://kz.test/', { 'kz-who': 'worker' });
  assert.equal((await (await w7.claude.use('user')).me()).isOwner, false); ok('вход: исполнитель через Google получил версию исполнителя');
  // вкладка «Руководитель» без доступа руководителя: не выкидывает, а открывает версию исполнителя
  const be8 = makeBackend();
  const w8 = boot(be8, N, {}, 'https://kz.test/', { 'kz-who': 'lead' });
  assert.equal((await (await w8.claude.use('user')).me()).isOwner, false); ok('вход: новый аккаунт на вкладке «Руководитель» попадает в версию исполнителя');
  assert.ok(!(be8.signOuts || []).length); ok('вход: из аккаунта не выкидывает');
  assert.ok(/нет доступа руководителя/.test(w8.kzLoginNote || '')); ok('вход: объясняем, почему открыта версия исполнителя');
  // действующий руководитель (есть своё пространство) входит как обычно
  const be9 = makeBackend(); be9.put('data/users/' + A + '/meta', { json: '{}' });
  const w9 = boot(be9, A, {}, 'https://kz.test/', { 'kz-who': 'lead' });
  assert.equal((await (await w9.claude.use('user')).me()).isOwner, true); ok('вход: руководитель со своим пространством входит');
  // исполнитель (role guest) на вкладке «Руководитель» тоже не проходит
  const be10 = makeBackend();
  const w10 = boot(be10, N, { meta: { role: 'guest' } }, 'https://kz.test/', { 'kz-who': 'lead' });
  assert.equal((await (await w10.claude.use('user')).me()).isOwner, false); ok('вход: исполнитель на вкладке «Руководитель» получает версию исполнителя, а не руководителя');
  assert.ok(!(be10.signOuts || []).length); ok('вход: исполнителя не выкидывает');
  // роль lead в профиле — доступ руководителя есть и без данных
  const w11 = boot(makeBackend(), N, { meta: { role: 'lead' } }, 'https://kz.test/', { 'kz-who': 'lead' });
  assert.equal((await (await w11.claude.use('user')).me()).isOwner, true); ok('вход: роль руководителя из профиля пускает');

  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
