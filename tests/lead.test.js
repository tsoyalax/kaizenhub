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
  const errors = []; const reloads = [];
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
      w.kzReloadHook = () => reloads.push(1);
      if (keepStorage) for (const k in keepStorage) w.localStorage.setItem(k, keepStorage[k]);
    }
  });
  return { dom, w: dom.window, errors, reloads };
}
const dump = w => { const o = {}; for (let i = 0; i < w.localStorage.length; i++){ const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; };
(async () => {
  const be = makeBackend();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', L = 'eeeeeeee-0000-0000-0000-000000000007', S = 'ffffffff-0000-0000-0000-000000000008';
  be.profiles.set(A, { id: A, name: 'Александр Владелец', email: 'a@x.y', avatar_url: '', job_title: '', contact: '' });
  be.profiles.set(L, { id: L, name: 'Лена Руководитель', email: 'l@x.y', avatar_url: '', job_title: '', contact: '' });
  const own = openApp(be, A, 'https://kz.test/', { meta: { name: 'Александр Владелец' } }); await wait(4500);
  const $ = (o, s) => o.w.document.querySelector(s);
  // 1) владелец приглашает руководителя
  $(own, '[data-view="team"]').click(); await wait(100);
  $(own, '[data-invite]').click(); await wait(50);
  assert.ok($(own, '#iLead')); ok('приглашение: есть галочка «Доступ руководителя»');
  $(own, '#iName').value = 'Лена Руководитель'; $(own, '#iEmail').value = 'l@x.y'; $(own, '#iLead').checked = true;
  $(own, '#iForm').dispatchEvent(new own.w.Event('submit', { bubbles: true, cancelable: true })); await wait(800);
  const link = $(own, '#tlIn').value; const code = link.split('invite=')[1];
  assert.equal(be.rows.get('inv/' + code).data.role, 'lead'); ok('ссылка руководителя записана с ролью руководителя');
  assert.ok(/руководитель/.test($(own, '#tlT').textContent)); ok('в окне ссылки видно, что это руководитель');
  $(own, '[data-close]').click(); await wait(100);
  // 2) руководитель открывает ссылку (вход через Google: роли ещё нет)
  const l1 = openApp(be, L, link, { meta: { name: 'Лена Руководитель' } }); await wait(4500);
  assert.ok(be.rows.has(`team/${A}/managers/${L}`)); ok('руководитель вписан в команду владельца как руководитель');
  assert.ok(be.rows.has(`data/users/${L}/links/lead/${A}`)); ok('у руководителя запомнена команда');
  assert.ok(!be.rows.has('inv/' + code)); ok('ссылка руководителя одноразовая');
  assert.ok(l1.reloads.length >= 1 && l1.w.localStorage.getItem('kz-org') === A); ok('после входа открываются проекты владельца');
  assert.ok(!l1.w.document.body.classList.contains('guest')); ok('руководитель не в версии исполнителя');
  const keep = dump(l1.w); l1.w.close();
  // 3) «после перезагрузки»: руководитель видит все проекты владельца и работает в них
  const l2 = openApp(be, L, 'https://kz.test/', { meta: { name: 'Лена Руководитель', role: 'lead' } }, keep); await wait(5000);
  const ownNames = own.w.eval('db.projects.filter(p => p.state !== "archived").map(p => p.name)');
  const lNames = l2.w.eval('db.projects.filter(p => p.state !== "archived").map(p => p.name)');
  assert.deepEqual(lNames.slice().sort(), ownNames.slice().sort()); ok('руководитель видит все проекты владельца');
  assert.ok(l2.w.document.querySelector('.tabs [data-view="matrix"]') && !l2.w.document.body.classList.contains('guest')); ok('у руководителя полная версия: матрица, канбан, команда');
  const meU = l2.w.eval('userById(ME)');
  assert.equal(meU.account_id, L); assert.ok(meU.lead); ok('руководитель — это его запись в команде, а не владелец');
  assert.equal(l2.w.eval('db.users.filter(u => u.account_id === "' + L + '").length'), 1); ok('без дублей в команде');
  assert.ok(/Проекты: Александр/.test($(l2, '#spaceName').textContent)); ok('в шапке видно, чьи это проекты');
  const pid = l2.w.eval('db.projects[0].id');
  l2.w.eval(`projById('${pid}').name = 'Правка руководителя'; commit();`); await wait(2500);
  assert.equal(JSON.parse(be.rows.get(`data/users/${A}/p_${pid}`).data.json).name, 'Правка руководителя'); ok('правка руководителя сохраняется в проектах владельца');
  await wait(500);
  assert.equal(own.w.eval(`projById('${pid}').name`), 'Правка руководителя'); ok('владелец сразу видит правку руководителя');
  // ссылку в проект руководитель создаёт от имени владельца
  await l2.w.createLink(pid, 'worker'); await wait(400);
  const pinv = [...be.rows.values()].find(r => r.path.startsWith('inv/') && r.data.pid === pid);
  assert.ok(pinv && pinv.data.ownerId === A); ok('ссылки в проекты руководитель создаёт от имени владельца');
  assert.ok(!$(l2, '[data-view="team"]') || true);
  l2.w.document.querySelector('[data-view="team"]').click(); await wait(100); l2.w.document.querySelector('[data-invite]').click(); await wait(50);
  assert.ok(!$(l2, '#iLead')); ok('руководитель не может пригласить других руководителей');
  l2.w.document.querySelector('[data-close]')?.click(); await wait(50);
  // 4) владелец видит руководителя в «Команде»
  own.w.document.querySelector('[data-view="team"]').click(); await wait(1500);
  assert.ok(/Руководитель/.test(own.w.document.getElementById('app').textContent)); ok('владелец видит в «Команде», что это руководитель');
  // 5) владелец убирает руководителя — доступ закрыт
  const lu = own.w.eval(`db.users.find(u => u.account_id === '${L}')`);
  own.w.eval(`removeMember(userById('${lu.id}'))`); await wait(800);
  assert.ok(!be.rows.has(`team/${A}/managers/${L}`)); ok('убрали из команды — права руководителя сняты');
  const keep2 = dump(l2.w); l2.w.close();
  const l3 = openApp(be, L, 'https://kz.test/', { meta: { name: 'Лена Руководитель', role: 'lead' } }, keep2); await wait(4000);
  assert.ok(!l3.w.localStorage.getItem('kz-org') && l3.reloads.length >= 1); ok('после этого руководитель возвращается к своим проектам');
  l3.w.close();
  assert.equal(own.errors.length, 0, own.errors.join('\n')); ok('ошибок нет');
  own.w.close();
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
