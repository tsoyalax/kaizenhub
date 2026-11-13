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
  const xid = E('contentStage().subs[0].id');
  const cb = D.querySelector(`[data-ctdone="${xid}"]`); cb.checked = true; cb.dispatchEvent(new w.Event('change', { bubbles:true })); await wait(50);
  assert.ok(E(`projById('infoboard').stages.find(s => s.id === contentStage().id).subs[0].done`)); ok('отметка «опубликовано» — это отметка карточки на доске');
  assert.equal(E('ctStats(ctCur()).pub'), 1); ok('факт считается по отметкам');
  E(`ui.view = 'production'; render()`);
  assert.equal(D.querySelectorAll('.pf-card.done').length, 1); ok('на доске карточка тоже отмечена');
  E(`db.prefs.kind = 'agency'; render()`);
  assert.ok(!D.querySelector('.tabs [data-view="matrix"]').hidden); ok('в агентстве матрица на месте');
  assert.equal(errors.length, 0, errors.join('\n')); ok('ошибок нет');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
