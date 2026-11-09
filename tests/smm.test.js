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
  const t = new Date(); const ym = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
  $('#cName').value = 'Ролик'; $('#cClient').value = 'Клиника'; $('#cStart').value = `${ym}-01`; $('#cDl').value = `${ym}-08`;
  $('#cCount').value = '15'; fire($('#cForm'), 'submit'); await wait(400);
  const vids = ls().projects.filter(p => /^Ролик \d+$/.test(p.name));
  assert.equal(vids.length, 15); ok('создано сразу 15 видео');
  assert.ok(vids.every(p => p.tags?.length === 1 && ls().prefs.tags.find(x => x.id === p.tags[0]).name === 'Главврач')); ok('у всех тег «Главврач»');
  const dates = vids.map(p => p.deadline).sort();
  assert.ok(dates[0] === `${ym}-08` && dates.at(-1).slice(0, 7) === ym && dates.at(-1) > `${ym}-27`); ok('публикации распределены от 8-го до конца месяца');

  // 4) недели и план / факт
  assert.ok([...D.querySelectorAll('.grp h2')].some(h => /^Неделя 2/.test(h.textContent))); ok('видео сгруппированы по неделям месяца');
  assert.ok(/Главврач/.test($('#tags').textContent)); ok('фильтр по тегу над списком');
  const pl = $('#smmPlan'); pl.value = '45'; fire(pl, 'change'); await wait(200);
  assert.equal(ls().prefs.smmPlans[ym], 45); assert.ok(/45/.test($('.smm-kpi').textContent)); ok('план на месяц сохраняется');
  // «опубликовать» одно видео: все этапы завершены сегодня
  const db = ls(); const v = db.projects.find(p => p.name === 'Ролик 1'); const today = `${ym}-${String(t.getDate()).padStart(2, '0')}`;
  v.stages.forEach(s => { s.status = 'done'; s.completed_at = today; });
  w.localStorage.setItem('agency-pipeline-demo-v2', JSON.stringify(db));
  const kpi = w.eval('(() => { db.projects.find(p => p.name === "Ролик 1").stages.forEach(s => { s.status = "done"; s.completed_at = today(); }); return smmStats(today().slice(0, 7)); })()');
  assert.equal(kpi.pub, 1); assert.equal(kpi.shot, 1); assert.equal(kpi.plan, 45); assert.ok(kpi.planned >= 15); ok("факт: снято 1, опубликовано 1 из плана 45");
  assert.ok(/опубликовано 1 из 15/.test(w.eval('smmTagRows(today().slice(0, 7))').replace(/<[^>]+>/g, ''))); ok('по тегу: «Главврач» опубликовано 1 из 15');

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

  // 7) «Где работаем?» — разделы: «Агентство» (основной) и «SMM» со своим пространством
  be.put(`data/users/${A}/spaces/ws/wsmm1`, { name: 'SMM', kind: 'smm', at: '2026-11-01' });
  be.put(`data/users/${A}/spaces/list/sabcde1`, { name: 'Клиника', at: '2026-11-01', kind: 'smm', ws: 'wsmm1' });
  be.put(`data/users/${A}/spaces/list/sabcde2`, { name: 'Разработка', at: '2026-11-02', kind: 'agency' });
  const o2 = openApp(be, A, { 'agency-mode': 'owner' }); await wait(4500);
  const w2 = o2.w, D2 = w2.document, $2 = s => D2.querySelector(s);
  const pick = $2('#spPick');
  assert.ok(pick && /Где работаем/.test(pick.textContent)); ok('после входа — «Где работаем?»');
  const cards = [...pick.querySelectorAll('[data-pickws]')].map(b => b.textContent.replace(/\s+/g, ' '));
  assert.equal(cards.length, 2); assert.ok(/Агентство · 2 пространства/.test(cards[0]) && /SMM · 1 пространство/.test(cards[1])); ok('на экране разделы, а не пространства: «Агентство» (2) и «SMM» (1)');
  pick.querySelector('[data-pickws="w0"]').click(); await wait(100);
  assert.ok(!$2('#spPick')); ok('выбор текущего раздела просто закрывает экран');
  $2('#sideBtn').click(); await wait(80);
  const dots = [...D2.querySelectorAll('.side-dots [data-sidesp]')].map(b => b.dataset.sidesp);
  assert.deepEqual(dots, ['', 'sabcde2']); assert.ok(/Агентство/.test($2('.side-ws').textContent)); ok('в панели — только пространства раздела «Агентство», сверху название раздела');
  let reloaded = 0; w2.kzReloadHook = () => { reloaded++; };
  $2('.side-ws').click(); await wait(100);
  assert.ok($2('#spPick')); ok('название раздела в панели снова открывает «Где работаем?»');
  $2('#spPick [data-pickws="wsmm1"]').click(); await wait(400);
  assert.ok(reloaded === 1 && w2.localStorage.getItem('kz-space') === 'sabcde1'); ok('раздел SMM открывает своё пространство «Клиника»');
  // новый раздел прямо с экрана выбора
  w2.eval('openPick()'); await wait(50);
  $2('[data-picknew]').click(); await wait(50);
  $2('#wsNewName').value = 'Другой бизнес'; $2('[name="wsKind"][value="agency"]').checked = true;
  $2('#wsNew').dispatchEvent(new w2.Event('submit', { bubbles: true, cancelable: true })); await wait(600);
  const wsKeys = [...be.rows.keys()].filter(k => k.startsWith(`data/users/${A}/spaces/ws/`));
  const newWs = wsKeys.find(k => be.rows.get(k).data.name === 'Другой бизнес');
  assert.ok(newWs); const wid = newWs.split('/').pop();
  const first = [...be.rows.values()].find(r => r.path.startsWith(`data/users/${A}/spaces/list/`) && r.data.ws === wid);
  assert.ok(first && reloaded === 2 && w2.localStorage.getItem('kz-space') === first.path.split('/').pop()); ok('«+ Новый раздел» создаёт раздел и его первое пространство и открывает его');
  const errs = [...o.errors, ...o2.errors].filter(e => !/Not implemented/.test(e));
  assert.deepEqual(errs, []); ok('ошибок на странице нет');
  w2.close();
  console.log(`\nИтого: ${n} проверок прошло`);
  process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
