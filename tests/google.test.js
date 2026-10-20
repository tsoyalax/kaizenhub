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

  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
