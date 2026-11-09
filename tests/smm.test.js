// SMM-пространство: тип, «видео» вместо «проектов», пачка видео с тегом, недели месяца, план / факт, экран выбора пространства
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

function openApp(backend, userId, keepStorage, session) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.message || e).slice(0, 200)));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://kz.test/', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.supabase = { createClient: () => backend.client(userId) };
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
      w.scrollTo = () => {}; w.IntersectionObserver = w.IntersectionObserver || class { observe() {} disconnect() {} unobserve() {} };
      w.ResizeObserver = w.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
      w.HTMLElement.prototype.scrollIntoView = function () {};
      if (keepStorage) for (const k in keepStorage) w.localStorage.setItem(k, keepStorage[k]);
      if (session) for (const k in session) w.sessionStorage.setItem(k, session[k]);
    }
  });
  return { dom, w: dom.window, errors };
}
(async () => {
  const be = makeBackend();
  const A = 'aaaaaaaa-0000-0000-0000-000000000077';
  const o = openApp(be, A, { 'kz-pick-seen': '1' });
  await wait(4500);
  const w = o.w, D = w.document, $ = s => D.querySelector(s);
  const fire = (el, t) => el.dispatchEvent(new w.Event(t, { bubbles: true, cancelable: true }));
  const ls = () => JSON.parse(w.localStorage.getItem('agency-pipeline-demo-v2'));
  assert.ok(!$('#spPick')); ok('до приветственной анкеты экран выбора не мешает');

  // 1) тип пространства → SMM
  D.querySelector('.tabs [data-view="templates"]').click(); await wait(100);
  $('[data-settab="spaces"]').click(); await wait(200);
  const kind = $('[data-spkind]'); assert.ok(kind && kind.value === 'agency'); ok('у открытого пространства есть выбор типа, по умолчанию «Агентство»');
  kind.value = 'smm'; fire(kind, 'change'); await wait(300);
  assert.equal(ls().prefs.kind, 'smm'); assert.ok(ls().templates.some(t => t.name === 'SMM: видео')); ok('тип SMM сохранён, добавлен шаблон «SMM: видео»');
  assert.equal(be.rows.get(`data/users/${A}/spaces/main`)?.data?.kind, 'smm'); ok('тип записан в аккаунт');

  // 2) главная: «Новое видео», блок план / факт
  D.querySelector('.tabs [data-view="matrix"]').click(); await wait(150);
  assert.equal($('#newBtn').textContent, 'Новое видео'); ok('кнопка «Новое видео»');
  assert.ok($('.smm-pf') && /План \/ Факт/.test($('.smm-pf').textContent)); ok('на главной блок «План / Факт»');

  // 3) пачка: 15 видео с тегом «Главврач»
  $('#newBtn').click(); await wait(100);
  assert.equal($('#cTitle').textContent, 'Новое видео'); assert.ok($('#cCount')); ok('окно «Новое видео» с полем «Количество видео»');
  assert.ok(/SMM/.test($('#cTpl').selectedOptions[0].textContent)); ok('по умолчанию выбран шаблон SMM');
  const tn = $('[data-tgscope="c"] [data-tgnew]'); tn.value = 'Главврач';
  tn.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(50);
  assert.equal($('[data-tgscope="c"] [data-tgtoggle]').getAttribute('aria-pressed'), 'true'); ok('новый тег создаётся из поля и сразу выбран');
  const t = new Date(); const T = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  $('#cName').value = 'Ролик'; $('#cClient').value = 'Клиника'; $('#cStart').value = T;
  $('#cCount').value = '45'; fire($('#cCount'), 'input'); await wait(20);
  assert.ok($('#cDl').closest('.field').hidden); ok('при пачке общее поле «Дата публикации» прячется');
  fire($('#cForm'), 'submit'); await wait(500);
  const vids = ls().projects.filter(p => /^Ролик \d+$/.test(p.name));
  assert.equal(vids.length, 45); ok('создано сразу 45 видео');
  assert.ok(vids.every(p => p.tags?.length === 1 && ls().prefs.tags.find(x => x.id === p.tags[0]).name === 'Главврач')); ok('у всех тег «Главврач»');
  const perW = [1, 2, 3, 4].map(k => vids.filter(p => p.week === k).length);
  assert.deepEqual(perW, [12, 11, 11, 11]); assert.ok(vids.every(p => p.cycle === T)); ok('45 видео поровну на 4 недели от сегодня: 12 / 11 / 11 / 11');
  const inWeek = p => { const d = (Date.parse(p.deadline) - Date.parse(T)) / 864e5; return d >= (p.week - 1) * 7 && d <= (p.week - 1) * 7 + 6; };
  assert.ok(vids.every(inWeek)); ok('публикация каждого видео — внутри его недели');
  const lateN = w.eval('db.projects.filter(p => p.cycle && plannedEnd(p) > p.deadline).length');
  assert.equal(lateN, 0); ok('этапы каждого видео укладываются в его дату публикации');

  // 4) недели и план / факт
  const heads = [...D.querySelectorAll('.grp h2')].map(h => h.textContent);
  assert.ok(heads.some(h => /^Неделя 1/.test(h)) && heads.some(h => /^Неделя 4/.test(h))); ok('список сгруппирован: Неделя 1…4 от даты старта');
  assert.ok(/Главврач/.test($('#tags').textContent)); ok('фильтр по тегу над списком');
  const rows = [...D.querySelectorAll('.smm-wk tbody tr')].map(r => r.children[1].textContent);
  assert.deepEqual(rows, ['12', '11', '11', '11']); ok('«План / Факт»: план по неделям 12 / 11 / 11 / 11');
  assert.ok(!$('#smmPlan') && $('[data-smmedit]')); ok('поле плана скрыто, есть кнопка «Редактировать»');
  $('[data-smmedit]').click(); await wait(50);
  assert.ok($('#smmStart') && $('#smmStart').type === 'date' && $('#smmStart').value === T); ok('«Редактировать» открывает календарь даты старта и план');
  $('#smmPlan').value = '40'; fire($('#smmEd'), 'submit'); await wait(200);
  assert.equal(ls().prefs.smmCyclePlans[T], 40); assert.deepEqual([...D.querySelectorAll('.smm-wk tbody tr')].map(r => r.children[1].textContent), ['10', '10', '10', '10']); ok('свой план на 4 недели (40) делится по неделям: 10 / 10 / 10 / 10');
  // сдвиг старта на 3 дня: цикл и публикации переезжают, недели те же
  const before = ls().projects.find(p => p.name === 'Ролик 5').deadline;
  $('[data-smmedit]').click(); await wait(50);
  const T3 = w.eval(`addDays('${T}', 3)`); $('#smmStart').value = T3; fire($('#smmEd'), 'submit'); await wait(200);
  const after = ls().projects.find(p => p.name === 'Ролик 5');
  assert.ok(after.cycle === T3 && after.deadline === w.eval(`addDays('${before}', 3)`) && ls().prefs.smmCyclePlans[T3] === 40 && !$('#smmEd')); ok('новая дата старта сдвигает цикл и публикации, план сохраняется');
  const kpi = w.eval('(() => { db.projects.find(p => p.name === "Ролик 1").stages.forEach(s => { s.status = "done"; s.completed_at = today(); }); return smmStats(curCycle()); })()');
  assert.equal(kpi.pub, 1); assert.equal(kpi.shot, 1); assert.equal(kpi.plan, 40); assert.equal(kpi.weeks[0].pub, 1); ok('факт: снято 1, опубликовано 1 — в неделе 1');
  assert.ok(/опубликовано 1 из 45/.test(w.eval('smmTagRows(curCycle())').replace(/<[^>]+>/g, ''))); ok('по тегу: «Главврач» опубликовано 1 из 45');

  // 5) у видео без фото — иконка видео
  assert.ok($('.pava.vid svg')); ok('у видео иконка видео вместо букв');

  // 6) пачкой назначить тег выбранным
  w.eval('addTag("Отзыв"); save();');
  $('#selToggle').click(); await wait(100);
  D.querySelectorAll('[data-open]')[0].click(); await wait(50);
  const st = $('[data-seltag]'); const otz = ls().prefs.tags.find(x => x.name === 'Отзыв').id;
  st.value = otz; fire(st, 'change'); await wait(200);
  assert.equal(ls().projects.filter(p => (p.tags || []).includes(otz)).length, 1); ok('тег назначается выбранным пачкой');
  w.eval('db.onboarded = true; save();'); await wait(2500);   // анкета пройдена
  o.w.close();

  // 7) «Где работаем?» — области; внутри области — пространства (агентство и SMM вперемешку)
  be.put(`data/users/${A}/spaces/list/sabcde1`, { name: 'Клиника', at: '2026-11-01', kind: 'smm' });
  be.put(`data/users/${A}/spaces/list/sabcde2`, { name: 'Разработка', at: '2026-11-02', kind: 'agency' });
  be.put(`data/users/${A}/spaces/area/abiz2`, { name: 'Второй бизнес', at: '2026-11-03' });
  be.put(`data/users/${A}/spaces/list/sabcde3`, { name: 'Кофейня', at: '2026-11-03', kind: 'agency', area: 'abiz2' });
  const o2 = openApp(be, A, { 'agency-mode': 'owner' }); await wait(4500);
  const w2 = o2.w, D2 = w2.document, $2 = s => D2.querySelector(s);
  const pick = $2('#spPick');
  assert.ok(pick && /Где работаем/.test(pick.textContent)); ok('после входа — «Где работаем?»');
  const areas = [...pick.querySelectorAll('[data-pickarea]')];
  assert.equal(areas.length, 2); assert.ok(/Мой бизнес/.test(areas[0].textContent) && /Клиника · Разработка/.test(areas[0].textContent) && /Кофейня/.test(areas[1].textContent)); ok('на экране — области со списком их пространств');
  assert.ok(!pick.querySelector('[data-pickws]')); ok('разделов больше нет');
  areas[0].click(); await wait(100);
  assert.ok(!$2('#spPick')); ok('нажатие на текущую область сразу открывает рабочий экран');
  $2('#sideBtn').click(); await wait(80);
  const dots = [...D2.querySelectorAll('.side-dots [data-sidesp]')].map(b => b.dataset.sidesp);
  assert.deepEqual(dots, ['', 'sabcde1', 'sabcde2']); ok('в панели кружками все пространства области «Мой бизнес»');
  $2('[data-areamenu]').click(); await wait(50);
  const items = [...D2.querySelectorAll('.area-menu [data-areaopen]')].map(b => b.firstChild.textContent);
  assert.deepEqual(items, ['Мой бизнес', 'Второй бизнес']); assert.ok($2('.area-menu [data-areamnew]')); ok('▾ у названия области — выпадающий список областей и «+ Новая область»');
  let reloaded = 0; w2.kzReloadHook = () => { reloaded++; };
  $2('.area-menu [data-areaopen="abiz2"]').click(); await wait(400);
  assert.ok(reloaded === 1 && w2.localStorage.getItem('kz-space') === 'sabcde3'); ok('выбор области в списке открывает её пространство');
  $2('.side-dots [data-sidesp="sabcde1"]')?.click(); await wait(10);
  // новая область → сразу форма первого пространства
  w2.eval('openPick()'); await wait(50);
  $2('[data-areanew]').click(); await wait(50);
  $2('#areaNewName').value = 'Третий бизнес';
  $2('#areaNew').dispatchEvent(new w2.Event('submit', { bubbles: true, cancelable: true })); await wait(400);
  const areaRow = [...be.rows.values()].find(r => r.path.startsWith(`data/users/${A}/spaces/area/`) && r.data.name === 'Третий бизнес');
  assert.ok(areaRow && /Третий бизнес/.test($2('#spPickT').textContent) && $2('#spFirst')); ok('«+ Новая область» создаёт область и сразу предлагает её первое пространство');
  $2('#spFirstName').value = 'Ролики'; $2('[name="spFirstKind"][value="smm"]').checked = true;
  $2('#spFirst').dispatchEvent(new w2.Event('submit', { bubbles: true, cancelable: true })); await wait(600);
  const first = [...be.rows.values()].find(r => r.path.startsWith(`data/users/${A}/spaces/list/`) && r.data.name === 'Ролики');
  assert.ok(first && first.data.area === areaRow.path.split('/').pop() && first.data.kind === 'smm' && w2.localStorage.getItem('kz-space') === first.path.split('/').pop()); ok('первое пространство (SMM) создано в новой области и открыто');
  const errs = [...o.errors, ...o2.errors].filter(e => !/Not implemented/.test(e));
  assert.deepEqual(errs, []); ok('ошибок на странице нет');
  w2.close();
  console.log(`\nИтого: ${n} проверок прошло`);
  process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
