// Пространство «Инфобизнес»: одна доска сразу, без матрицы и «Нового проекта»; этапы и подэтапы — из шаблона в «Настройках»
const fs = require('fs'), assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8')
  .replace('<script src="/claude-shim.js"></script>', '').replace('<script src="/config.js"></script>', '')
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/, '');
const wait = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const ok = m => { n++; console.log('PASS ' + m); };
(async () => {
  const errors = []; const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(String(e.message || e)));
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://kz.test/', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w){ w.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }); w.scrollTo = () => {};
      w.IntersectionObserver = class { observe(){} disconnect(){} unobserve(){} }; w.ResizeObserver = class { observe(){} disconnect(){} unobserve(){} }; w.HTMLElement.prototype.scrollIntoView = function(){}; } });
  await wait(2500); const w = dom.window, E = x => w.eval(x), D = w.document;
  E(`db.onboarded = true; db.projects = []; db.prefs = db.prefs || {}; db.prefs.kind = 'info'; ensureKindTemplate(db, 'info'); layer.innerHTML = ''; ui.view = 'matrix'; save(); render()`);
  assert.equal(E('ui.view'), 'production'); ok('в инфобизнесе сразу открывается доска');
  assert.deepEqual(E(`db.projects.filter(p => p.state !== 'archived').map(p => p.id)`), ['infoboard']); ok('доска создалась одна, сама');
  assert.deepEqual(E(`projById('infoboard').stages.map(s => s.name)`), ['Продукт', 'Контент', 'Прогрев', 'Запуск', 'Продажи', 'Сопровождение']); ok('колонки — этапы запуска инфопродукта');
  E('render()'); assert.equal(E(`db.projects.length`), 1); ok('повторная отрисовка не создаёт вторую доску');
  assert.ok(['matrix', 'kanban', 'archive'].every(v => D.querySelector(`.tabs [data-view="${v}"]`).hidden)); ok('матрицы, канбана и архива в меню нет');
  E('openCreate()'); assert.ok(!D.querySelector('#cForm') && E('db.projects.length') === 1); ok('новый проект не создаётся');
  E(`(() => { const t = db.templates.find(t => t.id === INFO_TPL_ID); t.stages[0].subs = [{ id:'a1', name:'Упаковка продукта' }]; t.stages.push({ id:'z1', name:'Вебинар', days:3, approval:false, subs:[] }); syncAllTemplates(INFO_TPL_ID); })()`);
  assert.ok(E(`projById('infoboard').stages[0].subs.some(x => x.name === 'Упаковка продукта')`)); ok('подэтап из шаблона появился на доске');
  assert.ok(E(`projById('infoboard').stages.some(s => s.name === 'Вебинар')`)); ok('этап из шаблона появился на доске');
  // «Контент»: видео — карточки колонки «Контент» на доске; отметка в одном месте видна в другом
  assert.ok(!D.querySelector('.tabs [data-view="content"]').hidden); ok('в меню есть «Контент»');
  E(`ui.view = 'content'; render()`);
  D.getElementById('ctName').value = 'Ролик'; D.getElementById('ctN').value = '12';
  D.getElementById('ctAdd').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(50);
  assert.equal(E('contentStage().subs.length'), 12); ok('12 видео добавлены карточками в колонку «Контент» доски');
  E(`ui.ctMode = null; render()`);
  assert.equal(D.querySelector('.ct-mode [aria-pressed="true"]')?.textContent, 'План / Факт'); ok('«Контент» открывается «План / Факт»');
  assert.deepEqual(E('ctStats(ctCur()).weeks.map(x => x.plan)'), [3, 3, 3, 3]); ok('план поровну на 4 недели');
  E(`ui.ctMode = 'plan'; render()`);
  const xid = E('contentStage().subs[0].id');
  const cb = D.querySelector(`[data-ctdone="${xid}"]`); cb.checked = true; cb.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(50);
  assert.ok(E(`projById('infoboard').stages.find(s => s.id === contentStage().id).subs[0].done`)); ok('отметка «опубликовано» — это отметка карточки на доске');
  assert.equal(E('ctStats(ctCur()).pub'), 1); ok('факт считается по отметкам');
  // недельный KPI: общий на все недели и свой у отдельной недели
  E(`ui.ctMode = 'plan'; ui.ctEdit = ctCur(); render()`);
  D.getElementById('ctKpi').value = '5'; D.getElementById('ctEd').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(20);
  assert.deepEqual(E('ctStats(ctCur()).weeks.map(x => x.plan)'), [5, 5, 5, 5]); ok('KPI 5 в неделю — план 5 на каждую неделю');
  assert.equal(E('ctStats(ctCur()).plan'), 20); ok('план цикла — 20');
  E(`ui.ctEdit = ctCur(); render()`);
  const w2 = D.querySelector('[data-ctwk="1"]'); w2.value = '8'; D.getElementById('ctEd').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(20);
  assert.deepEqual(E('ctStats(ctCur()).weeks.map(x => x.plan)'), [5, 8, 5, 5]); ok('у отдельной недели — свой KPI');
  assert.ok(/по неделям/.test(D.querySelector('.smm-kpi').textContent)); ok('видно, что план по неделям');
  E(`ui.view = 'production'; render()`);
  assert.equal(D.querySelectorAll('.pf-card.done').length, 1); ok('на доске карточка тоже отмечена');
  // доска видео в «Контенте»: колонки SMM, «Опубликовано» = отметка на основной доске
  E(`ui.view = 'content'; ui.ctMode = 'board'; render()`);
  assert.deepEqual([...D.querySelectorAll('[data-ctcol] header b')].map(b => b.textContent.replace(/^\d+\. /, '')), E('vidCols().map(c => c.name)')); ok('в «Контенте» — доска видео с этапами SMM');
  const x2 = E('contentStage().subs.find(x => !x.done).id');
  E(`moveVideo('${x2}', vidCols()[2].id)`);
  assert.equal(E(`vidCol(contentStage().subs.find(x => x.id === '${x2}')).name`), E('vidCols()[2].name')); ok('видео переходит в другую колонку');
  E(`moveVideo('${x2}', vidCols().at(-1).id)`);
  assert.ok(E(`contentStage().subs.find(x => x.id === '${x2}').done`)); ok('«Опубликовано» отмечает видео на основной доске');
  // срок и напоминание у задачи
  E(`(() => { const p = infoBoard(), s = contentStage(p), x = s.subs[3]; tasksFromSubs(p, { ...s, subs:[x] }); openTask(taskFor(p.id, s.id, x.id).id); })()`); await wait(50);
  // быстрый календарь: срок — день одним нажатием; напоминание — день, потом время
  D.querySelector('[data-duepick]').click(); assert.ok(D.getElementById('dpPop')); ok('по нажатию на «Срок» открывается календарь');
  D.querySelector(`[data-dpday="${E('addDays(today(), 1)')}"]`).click();
  assert.ok(D.getElementById('dpPop') && /теперь нажмите день окончания/.test(D.querySelector('.dp-hint').textContent)); ok('срок «от и до»: после первого дня — выбор окончания');
  D.querySelector(`[data-dpday="${E('addDays(today(), 3)')}"]`).click();
  assert.equal(E('taskById(ui.taskId).start_date'), E('addDays(today(), 1)')); assert.equal(E('taskById(ui.taskId).due_date'), E('addDays(today(), 3)')); ok('у задачи ставится срок от и до');
  assert.ok(/–/.test(D.querySelector('[data-duepick]').textContent)); ok('на кнопке — период');
  assert.ok(!D.getElementById('dpPop')); ok('календарь закрылся сам');
  D.querySelector('[data-duepick]').click(); [...D.querySelectorAll('[data-dpq]')].find(b => b.textContent === 'Завтра').click();
  assert.equal(E('taskById(ui.taskId).due_date'), E('addDays(today(), 1)')); ok('быстрый вариант «Завтра»');
  assert.ok(!E('taskById(ui.taskId).start_date')); ok('один день — без начала');
  D.querySelector('[data-duepick]').click(); const d2 = E('addDays(today(), 2)'); D.querySelector(`[data-dpday="${d2}"]`).click(); D.querySelector(`[data-dpday="${d2}"]`).click();
  assert.equal(E('taskById(ui.taskId).due_date'), d2); assert.ok(!E('taskById(ui.taskId).start_date')); ok('двойное нажатие на день — срок на один день');
  D.querySelector('[data-rempick]').click(); D.querySelector(`[data-dpday="${E('addDays(today(), 1)')}"]`).click();
  assert.ok(D.getElementById('dpPop')); ok('после дня для напоминания — выбор времени');
  D.querySelector('[data-dptime="10:00"]').click();
  assert.equal(E('taskById(ui.taskId).remind.at'), E('addDays(today(), 1)') + 'T10:00'); ok('у задачи ставится напоминание — день и время');
  assert.ok(/завтра, 10:00/.test(D.querySelector('[data-rempick]').textContent)); ok('на кнопке — «завтра, 10:00»');
  E(`(() => { const t = taskById(ui.taskId); const d = new Date(Date.now() - 60000); t.remind.at = d.toISOString().slice(0, 16); t.remind.by = meKey(); })()`);
  E('checkReminders()');
  assert.ok(D.getElementById('remPop')); ok('напоминание срабатывает');
  D.getElementById('remPop').querySelector('[data-remok]').click(); E('checkReminders()');
  assert.ok(!D.getElementById('remPop')); ok('одно напоминание срабатывает один раз');
  // переименование задачи — и карточка на доске / видео в «Контенте» получает новое название
  D.querySelector('[data-tedit]').click(); await wait(20);
  const tt = D.getElementById('tdTitle'); tt.value = 'Рилс про отзывы'; tt.dispatchEvent(new w.Event('input', { bubbles:true }));
  E('saveTaskDraft()'); await wait(20);
  assert.equal(E(`(() => { const t = taskById(ui.taskId); return projById(t.project_id).stages.find(s => s.id === t.stage_id).subs.find(x => x.id === t.substage_id).name; })()`), 'Рилс про отзывы'); ok('новое название задачи — и на карточке доски');
  E('closeTask()');
  // связи этапов и «Срочно»: просроченный этап тормозит всех, кто от него зависит
  E(`(() => { const p = infoBoard(); const t0 = today();
    p.stages = ['Контент', 'Статья', 'VSL', 'Платный канал', 'Отдел продаж', 'Эфиры'].map((n, i) => ({ id:'f' + i, name:n, position:i, status:'not_started', planned_start:t0, due_date:addDays(t0, 7),
      subs:i === 5 ? [] : [{ id:'fx' + i, name:'Задача ' + n, done:false, due_date:i === 2 ? addDays(t0, -2) : addDays(t0, 10) }] }));
    ui.view = 'production'; ui.prodProject = p.id; render(); })()`);
  const fs = E(`JSON.stringify([...flowState(infoBoard()).values()].map(v => [v.s.name, v.key]))`);
  assert.deepEqual(JSON.parse(fs), [['Контент','green'],['Статья','green'],['VSL','red'],['Платный канал','yellow'],['Отдел продаж','yellow'],['Эфиры','red']]); ok('VSL просрочен — следующие за ним ждут, этап без задач — красный');
  assert.ok(D.querySelector('.fl') && /VSL.*из-за этого стоят: Платный канал, Отдел продаж, Эфиры/.test(D.querySelector('.fl-urgent').textContent)); ok('«Срочно» объясняет, что и из-за чего стоит');
  E(`ui.flowEdit = true; render()`);
  const cbx = D.querySelector('[data-fldep="f5|f4"]'); cbx.checked = false; cbx.dispatchEvent(new w.Event('change', { bubbles:true }));
  const cby = D.querySelector('[data-fldep="f5|f0"]'); cby.checked = true; cby.dispatchEvent(new w.Event('change', { bubbles:true }));
  assert.deepEqual(E(`flowDeps(infoBoard(), infoBoard().stages[5])`), ['f0']); ok('связи меняются: «Эфиры» зависят от «Контента»');
  assert.ok(!E(`flowState(infoBoard()).get('f2').down.includes('f5')`)); ok('VSL больше не тормозит «Эфиры»');
  E(`ui.flowEdit = false`);
  // статусы отделов вручную: «Приостановлено» с причиной тормозит зависимых и стоит первым в «Срочно»
  E(`ui.view = 'production'; ui.infoMode = 'board'; render()`);
  const sel = D.querySelector('[data-flst="f1"]'); sel.value = 'pause'; sel.dispatchEvent(new w.Event('change', { bubbles:true }));
  D.getElementById('gateTx').value = 'Ждём интервью'; D.getElementById('gateF').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(30);
  assert.equal(E(`infoBoard().stages[1].dept.st`), 'pause'); ok('отдел приостановлен');
  assert.equal(E(`flowState(infoBoard()).get('f1').key`), 'paused'); ok('в воронке — «Приостановлено»');
  assert.ok(E(`flowState(infoBoard()).get('f2').blockedBy.includes('f1')`)); ok('зависимые ждут приостановленный отдел');
  assert.ok(/Приостановлено.*Статья.*Ждём интервью.*из-за этого стоят/.test(D.querySelector('.fl-urgent li').textContent)); ok('«Срочно»: приостановленный — первым, с причиной');
  const sel2 = D.querySelector('[data-flst="f1"]'); sel2.value = 'work'; sel2.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(20);
  assert.notEqual(E(`flowState(infoBoard()).get('f1').key`), 'paused'); ok('снова «В работе»');
  // финальный дедлайн инфоповода: название и дата, задачи после него — в «Срочно», линия на таймлайне
  const gn = D.querySelector('[data-goalname]'); gn.value = 'Открытие окна продаж'; gn.dispatchEvent(new w.Event('change', { bubbles:true }));
  const gd = D.querySelector('[data-goaldate]'); gd.value = E('addDays(today(), 5)'); gd.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(20);
  assert.equal(E('infoBoard().goalName'), 'Открытие окна продаж'); ok('название финального дедлайна');
  assert.equal(E('infoBoard().deadline'), E('addDays(today(), 5)')); ok('дата финального дедлайна');
  assert.ok(/После дедлайна.*позже, чем «Открытие окна продаж»/.test(D.querySelector('.fl-urgent').textContent)); ok('задачи позже дедлайна — в «Срочно»');
  E(`ui.infoMode = 'timeline'; render()`);
  assert.ok(/Открытие окна продаж/.test(D.querySelector('.tl-goal')?.textContent || '')); ok('дедлайн — линией на таймлайне');
  E(`ui.infoMode = 'board'; render()`);
  // таймлайн: все задачи с датой на одной шкале, связи стрелками
  E(`ui.infoMode = 'timeline'; render()`);
  assert.ok(D.querySelector('.tl') && !D.querySelector('.pf-board')); ok('«Таймлайн» вместо доски');
  assert.equal(D.querySelectorAll('.tl-task').length, E(`flowState(infoBoard()) && [...flowState(infoBoard()).values()].reduce((n, v) => n + v.items.filter(i => i.due).length, 0)`)); ok('на таймлайне все задачи со сроком');
  assert.equal(D.querySelectorAll('.tl-lbl').length, 6); ok('строка на каждый этап');
  assert.ok(D.querySelector('.tl-task.k-red') && D.querySelector('.tl-arr.red')); ok('просроченное и связь от него — красные');
  E(`(() => { const p = infoBoard(), s = p.stages[0], x = s.subs[0]; tasksFromSubs(p, { ...s, subs:[x] }); const t = taskFor(p.id, s.id, x.id); t.start_date = addDays(today(), 1); t.due_date = addDays(today(), 4); render(); })()`);
  assert.ok(D.querySelector('.tl-bar')); ok('срок от и до — полосой на таймлайне');
  E(`ui.infoMode = 'board'`);
  // этапы и подэтапы видео — из шаблона SMM-пространства
  E(`cloud.store = cloud.store || {}; cloud.uid = cloud.uid || 'u1'; otherSpaces = () => [{ id:'s1', name:'SMM Reels', kind:'smm' }];
    loadSpaceTemplates = async () => ({ tpls:[{ id:'tsmm', name:'SMM: видео', stages:[{ id:'a', name:'Сценарий', days:2, subs:[{ id:'a1', name:'Хук' }] }, { id:'b', name:'Съёмка', days:1, subs:[] }, { id:'c', name:'Публикация', days:1, subs:[] }] }], cards:{} });`);
  await w.eval('syncVidTplFromSmm(true)');
  assert.deepEqual(E('vidCols().map(c => c.name)'), ['Сценарий', 'Съёмка', 'Публикация']); ok('этапы видео — как в шаблоне SMM-пространства');
  E(`addContent('Рилс', 3, today()); ui.view = 'content'; ui.ctMode = 'board'; render()`);
  assert.ok(/Хук/.test(D.querySelector('.ct-subs')?.textContent || '')); ok('подэтапы этапа SMM — на карточке видео');
  // свои задачи в колонке «Контент» доски — наверху, над видео; новые первыми
  E(`ui.view = 'production'; ui.infoMode = 'board'; render()`);
  const addIn = () => D.querySelector(`[data-pfadd="${E('contentStage().id')}"]`);
  addIn().querySelector('input').value = 'Сценарий вебинара'; addIn().dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(20);
  addIn().querySelector('input').value = 'Запросить отзывы'; addIn().dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(20);
  assert.deepEqual(E('boardSubs(infoBoard(), contentStage()).slice(0, 2).map(x => x.name)'), ['Запросить отзывы', 'Сценарий вебинара']); ok('свои задачи «Контента» — наверху, новые первыми');
  assert.ok(E('boardSubs(infoBoard(), contentStage()).slice(-3).every(x => x.cycle)')); ok('видео — ниже своих задач');
  // перетаскивание карточки на доске инфобизнеса в другую колонку
  E(`ui.view = 'production'; ui.infoMode = 'board'; render()`);
  { const dt = { setData(){}, getData(){ return ''; }, types:['text/kz-card'], effectAllowed:'' };
    const ev = (type, el) => { const e = new w.Event(type, { bubbles:true, cancelable:true }); Object.defineProperty(e, 'dataTransfer', { value:dt }); el.dispatchEvent(e); };
    const fromSid = E(`infoBoard().stages[1].id`), toSid = E(`infoBoard().stages[3].id`), xid = E(`infoBoard().stages[1].subs[0].id`);
    const card = D.querySelector(`[data-pfdrag="${fromSid}|${xid}"]`); assert.ok(card && card.getAttribute('draggable') === 'true'); ok('карточки доски перетаскиваются');
    ev('dragstart', card); const col = D.querySelector(`[data-pfcol="${toSid}"]`); ev('dragover', col); ev('drop', col); await wait(20);
    assert.ok(E(`infoBoard().stages[3].subs.some(x => x.id === '${xid}') && !infoBoard().stages[1].subs.some(x => x.id === '${xid}')`)); ok('карточка переехала в другую колонку');
  }
  // инфоповоды: новый — своя доска с теми же колонками и связями, «Контент» — у выбранного
  E(`infoBoard().name = 'Контент Игоря'; ui.view = 'production'; ui.ipNew = true; render()`);
  D.getElementById('ipName').value = 'Челлендж Эма'; D.getElementById('ipNew').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(30);
  assert.deepEqual(E('infoBoards().map(p => p.name)').sort(), ['Контент Игоря', 'Челлендж Эма']); ok('инфоповод добавлен второй доской');
  assert.equal(E('infoBoard().name'), 'Челлендж Эма'); ok('открыт новый инфоповод');
  assert.deepEqual(E(`infoBoard().stages.map(s => s.name)`), E(`infoBoards().find(p => p.name === 'Контент Игоря').stages.filter(s => !isMaint(s)).map(s => s.name)`)); ok('колонки — как у текущего инфоповода');
  assert.equal(E('infoBoard().stages.flatMap(s => s.subs).length'), 0); ok('задачи у нового инфоповода свои — пока пусто');
  assert.ok(D.querySelectorAll('.ip-chip').length === 2); ok('в «Производстве» — строка инфоповодов');
  // доп. контент: вне плана, считается отдельно
  E(`addContent('Рилс', 4, today()); addContent('Сторис', 2, today(), true)`);
  const cst = E('JSON.stringify(ctStats(ctCur()))'); const cj = JSON.parse(cst);
  assert.equal(cj.plan, 4); ok('доп. контент не меняет план');
  assert.deepEqual(cj.extra, { n:2, pub:0 }); ok('доп. контент считается отдельно');
  E(`ui.view = 'content'; ui.ctMode = 'board'; render()`);
  assert.equal(D.querySelectorAll('.ct-card .ct-x').length, 2); ok('на доске видео доп. контент с пометкой «доп.»');
  assert.ok(D.querySelectorAll('.ct-card .ct-ico').length >= 6 && D.querySelector('.ct-add .ct-sw')); ok('у видео — значок видео, форма добавления — карточкой с переключателем «Доп. контент»');
  assert.ok(!D.querySelector('[data-vidsync]')); ok('кнопки «Обновить из SMM» нет');
  E(`db.prefs.kind = 'agency'; render()`);
  assert.ok(!D.querySelector('.tabs [data-view="matrix"]').hidden); ok('в агентстве матрица на месте');
  assert.equal(errors.length, 0, errors.join('\n')); ok('ошибок нет');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
