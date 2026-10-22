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
  const errors = []; const reloads = [];
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
      w.kzReloadHook = () => reloads.push(1);
      if (keepStorage) for (const k in keepStorage) w.localStorage.setItem(k, keepStorage[k]);
    }
  });
  return { dom, w: dom.window, errors, reloads };
}
(async () => {
  const be = makeBackend(); const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const o = openApp(be, A); await wait(4500); const w = o.w, E = s => w.eval(s);
  const D = w.document, $ = s => D.querySelector(s), $$ = s => [...D.querySelectorAll(s)];
  const fire = (el, t) => el.dispatchEvent(new w.Event(t, { bubbles: true, cancelable: true }));
  // 1) создание проекта с галочкой ведения
  $('#newBtn').click(); await wait(100);
  assert.ok($('#cMaint') && /абонентского ведения/.test($('.maint-check').textContent) && /перейдёт на этап регулярных задач/.test($('.maint-check').textContent)); ok('форма проекта: галочка «Перевести проект на этап абонентского ведения» с подсказкой');
  $('#cName').value = 'Ведение клиники'; $('#cClient').value = 'Клиника'; $('#cMaint').checked = true;
  $('#cForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await wait(200);
  const pid = E(`db.projects.find(p => p.name === 'Ведение клиники').id`);
  const P = () => E(`JSON.parse(JSON.stringify(projById('${pid}')))`);
  assert.ok(P().is_maintenance); ok('флаг «на ведении» сохранён в проекте');
  assert.ok(isLastMaint(P()) && P().stages.at(-1).status === 'not_started'); ok('в конце цепочки — этап «Ведение / Поддержка», пока не начат');
  // 2) регулярные задачи можно подготовить заранее, руководителем
  w.openProject(pid); await wait(150);
  assert.ok($('.stg-maint .rt-block') && $('.stg-maint [data-radd]')); ok('в карточке проекта блок «Регулярные задачи (абонентка)» и «+ Добавить регулярную задачу»');
  $('.stg-maint [data-radd]').click(); await wait(100);
  $('#rtTitle').value = 'Еженедельный отчёт по ROMI'; $('#rtFreq').value = 'weekly'; const due0 = E('addDays(today(), 2)'); $('#rtDue').value = due0;
  $('#rtForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await wait(150);
  $('.stg-maint [data-radd]').click(); await wait(100);
  $('#rtTitle').value = 'Ежемесячный отчёт клиенту'; $('#rtFreq').value = 'monthly'; $('#rtDue').value = '2026-10-31';
  $('#rtForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await wait(150);
  const rts = P().stages.at(-1).rtasks;
  assert.equal(rts.length, 2); assert.ok(rts.every(r => r.id && r.project_id === pid && r.title && r.frequency && r.status === 'todo' && r.due_date && r.created_at && r.updated_at)); ok('регулярные задачи: название, частота, статус, срок цикла, время создания');
  w.closeLayer(); await wait(50);
  // 3) прохождение воронки: проект не закрывается, а переходит на ведение
  E(`(() => { const p = projById('${pid}'); const real = p.stages.filter(s => !isMaint(s)); setStatus(p, real.at(-1), 'in_progress'); setStatus(p, real.at(-1), 'done'); })()`); await wait(100);
  assert.equal(P().state, 'active'); ok('после завершения воронки проект не закрыт');
  assert.ok(isLastMaint(P()) && P().stages.at(-1).status === 'in_progress'); ok('проект автоматически перешёл на этап «Ведение / Поддержка»');
  assert.ok(P().stages.filter(s => s.system !== 'maint').every(s => s.status === 'done')); ok('все этапы воронки завершены');
  // 4) канбан: колонка «Ведение» с регулярными задачами
  D.querySelector('.tabs [data-view="kanban"]').click(); await wait(100);
  const tplId = P().template_id; const sel = $('#kbTpl'); sel.value = tplId; fire(sel, 'change'); await wait(100);
  const mc = $('[data-col="maint"]');
  assert.ok(mc && /Ведение/.test(mc.querySelector('h3').textContent)); ok('канбан: финальная колонка «Ведение»');
  const card = mc.querySelector(`[data-card="${pid}"]`);
  assert.ok(card && card.querySelectorAll('.rt-row').length === 2 && card.querySelector('[data-radd]')); ok('карточка на ведении: список регулярных задач и «+ Добавить регулярную задачу»');
  assert.ok(!$('[data-col="done"]').querySelector(`[data-card="${pid}"]`)); ok('проект на ведении не попал в «Завершены»');
  // 5) отметка выполнения — задача уходит на следующий цикл
  const romi = () => P().stages.at(-1).rtasks.find(r => r.title.includes('ROMI'));
  const chk = [...card.querySelectorAll('.rt-row')].find(r => r.textContent.includes('ROMI')).querySelector('.rt-chk');
  chk.checked = true; fire(chk, 'change'); await wait(150);
  assert.equal(romi().due_date, E(`addDays('${due0}', 7)`)); ok('отметили — срок переехал на следующую неделю');
  assert.ok(romi().done_count === 1 && romi().last_done === E('today()') && romi().status === 'todo'); ok('цикл засчитан, задача снова «к выполнению»');
  E(`(() => { const r = projById('${pid}').stages.at(-1).rtasks.find(r => r.frequency === 'monthly'); completeRtask(projById('${pid}'), r); })()`);
  assert.equal(P().stages.at(-1).rtasks.find(r => r.frequency === 'monthly').due_date, '2026-11-30'); ok('ежемесячная — на месяц вперёд');
  // 6) регулярные задачи в задачах исполнителя и в «Поручениях»
  E(`(() => { const p = projById('${pid}'); p.stages.at(-1).rtasks.forEach(r => r.assignee_id = ME); commit(); })()`);
  D.querySelector('.tabs [data-view="production"]').click(); await wait(100); $('[data-pmode="tasks"]').click(); await wait(150);
  assert.ok(!$$('.td-chk[data-tddone^="r|"]').length && $('[data-todotab="m"]')); ok('«Мои задачи»: регулярные задачи не смешаны с обычными, есть вкладка «Ведение»');
  $('[data-todotab="m"]').click(); await wait(100);
  assert.ok($$('.td-chk[data-tddone^="r|"]').length === 2 && $$('.td-row').length === 2); ok('вкладка «Ведение»: только регулярные задачи');
  $('[data-todotab="t"]').click(); await wait(50);
  D.querySelector('.tabs [data-view="assign"]').click(); await wait(150); $('[data-dtall="1"]')?.click(); await wait(100);
  assert.ok(!$$('.dt-r').length); ok('«Поручения»: в общих вкладках регулярных задач нет');
  $('[data-daytab="m"]').click(); await wait(100);
  assert.ok($(`[data-mproj="${pid}"]`) && $$(`[data-mproj="${pid}"] .rt-row`).length === 2 && $(`[data-mproj="${pid}"] [data-radd]`)); ok('«Поручения → Ведение»: проект, его регулярные задачи и постановка новой');
  // цвет ведения отличается от «В работе»
  E(`(() => { const ms = projById('${pid}').stages.at(-1); ms.rtasks.forEach(r => r.due_date = addDays(today(), 9)); commit(); })()`);
  assert.equal(E(`health(projById('${pid}').stages.at(-1)).key`), 'maint'); ok('статус ведения — свой («maint»), не «В работе»');
  const cm = w.getComputedStyle($(`[data-mproj="${pid}"] .st-pill`)).color, cg = E(`getComputedStyle(document.documentElement).getPropertyValue('--g')`);
  assert.ok(cm && !/74, 222, 128|21, 128, 61/.test(cm)); ok('цвет ведения отличается от зелёного «В работе»');
  // 7) выключили ведение — проект завершается
  E(`(() => { const p = projById('${pid}'); p.is_maintenance = false; syncState(p); commit(); })()`);
  assert.ok(!P().stages.some(s => s.system === 'maint') && P().state === 'completed'); ok('ведение выключено — этап убран, проект завершён');
  // 8) синхронизация шаблона не трогает этап ведения
  E(`(() => { const p = projById('${pid}'); p.is_maintenance = true; syncState(p); syncAllTemplates(); })()`);
  assert.ok(isLastMaint(P()) && P().state === 'active'); ok('этап ведения переживает синхронизацию с шаблоном');
  assert.equal(o.errors.length, 0, o.errors.join('\n')); ok('ошибок нет');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
function isLastMaint(p){ return p.stages.at(-1)?.system === 'maint' && p.stages.filter(s => s.system === 'maint').length === 1; }
