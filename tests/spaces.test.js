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
      if (extra && extra.session) for (const k in extra.session) w.sessionStorage.setItem(k, extra.session[k]);
    }
  });
  return { dom, w: dom.window, errors };
}
(async () => {
  const be = makeBackend();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const o = openApp(be, A);
  await wait(4500);
  const w = o.w, D = w.document, $ = s => D.querySelector(s);
  const fire = (el, t) => el.dispatchEvent(new w.Event(t, { bubbles: true, cancelable: true }));
  const ls = (win, k = 'agency-pipeline-demo-v2') => JSON.parse(win.localStorage.getItem(k));
  const mainProjects = ls(w).projects.length;
  // 1) раздел «Пространства»
  D.querySelector('.tabs [data-view="templates"]').click(); await wait(100);
  $('[data-settab="spaces"]').click(); await wait(200);
  assert.ok($('#spNew') && /Основное/.test($('.sp-list').textContent)); ok('настройки: раздел «Пространства», открыто «Основное»');
  let reloaded = 0; w.kzReloadHook = () => { reloaded++; };
  $('#spNewName').value = 'Личные проекты'; fire($('#spNew'), 'submit'); await wait(500);
  const sid = w.localStorage.getItem('kz-space');
  assert.ok(/^s[a-z0-9]+$/.test(sid) && reloaded === 1); ok('создание: пространство создано и открывается');
  assert.ok(be.rows.has(`data/users/${A}/spaces/list/${sid}`)); ok('создание: пространство записано в аккаунт');
  const fresh = ls(w, `agency-pipeline-demo-v2-${sid}`);
  assert.equal(fresh.projects.length, 0); assert.equal(fresh.templates.length, ls(w).templates.length); ok('новое пространство пустое, шаблоны и команда взяты из текущего');
  // 2) «перезагрузка» в новом пространстве
  const store = { 'kz-space': sid, [`agency-pipeline-demo-v2-${sid}`]: w.localStorage.getItem(`agency-pipeline-demo-v2-${sid}`), 'agency-mode': 'owner' };
  o.w.close();
  const o2 = openApp(be, A, 'https://kz.test/', {}, store); await wait(4000);
  const w2 = o2.w, D2 = w2.document, $2 = s => D2.querySelector(s);
  assert.equal($2('#spaceName').textContent, 'Личные проекты'); assert.ok(!$2('#spaceName').hidden); ok('в шапке видно текущее пространство');
  assert.ok(/Проектов пока нет/.test(D2.getElementById('app').textContent)); ok('в новом пространстве нет проектов основного');
  $2('#newBtn').click(); await wait(100); $2('#cName').value = 'Личный проект'; $2('#cClient').value = 'Я'; fire($2('#cForm'), 'submit'); await wait(2500);
  const keys = [...be.rows.keys()];
  assert.ok(keys.some(k => k.startsWith(`data/users/${A}/spaces/list/${sid}/items/p_`))); ok('проект нового пространства сохраняется в его папку');
  assert.equal(keys.filter(k => /^data\/users\/[^/]+\/p_/.test(k)).length, mainProjects); ok('основное пространство не тронуто');
  // меню-панель как в Arc
  assert.ok($2('#sideBtn') && $2('#side').hidden); ok('панель: есть кнопка меню, панель скрыта');
  $2('#sideBtn').click(); await wait(80);
  assert.ok(!$2('#side').hidden && $2('.side-nav [data-sideview="matrix"]') && /Личные проекты/.test($2('.side-head').textContent)); ok('панель: открывается, в ней разделы и текущее пространство');
  assert.equal(D2.querySelectorAll('.side-dots [data-sidesp]').length, 2); assert.ok($2('.side-dot.cur')); ok('панель: пространства цветными кружками, текущее отмечено');
  $2('.side-nav [data-sideview="kanban"]').click(); await wait(80);
  assert.ok(D2.body.dataset.view === 'kanban' && $2('#side').hidden); ok('панель: выбор раздела переключает его и прячет панель');
  $2('#sideBtn').click(); await wait(50); $2('[data-sidepin]').click(); await wait(80);
  assert.ok(D2.body.classList.contains('side-pinned') && !$2('#side').hidden && w2.localStorage.getItem('kz-side-pin') === '1'); ok('панель: закрепляется и остаётся открытой');
  $2('[data-sidepin]').click(); await wait(80);
  assert.ok(!D2.body.classList.contains('side-pinned') && $2('#side').hidden); ok('панель: открепляется');
  // цвет пространства
  D2.querySelector('.tabs [data-view="templates"]').click(); await wait(100); $2('[data-settab="spaces"]').click(); await wait(200);
  const cBtn = $2(`[data-spcolor="${sid}|#EF4444"]`); assert.ok(cBtn); cBtn.click(); await wait(300);
  assert.equal(be.rows.get(`data/users/${A}/spaces/list/${sid}`).data.color, '#EF4444'); ok('цвет пространства сохраняется в аккаунте');
  assert.equal(w2.getComputedStyle(D2.documentElement).getPropertyValue('--space').trim(), '#EF4444'); ok('цвет текущего пространства окрашивает интерфейс');
  // переключение пространства кружком
  let re1 = 0; w2.kzReloadHook = () => { re1++; };
  $2('#sideBtn').click(); await wait(50); $2('.side-dots [data-sidesp=""]').click(); await wait(400);
  assert.ok(re1 === 1 && !w2.localStorage.getItem('kz-space')); ok('панель: нажатие на кружок открывает другое пространство');
  w2.localStorage.setItem('kz-space', sid);
  // 3) раздел страницы помнится при обновлении
  D2.querySelector('.tabs [data-view="load"]').click(); await wait(100);
  const view = w2.sessionStorage.getItem('kz-view');
  assert.ok(JSON.parse(view).view === 'load'); ok('открытый раздел запоминается во вкладке');
  // 4) обратно в «Основное» и удаление пространства
  D2.querySelector('.tabs [data-view="templates"]').click(); await wait(100); $2('[data-settab="spaces"]').click(); await wait(200);
  let re2 = 0; w2.kzReloadHook = () => { re2++; };
  [...D2.querySelectorAll('[data-spopen]')].find(b => b.dataset.spopen === '').click(); await wait(400);
  assert.ok(!w2.localStorage.getItem('kz-space') && re2 === 1); ok('переключение обратно в «Основное»');
  w2.localStorage.setItem('kz-space', sid); // остаёмся в нём для удаления
  $2(`[data-spdel="${sid}"]`).click(); await wait(50); $2('#cfmOk').click(); await wait(800);
  assert.ok(![...be.rows.keys()].some(k => k.includes(`/spaces/list/${sid}`))); ok('удаление: пространство и все его данные удалены из аккаунта');
  assert.equal([...be.rows.keys()].filter(k => /^data\/users\/[^/]+\/p_/.test(k)).length, mainProjects); ok('удаление: основное пространство не тронуто');
  o2.w.close();
  // 5) после обновления страницы открывается тот же раздел
  const o3 = openApp(be, A, 'https://kz.test/', { session: { 'kz-view': view } }); await wait(3500);
  assert.equal(o3.w.document.body.dataset.view, 'load'); ok('после обновления страницы открыт тот же раздел, а не главная');
  // 6) порядок этапов: перепутанный порядок восстанавливается по шаблону один раз
  const W3 = o3.w; const L3 = ls(W3); const pr = L3.projects.find(p => p.state === 'active' && p.stages.length > 3);
  const st = pr.stages.map(s => ({ ...s })); [st[st.length - 2], st[st.length - 1]] = [st[st.length - 1], st[st.length - 2]];
  const bad = { ...pr, stages: st, orderChecked: false }; delete bad.orderChecked;
  W3.mergeSnapshot({ meta: {}, projects: [bad], tasks: [] }, { keepDemo: true }); W3.commit(); await wait(50);
  W3.repairStageOrder(); W3.commit(); await wait(50);
  const fixed = ls(W3).projects.find(p => p.id === pr.id);
  assert.deepEqual(fixed.stages.map(s => s.name), pr.stages.map(s => s.name)); assert.ok(fixed.stages.every((s, i) => s.position === i)); ok('этапы: порядок восстановлен по шаблону, номера по порядку');
  assert.ok(fixed.log.some(l => /Порядок этапов восстановлен/.test(l.text))); ok('этапы: в истории проекта есть запись');
  const st2 = fixed.stages.map(s => ({ ...s })); [st2[st2.length - 2], st2[st2.length - 1]] = [st2[st2.length - 1], st2[st2.length - 2]];
  W3.mergeSnapshot({ meta: {}, projects: [{ ...fixed, stages: st2 }], tasks: [] }, { keepDemo: true }); W3.repairStageOrder(); W3.commit(); await wait(50);
  assert.deepEqual(ls(W3).projects.find(p => p.id === pr.id).stages.map(s => s.name), st2.map(s => s.name)); ok('этапы: дальше ручной порядок проекта не трогается');
  assert.equal(o3.errors.length, 0, o3.errors.join('\n')); ok('ошибок нет');
  o3.w.close();
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
