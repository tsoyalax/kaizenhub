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
    }
  });
  return { dom, w: dom.window, errors };
}
(async () => {
  const be = makeBackend();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', G = 'dddddddd-0000-0000-0000-000000000004';
  const $ = (o, s) => o.w.document.querySelector(s);
  const E = (o, js) => o.w.eval(js);
  const own = openApp(be, A, 'https://kz.test/', { meta: { name: 'Owner A' } });
  await wait(4500);

  // в шаблоне: текущий этап проекта — «запрос перехода», его первый подэтап — «материалы»
  const pid = E(own, `db.projects.find(p => p.state === 'active' && currentStage(p) && currentStage(p).status === 'in_progress' && currentStage(p).tsid && (currentStage(p).subs || []).length).id`);
  E(own, `(() => { const p = projById('${pid}'); const t = tplById(p.template_id); const ts = t.stages.find(x => x.id === currentStage(p).tsid);
    ts.gate = true; ts.subs[0].files = true; syncAllTemplates(t.id); commit(); })()`);
  const sid = E(own, `currentStage(projById('${pid}')).id`), xid = E(own, `currentStage(projById('${pid}')).subs[0].id`);
  assert.ok(E(own, `currentStage(projById('${pid}')).gate && currentStage(projById('${pid}')).subs[0].files`)); ok('флаги шаблона перенеслись в проект');
  E(own, `ui.view = 'templates'; ui.setTab = 'templates'; ui.tplOpen = {}; render()`); await wait(100);
  assert.ok($(own, '.trow input[data-f="gate"]')); ok('шаблон: у этапа галочка «запрос перехода»');
  $(own, '[data-tsubtog]').click(); await wait(50);
  assert.ok($(own, '.tsub input[data-sfiles]')); ok('шаблон: у подэтапа галочка «материалы»');

  // исполнитель входит по ссылке на проект
  await own.w.createLink(pid, 'worker'); await wait(600);
  const code = [...be.rows.values()].find(r => r.path.startsWith('inv/') && r.data.pid === pid).path.slice(4);
  const gw = openApp(be, G, 'https://kz.test/?invite=' + code, { meta: { role: 'guest', name: 'Гоша Исполнитель' } });
  await wait(4500);
  E(gw, `ui.view = 'mine'; ui.myProject = '${pid}'; render()`); await wait(150);
  const stSel = $(gw, `select[data-mstatus="${pid}|${sid}"]`);
  assert.ok(stSel && ![...stSel.options].some(o => o.value === 'done')); ok('исполнитель: на этапе с запросом нельзя самому поставить «Завершён»');
  assert.ok($(gw, `[data-gatereq="${pid}|${sid}"]`)); ok('исполнитель: есть кнопка «Запросить переход на следующий этап»');

  // материалы: подэтап без задачи — кнопка «Прикрепить материалы» создаёт карточку
  $(gw, `.pf-mat[data-pfsub="${sid}|${xid}"]`)?.click() || $(gw, `[data-pfsub="${sid}|${xid}"]`).click(); await wait(200);
  assert.ok($(gw, '.tk-mats') && $(gw, '[data-matfile]')); ok('исполнитель: в подэтапе блок «Материалы» с загрузкой файла');
  const li = $(gw, '[data-matlink] input'); li.value = 'https://drive.google.com/file/xyz';
  li.form.dispatchEvent(new gw.w.Event('submit', { bubbles: true, cancelable: true })); await wait(100);
  assert.equal($(gw, '.tk-mats').querySelectorAll('.mat').length, 1); ok('исполнитель: ссылка на материал прикреплена');
  // файлы с русскими названиями: хранилище принимает только латиницу — путь переводится, название остаётся
  assert.equal(E(gw, `safeFileName('Бриф клиента (финал).pdf')`), 'Brif_klienta_final_.pdf'.replace('_.pdf', '.pdf')); ok('имя файла для хранилища — латиницей');
  assert.ok(/^[A-Za-z0-9._-]+$/.test(E(gw, `safeFileName('Қазақ тілі — ТЗ №2.docx')`))); ok('казахские буквы и знаки тоже переводятся');
  { const tid = E(gw, `taskFor('${pid}', '${sid}', '${xid}').id`);
    await E(gw, `uploadMats(taskById('${tid}'), [new File(['a'], 'Бриф клиента.pdf'), new File(['b'], 'Сценарий №1.docx')])`); await wait(100);
    const names = E(gw, `taskById('${tid}').mats.filter(m => m.kind === 'file').map(m => m.name)`);
    assert.deepEqual(names, ['Бриф клиента.pdf', 'Сценарий №1.docx']); ok('исполнитель загрузил сразу два файла с русскими названиями');
    assert.ok(E(gw, `taskById('${tid}').mats.filter(m => m.kind === 'file').every(m => /^[A-Za-z0-9._\/-]+$/.test(m.path))`)); ok('пути файлов в хранилище — латиницей');
    assert.equal($(gw, '.tk-mats').querySelectorAll('.mat').length, 3); ok('в «Сдаче работы» видны все три материала'); }
  $(gw, '[data-tclose]').click(); await wait(2500);
  assert.equal(E(own, `(taskFor('${pid}', '${sid}', '${xid}')?.mats || []).length`), 3); ok('руководитель видит материалы исполнителя');
  // руководитель принимает файл
  E(own, `openTask(taskFor('${pid}', '${sid}', '${xid}').id)`); await wait(50);
  assert.ok($(own, '.tk-mats [data-matok][data-v="1"]')); ok('у руководителя кнопка «Принять» у материала');
  $(own, '.tk-mats [data-matok][data-v="1"]').click(); await wait(50);
  assert.ok($(own, '.tk-mats .mat-ok') && E(own, `taskFor('${pid}', '${sid}', '${xid}').mats.some(m => m.ok)`)); ok('материал принят, отметка «Принято»');
  E(own, 'closeTask()'); await wait(2500);
  E(gw, `openTask(taskFor('${pid}', '${sid}', '${xid}').id)`); await wait(50);
  assert.ok($(gw, '.tk-mats .mat-ok') && !$(gw, '.tk-mats [data-matok]')); ok('исполнитель видит «Принято», сам принять не может');
  E(gw, 'closeTask()'); await wait(50);
  assert.equal(E(own, `taskFor('${pid}', '${sid}', '${xid}').mats[0].byName`), 'Гоша Исполнитель'); ok('у материала подписан автор');

  // запрос на переход → руководитель возвращает → снова запрос → одобряет
  $(gw, `[data-gatereq="${pid}|${sid}"]`).click(); await wait(50);
  $(gw, '#gateTx').value = 'Всё готово';
  $(gw, '#gateF').dispatchEvent(new gw.w.Event('submit', { bubbles: true, cancelable: true })); await wait(100);
  assert.ok($(gw, '.gate.wait')); ok('исполнитель: видит «Запрос отправлен»');
  await wait(3000);
  assert.equal(E(own, 'gateRequests().length'), 1); ok('руководитель получил запрос');
  $(own, '#bell').click(); await wait(50);
  assert.ok($(own, '.pop .gate-ntf') && /Всё готово/.test($(own, '.pop .gate-ntf').textContent)); ok('запрос с комментарием — в колокольчике');
  $(own, '.pop [data-gateno]').click(); await wait(50);
  $(own, '#gateTx').value = 'Нужна ещё одна версия';
  $(own, '#gateF').dispatchEvent(new own.w.Event('submit', { bubbles: true, cancelable: true })); await wait(3000);
  E(gw, 'render()'); await wait(100);
  assert.ok($(gw, '.gate-back') && /ещё одна версия/.test($(gw, '.gate-back').textContent)); ok('исполнитель видит, что этап вернули и почему');
  $(gw, `[data-gatereq="${pid}|${sid}"]`).click(); await wait(50);
  $(gw, '#gateF').dispatchEvent(new gw.w.Event('submit', { bubbles: true, cancelable: true })); await wait(3000);
  E(own, `ui.view = 'production'; ui.prodProject = '${pid}'; render()`); await wait(100);
  assert.ok($(own, '.gate.ask [data-gateok]')); ok('запрос виден на доске проекта');
  assert.ok($(own, '.gate.ask .gate-mats .fchip') && /Сдано материалов: 3/.test($(own, '.gate.ask').textContent)); ok('в запросе на переход видны сданные материалы');
  $(own, '.gate.ask [data-gateok]').click(); await wait(3000);
  assert.equal(E(own, `projById('${pid}').stages.find(s => s.id === '${sid}').status`), 'done'); ok('одобрение закрывает этап');
  assert.notEqual(E(own, `currentStage(projById('${pid}'))?.id`), sid); ok('следующий этап — в работе (или проект завершён)');
  E(gw, 'render()'); await wait(100);
  assert.equal(E(gw, `projById('${pid}').stages.find(s => s.id === '${sid}').status`), 'done'); ok('исполнитель видит, что этап закрыт');

  // карточка проекта: галочки «Исполнителю» прямо в этапах, шаблон их не сбрасывает
  const p2 = E(own, `db.projects.find(p => p.state === 'active' && p.id !== '${pid}' && currentStage(p) && (currentStage(p).subs || []).length > 1 && !currentStage(p).gate).id`);
  E(own, `openProject('${p2}', currentStage(projById('${p2}')).id)`); await wait(200);
  const s2 = E(own, `currentStage(projById('${p2}')).id`), x2 = E(own, `currentStage(projById('${p2}')).subs[1].id`);
  assert.ok($(own, `.exec-flags [data-sgate="${s2}"]`) && $(own, `.exec-flags [data-sfilesp="${s2}|${x2}"]`)); ok('карточка проекта: в этапе блок «Исполнителю» с галочками');
  for (const sel of [`[data-sgate="${s2}"]`, `[data-sfilesp="${s2}|${x2}"]`]){ const el = $(own, sel); el.checked = true; el.dispatchEvent(new own.w.Event('change', { bubbles: true })); await wait(100); }
  E(own, `syncAllTemplates(projById('${p2}').template_id)`);
  assert.ok(E(own, `(() => { const s = projById('${p2}').stages.find(x => x.id === '${s2}'); return s.gate && s.subs.find(x => x.id === '${x2}').files; })()`)); ok('галочки из карточки проекта не сбрасываются шаблоном');
  assert.equal(own.errors.length, 0, own.errors.join('\n')); assert.equal(gw.errors.length, 0, gw.errors.join('\n')); ok('ошибок на страницах нет');
  own.w.close(); gw.w.close();
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
