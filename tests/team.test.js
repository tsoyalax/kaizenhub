// Запуск настоящего index.html с «переходником» и имитацией Supabase
const fs = require('fs'), assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const { makeBackend } = require('./fake-supabase');
const root = __dirname + '/../';
let html = fs.readFileSync(root + 'index.html', 'utf8');
const shim = fs.readFileSync(root + 'claude-shim.js', 'utf8'), cfg = fs.readFileSync(root + 'config.js', 'utf8');
html = html
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/, '<script>/* supabase подставляется тестом */</script>')
  .replace('<script src="/config.js"></script>', '<script>' + cfg + '</script>')
  .replace('<script src="/claude-shim.js"></script>', '<script>' + shim + '</script>');
const wait = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const ok = m => { n++; console.log('PASS ' + m); };

function openApp(backend, userId, url = 'https://kz.test/', extra, keepStorage) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.message || e).slice(0, 200)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ').slice(0, 200)));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url, pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.supabase = { createClient: () => backend.client(userId, extra) };
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
      w.scrollTo = () => {}; w.IntersectionObserver = w.IntersectionObserver || class { observe() {} disconnect() {} unobserve() {} };
      w.ResizeObserver = w.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
      w.HTMLElement.prototype.scrollIntoView = function () {};
      if (keepStorage) for (const k in keepStorage) w.localStorage.setItem(k, keepStorage[k]);
    }
  });
  return { dom, w: dom.window, errors };
}
(async () => {
  const be = makeBackend();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', T = 'cccccccc-0000-0000-0000-000000000003';
  const $ = (o, s) => o.w.document.querySelector(s);
  const change = (o, el, v) => { el.value = v; el.dispatchEvent(new o.w.Event('change', { bubbles: true })); };

  // владелец: первый запуск, данные уходят в аккаунт
  const own = openApp(be, A, 'https://kz.test/', { meta: { name: 'Owner A', avatar_url: 'https://img/a.png' } });
  await wait(4500);
  assert.ok($(own, '#meBtn')); ok('в шапке есть кнопка профиля');

  // 1) приглашение в команду по ссылке
  $(own, '[data-view="team"]').click(); await wait(100);
  $(own, '[data-invite]').click(); await wait(50);
  $(own, '#iName').value = 'Тимур Тестов'; $(own, '#iEmail').value = 't@x.y';
  $(own, '#iForm').dispatchEvent(new own.w.Event('submit', { bubbles: true, cancelable: true }));
  await wait(800);
  const link = $(own, '#tlIn') && $(own, '#tlIn').value;
  assert.ok(link && /\?invite=[a-z0-9]{8,32}$/.test(link), 'нет ссылки: ' + link); ok('после добавления сотрудника показана ссылка-приглашение');
  const code = link.split('invite=')[1];
  assert.equal(be.rows.get('inv/' + code).data.kind, 'team'); ok('ссылка в команду записана в базу');
  $(own, '[data-close]').click(); await wait(100);
  assert.ok(own.w.document.getElementById('app').textContent.includes('Ждём входа по ссылке')); ok('в «Команде» статус «Ждём входа по ссылке»');

  // назначаем сотрудника ответственным за этап проекта
  $(own, '[data-view="matrix"]').click(); await wait(100);
  const openBtn = $(own, '.prow[data-open]'); const pid = openBtn.dataset.open; openBtn.click(); await wait(200);
  const sel = $(own, '[data-sassign]'); const sid = sel.dataset.sassign;
  const memberOpt = [...sel.options].find(o => o.textContent.startsWith('Тимур'));
  change(own, sel, memberOpt.value); await wait(1500);
  assert.ok(!be.rows.has('sp/' + pid) || !(be.rows.get('sp/' + pid).data.memberIds || []).length); ok('пока человек не вошёл, проект ему не открыт');

  // 2) сотрудник открывает ссылку и входит (через Google: роли в профиле ещё нет)
  const wk = openApp(be, T, link, { meta: { name: 'Тимур Google', avatar_url: 'https://img/t.png' } });
  await wait(4000);
  assert.ok(be.rows.has(`team/${A}/members/${T}`)); ok('сотрудник вписан в команду по ссылке');
  assert.ok(wk.w.document.body.classList.contains('guest')); ok('сотрудник видит версию исполнителя');
  assert.ok(!be.rows.has('inv/' + code)); ok('ссылка одноразовая: после входа отключена');
  const sp = be.rows.get('sp/' + pid);
  assert.ok(sp && sp.data.memberIds.includes(T)); ok('проект, где он назначен, открылся ему автоматически');
  assert.ok(wk.w.document.getElementById('app').textContent.includes(JSON.parse(sp.data.json).name)); ok('сотрудник видит этот проект во «Моих проектах»');
  assert.equal(be.rows.size && [...be.rows.keys()].filter(k => k.startsWith('sp/') && k.split('/').length === 2 && be.rows.get(k).data.memberIds.includes(T)).length, 1); ok('другие проекты ему не открыты');

  // 3) профиль: сотрудник заполняет должность и контакт, владелец видит их в «Команде»
  $(wk, '#meBtn').click(); await wait(300);
  assert.ok($(wk, '#mForm')); ok('у сотрудника открывается окно профиля');
  assert.ok($(wk, '.prof-head img')); ok('в профиле фото из Google');
  $(wk, '#mTitle2').value = 'Моушн-дизайнер'; $(wk, '#mContact').value = '@timur';
  $(wk, '#mForm').dispatchEvent(new wk.w.Event('submit', { bubbles: true, cancelable: true })); await wait(300);
  assert.equal(be.profiles.get(T).job_title, 'Моушн-дизайнер'); ok('профиль сохранён в базе');
  await own.w.refreshProfiles(true); await wait(200);
  $(own, '[data-view="team"]').click(); await wait(100);
  const teamTxt = own.w.document.getElementById('app').textContent
  assert.ok(teamTxt.includes('Моушн-дизайнер') && teamTxt.includes('@timur') && teamTxt.includes('вошёл в приложение')); ok('владелец видит должность, контакт и что человек вошёл');
  assert.ok(own.w.document.querySelector('.members img[src="https://img/t.png"]')); ok('владелец видит фото сотрудника');

  // 4) владелец меняет свой профиль
  $(own, '#meBtn').click(); await wait(300);
  assert.equal($(own, '#mEmail').readOnly, true); ok('почта аккаунта не редактируется вручную');
  $(own, '#mTitle2').value = 'Директор';
  $(own, '#mForm').dispatchEvent(new own.w.Event('submit', { bubbles: true, cancelable: true })); await wait(300);
  assert.equal(be.profiles.get(A).job_title, 'Директор'); ok('свой профиль владельца сохранён');
  assert.equal(be.profiles.get(T).job_title, 'Моушн-дизайнер'); ok('чужой профиль не задет');

  // 5) сняли с этапа — доступ к проекту закрылся
  $(own, '[data-view="matrix"]').click(); await wait(100);
  $(own, `.prow[data-open="${pid}"]`).click(); await wait(200);
  change(own, $(own, `[data-sassign="${sid}"]`), ''); await wait(1500);
  const sp2 = be.rows.get('sp/' + pid);
  assert.ok(!sp2 || !(sp2.data.memberIds || []).includes(T)); ok('сняли с назначения — доступ к проекту закрыт');

  assert.equal(own.errors.length, 0, own.errors.join('\n')); assert.equal(wk.errors.length, 0, wk.errors.join('\n')); ok('ошибок на страницах нет');
  own.w.close(); wk.w.close();
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
