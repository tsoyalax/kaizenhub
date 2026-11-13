// Шаблоны из другого пространства: выбрать пространство → отметить шаблоны → копия с этапами, подэтапами и карточками
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
  const o = openApp(be, 'aaaaaaaa-0000-0000-0000-000000000051'); await wait(4500);
  const w = o.w, D = w.document, $ = s => D.querySelector(s);
  const fire = (el, t) => el.dispatchEvent(new w.Event(t, { bubbles: true, cancelable: true }));
  D.getElementById('spPick')?.remove(); w.eval(`layer.innerHTML = ''`);
  // два проекта на ведении
  w.eval(`db.projects.filter(p => p.state === 'active').slice(0, 2).forEach(p => { p.is_maintenance = true; syncState(p); }); commit();`);
  const [p1, p2] = w.eval('maintProjects().map(p => p.id)');
  assert.ok(p1 && p2); ok('есть проекты на ведении');
  D.querySelector('.tabs [data-view="depts"]').click(); await wait(100);
  assert.ok($('#ogAddForm') && /после запуска/i.test($('.og-first').textContent)); ok('без отделов — пояснение и форма «Создать отдел»');
  for (const n of ['Отдел контента', 'Отдел трафика', 'Челлендж с Сэмом']){ $('#ogAddName').value = n; fire($('#ogAddForm'), 'submit'); await wait(50); }
  assert.deepEqual([...D.querySelectorAll('.og-col .cname')].map(x => x.textContent), ['Отдел контента', 'Отдел трафика', 'Челлендж с Сэмом']); ok('свои отделы — колонки канбана');
  const [dC, dT] = w.eval('deptList().map(d => d.id)');
  // задача отдела из колонки: сама по себе, с подзадачами
  $(`[data-ognew="${dT}"]`).click(); await wait(50);
  assert.ok($('#ogForm') && $('#ogDept').value === dT); ok('«+ Задача» в колонке: форма задачи отдела, отдел подставлен');
  $('#ogTitle').value = 'Запуск кампании'; $('#ogStart').value = w.eval('addDays(today(), 2)'); $('#ogDue').value = w.eval('addDays(today(), 9)');
  for (const st of ['Креативы', 'Настроить кабинет', 'Запуск']){ $('#ogSubNew').value = st; $('#ogSubNew').dispatchEvent(new w.KeyboardEvent('keydown', { key:'Enter', bubbles:true })); }
  const sc = D.querySelector('[data-ogsub="0"]'); sc.checked = true; fire(sc, 'change');
  fire($('#ogForm'), 'submit'); await wait(100);
  const t1 = w.eval(`itAll().find(t => t.title === 'Запуск кампании')`);
  assert.ok(t1 && t1.dept === dT && t1.start && !t1.pid && t1.subs.length === 3 && t1.subs[0].done); ok('задача отдела без привязки к ролику, с подзадачами');
  const c1 = [...D.querySelectorAll(`[data-ogcol="${dT}"] .og-card`)].find(x => /Запуск кампании/.test(x.textContent));
  assert.ok(c1 && /Подзадачи 1\/3/.test(c1.textContent)); ok('в колонке отдела с прогрессом подзадач');
  // задача, связанная с роликом: галочка «В производство» создаёт проект
  const nProj = w.eval('db.projects.length');
  $(`[data-ognew="${dC}"]`).click(); await wait(50);
  $('#ogTitle').value = 'Ролик для челленджа'; const pc = $('#ogProd'); pc.checked = true; fire(pc, 'change');
  assert.ok(!$('#ogTpl').hidden); fire($('#ogForm'), 'submit'); await wait(100);
  const t2 = w.eval(`itAll().find(t => t.title === 'Ролик для челленджа')`);
  assert.ok(t2.pid && w.eval('db.projects.length') === nProj + 1 && w.eval(`projById('${t2.pid}').name`) === 'Ролик для челленджа'); ok('«В производство» создаёт проект и связывает с задачей');
  assert.ok(/В производстве: Ролик для челленджа/.test(D.querySelector(`[data-ogcol="${dC}"]`).textContent)); ok('на карточке видно, что задача в производстве и на каком этапе');
  // задача ведения проекта после запуска — тоже в отделе
  w.eval(`{ const s = projById('${p2}').stages.find(isMaint); s.rtasks = s.rtasks || []; s.rtasks.push({ id:'rC', title:'Отчёт клиенту', frequency:'once', due_date:addDays(today(), 5), status:'todo', dept:'${dT}', done_count:0 }); commit(); }`);
  assert.ok(/Отчёт клиенту/.test($(`[data-ogcol="${dT}"]`).textContent) && /ведение/.test($(`[data-ogcol="${dT}"]`).textContent)); ok('задачи ведения проекта — в колонке своего отдела');
  // регулярная задача без отдела и просроченная — в своей колонке
  w.eval(`{ const s = projById('${p1}').stages.find(isMaint); s.rtasks = s.rtasks || [];
    s.rtasks.push({ id:'rA', title:'Отчёт по рекламе', frequency:'weekly', due_date:addDays(today(), 3), status:'todo', done_count:0 });
    s.rtasks.push({ id:'rB', title:'Сценарии челленджа', frequency:'once', start:addDays(today(), -9), due_date:addDays(today(), -2), status:'todo', dept:'${dC}', done_count:0 }); commit(); }`);
  assert.ok($('[data-ogcol="_"]') && /Отчёт по рекламе/.test($('[data-ogcol="_"]').textContent)); ok('задача без отдела — в колонке «Без отдела»');
  assert.ok($(`[data-ogcol="${dC}"] .og-card.k-late`)); ok('просроченная отмечена');
  // перенос в другой отдел
  w.eval(`moveOpTask('${p1}', 'rA', '${dT}')`); await wait(50);
  assert.equal(w.eval(`projById('${p1}').stages.find(isMaint).rtasks.find(r => r.id === 'rA').dept`), dT); ok('перетаскивание меняет отдел задачи');
  // выполнение разовой — пропадает из канбана, регулярная — переносится на следующий цикл
  const cb = $(`[data-rdone="${p1}|rB"]`); cb.checked = true; fire(cb, 'change'); await wait(50);
  assert.ok(!$(`[data-rdone="${p1}|rB"]`)); ok('выполненная разовая уходит из колонки');
  assert.ok(w.eval(`!rOpen(projById('${p1}').stages.find(isMaint).rtasks.find(r => r.id === 'rB'))`)); ok('и помечена выполненной (не повторяется)');
  // таймлайн: общий и по отделу
  $('[data-dtmode="timeline"]').click(); await wait(50);
  assert.ok($('.og-today') && D.querySelectorAll('.og-grp').length >= 1); ok('таймлайн: линия «сегодня» и группы по отделам');
  assert.ok(D.querySelectorAll('.og-bar.rep').length >= 1); ok('у регулярной задачи видны следующие повторы');
  $(`[data-dtdept="${dT}"]`).click(); await wait(50);
  const titles = [...D.querySelectorAll('.og-name b')].map(x => x.textContent);
  assert.ok(titles.includes('Запуск кампании') && titles.includes('Отчёт по рекламе') && titles.includes('Отчёт клиенту') && !titles.includes('Сценарии челленджа')); ok('таймлайн одного отдела — только его задачи');
  $('[data-dtdept=""]').click(); await wait(50);
  assert.ok(D.querySelectorAll('.og-grp').length >= 2); ok('общий таймлайн — все отделы');
  // задача отдела выполняется галочкой
  w.eval(`ui.dtMode = 'kanban'; render();`); await wait(50);
  const dc = $(`[data-ogdone="${t1.id}"]`); dc.checked = true; fire(dc, 'change'); await wait(50);
  assert.equal(w.eval(`itAll().find(t => t.id === '${t1.id}').status`), 'done'); ok('задача отдела выполняется галочкой');
  // карточка проекта: задачи ведения с отделом
  w.eval(`openProject('${p2}')`); await wait(100);
  assert.ok(/Задачи ведения/.test(D.body.textContent) && /Отдел трафика/.test(D.querySelector('.rt-block').textContent)); ok('в карточке проекта — задачи ведения с отделом');
  // удаление отдела — задачи остаются без отдела
  w.eval(`layer.innerHTML = ''; ui.open = null; ui.dtMode = 'kanban'; render();`); await wait(50);
  $(`[data-ogdel="${dT}"]`).click(); await wait(50); D.querySelector('.modal .primary, .modal [data-ok]')?.click(); await wait(100);
  assert.ok(!w.eval(`deptById('${dT}')`) && w.eval(`projById('${p2}').stages.find(isMaint).rtasks[0].dept`) === null && w.eval(`itAll().find(t => t.id === '${t1.id}').dept`) === null); ok('удалённый отдел: задачи остаются, без отдела');
  assert.deepEqual(o.errors.filter(e => !/Not implemented/.test(e)), []); ok('без ошибок');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
