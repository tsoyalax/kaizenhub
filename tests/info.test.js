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
  assert.deepEqual(E('ctStats(ctCur()).weeks.map(x => x.plan)'), [3, 3, 3, 3]); ok('план поровну на 4 недели');
  E(`ui.ctMode = 'plan'; render()`);
  const xid = E('contentStage().subs[0].id');
  const cb = D.querySelector(`[data-ctdone="${xid}"]`); cb.checked = true; cb.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(50);
  assert.ok(E(`projById('infoboard').stages.find(s => s.id === contentStage().id).subs[0].done`)); ok('отметка «опубликовано» — это отметка карточки на доске');
  assert.equal(E('ctStats(ctCur()).pub'), 1); ok('факт считается по отметкам');
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
  const due = D.querySelector('[data-tdue]'); due.value = '2026-01-10'; due.dispatchEvent(new w.Event('change', { bubbles:true }));
  const rem = D.querySelector('[data-tremind]'); rem.value = '2026-01-01T09:00'; rem.dispatchEvent(new w.Event('change', { bubbles:true }));
  assert.equal(E('taskById(ui.taskId).due_date'), '2026-01-10'); ok('у задачи ставится срок');
  assert.equal(E('taskById(ui.taskId).remind.at'), '2026-01-01T09:00'); ok('у задачи ставится напоминание');
  E(`(() => { const t = taskById(ui.taskId); const d = new Date(Date.now() - 60000); t.remind.at = d.toISOString().slice(0, 16); t.remind.by = meKey(); })()`);
  E('checkReminders()');
  assert.ok(D.getElementById('remPop')); ok('напоминание срабатывает');
  D.getElementById('remPop').querySelector('[data-remok]').click(); E('checkReminders()');
  assert.ok(!D.getElementById('remPop')); ok('одно напоминание срабатывает один раз');
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
  // таймлайн: все задачи с датой на одной шкале, связи стрелками
  E(`ui.infoMode = 'timeline'; render()`);
  assert.ok(D.querySelector('.tl') && !D.querySelector('.pf-board')); ok('«Таймлайн» вместо доски');
  assert.equal(D.querySelectorAll('.tl-task').length, E(`flowState(infoBoard()) && [...flowState(infoBoard()).values()].reduce((n, v) => n + v.items.filter(i => i.due).length, 0)`)); ok('на таймлайне все задачи со сроком');
  assert.equal(D.querySelectorAll('.tl-lbl').length, 6); ok('строка на каждый этап');
  assert.ok(D.querySelector('.tl-task.k-red') && D.querySelector('.tl-arr.red')); ok('просроченное и связь от него — красные');
  E(`ui.infoMode = 'board'`);
  // этапы и подэтапы видео — из шаблона SMM-пространства
  E(`cloud.store = cloud.store || {}; cloud.uid = cloud.uid || 'u1'; otherSpaces = () => [{ id:'s1', name:'SMM Reels', kind:'smm' }];
    loadSpaceTemplates = async () => ({ tpls:[{ id:'tsmm', name:'SMM: видео', stages:[{ id:'a', name:'Сценарий', days:2, subs:[{ id:'a1', name:'Хук' }] }, { id:'b', name:'Съёмка', days:1, subs:[] }, { id:'c', name:'Публикация', days:1, subs:[] }] }], cards:{} });`);
  await w.eval('syncVidTplFromSmm(true)');
  assert.deepEqual(E('vidCols().map(c => c.name)'), ['Сценарий', 'Съёмка', 'Публикация']); ok('этапы видео — как в шаблоне SMM-пространства');
  E(`addContent('Рилс', 3, today()); ui.view = 'content'; ui.ctMode = 'board'; render()`);
  assert.ok(/Хук/.test(D.querySelector('.ct-subs')?.textContent || '')); ok('подэтапы этапа SMM — на карточке видео');
  E(`db.prefs.kind = 'agency'; render()`);
  assert.ok(!D.querySelector('.tabs [data-view="matrix"]').hidden); ok('в агентстве матрица на месте');
  assert.equal(errors.length, 0, errors.join('\n')); ok('ошибок нет');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
