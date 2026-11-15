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
// Инфобизнес: таймлайн «Вместе» — несколько инфоповодов на одной шкале
(async () => {
  const be = makeBackend(); const o = openApp(be, 'aaaaaaaa-0000-0000-0000-0000000000c1'); await wait(4500);
  const w = o.w, D = w.document, $ = s => D.querySelector(s), E = x => w.eval(x);
  D.getElementById('spPick')?.remove(); E(`layer.innerHTML = ''`);
  E(`db.prefs = db.prefs || {}; db.prefs.kind = 'info'; ensureInfoTemplate(db); db.projects = db.projects.filter(p => p.template_id !== INFO_TPL_ID && p.id !== INFO_BOARD_ID);
     window.T = today(); window.ig = createInfoBoard('Блок Игоря', addDays(T, -5)); window.em = createInfoBoard('Челлендж Эма', addDays(T, -2));
     const fill = (p, list) => list.forEach(([st, name, d]) => { const s = p.stages[st]; (s.subs = s.subs || []).push({ id:uid(), name, done:false, due_date:addDays(T, d) }); });
     fill(ig, [[0, 'Оффер', 1], [1, 'Рилс 1', 2], [2, 'Эфир', 6]]); fill(em, [[1, 'Анонс челленджа', 2], [3, 'Старт', 9]]);
     ui.view = 'production'; ui.prodProject = ig.id; ui.infoMode = 'board'; commit();`); await wait(100);
  assert.ok(!$('[data-infomode="together"]') && !$('[data-tlscope]')); ok('отдельной кнопки «Вместе» и выпадающего списка нет');
  assert.ok($('[data-ipall]')); ok('в строке инфоповодов — «Все»');
  $('[data-ipall]').click(); await wait(100);
  assert.equal(D.querySelectorAll('.ip-board').length, 2); ok('«Все» → «Доска»: доски обоих инфоповодов одна под другой');
  { const b = [...D.querySelectorAll('.ip-board')].find(x => x.dataset.pfboard === E('em.id')); const add = b.querySelector('[data-pfadd]'); add.querySelector('input').value = 'Задача из «Всех»';
    add.dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(50);
    assert.ok(E(`em.stages.some(s => (s.subs || []).some(x => x.name === 'Задача из «Всех»'))`) && !E(`ig.stages.some(s => (s.subs || []).some(x => x.name === 'Задача из «Всех»'))`)); ok('правка в доске внутри «Все» попадает в свой инфоповод'); }
  E(`ui.infoAll = true; render();`); $('[data-infomode="timeline"]').click(); await wait(100);
  const fa = $('.fl-p'); assert.ok(/Все площадки/.test(fa.textContent) && /Оффер/.test(fa.textContent) && /Анонс челленджа/.test(fa.textContent)); ok('«Все»: ближайшие задачи всех инфоповодов вместе');

  assert.ok($('.tg-tl') && D.querySelectorAll('.tg-lane').length === 2); ok('«Вместе»: блок Игоря и челлендж Эма — две полосы на одной шкале');
  assert.equal(D.querySelectorAll('.tg-task').length, 5); ok('задачи обоих инфоповодов на таймлайне');
  assert.ok(!$('.tg-cross') && !$('.tg-cnt') && !/Пересечени/.test($('.tg').textContent)); ok('без строки «Пересечения» — просто общий таймлайн');
  assert.ok($('[data-ipall]').classList.contains('on') && !$('[data-tgp]') && !$('.ip-board')); ok('«Все» → «Таймлайн»: общий таймлайн без лишнего выбора');
  // клик по задаче другого инфоповода — её карточка
  [...D.querySelectorAll('.tg-task')].find(b => /Старт/.test(b.textContent)).click(); await wait(100);
  assert.ok(E('ui.taskId') && E(`taskById(ui.taskId).project_id`) === E('em.id')); ok('клик по задаче Эма открывает её карточку');
  E(`layer.innerHTML = ''; ui.taskId = null; ui.infoAll = false; ui.infoMode = 'board'; ui.prodProject = ig.id; render();`); await wait(50);
  // ключевые даты: вводятся в карточке площадки, на доске открыто не показываются; на таймлайне — линии
  assert.ok(!/финиш/.test($('.pf-head small').textContent) && !$('.pf-main [data-kdadd]') && !$('.pf-main .kd-row')); ok('на доске нет ни финиша, ни ключевых дат');
  const addKd = async (pid, d, name) => { E(`openProject('${pid}')`); await wait(100); D.querySelector('.d-kd [data-kdadd]').click(); await wait(30);
    const f = D.querySelector('.d-kd [data-kdform]'); f.elements.namedItem('kdd').value = d; f.elements.namedItem('kdn').value = name; f.dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(50); };
  await addKd(E('ig.id'), E('addDays(T, 3)'), 'Эфир Игоря');
  assert.ok(/Эфир Игоря/.test(D.querySelector('.d-kd').textContent) && E('ig.keyDates.length') === 1); ok('ключевая дата вписывается в карточке площадки');
  await addKd(E('em.id'), E('addDays(T, 4)'), 'Старт челленджа');
  assert.ok(!/Эфир Игоря/.test(D.querySelector('.d-kd').textContent)); ok('у каждой площадки свои ключевые даты');
  E(`layer.innerHTML = ''; ui.open = null; ui.prodProject = em.id; ui.infoMode = 'timeline'; render();`); await wait(30); assert.ok($('.tl-key') && /Старт челленджа/.test($('.tl-key').textContent)); ok('на таймлайне ключевая дата — красная линия');
  E(`ui.infoAll = true; render();`); await wait(30); assert.equal(D.querySelectorAll('.tl-key').length, 2); ok('во «Все» — ключевые даты обеих площадок');
  E(`ui.infoAll = false; ui.infoMode = 'board'; openProject(em.id)`); await wait(100); D.querySelector('.d-kd [data-kddel]').click(); await wait(30); assert.equal(E('em.keyDates.length'), 0); ok('ключевую дату можно удалить');
  E(`closeLayer ? closeLayer() : (layer.innerHTML = ''); ui.open = null; ui.prodProject = em.id; render();`); await wait(30);
  // столбики доски: переименовать, удалить, добавить — только в этом инфоповоде
  assert.ok(!$('[data-pfsren]') && !$('[data-pfsdel]') && !$('[data-pfscol]') && $('[data-pfedit]')); ok('без «Редактировать доску» значков правки и «+ Столбик» не видно');
  $('[data-pfedit]').click(); await wait(30); assert.ok($('[data-pfsren]') && $('[data-pfscol]') && $('[data-pfcolmove]')); ok('«Редактировать доску» открывает правку столбиков');
  $('[data-pfsren]').click(); await wait(30); f = $('[data-pfrenf]'); f.querySelector('input').value = 'Продукт и оффер'; f.dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(30);
  E(`syncAllTemplates(INFO_TPL_ID); render();`); await wait(30);
  assert.ok(E(`em.stages[0].name`) === 'Продукт и оффер' && E(`ig.stages[0].name`) === 'Продукт'); ok('столбик переименовывается и не возвращается шаблоном; у другого инфоповода прежний');
  $('[data-pfscol]').click(); await wait(30); f = $('[data-pfrenf]'); f.querySelector('input').value = 'Монтаж'; f.dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(30);
  assert.ok(E(`em.stages.some(s => s.name === 'Монтаж')`) && !E(`ig.stages.some(s => s.name === 'Монтаж')`)); ok('новый столбик добавляется');
  D.querySelector(`[data-pfsdel="${E(`em.stages.find(s => s.name === 'Монтаж').id`)}"]`).click(); await wait(30); $('#cfmOk').click(); await wait(80);
  E(`syncAllTemplates(INFO_TPL_ID);`); assert.ok(!E(`em.stages.some(s => s.name === 'Монтаж')`)); ok('лишний столбик удаляется');
  // переставить столбики (в режиме правки): второй встаёт первым
  { const ids = E(`JSON.stringify(em.stages.map(s => s.id))`); const [a0, a1] = JSON.parse(ids);
    E(`reorderStage(em, '${a1}', '${a0}')`); assert.ok(E(`em.stages[0].id`) === a1 && E(`em.stages[1].id`) === a0 && E(`em.stages[0].position`) === 0); ok('столбики переставляются местами');
    E(`syncAllTemplates(INFO_TPL_ID);`); assert.ok(E(`em.stages[0].id`) === a1); ok('порядок не сбрасывается шаблоном');
    E(`reorderStage(em, '${a0}', '${a1}')`); }
  $('[data-pfedit]').click(); await wait(30); assert.ok(!$('[data-pfsren]')); ok('«Готово» прячет правку');
  // порядок карточек в столбике: как на доске / по ближайшим датам / по приоритету
  E(`layer.innerHTML = ''; ui.open = null; ui.infoMode = 'board'; ui.prodProject = em.id; { const s = em.stages[1]; s.subs = [
     { id:'cA', name:'Поздняя', done:false, due_date:addDays(T, 9) }, { id:'cB', name:'Без срока', done:false }, { id:'cC', name:'Ближайшая', done:false, due_date:addDays(T, 1) }, { id:'cD', name:'Срочная', done:false, due_date:addDays(T, 5) } ];
     tasksFromSubs(em, { ...s, subs:[s.subs[3]] }); taskFor(em.id, s.id, 'cD').priority = 'urgent'; } render();`); await wait(50);
  const order = () => [...D.querySelectorAll('.pf-col')[1].querySelectorAll('.pf-card b')].map(b => b.textContent.trim());
  assert.deepEqual(order(), ['Поздняя', 'Без срока', 'Ближайшая', 'Срочная']); ok('по умолчанию — как на доске');
  const sel = $('#pfSort'); sel.value = 'due'; sel.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(30);
  assert.deepEqual(order().map(x => x.replace(/^[^А-Яа-яЁё]+/, '')), ['Ближайшая', 'Срочная', 'Поздняя', 'Без срока']); ok('«по ближайшим датам»: ближайшие сверху, без срока внизу');
  const sel2 = $('#pfSort'); sel2.value = 'pri'; sel2.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(30);
  assert.equal(order()[0].replace(/^[^А-Яа-яЁё]+/, ''), 'Срочная'); ok('«по приоритету»: срочные сверху');
  assert.equal(w.localStorage.getItem('kz-card-sort'), 'pri'); ok('выбор запоминается');
  assert.deepEqual(o.errors.filter(e => !/Not implemented/.test(e)), []); ok('без ошибок');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
