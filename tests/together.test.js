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
  E(`ui.infoAll = true; ui.prodTab = 'internal'; render()`); assert.ok($('[data-prodtab="internal"][aria-pressed="true"]') && D.querySelectorAll('.it-allp').length === 2); ok('во «Все» — «Внутренние задачи» всех площадок');
  E(`ui.prodTab = 'board'; ui.infoAll = false; render()`);
  $('[data-ipall]').click(); await wait(100);
  { const cols = [...D.querySelectorAll('.kb-board .kb-col')].map(c => c.querySelector('header b').textContent);
    assert.deepEqual(cols, ['К выполнению', 'В работе', 'Готово']); ok('«Все» → «Доска»: обычный канбан — К выполнению / В работе / Готово');
    const todo = $('.kb-todo'); const c = [...todo.querySelectorAll('.kb-card')].find(x => /Эфир/.test(x.textContent));
    assert.ok(c && /Блок Игоря/.test(c.textContent) && c.querySelector('.kb-dept') && [...todo.querySelectorAll('.kb-card')].some(x => /Старт/.test(x.textContent) && /Челлендж Эма/.test(x.textContent))); ok('задачи обеих площадок с плашкой отдела и площадки');
    assert.ok($('.kb-depts .kb-dbtn .dept-tile') && !$('[data-kbtype]')); ok('отделы — большими кнопками, остальные фильтры за иконкой');
    $('[data-kbfopen]').click(); await wait(30);
    assert.ok([...D.querySelectorAll('.kb-type')].every(b => /Операционная/.test(b.textContent))); ok('по умолчанию задачи операционные');
    $('[data-kbtype="strat"]').click(); await wait(50); assert.equal(D.querySelectorAll('.kb-card').length, 0);
    $('[data-kbtype=""]').click(); await wait(50); E(`ui.kbType = ''`); ok('фильтр «Стратегические»');
    $('.kb-type[data-kbtt]').click(); await wait(30); assert.equal(D.querySelectorAll('.kb-type.t-strat').length, 1); assert.ok(!E('ui.taskId')); ok('нажатие на метку — «Стратегическая», карточка не открывается');
    $('[data-kbdue="week"]').click(); await wait(50);
    { const t = [...D.querySelectorAll('.kb-todo .kb-card b')].map(b => b.textContent); assert.ok(t.length && t.every(x => !/Старт/.test(x))); ok('фильтр «На неделю»: дальние сроки скрыты'); }
    $('[data-kbdue=""]').click(); await wait(50);
    { const d = [...D.querySelectorAll('.kb-todo .kb-card .pf-due:not(.nodue)')].map(e => e.textContent); assert.ok(d.length > 1); ok('ближайшие сроки — сверху колонки'); }
    $('[data-kbview="dept"]').click(); await wait(50); assert.ok($('.ab-board') && !$('.kb-board')); ok('вид «По отделам»: столбик = отдел');
    $('[data-kbview="status"]').click(); await wait(50); assert.ok($('.kb-board')); ok('вид «Канбан» возвращается'); }
  E(`ui.infoAll = true; render();`); $('[data-infomode="timeline"]').click(); await wait(100);
  assert.ok($('.fl-viewbar [data-kbview]') && !$('.fl-p') && !$('.flp-list')); ok('«Все»: только переключатель вида, без плашки');
  E(`SHOW_TODAY = true; INFO_HIDDEN.splice(INFO_HIDDEN.indexOf('today'), 1); ui.view = 'today'; ui.tdIp = ''; render();`); { const due = $('.tdy-due'); assert.ok(due && /Оффер/.test(due.textContent) && /Анонс челленджа/.test(due.textContent)); ok('«Сегодня»: «Ближайшие» — задачи всех площадок'); }
  E(`SHOW_TODAY = false; INFO_HIDDEN.push('today'); ui.view = 'production'; render();`);

  assert.ok($('.tg-tl') && D.querySelectorAll('.tg-tl .tl-dlane').length >= 2 && D.querySelectorAll('.tg-tl .tgp-b').length === D.querySelectorAll('.tg-task').length && D.querySelectorAll('.tg-legend span').length === 2); ok('«Все» → таймлайн: строки — отделы обеих площадок, у задачи — метка площадки, сверху легенда');
  assert.equal(D.querySelectorAll('.tg-task').length, 3); assert.ok(![...D.querySelectorAll('.tg-task')].some(b => /Рилс|Анонс/.test(b.textContent))); ok('задачи обоих инфоповодов на таймлайне, без «Контента»');
  assert.ok(!$('.tg-cross') && !$('.tg-cnt') && !/Пересечени/.test($('.tg').textContent)); ok('без строки «Пересечения» — просто общий таймлайн');
  assert.ok($('[data-ipall]').classList.contains('on') && !$('[data-tgp]') && !$('.ab-board')); ok('«Все» → «Таймлайн»: общий таймлайн без лишнего выбора');
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
  // финал (окно продаж) — в карточке площадки, зелёная линия; ключевые даты — жёлтые
  E(`ui.infoAll = false; ui.infoMode = 'board'; openProject(em.id)`); await wait(100);
  { const gn = D.querySelector('.d-kd [data-goalname]'); gn.value = 'Окно продаж'; gn.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(30);
    const gd = D.querySelector('.d-kd [data-goaldate]'); gd.value = E('addDays(T, 6)'); gd.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(30);
    assert.ok(E('em.goalName') === 'Окно продаж' && E('em.deadline') === E('addDays(T, 6)')); ok('финал вбивается в карточке площадки'); }
  E(`layer.innerHTML = ''; ui.open = null; ui.prodProject = em.id; ui.infoMode = 'timeline'; render();`); await wait(30);
  { const fin = [...D.querySelectorAll('.tl-goal:not(.tl-key)')].find(x => /Окно продаж/.test(x.textContent)); const kd = D.querySelector('.tl-key');
    assert.ok(fin && kd && /\.tl-goal\.tl-key\{background:var\(--y\)\}/.test(D.documentElement.innerHTML) && /\.tl-goal\{[^}]*background:var\(--g\)/.test(D.documentElement.innerHTML)); ok('на таймлайне финал — своей (зелёной) линией, ключевые даты — другой (жёлтой)'); }
  E(`ui.infoAll = false; ui.infoMode = 'board'; openProject(em.id)`); await wait(100); D.querySelector('.d-kd [data-kddel]').click(); await wait(30); assert.equal(E('em.keyDates.length'), 0); ok('ключевую дату можно удалить');
  E(`closeLayer ? closeLayer() : (layer.innerHTML = ''); ui.open = null; ui.prodProject = em.id; render();`); await wait(30);
  // отделы площадки: на доске правки нет — переименовать, добавить, удалить, переставить в «Настройки → Площадки»
  assert.ok(!$('[data-pfedit]') && !$('#pfSort') && !$('.ip-card') && /^\+$/.test($('[data-ipnew]').textContent.trim())); ok('на доске нет «Отделы», «Карточки: …» и карандаша площадки; новая площадка — «+»');
  E(`ui.view = 'templates'; ui.setTab = ''; render()`); assert.equal($('[data-settab][aria-pressed="true"]').dataset.settab, 'boards'); ok('«Настройки → Площадки» открывается первой');
  { const inp = D.querySelector(`[data-bsren="${E('em.id')}|${E('em.stages[0].id')}"]`); inp.value = 'Продукт и оффер'; inp.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(30); }
  E(`syncAllTemplates(INFO_TPL_ID); render();`); await wait(30);
  assert.ok(E(`em.stages[0].name`) === 'Продукт и оффер' && E(`ig.stages[0].name`) === 'Продукт'); ok('отдел переименовывается и не возвращается шаблоном; у другой площадки — свой');
  { const f = D.querySelector(`[data-bsadd="${E('em.id')}"]`); f.querySelector('input').value = 'Монтаж'; f.dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(30); }
  assert.ok(E(`em.stages.some(s => s.name === 'Монтаж')`) && !E(`ig.stages.some(s => s.name === 'Монтаж')`)); ok('новый отдел добавляется');
  D.querySelector(`[data-bsdel="${E('em.id')}|${E(`em.stages.find(s => s.name === 'Монтаж').id`)}"]`).click(); await wait(30); $('#cfmOk').click(); await wait(80);
  E(`syncAllTemplates(INFO_TPL_ID);`); assert.ok(!E(`em.stages.some(s => s.name === 'Монтаж')`)); ok('лишний отдел удаляется');
  { const [a0, a1] = JSON.parse(E(`JSON.stringify(em.stages.map(s => s.id))`)); D.querySelector(`[data-bsup="${E('em.id')}|${a1}"]`).click(); await wait(30);
    assert.ok(E(`em.stages[0].id`) === a1 && E(`em.stages[1].id`) === a0); ok('↑ переставляет отдел выше');
    E(`syncAllTemplates(INFO_TPL_ID);`); assert.ok(E(`em.stages[0].id`) === a1); ok('порядок не сбрасывается шаблоном');
    E(`reorderStage(em, '${a0}', '${a1}')`); }
  { const n = D.querySelector(`[data-bsname="${E('em.id')}"]`); n.value = 'Челлендж Эма 2'; n.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(20); assert.equal(E('em.name'), 'Челлендж Эма 2'); E(`em.name = 'Челлендж Эма'`); ok('площадку переименовывают в настройках'); }
  E(`ui.view = 'production'; layer.innerHTML = ''; ui.open = null; ui.infoMode = 'board'; ui.prodProject = em.id; render();`);
  // «Сегодня» в инфобизнесе: выбор площадки, задачи обеих площадок, люди из обеих
  E(`{ db.users.push({ id:'uEmm', name:'Эм', role:'specialist', status:'active' }); const s = em.stages.find(x => !/контент/i.test(x.name) && !isMaint(x)); s.subs.push({ id:'tdE', name:'Сторис Эма', done:false, due_date:today() });
     tasksFromSubs(em, { ...s, subs:[s.subs.at(-1)] }); taskFor(em.id, s.id, 'tdE').assignee_id = 'uEmm'; taskFor(em.id, s.id, 'tdE').due_date = today();
     const g = ig.stages.find(x => !/контент/i.test(x.name) && !isMaint(x)); g.subs.push({ id:'tdI', name:'Пост Игоря', done:false, due_date:today() }); SHOW_TODAY = true; INFO_HIDDEN.splice(INFO_HIDDEN.indexOf('today'), 1); ui.view = 'today'; ui.tdIp = ''; commit(); }`); await wait(80);
  const tdTxt = () => D.getElementById('app').textContent;
  assert.ok(D.querySelectorAll('[data-tdip]').length === 3 && /Сторис Эма/.test(tdTxt()) && /Пост Игоря/.test(tdTxt())); ok('«Сегодня»: «Все» — задачи обеих площадок');
  [...D.querySelectorAll('[data-tdip]')].find(b => b.dataset.tdip === E('em.id')).click(); await wait(50);
  assert.ok(/Сторис Эма/.test(tdTxt()) && !/Пост Игоря/.test(tdTxt())); ok('«Сегодня»: выбрана площадка — только её задачи');
  // задачи «Контента» в «Сегодня» — обычными строками с галочкой, без сворачивания
  E(`{ const s = em.stages.find(x => /контент/i.test(x.name)); s.subs.push({ id:'tdC', name:'Видео дня', done:false, due_date:today() }); ui.tdIp = ''; commit(); }`); await wait(50);
  { const li = [...D.querySelectorAll('.tdy-i')].find(x => /Видео дня/.test(x.textContent)); assert.ok(li && li.querySelector('input[data-tdyk]') && !D.querySelector('.tdy-ct')); ok('«Сегодня»: задача «Контента» — обычная строка с галочкой'); }
  E(`ui.tdIp = ''; SHOW_TODAY = false; INFO_HIDDEN.push('today'); ui.view = 'production'; render();`);
  // «Входящие»: колонка слева на канбане «Производства»; выжимка созвона → Claude находит задачи → разнести по отделам
  assert.ok(!D.querySelector('.tabs [data-view="inbox"]')); E(`ui.view = 'production'; ui.infoAll = false; ui.prodProject = ig.id; ui.infoMode = 'board'; ui.kbView = 'status'; ui.pfEdit = false; render()`);
  assert.ok($('.kb-board > .kb-in:first-child')); ok('«Входящие» — первой колонкой в «Производстве», не отдельным пунктом меню');
  assert.ok(!D.getElementById('inSrc') && D.querySelectorAll('#inAdd button').length === 1); ok('во «Входящих» — только поле и одна кнопка «Найти задачи»');
  E(`_sample = { json: async p => { window.__inP = p; return { tasks:[{ title:'Запустить рекламу VSL', dept:'${E('ig.stages.find(s => !isCtStage(ig, s) && !isMaint(s)).name')}', type:'strat', due:'2026-12-01', who:'Эм' }, { title:'', dept:'x' }] }; } }`);
  D.getElementById('inText').value = 'Обсудили запуск. Решили: запустить рекламу VSL до 1 декабря, отвечает Эм.'; D.getElementById('inAdd').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(80);
  assert.ok(/реальные|РЕАЛЬНЫЕ/.test(E('window.__inP')) && E('db.prefs.inbox.length') === 1 && E(`db.prefs.inbox.find(x => x.text === 'Запустить рекламу VSL').due`) === '2026-12-01'); ok('«Найти задачи»: Claude выделяет задачи из выжимки — отдел, тип, срок');
  { const f = [...D.querySelectorAll('[data-into]')].find(x => /рекламу VSL/.test(x.closest('.in-card').textContent)); assert.equal(f.querySelector('[data-intt]').value, 'strat'); f.dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(30); }
  assert.equal(E('db.prefs.inbox.length'), 0); assert.ok(E(`infoBoards().some(p => p.stages.some(s => (s.subs || []).some(x => x.name === 'Запустить рекламу VSL' && x.ttype === 'strat' && x.due_date === '2026-12-01')))`)); ok('«В задачи» — задача в отделе с типом и сроком, из входящих убрана');
  // карточка задачи площадки: свойства — статус, тип, отдел, срок и напоминание быстрыми кнопками
  { const [sid, xid] = E(`(() => { const s = ig.stages.find(y => !isMaint(y) && !isCtStage(ig, y) && (y.subs || []).length); const x = s.subs[0]; tasksFromSubs(ig, { ...s, subs:[x] }); commit(); return [s.id, x.id]; })()`);
    E(`openTask(taskFor(ig.id, '${sid}', '${xid}').id)`); await wait(30);
    assert.ok($('.tk-props') && !$('[data-tkst]') && !$('.tk-props .pri-sel, .tk-props [data-pri]') && $('[data-tktt]') && $('[data-tkdept]') && $('.tk-props input[type="date"][data-tkdate]')); ok('карточка: тип, отдел, ответственный, срок полем с календарём, напоминание — без статуса и приоритета');
    $(`[data-tktt="${E('ig.id')}|${sid}|${xid}|strat"]`).click(); await wait(20); assert.equal(E(`ig.stages.find(y => y.id === '${sid}').subs.find(y => y.id === '${xid}').ttype`), 'strat'); ok('тип ставится в карточке');

    { const d = $('[data-tkdate]'); d.value = E('addDays(today(), 1)'); d.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(20); } assert.equal(E('taskById(ui.taskId).due_date'), E('addDays(today(), 1)')); ok('срок — дата в поле с календарём');
    $(`[data-tkrem="${E('ui.taskId')}|${E('today()')}T10:00"]`).click(); await wait(20); assert.equal(E('taskById(ui.taskId).remind.at'), E('today()') + 'T10:00'); ok('напоминание «За день, 10:00» от срока');
    E('closeTask()'); }
  // чек-лист двигает задачу по канбану: первая галочка — «В работе», последняя — «Готово»
  { const r = E(`(() => { const s = ig.stages.find(y => !isMaint(y) && !isCtStage(ig, y)); const x = { id:'ckMove', name:'Задача с чек-листом', done:false }; s.subs.push(x); tasksFromSubs(ig, { ...s, subs:[x] });
      const t = taskFor(ig.id, s.id, x.id); t.checklist = [{ id:'a1', text:'раз', done:false }, { id:'a2', text:'два', done:false }];
      const st0 = kbStatus(ig, s, x); t.checklist[0].done = true; syncTaskToSub(t); const st1 = kbStatus(ig, s, x); t.checklist[1].done = true; syncTaskToSub(t); const st2 = kbStatus(ig, s, x); t.checklist[1].done = false; syncTaskToSub(t); const st3 = kbStatus(ig, s, x); t.checklist[0].done = false; syncTaskToSub(t); const st4 = kbStatus(ig, s, x); return [st0, st1, st2, st3, st4].join(); })()`);
    assert.equal(r, 'todo,doing,done,doing,todo'); ok('первая галочка — «В работе», последняя — «Готово»; снятые галочки возвращают назад'); }
  // «Мои задачи»: два блока — операционные и стратегические, в каждом можно написать задачу
  E(`ui.view = 'mytasks'; ui.dayAs = ''; render()`);
  assert.ok($('.td-oper') && $('.td-strat')); ok('«Мои задачи»: блоки «Операционные» и «Стратегические»');
  { const f = $('[data-tdadd="strat"]'); f.querySelector('input').value = 'Стратегия на квартал'; f.dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(30); }
  assert.ok(/Стратегия на квартал/.test($('.td-strat').textContent) && !/Стратегия на квартал/.test($('.td-oper').textContent)); ok('задача, написанная в «Стратегических», — там и стоит');
  E(`ui.view = 'production'; ui.infoAll = false; ui.prodProject = ig.id; ui.infoMode = 'board'; ui.kbView = 'status'; ui.kbDept = ''; ui.kbType = ''; ui.kbDue = ''; ui.pfEdit = false; render()`);
  { const b = D.querySelector('.kb-todo [data-kbnext]'); const [pid, sid, xid] = b.dataset.kbnext.split('|'); b.click(); await wait(30);
    assert.equal(E(`kbStatus(projById('${pid}'), projById('${pid}').stages.find(s => s.id === '${sid}'), projById('${pid}').stages.find(s => s.id === '${sid}').subs.find(x => x.id === '${xid}'))`), 'doing'); assert.ok(!E('ui.taskId')); ok('«В работу →» на карточке — следующий этап без перетаскивания'); }
  // «Тестовое · бета»: воронка +10к Telegram — как в таблице «Декомпозиция»
  assert.ok(!D.querySelector('.tabs [data-view="beta"]').hidden); E(`ui.view = 'beta'; render()`);
  { const p = E('JSON.stringify(bfPlan(bfCfg()))'); const q = JSON.parse(p); assert.ok(Math.round(q.code) === 21984 && Math.round(q.pub * 10) === 366 && Math.round(q.client) === 45); ok('бета-воронка: план как в таблице (21 984 кодовых слова, 36,6 рилс, 45 клиентов)'); }
  { const i = D.querySelector('[data-bffact$="|subs"]'); i.value = '500'; i.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(20); assert.ok(/500/.test($('.bf-t').textContent)); ok('факт по дню — в итог «Факт»'); }
  assert.ok($('.bfv') && !/Рилс/.test($('.bfv').textContent) && ![...D.querySelectorAll('.bf-t:not(.bf-d) td b')].some(b => /Рилс/.test(b.textContent)) && /Рилс снято/.test($('.bf-dash').textContent)); ok('рилсы — сверху в дашборде, не в воронке');
  assert.deepEqual(o.errors.filter(e => !/Not implemented/.test(e)), []); ok('без ошибок');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
