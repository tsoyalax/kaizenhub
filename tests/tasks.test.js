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
const getComputedStyle_ok = w => w.getComputedStyle(w.document.getElementById('bell')).display !== 'none';
(async () => {
  const be = makeBackend();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', T = 'cccccccc-0000-0000-0000-000000000003';
  be.profiles.set(T, { id: T, name: 'Тимур Исполнитель', email: 't@x.y', avatar_url: '', job_title: '', contact: '' });
  const own = openApp(be, A, 'https://kz.test/', { meta: { name: 'Владелец' } }); await wait(4500);
  const D = own.w.document, $ = s => D.querySelector(s), $$ = s => [...D.querySelectorAll(s)];
  const fire = (el, t) => el.dispatchEvent(new own.w.Event(t, { bubbles: true, cancelable: true }));
  // исполнитель в команде (вошёл по ссылке)
  D.querySelector('[data-view="team"]').click(); await wait(100); $('[data-invite]').click(); await wait(50);
  $('#iName').value = 'Тимур Исполнитель'; $('#iEmail').value = 't@x.y';
  $('#iForm').dispatchEvent(new own.w.Event('submit', { bubbles: true, cancelable: true })); await wait(800);
  const link = $('#tlIn').value; $('[data-close]').click(); await wait(50);
  const wk = openApp(be, T, link, { meta: { name: 'Тимур Исполнитель' } }); await wait(4500);
  await wait(1500);
  const tu = own.w.eval(`db.users.find(u => u.account_id === '${T}')`); assert.ok(tu, 'исполнитель не привязан');
  // назначаем Тимура ответственным за текущий этап одного проекта
  const pid = own.w.eval(`db.projects.find(p => p.state === 'active' && currentStage(p) && (currentStage(p).subs || []).length && p.stages.indexOf(currentStage(p)) > 0).id`);
  own.w.eval(`(() => { const p = projById('${pid}'); currentStage(p).assignee_id = '${tu.id}'; commit(); })()`); await wait(2500);
  // 1) вкладка «Задачи» в «Производстве»
  D.querySelector('[data-view="production"]').click(); await wait(100); $('[data-pmode="tasks"]').click(); await wait(150);
  assert.ok($('[data-daytab="all"]') && $('[data-daytab="p"]') && $('[data-daytab="i"]')); ok('«Задачи»: подфильтры «Все (Мой день)», «Проектные», «Внутренние»');
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(D.getElementById('app').textContent)); ok('без эмодзи');
  assert.equal($('[data-daytab="all"]').getAttribute('aria-pressed'), 'true'); ok('по умолчанию — «Все (Мой день)»');
  assert.ok($('#dayWho') && $('[data-itnew]')); ok('у руководителя есть выбор исполнителя и «+ Внутренняя задача»');
  // только текущий этап
  const items = own.w.eval('dayProjectItems("").map(i => [i.p.id, i.s.id])');
  assert.ok(items.length > 0 && items.every(([p, s]) => own.w.eval(`currentStage(projById('${p}')).id`) === s)); ok('проектные задачи — только текущего этапа каждого проекта');
  const otherStage = own.w.eval(`(() => { const p = projById('${pid}'); const c = currentStage(p); return p.stages.filter(s => s !== c).flatMap(s => (s.subs || []).map(x => x.name)); })()`);
  const curNames = own.w.eval(`(currentStage(projById('${pid}')).subs || []).map(x => x.name)`);
  const shown = $$(`[data-dtproj="${pid}"] .dt-p`).map(c => c.querySelector('.dt-main b').textContent);
  assert.ok(shown.length && shown.every(n => curNames.includes(n)) && !shown.some(n => otherStage.includes(n) && !curNames.includes(n))); ok('подзадачи будущих и прошлых этапов скрыты');
  const secs = $$('[data-dtproj]');
  assert.ok(secs.length > 1 && secs.every(sc => sc.querySelectorAll('.dt-p').length && /^\d+\/\d+ /.test(sc.querySelector('.dt-ph .dt-stage').textContent))); ok('проектные задачи разложены по проектам: у каждого блок с этапом «X/N Название»');
  assert.equal(new Set(secs.map(sc => sc.dataset.dtproj)).size, secs.length); ok('каждый проект — один блок');
  // свернуть / развернуть проект
  secs[0].querySelector('[data-dtfold]').click(); await wait(100);
  assert.ok($(`[data-dtproj="${secs[0].dataset.dtproj}"]`).classList.contains('folded') && !$(`[data-dtproj="${secs[0].dataset.dtproj}"] .dt-p`)); ok('блок проекта сворачивается');
  $(`[data-dtproj="${secs[0].dataset.dtproj}"] [data-dtfold]`).click(); await wait(100);
  // срок подзадачи ставит руководитель прямо в карточке
  const dIn = $(`[data-dtproj="${pid}"] [data-dtdue]`); const dk = dIn.dataset.dtdue;
  dIn.value = '2026-11-03'; fire(dIn, 'change'); await wait(200);
  const [dkind, ...dids] = dk.split('|');
  const saved = dkind === 't' ? own.w.eval(`taskById('${dids[0]}').due_date`) : own.w.eval(`projById('${dids[0]}').stages.find(s => s.id === '${dids[1]}').subs.find(x => x.id === '${dids[2]}').due_date`);
  assert.equal(saved, '2026-11-03'); ok('руководитель ставит срок подзадаче прямо в карточке');
  assert.ok($(`[data-dtproj="${pid}"] .dt-date.own`)); ok('свой срок подзадачи виден в карточке');
  // 2) внутренняя задача
  $('[data-itnew]').click(); await wait(50);
  $('#itTitle').value = 'Подготовить договор'; $('#itDesc').value = 'Для нового сотрудника';
  $('#itWho').value = tu.id; $('#itPri').value = 'urgent'; $('#itCat').value = 'hr'; $('#itDue').value = '2026-10-25';
  fire($('#itForm'), 'submit'); await wait(800);
  const doc = [...be.rows.values()].find(r => r.path.startsWith('it/'));
  assert.ok(doc && doc.data.ownerId === A && doc.data.memberIds.includes(T) && doc.data.memberIds.includes(A)); ok('внутренняя задача сохранена: видна владельцу и исполнителю');
  const j = JSON.parse(doc.data.json);
  assert.ok(j.title === 'Подготовить договор' && j.status === 'todo' && j.priority === 'urgent' && j.category === 'hr' && j.creator_id && j.created_at); ok('поля задачи: статус по умолчанию «todo», приоритет, категория, постановщик, время');
  const ic = $$('.dt-i').find(c => c.textContent.includes('Подготовить договор'));
  assert.ok(ic && /Внутренняя · HR/.test(ic.textContent) && ic.querySelector('.pri-urgent') && ic.querySelector('[data-itstatus]')); ok('внутренняя карточка: категория, флажок «Срочно», быстрый статус');
  // фильтры
  $('[data-daytab="i"]').click(); await wait(100);
  assert.ok($$('.dt').length && $$('.dt').every(c => c.classList.contains('dt-i'))); ok('«Внутренние» — только внутренние');
  $('[data-daytab="p"]').click(); await wait(100);
  assert.ok($$('.dt').length && $$('.dt').every(c => c.classList.contains('dt-p'))); ok('«Проектные» — только проектные');
  $('[data-daytab="all"]').click(); await wait(100);
  const w2 = $('#dayWho'); w2.value = tu.id; fire(w2, 'change'); await wait(100);
  assert.ok($$('.dt').length && $$('[data-dtproj]').every(sc => sc.dataset.dtproj === pid)); ok('выбор исполнителя: видны только его задачи');
  // 3) исполнитель видит свои задачи
  await wait(1500);
  wk.w.document.querySelector('[data-minemode="tasks"]').click(); await wait(200);
  const wD = wk.w.document;
  const wTxt = wD.getElementById('app').textContent;
  assert.ok(wTxt.includes('Подготовить договор')); ok('исполнитель видит поставленную ему внутреннюю задачу');
  assert.ok(wD.querySelectorAll('.dt-p').length > 0 && [...wD.querySelectorAll('[data-dtproj]')].every(sc => sc.dataset.dtproj === pid)); ok('исполнитель видит подзадачи текущего этапа, где он ответственный, и только их');
  assert.ok(!wD.querySelector('[data-dtdue]') && /3 нояб/.test(wD.querySelector(`[data-dtproj="${pid}"]`).textContent)); ok('исполнитель видит срок подзадачи, но не меняет его');
  // уведомления исполнителю
  assert.ok(!wD.getElementById('bell').hidden && getComputedStyle_ok(wk.w)); ok('у исполнителя есть колокольчик');
  assert.ok(+(wD.querySelector('#bellCount .badge')?.textContent || 0) >= 1); ok('на колокольчике число новых задач');
  wD.getElementById('bell').click(); await wait(100);
  assert.ok(/Новые задачи/.test(wD.querySelector('.pop').textContent) && wD.querySelector('.pop').textContent.includes('Подготовить договор')); ok('в колокольчике — новая задача от руководителя');
  wD.querySelector('.pop [data-itopen]').click(); await wait(100);
  assert.ok(wD.querySelector('#itForm')); ok('из уведомления задача открывается');
  wD.querySelector('[data-close]').click(); await wait(50);
  assert.equal(wk.w.eval('myAlerts().fresh.length'), 0); ok('после просмотра новые задачи отмечены прочитанными');
  assert.ok(!wD.querySelector('[data-itnew]') && !wD.querySelector('#dayWho')); ok('исполнитель не ставит задачи и не выбирает исполнителя');
  // смена статуса исполнителем — сразу у владельца
  const ws = [...wD.querySelectorAll('[data-itstatus]')][0]; ws.value = 'in_progress'; ws.dispatchEvent(new wk.w.Event('change', { bubbles: true })); await wait(1500);
  assert.equal(JSON.parse([...be.rows.values()].find(r => r.path.startsWith('it/')).data.json).status, 'in_progress'); ok('исполнитель меняет статус');
  assert.equal(own.w.eval('IT.list[0].status'), 'in_progress'); ok('владелец сразу видит новый статус');
  wk.w.document.querySelector('.dt-i').click(); await wait(100);
  assert.ok(wk.w.document.querySelector('#itTitle').disabled && !wk.w.document.querySelector('#itDel')); ok('исполнитель не меняет задачу и не удаляет её — только статус');
  wk.w.document.querySelector('[data-close]').click(); await wait(50);
  // 4) отметка подзадачи во вкладке «Задачи» видна в воронке/проекте
  w2.value = ''; fire($('#dayWho'), 'change'); await wait(100);
  own.w.eval(`(() => { const c = currentStage(projById('${pid}')); c.subs.push({ id:'xnew', name:'Позвонить клиенту', done:false }); commit(); })()`); await wait(150);
  const chk = $$('.dt-p .dt-chk:not([disabled])').find(c => c.dataset.sub.endsWith('|xnew'));
  assert.ok(chk, 'нет подзадачи без чек-листа для проверки');
  { const [p0, s0, x0] = chk.dataset.sub.split('|'); chk.checked = true; fire(chk, 'change'); await wait(200);
    assert.ok(own.w.eval(`projById('${p0}').stages.find(s => s.id === '${s0}').subs.find(x => x.id === '${x0}').done`)); ok('отметка подзадачи во «Задачах» сразу отмечена в проекте и воронке'); }
  // 5) удаление
  $$('.dt-i')[0].click(); await wait(100); $('#itDel').click(); await wait(50); $('#cfmOk').click(); await wait(800);
  assert.ok(![...be.rows.keys()].some(k => k.startsWith('it/'))); ok('руководитель удаляет задачу');
  await wait(1500);
  assert.ok(!wk.w.document.getElementById('app').textContent.includes('Подготовить договор')); ok('у исполнителя она тоже пропала');
  assert.equal(own.errors.length + wk.errors.length, 0, own.errors.concat(wk.errors).join('\n')); ok('ошибок нет');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
