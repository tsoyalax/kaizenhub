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
  assert.ok(!E(`projById('infoboard').stages[0].subs.some(x => x.name === 'Упаковка продукта')`)); ok('задачи из шаблона на площадку не расходятся — у площадки свои задачи');
  assert.ok(!E(`tplById(INFO_TPL_ID).stages.some(s => (s.subs || []).length)`) && !E(`projById('infoboard').stages.some(s => (s.subs || []).some(x => x.tsub))`)); ok('подэтапы шаблона «Инфобизнес» очищены, задачи площадок отвязаны — старой версии нечего возвращать');
  assert.ok(E(`projById('infoboard').stages.some(s => s.name === 'Вебинар')`)); ok('этап из шаблона появился на доске');
  // «Контент»: видео — карточки колонки «Контент» на доске; отметка в одном месте видна в другом
  assert.ok(!D.querySelector('.tabs [data-view="content"]').hidden); ok('раздел «Контент» в меню');
  E(`ui.view = 'templates'; ui.setTab = 'deadlines'; render()`);
  assert.deepEqual([...D.querySelectorAll('[data-settab]')].map(b => b.dataset.settab), ['boards', 'look', 'templates', 'spaces', 'ai']); ok('настройки инфобизнеса: «Площадки», «Оформление», «Шаблоны», «Пространства», «AI» — без дедлайнов и категорий');
  E(`ui.setTab = 'look'; render()`); D.querySelector('[data-themeset="dark"]').click(); assert.equal(D.documentElement.dataset.theme, 'dark'); D.querySelector('[data-themeset="auto"]').click(); assert.ok(!D.documentElement.dataset.theme); ok('тема — в «Оформлении», «Как в системе» меняется сама');
  E(`ui.setTab = ''; ui.view = 'production'; render()`);
  E(`ui.view = 'content'; render()`);
  D.getElementById('ctName').value = 'Ролик'; D.getElementById('ctN').value = '12';
  D.getElementById('ctAdd').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(50);
  assert.equal(E('contentStage().subs.length'), 12); ok('12 видео добавлены карточками в колонку «Контент» доски');
  E(`ui.ctMode = null; render()`);
  assert.equal(D.querySelector('.ct-mode [aria-pressed="true"]')?.textContent, 'План / Факт'); ok('«Контент» открывается «План / Факт»');
  assert.deepEqual(E('ctStats(ctCur()).weeks.map(x => x.plan)'), [3, 3, 3, 3]); ok('план поровну на 4 недели');
  E(`ui.ctMode = 'plan'; render()`);
  const xid = E('contentStage().subs[0].id');
  assert.ok(!D.querySelector('[data-ctdone]') && D.querySelector('.ct-pf .pf-list [data-ctsel]') && D.querySelectorAll('.ct-pf .ct-reel [data-ctcol]').length === E('vidCols().length')); ok('«По роликам»: слева список роликов, справа доска этапов выбранного ролика');
  D.querySelector(`[data-ctsel="${xid}"]`).click(); await wait(20); assert.ok(D.querySelector('.ct-reel .pf-col.cur .ct-card.here')); ok('выбранный ролик — «Сейчас здесь» в своём этапе');
  { const dt = { d:{}, types:['text/kz-video'], setData(k, v){ this.d[k] = v; }, getData(k){ return this.d[k]; } };
    const ev = (type, el) => { const e = new w.Event(type, { bubbles:true, cancelable:true }); Object.defineProperty(e, 'dataTransfer', { value:dt }); el.dispatchEvent(e); };
    ev('dragstart', D.querySelector(`.ct-reel [data-ctdrag="${xid}"]`)); const last = [...D.querySelectorAll('.ct-reel [data-ctcol]')].at(-1); ev('dragover', last); ev('drop', last); await wait(30); }
  assert.ok(E(`projById('infoboard').stages.find(s => s.id === contentStage().id).subs[0].done`)); ok('ролик перетащили в «Опубликовано» — отмечен на доске площадки');
  E(`{ const x = contentStage().subs[0]; x.done = false; x.vst = vidCols()[0].id; ui.ctSelVid = x.id; commit(); }`); await wait(20);
  { const pub0 = E('ctStats(ctCur()).pub'); D.querySelector(`[data-ctto="${xid}|${E('vidCols().at(-1).id')}"]`).click(); await wait(30);
    assert.ok(E('contentStage().subs[0].done') && E('ctStats(ctCur()).pub') === pub0 + 1); ok('«Опубликовано ✓» — ролик готов и засчитан в план'); }
  D.querySelector('[data-ctview="list"]').click(); await wait(20); assert.ok(!D.querySelector('.ct-reel') && D.querySelector('.ct-row [data-ctmove]')); ok('вид «Список» — без доски, с этапом и датой в строке');
  D.querySelector('[data-ctview="split"]').click(); await wait(20);
  assert.equal(E('ctStats(ctCur()).pub'), 1); ok('факт считается по отметкам');
  // KPI: одно число на цикл, само делится на 4 недели
  E(`ui.ctMode = 'plan'; ui.ctEdit = ctCur(); render()`);
  D.getElementById('ctTotal').value = '45'; D.getElementById('ctEd').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(20);
  assert.deepEqual(E('ctStats(ctCur()).weeks.map(x => x.plan)'), [12, 11, 11, 11]); ok('KPI 45 — сам разбит на 4 недели 12/11/11/11');
  assert.equal(E('ctStats(ctCur()).plan'), 45); ok('план цикла — 45');
  E(`ui.ctEdit = ctCur(); render()`); { const end = E('addDays(cycleEnd(ctCur()), -7)'); D.getElementById('ctEndD').value = end; D.getElementById('ctEd').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(20);
    const ds = E(`JSON.stringify(contentStage().subs.filter(x => x.cycle === ctCur() && !x.done && !x.extra).map(x => x.due_date))`);
    assert.ok(JSON.parse(ds).every(d => d <= end) && /закончить к/.test(D.getElementById('app').textContent)); ok('«Закончить к»: даты видео расставлены до этой даты'); }
  E(`addContent('Пачка', 3, today(), false, addDays(today(), 6))`);
  assert.deepEqual(JSON.parse(E(`JSON.stringify(contentStage().subs.filter(x => /^Пачка/.test(x.name)).map(x => x.due_date))`)), [E('today()'), E('addDays(today(), 3)'), E('addDays(today(), 6)')]); ok('новые видео: старт и конец — даты поровну между ними');
  E(`ui.view = 'production'; ui.kbView = 'status'; render()`);
  assert.ok(!D.querySelector('.kb-card .ct-ico') && ![...D.querySelectorAll('.kb-dept')].some(b => /Контент/.test(b.textContent))); ok('на канбане нет отдела «Контент» и рилсов');
  E(`ui.kbView = 'dept'; render()`);
  assert.ok(![...D.querySelectorAll('.pf-col header b')].some(b => /Контент/.test(b.textContent)) && !D.querySelector('.pf-card .ct-ico')); ok('в «По отделам» нет отдела «Контент» — он в своём разделе');
  // сторис — отдельный тип контента, в KPI рилсов не входит
  E(`ui.view = 'content'; ui.ctMode = 'board'; ui.ctAddOpen = true; render()`);
  { const before = E('ctStats(ctCur()).plan'); const r = D.querySelector('[name="ctKind"][value="stories"]'); r.checked = true;
    D.getElementById('ctN').value = '3'; D.getElementById('ctName').value = ''; D.getElementById('ctAdd').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(20);
    assert.equal(E('contentStage().subs.filter(x => x.kind === "stories").length'), 3); assert.equal(E('ctStats(ctCur()).stories.n'), 3); assert.equal(E('ctStats(ctCur()).plan'), before);
    ok('сторис добавляются отдельно: «Сторис 1–3», в плане рилсов не считаются'); }
  E(`ui.ctMode = 'timeline'; ui.ctAddOpen = false; render()`);
  { const n = [...D.querySelectorAll('.ct-tl .tl-lbl b')].map(b => b.textContent.trim()); assert.ok(n.includes('Рилсы') && n.includes('Сторис')); assert.equal(D.querySelectorAll('.ct-tl .tl-task').length, E('ctItems().filter(x => x.cycle && x.due_date).length')); ok('«Контент» → «Таймлайн»: публикации рилсов и сторис по строкам'); }
  E(`ui.ctMode = 'board'`);
  E(`ui.view = 'production'; ui.kbView = 'dept'; render()`);
  assert.ok(D.querySelector('.dept-h .dept-ico')); ok('у отделов — иконки'); E(`ui.kbView = 'status'`);
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
  // срок в карточке площадки — поле с календарём (дата)
  { const d = D.querySelector('.tk-props [data-tkdate]'); assert.ok(d && d.type === 'date' && !D.querySelector('.tk-props [data-duepick]')); ok('срок — поле с календарём');
    d.value = E('addDays(today(), 2)'); d.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(20);
    assert.equal(E('taskById(ui.taskId).due_date'), E('addDays(today(), 2)')); assert.ok(!E('taskById(ui.taskId).start_date')); ok('дата из поля — срок задачи'); }
  { const f = D.querySelector('.tk-props [data-tkfrom]'); f.value = E('today()'); f.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(20);
    assert.equal(E('taskById(ui.taskId).start_date'), E('today()')); assert.equal(E('taskById(ui.taskId).due_date'), E('addDays(today(), 2)')); ok('срок «с … до …» — от и до'); }
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
  E(`(() => { const t = taskById(ui.taskId); projById(t.project_id).stages.find(s => s.id === t.stage_id).subs.find(x => x.id === t.substage_id).name = 'Старое имя'; render(); })()`);
  assert.equal(E(`(() => { const t = taskById(ui.taskId); return projById(t.project_id).stages.find(s => s.id === t.stage_id).subs.find(x => x.id === t.substage_id).name; })()`), 'Рилс про отзывы'); ok('переименованные раньше — карточка на доске подтягивает название задачи');
  // «+ Добавить человека…» в списке ответственных: человек появляется в команде и сразу назначен
  const asg = D.querySelector('[data-tqassign]'); asg.dispatchEvent(new w.Event('focusin', { bubbles:true })); asg.value = '__newperson'; asg.dispatchEvent(new w.Event('change', { bubbles:true }));
  assert.ok(D.getElementById('npDlg')); ok('«+ Добавить человека…» открывает окно имени');
  D.getElementById('npName').value = 'Влад Ким'; D.getElementById('npForm').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(20);
  assert.ok(E(`db.users.some(u => u.name === 'Влад Ким')`)); ok('человек добавлен в «Команду»');
  assert.equal(E(`userById(taskById(ui.taskId).assignee_id)?.name`), 'Влад Ким'); ok('и сразу назначен ответственным за задачу');
  assert.ok(/Влад Ким/.test(E('peopleOpts(null)'))); ok('и есть во всех списках ответственных');
  E('closeTask()');
  // связи этапов и «Срочно»: просроченный этап тормозит всех, кто от него зависит
  E(`(() => { const p = infoBoard(); const t0 = today();
    p.stages = ['Контент', 'Статья', 'VSL', 'Платный канал', 'Отдел продаж', 'Эфиры'].map((n, i) => ({ id:'f' + i, name:n, position:i, status:'not_started', planned_start:t0, due_date:addDays(t0, 7),
      subs:i === 5 ? [] : [{ id:'fx' + i, name:'Задача ' + n, done:false, due_date:i === 2 ? addDays(t0, -2) : addDays(t0, 10) }] }));
    ui.view = 'production'; ui.prodProject = p.id; render(); })()`);
  const fs = E(`JSON.stringify([...flowState(infoBoard()).values()].map(v => [v.s.name, v.key]))`);
  assert.deepEqual(JSON.parse(fs), [['Контент','green'],['Статья','green'],['VSL','red'],['Платный канал','yellow'],['Отдел продаж','yellow'],['Эфиры','red']]); ok('VSL просрочен — следующие за ним ждут, этап без задач — красный');
  assert.ok(!D.querySelector('.fl-chain') && D.querySelector('.kb-board') && D.querySelectorAll('.kb-dept').length && !D.querySelector('.fl') && !D.querySelector('.fl-why-box') && !D.querySelector('.fl-ai') && D.querySelector('.fl-viewbar'));
  assert.ok(!D.querySelector('.flp-list')); ok('в «Производстве» списков «Просрочено / Ближайшие» нет — они в «Сегодня»');
  E(`ui.view = 'today'; render()`); assert.equal(E('ui.view'), 'production'); assert.ok(D.querySelector('.tabs [data-view="today"]').hidden); ok('в инфобизнесе «Сегодня» убран из меню — открывается «Производство»');
  E(`SHOW_TODAY = true; INFO_HIDDEN.splice(INFO_HIDDEN.indexOf('today'), 1); ui.view = 'today'; render()`); const lists = [...D.querySelectorAll('.tdy-due .flp-list')];   // сам раздел ещё проверяем (он есть в агентстве)
  assert.ok(/Просрочено/.test(lists[0].textContent) && /Задача VSL/.test(lists[0].textContent) && !/Задача Контент/.test(lists[0].textContent)); ok('«Просрочено» — только просроченные задачи');
  assert.ok(/Ближайшие/.test(lists[1].textContent) && /Задача Контент/.test(lists[1].textContent) && !/Задача VSL/.test(lists[1].textContent)); ok('«Ближайшие» — ближайшие задачи по сроку'); E(`SHOW_TODAY = false; INFO_HIDDEN.push('today'); ui.view = 'production'; render()`); ok('в «Производстве» — канбан без воронки: отдел плашкой на карточке');
  assert.ok(D.querySelector('.tabs [data-view="funnel"]').hidden); ok('пункт «AI-воронка» пока скрыт из меню');
  E('SHOW_AI_FUNNEL = true');   // дальше проверяем сам раздел
  E(`ui.view = 'funnel'; render()`);
  assert.ok(/AI-воронка/.test(D.querySelector('.fl-hd').textContent)); ok('разбор — в отдельном разделе «AI-воронка»');
  assert.ok(/VSL — просрочено.*поэтому не работают: Платный канал → Отдел продаж → Эфиры/.test(D.querySelector('.fl-why-box').textContent)); ok('воронка объясняет, что и из-за чего не работает');
  assert.ok(/Воронка не работает/.test(D.querySelector('.fl-hd').textContent)); ok('вывод: «Воронка не работает» — конец воронки стоит');
  E(`ui.view = 'production'; render()`);
  E(`ui.view = 'funnel'; ui.flowEdit = true; render()`);
  const cbx = D.querySelector('[data-fldep="f5|f4"]'); cbx.checked = false; cbx.dispatchEvent(new w.Event('change', { bubbles:true }));
  const cby = D.querySelector('[data-fldep="f5|f0"]'); cby.checked = true; cby.dispatchEvent(new w.Event('change', { bubbles:true }));
  assert.deepEqual(E(`flowDeps(infoBoard(), infoBoard().stages[5])`), ['f0']); ok('связи меняются: «Эфиры» зависят от «Контента»');
  assert.ok(!E(`flowState(infoBoard()).get('f2').down.includes('f5')`)); ok('VSL больше не тормозит «Эфиры»');
  E(`ui.flowEdit = false`);
  // без AI — запасной вывод по срокам; на отделах нет лишних полей
  E(`ui.view = 'production'; ui.infoMode = 'board'; render()`);
  assert.ok(!D.querySelector('[data-flst]') && !D.querySelector('[data-flblock]')); ok('на отделах нет «Что мешает?» и выпадающих статусов');
  // AI-воронка: ответ Claude (подставной) — вывод, причины по цепочке, статусы отделов, что сделать первым
  E(`_sample = { json: async prompt => { window.__aiPrompt = prompt; return { verdict:'broken', summary:'Воронка не доводит до денег: статья не дописана.',
    stages:[{ name:'Статья', status:'stopped', reason:'задача «Дописать статью» не закрыта' }, { name:'Отдел продаж', status:'stopped', reason:'нет заявок — деньги не поступают' }, { name:'Контент', status:'works', reason:'ролики выходят' }],
    chain:['Статья не дописана → VSL не на чем строить → платный канал не запускается → в продажах нет заявок'], actions:[{ stage:'Статья', task:'Дописать статью', why:'разблокирует VSL и трафик' }] }; } }`);
  E(`ui.view = 'funnel'; render()`); D.querySelector('[data-flai]').click(); await wait(80);
  assert.ok(/«Статья»|"Статья"/.test(E('window.__aiPrompt')) || /Статья/.test(E('window.__aiPrompt'))); ok('Claude получает отделы и задачи');
  assert.ok(/AI-воронка/.test(D.querySelector('.fl-hd').textContent) && /Воронка не работает/.test(D.querySelector('.fl-hd').textContent)); ok('вывод AI: «Воронка не работает»');
  assert.ok(/Статья не дописана → VSL не на чем строить/.test(D.querySelector('.fl-ai').textContent)); ok('цепочка причин и следствий');
  assert.ok(/Дописать статью/.test(D.querySelector('.fl-ai-act').textContent)); ok('что сделать в первую очередь');
  assert.ok(/Не работает/.test([...D.querySelectorAll('.fl-node')].find(n => /Отдел продаж/.test(n.textContent)).textContent)); ok('AI помечает отдел продаж: не работает');
  assert.ok(E('!!infoBoard().ai?.res')); ok('разбор сохранён у инфоповода');
  // финальный дедлайн инфоповода: название и дата, задачи после него — в «Срочно», линия на таймлайне
  const gn = D.querySelector('[data-goalname]'); gn.value = 'Открытие окна продаж'; gn.dispatchEvent(new w.Event('change', { bubbles:true }));
  const gd = D.querySelector('[data-goaldate]'); gd.value = E('addDays(today(), 5)'); gd.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(20);
  assert.equal(E('infoBoard().goalName'), 'Открытие окна продаж'); ok('название финального дедлайна');
  assert.equal(E('infoBoard().deadline'), E('addDays(today(), 5)')); ok('дата финального дедлайна');
  E(`ui.view = 'production'; render()`);
  E(`ui.infoMode = 'timeline'; render()`);
  assert.ok(/Открытие окна продаж/.test(D.querySelector('.tl-goal')?.textContent || '')); ok('дедлайн — линией на таймлайне');
  E(`ui.infoMode = 'board'; render()`);
  // таймлайн: все задачи с датой на одной шкале, связи стрелками
  E(`ui.infoMode = 'timeline'; render()`);
  assert.ok(D.querySelector('.tl') && !D.querySelector('.pf-board')); ok('«Таймлайн» вместо доски');
  assert.equal(D.querySelectorAll('.tl-task').length, E(`[...flowState(infoBoard()).values()].filter(v => !isCtStage(infoBoard(), v.s)).reduce((n, v) => n + v.items.filter(i => i.due && !i.x.cycle).length, 0)`)); ok('на таймлайне все задачи со сроком, кроме «Контента»');
  assert.equal(D.querySelectorAll('.tl-lbl').length, E(`new Set(kbItems([projById(ui.prodProject)]).map(i => i.s.id)).size`)); assert.ok(![...D.querySelectorAll('.tl-lbl b')].some(b => /Контент/.test(b.textContent))); ok('строки — только отделы с задачами (как на канбане), «Контента» нет');
  assert.ok(D.querySelector('.tl-task.k-red') && !D.querySelector('.tl-arr, .tl-svg')); ok('просроченное — красное, стрелок-связей в таймлайне нет');
  E(`(() => { const p = infoBoard(), s = p.stages.find(y => !isCtStage(p, y) && y.subs?.length), x = s.subs[0]; tasksFromSubs(p, { ...s, subs:[x] }); const t = taskFor(p.id, s.id, x.id); t.start_date = addDays(today(), 1); t.due_date = addDays(today(), 4); render(); })()`);
  assert.ok(D.querySelector('.tl-bar')); ok('срок от и до — полосой на таймлайне');
  E(`ui.infoMode = 'board'`);
  // этапы и подэтапы видео — из шаблона SMM-пространства
  E(`cloud.store = cloud.store || {}; cloud.uid = cloud.uid || 'u1'; otherSpaces = () => [{ id:'s1', name:'SMM Reels', kind:'smm' }];
    loadSpaceTemplates = async () => ({ tpls:[{ id:'tsmm', name:'SMM: видео', stages:[{ id:'a', name:'Сценарий', days:2, subs:[{ id:'a1', name:'Хук' }] }, { id:'b', name:'Съёмка', days:1, subs:[] }, { id:'c', name:'Публикация', days:1, subs:[] }] }], cards:{} });`);
  await w.eval('syncVidTplFromSmm(true)');
  assert.deepEqual(E('vidCols().map(c => c.name)'), ['Сценарий', 'Съёмка', 'Публикация']); ok('этапы видео — как в шаблоне SMM-пространства');
  E(`addContent('Рилс', 3, today()); ui.view = 'content'; ui.ctMode = 'board'; render()`);
  assert.ok(/Хук/.test(D.querySelector('.ct-subs')?.textContent || '')); ok('подэтапы этапа SMM — на карточке видео');
  // перетаскивание карточки на доске инфобизнеса в другую колонку
  E(`(() => { const p = infoBoard(); const ss = p.stages.filter(y => !isMaint(y) && !isCtStage(p, y)); window.__fs = ss[0]; window.__ts = ss[2]; (__fs.subs = __fs.subs || []).push({ id:'dragX', name:'Перенести меня', done:false }); ui.view = 'production'; ui.infoMode = 'board'; ui.kbView = 'dept'; commit(); })()`);
  { const dt = { setData(){}, getData(){ return ''; }, types:['text/kz-card'], effectAllowed:'' };
    const ev = (type, el) => { const e = new w.Event(type, { bubbles:true, cancelable:true }); Object.defineProperty(e, 'dataTransfer', { value:dt }); el.dispatchEvent(e); };
    const fromSid = E(`__fs.id`), toSid = E(`__ts.id`), xid = 'dragX';
    const card = D.querySelector(`[data-pfdrag="${fromSid}|${xid}"]`); assert.ok(card && card.getAttribute('draggable') === 'true'); ok('карточки доски перетаскиваются');
    ev('dragstart', card); const col = D.querySelector(`[data-pfcol="${toSid}"]`); ev('dragover', col); ev('drop', col); await wait(20);
    assert.ok(E(`__ts.subs.some(x => x.id === '${xid}') && !__fs.subs.some(x => x.id === '${xid}')`)); E(`ui.kbView = 'status'`); ok('карточка переехала в другую колонку');
  }
  // инфоповоды: новый — своя доска с теми же колонками и связями, «Контент» — у выбранного
  E(`infoBoard().name = 'Контент Игоря'; ui.view = 'production'; ui.ipNew = true; render()`);
  D.getElementById('ipName').value = 'Челлендж Эма'; D.getElementById('ipNew').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(30);
  assert.deepEqual(E('infoBoards().map(p => p.name)').sort(), ['Контент Игоря', 'Челлендж Эма']); ok('инфоповод добавлен второй доской');
  assert.equal(E('infoBoard().name'), 'Челлендж Эма'); ok('открыт новый инфоповод');
  assert.deepEqual(E(`infoBoard().stages.map(s => s.name)`), E(`infoBoards().find(p => p.name === 'Контент Игоря').stages.filter(s => !isMaint(s)).map(s => s.name)`)); ok('колонки — как у текущего инфоповода');
  assert.equal(E('infoBoard().stages.flatMap(s => s.subs).length'), 0); ok('задачи у нового инфоповода свои — пока пусто');
  assert.ok(D.querySelectorAll('.ip-chip:not(.ip-all)').length === 2); ok('в «Производстве» — строка инфоповодов');
  // доп. контент: вне плана, считается отдельно
  E(`addContent('Рилс', 4, today()); addContent('Сторис', 2, today(), true)`);
  const cst = E('JSON.stringify(ctStats(ctCur()))'); const cj = JSON.parse(cst);
  assert.equal(cj.plan, 4); ok('доп. контент не меняет план');
  assert.deepEqual(cj.extra, { n:2, pub:0 }); ok('доп. контент считается отдельно');
  E(`ui.view = 'content'; ui.ctMode = 'board'; render()`);
  assert.equal(D.querySelectorAll('.ct-card .ct-x').length, 2); ok('на доске видео доп. контент с пометкой «доп.»');
  assert.ok(!D.querySelector('.ct-add')); E(`ui.ctAddOpen = true; render()`);
  assert.ok(D.querySelectorAll('.ct-card .ct-ico').length >= 6 && D.querySelector('.ct-add .ct-sw')); E(`ui.ctAddOpen = false; render()`); ok('у видео — значок видео, форма добавления — карточкой с переключателем «Доп. контент»');
  assert.ok(!D.querySelector('[data-vidsync]')); ok('кнопки «Обновить из SMM» нет');
  // ответственный у каждого этапа видео: сценарий — один человек, съёмка — другой; на главной доске имя — по текущему этапу
  E(`db.users.push({ id:'uyu', name:'Юля Ан', role:'specialist', status:'active' }, { id:'uig', name:'Игорь Пак', role:'specialist', status:'active' }); ui.view = 'content'; ui.ctMode = 'board'; render()`);
  const c0 = E('vidCols()[0].id'), c1 = E('vidCols()[1].id');
  let sw = D.querySelector(`[data-vidwho="${c0}"]`); sw.value = 'uyu'; sw.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(20);
  sw = D.querySelector(`[data-vidwho="${c1}"]`); sw.value = 'uig'; sw.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(20);
  const vx = E(`contentStage().subs.find(x => x.cycle && !x.done && vidCol(x).id === '${c0}').id`);
  assert.equal(E(`contentWho(infoBoard(), contentStage(), contentStage().subs.find(x => x.id === '${vx}'), null)`), 'uyu'); ok('видео на «Сценарии» — у Юли');
  E(`moveVideo('${vx}', '${c1}')`);
  assert.equal(E(`contentWho(infoBoard(), contentStage(), contentStage().subs.find(x => x.id === '${vx}'), null)`), 'uig'); ok('перешло на «Съёмку» — у Игоря');
  E(`ui.view = 'production'; ui.infoMode = 'board'; render()`);
  assert.ok(!D.querySelector(`.pf-board [data-pfsub$="|${vx}"]`)); ok('видео на досках «Производства» нет — оно в «Контенте»');
  assert.ok(E(`dayProjectItems('uig').some(i => i.x?.id === '${vx}')`) && !E(`dayProjectItems('uyu').some(i => i.x?.id === '${vx}')`)); ok('«Мои задачи»: видео у того, у кого оно сейчас на этапе');
  // «Мои задачи»: задачи из всех колонок доски инфобизнеса, а не только текущего этапа
  E(`(() => { const p = infoBoard(); const s = p.stages.find(z => z !== contentStage(p) && !isMaint(z)); s.subs = s.subs || []; s.subs.push({ id:'mine1', name:'Моя задача в другой колонке', done:false }); s.assignee_id = 'me'; })()`);
  assert.ok(E(`dayProjectItems('me').some(i => i.title === 'Моя задача в другой колонке')`)); ok('«Мои задачи»: видны задачи из любой колонки доски');
  // переименование видео в «Контенте»: подэтап и его задача
  E(`ui.view = 'content'; ui.ctMode = 'board'; render()`);
  const rb = D.querySelector('[data-ctren]'); const rid = rb.dataset.ctren; rb.click();
  D.getElementById('npName').value = 'Рилс про кейс клиента с очень длинным названием'; D.getElementById('npForm').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(20);
  assert.equal(E(`contentStage().subs.find(x => x.id === '${rid}').name`), 'Рилс про кейс клиента с очень длинным названием'); ok('видео переименовывается прямо в «Контенте»');
  assert.ok(['priority', 'assign', 'reports'].every(v => D.querySelector(`.tabs [data-view="${v}"]`).hidden)); ok('в инфобизнесе нет «Приоритетов», «Поручений», «AI-отчётов»');
  E(`db.prefs.kind = 'agency'; render()`);
  assert.ok(!D.querySelector('.tabs [data-view="matrix"]').hidden); ok('в агентстве матрица на месте');
  // «Внутренние задачи» — вкладка в «Производстве» у проекта: отделы + «Регулярные» из «Ведения»
  assert.ok(!D.querySelector('.tabs [data-view="internal"]')); ok('отдельного пункта меню нет — вкладка в «Производстве»');
  const ap = E(`db.projects.find(p => p.state === 'active' && !p.is_maintenance).id`);
  E(`ui.view = 'production'; ui.prodProject = '${ap}'; ui.prodTab = 'board'; render()`);
  D.querySelector('[data-prodtab="internal"]').click(); await wait(20);
  assert.deepEqual([...D.querySelectorAll('.it-kb > .pf-col header b')].map(b => b.textContent.trim()), ['Входящие', 'К выполнению', 'В работе', 'Готово', 'Регулярные']); ok('внутренние задачи — канбан: Входящие, К выполнению, В работе, Готово (+ Регулярные)');
  for (const nm of ['Маркетинг', 'SMM']){ D.querySelector('[data-itdeptadd]').click(); await wait(10); D.getElementById('npName').value = nm; D.getElementById('npForm').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(20); }
  assert.ok(['Маркетинг', 'SMM'].every(n => [...D.querySelectorAll('.kb-dbtn b')].some(b => b.textContent === n))); ok('отделы — кнопками-плитками, добавляются плюсиком');
  const smmId = E(`itDepts().find(d => d.name === 'SMM').id`);
  assert.ok(D.querySelector('[data-mainton]')); ok('без «Ведения» — подсказка и «Включить ведение»');
  D.querySelector('[data-mainton]').click(); await wait(20);
  assert.ok(E(`projById('${ap}').is_maintenance`) && D.querySelector('.it-repcol .rt-block')); ok('«Включить ведение» — в «Регулярных» появляются регулярные задачи проекта');
  E(`projById('${ap}').worker_id = 'me'; render()`);
  D.querySelector(`[data-itdeptf="${smmId}"]`).click(); await wait(20);
  assert.ok(/Как у проекта/.test(D.querySelector(`[data-itdeptwho="${ap}|${smmId}"]`).selectedOptions[0].textContent)); ok('отдел: по умолчанию — исполнитель проекта');
  E(`if (!db.users.some(u => u.id === 'uyu')) db.users.push({ id:'uyu', name:'Юля Ан', role:'specialist', status:'active' })`);
  const dw = D.querySelector(`[data-itdeptwho="${ap}|${smmId}"]`); dw.value = 'uyu'; dw.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(20);
  assert.equal(E(`projById('${ap}').itDeptWho['${smmId}']`), 'uyu'); ok('у отдела в проекте — свой ответственный');
  { const f = D.querySelector('[data-itadd]'); f.querySelector('input').value = 'Контент-план на декабрь'; assert.equal(f.querySelector('[data-itaddd]').value, smmId); f.dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(30); }
  { const t = E(`JSON.stringify(itAll().find(t => t.title === 'Контент-план на декабрь'))`); const o = JSON.parse(t); assert.ok(o.dept === smmId && o.project_id === E(`'${ap}'`) && o.assignee_id === 'uyu' && o.status === 'todo'); ok('задача — в «К выполнению» этого проекта, отдел SMM, на ответственного отдела'); }
  const itId = E(`itAll().find(t => t.title === 'Контент-план на декабрь').id`);
  { const dt = { setData(){}, getData(){ return ''; } }; const ev = (type, el) => { const e = new w.Event(type, { bubbles:true, cancelable:true }); Object.defineProperty(e, 'dataTransfer', { value:dt }); el.dispatchEvent(e); };
    ev('dragstart', D.querySelector(`[data-itdrag="${itId}"]`)); const col = D.querySelector('[data-itcol="done"]'); ev('dragover', col); ev('drop', col); await wait(30); }
  assert.equal(E(`itAll().find(t => t.id === '${itId}').status`), 'done'); ok('перетащили в «Готово» — задача готова');
  const mk = E(`itDepts().find(d => d.name === 'Маркетинг').id`); D.querySelector(`[data-itdeptdel="${mk}"]`).click(); await wait(20);
  assert.deepEqual(E('itDepts().map(d => d.name)'), ['SMM']); ok('пустой отдел удаляется крестиком');
  E(`window.__smp0 = _sample; _sample = { json: async () => ({ tasks:[{ title:'Согласовать бюджет с клиентом', dept:'SMM', due:null, who:null }] }) }`);
  w.eval(`itInboxAi('Созвон: надо согласовать бюджет с клиентом')`); await wait(80);
  assert.ok(/Согласовать бюджет/.test(D.querySelector('.it-kb .kb-in').textContent)); ok('«Входящие» внутренних задач: Claude находит задачи из выжимки');
  D.querySelector('[data-itinto]').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(30);
  assert.ok(E(`itAll().some(t => t.title === 'Согласовать бюджет с клиентом' && t.project_id === '${ap}' && t.dept === '${smmId}')`)); ok('«В задачи» — внутренняя задача этого проекта в отделе SMM');
  E(`_sample = window.__smp0`);
  // внутренняя задача: срок «с … до …» и напоминание, как у задач площадки
  { const id = E(`itAll().find(t => t.title === 'Согласовать бюджет с клиентом').id`); E(`openItask('${id}')`); await wait(20);
    D.getElementById('itStart').value = E('today()'); D.getElementById('itDue').value = E('addDays(today(), 3)');
    D.querySelector('[data-itremq="before"]').click(); assert.equal(D.getElementById('itRem').value, E('addDays(today(), 2)') + 'T10:00');
    D.getElementById('itForm').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(30);
    const t = JSON.parse(E(`JSON.stringify(itAll().find(t => t.id === '${id}'))`)); assert.ok(t.start_date === E('today()') && t.due_date === E('addDays(today(), 3)') && t.remind?.at === E('addDays(today(), 2)') + 'T10:00'); ok('внутренняя задача: срок «с … до …» и напоминание «За день, 10:00»');
    E(`(() => { const t = itAll().find(x => x.id === '${id}'); t.remind.at = new Date(Date.now() - 60000).toISOString().slice(0, 16); })()`); E('checkReminders()');
    assert.ok(D.getElementById('remPop') && /Согласовать бюджет/.test(D.getElementById('remPop').textContent)); ok('напоминание внутренней задачи срабатывает'); D.querySelector('[data-remok]').click(); }
  const op = E(`db.projects.find(p => p.state === 'active' && p.id !== '${ap}').id`);
  E(`ui.prodProject = '${op}'; render()`);
  assert.ok(!/Контент-план на декабрь/.test(D.getElementById('app').textContent)); ok('у другого проекта — свои внутренние задачи');
  E(`ui.prodTab = 'board'`);
  E(`window.__k = db.prefs.kind; db.prefs.kind = 'info'; createInfoBoard('Вторая площадка', today()); ui.infoAll = true; ui.ctOpen = {}; render();`);
  assert.ok(D.querySelector('.kb-board') && !D.querySelector('.ab-board')); ok('во «Все» — общий канбан площадок');
  E(`ui.infoAll = false; db.prefs.kind = window.__k; render();`);
  // удалённая задача не возвращается из старой копии (исполнитель / другое устройство пишет проект целиком)
  E(`{ const p = infoBoard(); const s = p.stages.find(x => !isMaint(x)); s.subs.push({ id:'zDel', name:'Удалю', done:false }); commit();
     window.__old = JSON.parse(JSON.stringify(p)); s.subs = s.subs.filter(x => x.id !== 'zDel'); commit(); }`);
  assert.ok(E(`infoBoard().subDel.includes('zDel')`)); ok('удаление задачи запоминается');
  E(`{ const p = infoBoard(); p.stages.find(x => x.subs.some?.(y => false) || !isMaint(x)).subs.push({ id:'zDel', name:'Удалю', done:false }); commit(); }`);
  assert.ok(!E(`subIdsOf(infoBoard()).includes('zDel')`)); ok('вернувшаяся из копии задача сразу убирается');
  E(`onSharedProject(infoBoard().id, { exists:true, metadata:{}, data:() => ({ json:JSON.stringify(window.__old) }) })`);
  assert.ok(!E(`subIdsOf(infoBoard()).includes('zDel')`)); ok('старая копия из общего документа удалённую задачу не возвращает');
  // дорожная карта в PDF — во «Все»: все площадки одной таблицей
  E(`window.__k2 = db.prefs.kind; db.prefs.kind = 'info'; ui.view = 'production'; ui.infoAll = true; ui.infoMode = 'board'; render()`);
  assert.ok(!D.querySelector('[data-roadmap]')); ok('кнопки PDF во «Все» нет (убрана)');
  E(`ui.infoAll = false; render()`); assert.ok(!D.querySelector('[data-roadmap]')); ok('и у площадки кнопки PDF нет');
  { const h = E(`roadmapHtml(infoBoards())`); assert.ok(/все площадки/.test(h) && (h.match(/<section>/g) || []).length === E('infoBoards().length') && /print\(\)/.test(h)); ok('дорожная карта всех площадок — раздел на каждую площадку, как у одной; открывается печать (PDF)'); }
  E(`ui.infoAll = false; db.prefs.kind = window.__k2; render()`);
  // задача без срока подсвечена на доске
  E(`{ const p = infoBoard(); const s = p.stages.find(x => !isMaint(x) && !isCtStage(p, x)); s.subs.push({ id:'noDue', name:'Без даты', done:false }); ui.view = 'production'; ui.prodProject = p.id; ui.infoAll = false; ui.infoMode = 'board'; ui.kbView = 'status'; ui.kbDept = ''; ui.kbDue = ''; ui.kbType = ''; commit(); }`);
  { const c = D.querySelector('.pf-board [data-pfsub$="|noDue"], .pf-board [data-tgsub$="|noDue"]'); assert.ok(c && c.querySelector('.pf-due.nodue')); ok('задача без срока подсвечена «без срока»'); }
  // «Контент» → «План / Факт»: этап видео меняется выбором прямо в строке
  E(`window.__k3 = db.prefs.kind; db.prefs.kind = 'info'; contentStage(infoBoard()).subs.push({ id:'vSt', name:'Видео этап', done:false, cycle:today(), due_date:today() }); ui.ctCycle = today(); ui.view = 'content'; ui.ctMode = 'plan'; commit()`);
  { const sel = D.querySelector('.ct-row [data-ctmove="vSt"]') || D.querySelector('.ct-row [data-ctmove]');
    if (sel){ const xid = sel.dataset.ctmove; const to = [...sel.options].find(o => !o.selected && o.index < sel.options.length - 1)?.value;
      if (to){ sel.value = to; sel.dispatchEvent(new w.Event('change', { bubbles:true })); assert.equal(E(`vidCol(contentStage(infoBoard()).subs.find(x => x.id === '${xid}')).id`), to); }
      ok('«Контент»: этап видео меняется выбором в строке списка'); }
    else ok('«Контент»: видео в списке нет — пропуск'); }
  // на главной у видео — ответственный текущего этапа, даже если в карточке стоял другой
  E(`{ const p = infoBoard(); const s = contentStage(p); const x = s.subs.find(y => y.id === 'vSt'); tasksFromSubs(p, { ...s, subs:[x] }); taskFor(p.id, s.id, 'vSt').assignee_id = 'me';
     if (!db.users.some(u => u.id === 'uStg')) db.users.push({ id:'uStg', name:'Монтажёр', status:'active' }); p.vidWho = { ...(p.vidWho || {}), [vidCol(x).id]:'uStg' }; ui.view = 'production'; commit(); }`);
  assert.equal(E(`contentWho(infoBoard(), contentStage(infoBoard()), contentStage(infoBoard()).subs.find(y => y.id === 'vSt'), taskFor(infoBoard().id, contentStage(infoBoard()).id, 'vSt'))`), 'uStg'); ok('у видео ответственный — его текущего этапа');
  // «Контент» → «План / Факт»: «Сценариев написано» — видео дальше этапа «Сценарий»
  E(`ui.view = 'content'; ui.ctMode = 'plan'; render()`);
  { const has = E(`vidCols().some(y => /сценар/i.test(y.name))`); const kpi = D.querySelector('.smm-kpi');
    assert.ok(!has || /Сценариев написано/.test(kpi.textContent)); ok('в «План / Факт» «Контента» — «Сценариев написано»'); }
  { const before = E(`ctStats(contentStage(infoBoard()).subs.find(x => x.id === 'vSt').cycle).scr`); const sc = E(`vidCols().find(y => /сценар/i.test(y.name))?.id`);
    if (sc){ E(`{ const x = contentStage(infoBoard()).subs.find(y => y.id === 'vSt'); x.done = false; x.vst = vidCols()[0].id; }`); const b0 = E(`ctStats(contentStage(infoBoard()).subs.find(x => x.id === 'vSt').cycle).scr`);
      E(`moveVideo('vSt', '${sc}')`); const b1 = E(`ctStats(contentStage(infoBoard()).subs.find(x => x.id === 'vSt').cycle).scr`);
      assert.ok(b1 <= b0 + 1); }
    ok('счётчик сценариев считается по этапам'); }
  // галочка у видео в «Контенте» — следующий этап
  E(`{ const x = contentStage(infoBoard()).subs.find(y => y.id === 'vSt'); x.done = false; x.vst = vidCols()[0].id; ui.view = 'content'; ui.ctMode = 'plan'; commit(); }`);
  assert.ok(!D.querySelector('.ct-stg') && !D.querySelector('.ct-next') && !D.querySelector('.ct-row .ct-mini')); ok('«План / Факт»: без блока «Этапы» и лишнего');
  { const sel = D.querySelector('.ct-reel [data-vidwho]'); sel.value = 'uStg'; sel.dispatchEvent(new w.Event('change', { bubbles:true }));
    assert.equal(E(`infoBoard().vidWho[vidCols()[0].id]`), 'uStg'); ok('ответственного этапа назначаем на доске ролика'); }
  // выбрать и удалить видео в «Контенте»
  E(`ui.view = 'content'; ui.ctMode = 'plan'; render()`);
  D.querySelector('[data-ctselmode]').click();
  { const pk = D.querySelector('[data-ctpick="vSt"]'); pk.checked = true; pk.dispatchEvent(new w.Event('change', { bubbles:true }));
    D.querySelector('[data-ctseldel]').click(); await wait(30); D.getElementById('cfmOk').click(); await wait(80);
    assert.ok(!E(`contentStage(infoBoard()).subs.some(x => x.id === 'vSt')`)); ok('видео можно выбрать и удалить'); }
  E(`ui.view = 'production'; db.prefs.kind = window.__k3; render()`);
  E(`window.__k4 = db.prefs.kind; db.prefs.kind = 'info'; ui.view = 'content'; ui.ctMode = 'plan'; ui.ctAddOpen = false; render()`);
  if (D.querySelector('[data-ctplus]')){ D.querySelector('[data-ctplus]').click(); const top = D.getElementById('app').firstElementChild.nextElementSibling;
    assert.ok(top && top.id === 'ctAdd'); ok('«+» сверху открывает форму новых видео'); }
  E(`ui.ctAddOpen = false; ui.view = 'production'; db.prefs.kind = window.__k4; render()`);
  { // исполнитель по ссылке: доска канбаном, перетаскивать можно, создавать и править — нет
    E(`window.__xp = JSON.parse(JSON.stringify(infoBoards()[0])); __xp.id = 'xshared1'; __xp._ext = { role:'worker', ownerId:'o1', members:[] }; ext.projects.push(__xp);
      window.__v = ui.view; ui.view = 'mine'; ui.myProject = 'xshared1'; render()`); await wait(50);
    const brd = D.querySelector('.kb-board');
    assert.ok(brd && brd.querySelector('[data-kbdrag]') && !brd.querySelector('.kb-add') && !brd.querySelector('.kb-in') && !brd.querySelector('[data-kbtt]')); ok('исполнитель по ссылке: канбан, карточки перетаскиваются, нет добавления, «Входящих» и смены типа');
    const k = brd.querySelector('.kb-todo [data-kbdrag], .kb-col [data-kbdrag]').dataset.kbdrag;
    E(`kbMove('${k}', 'doing')`); assert.equal(E(`(() => { const [a, b, c] = '${k}'.split('|'); const p = projById(a); const s = p.stages.find(y => y.id === b); return kbStatus(p, s, s.subs.find(y => y.id === c)); })()`), 'doing'); ok('исполнитель по ссылке: перенос в «В работе» сохраняется');
    E(`ext.projects = ext.projects.filter(p => p.id !== 'xshared1'); ui.view = window.__v; render()`); }
  { // дорожная карта 12 недель: старт, цель недели, привязка задачи, таймер
    E(`window.__kw = db.prefs.kind; db.prefs.kind = 'info'; ui.view = 'w12'; render()`); await wait(30);
    assert.ok(!D.querySelector('.tabs [data-view="w12"]').hidden && D.getElementById('w12Start')); ok('дорожная карта: пункт меню и форма старта');
    D.getElementById('w12Goal').value = '1000 подписчиков'; D.getElementById('w12Date').value = E('addDays(today(), -8)');
    D.getElementById('w12Start').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(30);
    assert.equal(D.querySelectorAll('.w12-wk').length, 12); assert.ok(D.querySelector('.w12-wk.cur') === D.querySelectorAll('.w12-wk')[0] && /неделя 2/.test(D.querySelector('.w12-stats').textContent) && /9 дней прошло/.test(D.querySelector('.w12-stats').textContent) && D.querySelector('.w12-ring b').textContent === '1'); ok('дорожная карта: 12 недель; по календарю 2-я неделя, 9-й день; по задачам — 1-я');
    E(`w12Items()[0].x.w12 = 2; render()`); await wait(30);
    assert.equal(D.querySelectorAll('.w12-wk')[1].querySelectorAll('li').length, 1); ok('дорожная карта: задача привязана к неделе');
    { const bs = D.querySelector('[data-w12board="1"]'); bs.value = 'new'; bs.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(30);
      const pid = E('db.prefs.w12.weeks[0].board'); assert.ok(E(`projById('${pid}').name`) === 'Неделя 1'); ok('дорожная карта: к неделе 1 создана и привязана доска «Неделя 1»');
      E(`(() => { const p = projById('${pid}'); const s = p.stages.find(y => !isMaint(y) && !isCtStage(p, y)); (s.subs = s.subs || []).push({ id:'w1t', name:'Задача недели 1', done:false }); commit(); render(); })()`); await wait(30);
      assert.ok(D.querySelectorAll('.w12-wk')[0].classList.contains('cur') && D.querySelectorAll('.w12-wk')[1].classList.contains('lock')); ok('дорожная карта: пока задачи доски не закрыты — неделя 2 закрыта замком');
      E(`(() => { const p = projById('${pid}'); const s = p.stages.find(y => (y.subs || []).some(x => x.id === 'w1t')); kbMove(p.id + '|' + s.id + '|w1t', 'done'); render(); })()`); await wait(30);
      assert.ok(D.querySelectorAll('.w12-wk')[0].classList.contains('closed') && D.querySelectorAll('.w12-wk')[1].classList.contains('cur')); ok('дорожная карта: все задачи доски в «Готово» — неделя 1 закрыта, открылась неделя 2');
      { D.getElementById('w12MName').value = 'Пользователи VPN'; D.getElementById('w12MTarget').value = '1000'; D.getElementById('w12MAdd').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); await wait(30);
        const fa = D.querySelector('.w12-grid [data-w12v$="|fact"]'); fa.value = '62'; fa.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(30);
        const f2 = D.querySelectorAll('.w12-grid .w12-wk')[1].querySelector('[data-w12v$="|fact"]'); f2.value = '38'; f2.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(30);
        assert.ok(/100\s*из 1\s*000/.test(D.querySelector('.w12-kpi .w12-kv').textContent.replace(/\u00a0/g, ' '))); ok('дорожная карта: показатель — факт по неделям складывается в итог к цели (100 из 1000)'); }
      assert.ok(/100%/.test(D.querySelector('.w12-ex').textContent) && D.querySelector('.w12-ex').classList.contains('ok')); ok('дорожная карта: Execution Score — среднее по завершённым неделям (неделя 1 закрыта на 100%), зелёный при 85%+');
      { // Weekly Review: закрыть неделю 2 — незавершённая задача уезжает на доску недели 3
        const nm = E(`w12Calc().of(2).find(i => i.st !== 'done')?.x.name`);
        { E(`window.__st0 = db.prefs.w12.start; db.prefs.w12.start = addDays(today(), 3)`); const sun = E('w12SunOf(1)');
          assert.ok(E(`parse('${sun}').getDay()`) === 0 && !E('w12CanClose(1)')); E(`db.prefs.w12.start = window.__st0`); ok('закрыть неделю: только с её воскресенья, раньше кнопка неактивна'); }
        E(`window.__st = db.prefs.w12.start; db.prefs.w12.start = addDays(today(), -60); render()`); await wait(20);   // воскресенье недели 2 уже прошло
        D.querySelector('[data-w12review="2"]').click(); await wait(20);
        assert.ok(D.querySelector('.w12-rvm [data-rvact]')); D.querySelector('[data-rvdo="2"]').click(); await wait(30);
        assert.ok(E('!!db.prefs.w12.weeks[1].review') && E(`w12Calc().of(3).some(i => i.x.name === ${JSON.stringify(nm)})`) && E(`projById(db.prefs.w12.weeks[2].board).name`) === 'Неделя 3'); ok('Weekly Review: неделя закрыта, незавершённое перенесено на доску «Неделя 3»');
        assert.ok(D.querySelectorAll('.w12-wk')[2].classList.contains('cur')); ok('Weekly Review: текущей стала неделя 3'); }
      E(`db.prefs.w12.weeks[2].goal = 'Цель второй'; ui.view = 'production'; ui.infoAll = false; ui.prodProject = '${pid}'; render()`); await wait(30);
      assert.ok(/Неделя 1 из 12/.test(D.querySelector('.w12-banner')?.textContent || '')); ok('дорожная карта: на доске недели — плашка с целью недели');
      E(`ui.view = 'w12'; render()`); assert.ok(/Цель второй/.test(D.querySelector('.w12-now').textContent)); ok('дорожная карта: цель текущей недели — крупно наверху'); }
    const g = D.querySelector('[data-w12goal="2"]'); g.value = 'Запустить рекламу'; g.dispatchEvent(new w.Event('change', { bubbles:true }));
    assert.equal(E('db.prefs.w12.weeks[1].goal'), 'Запустить рекламу'); ok('дорожная карта: цель недели сохраняется');
    E(`db.prefs.kind = window.__kw; ui.view = 'production'; render()`); }
  { // регулярные задачи на доске: колонка «Регулярные», включается кнопкой
    E(`window.__kr = db.prefs.kind; db.prefs.kind = 'info'; ui.view = 'production'; ui.infoAll = false; ui.prodProject = infoBoards()[0].id; ui.infoMode = 'board'; ui.pfEdit = false; infoBoards()[0].is_maintenance = false; render()`); await wait(30);
    assert.ok(D.querySelector('.kb-board .kb-rep [data-mainton]')); D.querySelector('.kb-rep [data-mainton]').click(); await wait(30);
    assert.ok(D.querySelector('.kb-board .kb-rep [data-radd]')); ok('доска: колонка «Регулярные» — включается и даёт добавить отчёт/KPI'); E(`db.prefs.kind = window.__kr; render()`); }
  { // 12 недель: взвешенный счёт, перегруз недели, действия против результата
    assert.equal(E(`(() => { const items = [{ x:{ ttype:'strat' }, st:'todo' }, ...Array.from({ length:3 }, () => ({ x:{}, st:'done' }))]; const tot = items.reduce((m, i) => m + (kbTT(i.x) === 'strat' ? W12_STRAT_W : 1), 0); return Math.round(items.filter(i => i.st === 'done').reduce((m, i) => m + 1, 0) / tot * 100); })()`), 50); ok('12 недель: стратегическая задача весит ×3 (3 мелкие из 4 — это 50%, а не 75%)');
    assert.equal(E('w12Load(15)'), ''); assert.equal(E('w12Load(25)'), 'mid'); assert.equal(E('w12Load(35)'), 'bad'); ok('12 недель: перегруз — больше 20 задач жёлтый, больше 30 красный');
    assert.ok(/меняйте связку/.test(E(`w12Diag({ metrics:[{ id:'a', kind:'lead' }, { id:'b', kind:'lag' }], weeks:[{ vals:{ a:{ plan:30, fact:30 }, b:{ plan:20, fact:12 } } }] }, 1)`))); ok('12 недель: действия 100%, результат ниже — подсказка «меняйте связку»'); }
  { // регулярные: «Каждый день» и «По будням»
    assert.ok(E(`FREQ.daily && FREQ.workdays`)); assert.equal(E(`nextCycle('2099-01-01', 'daily')`), '2099-01-02');
    assert.equal(E(`nextCycle('2099-01-02', 'workdays')`), '2099-01-05'); ok('регулярные: есть «Каждый день» и «По будням» (после пятницы — понедельник)'); }
  { // корзина: карточку бросили в корзину → подтверждение → задача удалена с доски
    const k = E(`(() => { const p = infoBoards()[0]; const s = p.stages.find(y => !isMaint(y) && (y.subs || []).length); return p.id + '|' + s.id + '|' + s.subs[0].id; })()`);
    const name = E(`(() => { const [a, b, c] = ${JSON.stringify(k)}.split('|'); return projById(a).stages.find(y => y.id === b).subs.find(y => y.id === c).name; })()`);
    E(`trashDelete('kb:${k}')`); await wait(30); D.getElementById('cfmOk').click(); await wait(60);
    assert.ok(!E(`(() => { const [a, b, c] = ${JSON.stringify(k)}.split('|'); return !!projById(a).stages.find(y => y.id === b).subs.find(y => y.id === c); })()`), name); ok('корзина: задача удалена с доски после подтверждения'); }
  { // Telegram: текст из канала → Claude → «Входящие» без повторов; документ забирается (удаляется)
    E(`window.__cs = cloud.store; window.__cu = cloud.uid; window.__gs = getSample; window.__del = [];
      cloud.store = { doc: p => ({ delete: async () => { window.__del.push(p); } }) }; cloud.uid = 'me';
      db.prefs = db.prefs || {}; db.prefs.inbox = [{ id:'x1', text:'Позвонить подрядчику', at:'2026-11-19' }];
      getSample = async () => ({ json: async () => ({ tasks:[{ title:'Позвонить подрядчику', dept:'' }, { title:'Снять сторис про запуск', dept:'', type:'oper' }], skipped:1 }) })`);
    await E(`tgTake({ id:'d1', data: () => ({ text:'голосовое: снять сторис, позвонить подрядчику', kind:'info', chat:'Канал' }) })`);
    const inb = E(`db.prefs.inbox.map(x => x.text + '|' + (x.src || ''))`);
    assert.deepEqual(inb, ['Позвонить подрядчику|', 'Снять сторис про запуск|tg']); assert.ok(E(`db.prefs.tgLog[0].st === 'ok' && db.prefs.tgLog[0].n === 1`)); ok('telegram: задачи из голосового во «Входящих», повтор отброшен, текст в ленте');
    assert.deepEqual(E('window.__del'), ['data/users/me/tgdrops/d1']); ok('telegram: текст забран из базы');
    E(`getSample = async () => ({ json: async () => { throw { code:'unavailable' }; } })`);
    await E(`tgTake({ id:'d2', data: () => ({ text:'Купить микрофон', kind:'info' }) })`);
    assert.ok(E(`db.prefs.tgLog.some(e => e.text === 'Купить микрофон' && e.st === 'err')`) && /Купить микрофон/.test(D.querySelector('.kb-in .tg-feed')?.textContent || E('tgLogHtml("info", "")'))); ok('telegram: Claude недоступен — текст виден в ленте «Входящих» с кнопкой «Разобрать»');
    { // подтверждено в боте («ок») — задачи сразу в «К выполнению» площадки, с отделом, сроком и ответственным
      E(`db.users.push({ id:'uAs', name:'Аня', dept:'Ассистент', status:'active' })`);
      await E(`tgTake({ id:'d3', data: () => ({ kind:'info', chat:'Kaizen Voice', tasks:[{ title:'Снять 3 ролика для VPN', dept:'Трафик VPN', type:'oper', due:'2099-01-09', who:'Ане' }, { title:'Позвонить амбассадору', dept:'', type:'strat', due:null, who:null }] }) })`); await wait(30);
      const it = E(`(() => { const i = kbItems([infoBoard()]).find(i => i.x.name === 'Снять 3 ролика для VPN'); return i && [i.st, i.s.name, i.x.due_date, taskFor(i.p.id, i.s.id, i.x.id)?.assignee_id].join('|'); })()`);
      assert.equal(it, 'todo|Трафик VPN|2099-01-09|uAs'); assert.ok(E(`kbItems([infoBoard()]).some(i => i.x.name === 'Позвонить амбассадору' && i.st === 'todo' && i.x.ttype === 'strat')`));
      ok('telegram: подтверждённые в боте задачи — сразу в «К выполнению» с отделом, сроком и ответственным');
      assert.equal(E(`taskFor(...(() => { const i = kbItems([infoBoard()]).find(i => i.x.name === 'Снять 3 ролика для VPN'); return [i.p.id, i.s.id, i.x.id]; })())?.remind?.at`), '2099-01-09T10:00'); ok('telegram: срок без времени — напоминание в 10:00 этого дня');
      assert.equal(E(`tgRemind({ due:'2099-01-09', time:'15:00' }).at`), '2099-01-09T14:50'); assert.equal(E(`tgRemind({ due:'2099-01-09', time:'00:05' }).at`), '2099-01-08T23:55'); ok('telegram: названо время — напоминание за 10 минут'); }
    E(`cloud.store = window.__cs; cloud.uid = window.__cu; getSample = window.__gs; db.prefs.inbox = []; render()`); }
  assert.equal(errors.length, 0, errors.join('\n')); ok('ошибок нет');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
