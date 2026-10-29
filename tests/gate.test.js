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
  // у подэтапов с карточкой в шаблоне исполнитель сразу видит полную карточку, а не голую галочку
  E(own, `(() => { const p = projById('${pid}'); db.cardTpls = db.cardTpls || {}; p.stages.filter(s => !isMaint(s) && s.status !== 'done').slice(-2).forEach(s => (s.subs || []).slice(0, 2).forEach(x => { db.cardTpls[cardKey(p.template_id, x.name)] = { sub:x.name, d:'Цель — сделать по регламенту', c:['Пункт 1', 'Пункт 2'], b:[] }; })); commit(); })()`); await wait(2500);
  { const info = E(own, `(() => { const p = projById('${pid}'); const out = []; p.stages.forEach(s => { if (isMaint(s)) return; (s.subs || []).forEach(x => { if (cardTplFor(p, x.name)) out.push([s.id, x.id, !!taskFor(p.id, s.id, x.id)]); }); }); return out; })()`);
    assert.ok(info.length && info.every(r => r[2]), JSON.stringify([info, E(own, 'Object.keys(db.cardTpls||{}).length'), E(own, `tplById(projById('${pid}').template_id).id`), E(own, 'ownShared().map(p=>p.id)'), E(own, `'${pid}'`)])); ok(`задачи созданы для всех подэтапов с карточкой (${info.length})`);
    E(gw, `ui.view = 'mine'; ui.myProject = '${pid}'; render()`); await wait(100);
    assert.ok(info.every(([sid2, xid2]) => gw.w.document.querySelector(`button.pf-card[data-pfsub="${sid2}|${xid2}"]`) && !gw.w.document.querySelector(`.pf-tick input[data-sub$="|${xid2}"]`))); ok('исполнитель видит полные карточки, а не галочку «Отметьте, когда сделаете»'); }
  E(gw, `ui.view = 'mine'; ui.myProject = '${pid}'; render()`); await wait(150);
  const stSel = $(gw, `select[data-mstatus="${pid}|${sid}"]`);
  assert.ok(stSel && ![...stSel.options].some(o => o.value === 'done')); ok('исполнитель: на этапе с запросом нельзя самому поставить «Завершён»');
  assert.ok($(gw, `[data-ssfile="${pid}|${sid}"]`) && $(gw, `[data-sssend="${pid}|${sid}"]`) && !$(gw, '[data-gatereq]')); ok('исполнитель: под текущим этапом блок «Сдать этап»');
  assert.ok(!$(gw, '.pf-mat')); ok('на доске исполнителя нет ссылок «Прикрепить материалы» у подэтапов');
  // отметка «материалы» через интерфейс шаблона: галочка → «Сохранить шаблон» → исполнитель может прикрепить файлы
  { const tId = E(own, `projById('${pid}').template_id`);
    const nxt = E(own, `(() => { const p = projById('${pid}'); const c = p.stages.find(st => st.tsid && !isMaint(st) && (st.subs || []).length && st.subs[0].tsub && !st.subs[0].files); return c ? { sid:c.id, xid:c.subs[0].id, tsid:c.tsid, tsub:c.subs[0].tsub } : null; })()`);
    assert.ok(nxt, 'нет подходящего этапа для проверки'); if (nxt){
      E(own, `ui.view = 'templates'; ui.setTab = 'templates'; ui.tplSel = '${tId}'; ui.draft = null; ui.tplOpen = {}; render()`); await wait(80);
      const si = E(own, `ui.draft.stages.findIndex(s => s.id === '${nxt.tsid}')`);
      own.w.document.querySelector(`[data-tsubtog="${nxt.tsid}"]`).click(); await wait(50);
      const cb = own.w.document.querySelector(`.tsub[data-i="${si}"][data-j="0"] input[data-sfiles]`);
      cb.checked = !cb.checked || true; cb.checked = true; cb.dispatchEvent(new own.w.Event('change', { bubbles: true })); await wait(30);
      $(own, '#tSave').click(); await wait(3000);
      assert.ok(E(own, `tplById('${tId}').stages.find(s => s.id === '${nxt.tsid}').subs.find(x => x.id === '${nxt.tsub}').files`)); ok('шаблон: отметка «материалы» сохраняется кнопкой «Сохранить шаблон»');
      assert.ok(E(own, `projById('${pid}').stages.find(s => s.id === '${nxt.sid}').subs.find(x => x.id === '${nxt.xid}').files`)); ok('отметка из шаблона дошла до проекта');
      E(gw, 'render()'); await wait(50);
      assert.ok(E(gw, `projById('${pid}').stages.find(s => s.id === '${nxt.sid}').subs.find(x => x.id === '${nxt.xid}').files`)); ok('отметка из шаблона дошла до исполнителя');
      E(gw, `ui.view = 'mine'; ui.myProject = '${pid}'; render()`); await wait(80);
      if (!E(gw, `!!taskFor('${pid}', '${nxt.sid}', '${nxt.xid}')`)) E(gw, `(() => { const p = projById('${pid}'); const s = p.stages.find(x => x.id === '${nxt.sid}'); tasksFromSubs(p, { ...s, subs:s.subs.filter(x => x.id === '${nxt.xid}') }); commit(); })()`);
      E(gw, `openTask(taskFor('${pid}', '${nxt.sid}', '${nxt.xid}').id)`); await wait(150);
      assert.ok($(gw, '.tk-mats [data-matfile]')); ok('исполнитель: в карточке этого подэтапа можно прикрепить файлы');
      E(gw, 'closeTask()');
    }
  }

  // материалы: подэтап без задачи — кнопка «Прикрепить материалы» создаёт карточку
  if (!E(gw, `!!taskFor('${pid}', '${sid}', '${xid}')`)) E(gw, `(() => { const p = projById('${pid}'); const s = p.stages.find(x => x.id === '${sid}'); tasksFromSubs(p, { ...s, subs:s.subs.filter(x => x.id === '${xid}') }); commit(); })()`);
  E(gw, `openTask(taskFor('${pid}', '${sid}', '${xid}').id)`); await wait(200);
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
  // руководитель, которому проект открыли ссылкой: видит материалы в колокольчике и может принять
  await own.w.createLink(pid, 'lead'); await wait(600);
  const lcode = [...be.rows.values()].filter(r => r.path.startsWith('inv/') && r.data.pid === pid && r.data.role === 'lead').map(r => r.path.slice(4))[0];
  const L = 'eeeeeeee-0000-0000-0000-000000000005';
  const ld = openApp(be, L, 'https://kz.test/?invite=' + lcode, { meta: { role: 'guest', name: 'Лена Руководитель' } });
  await wait(4500);
  assert.equal(E(ld, `roleOf(projById('${pid}'))`), 'lead'); ok('руководитель по ссылке: роль «Руководитель» в проекте');
  assert.equal(E(ld, 'matsToReview().length'), 3); ok('руководитель по ссылке: 3 материала на проверку');
  $(ld, '#bell').click(); await wait(50);
  assert.ok(/Материалы на проверку/.test($(ld, '.pop').textContent) && $(ld, `.pop .ntf[data-task]`)); ok('в колокольчике раздел «Материалы на проверку»');
  $(ld, '.pop .ntf[data-task]').click(); await wait(80);
  assert.ok($(ld, '.tk-mats [data-matok][data-v="1"]')); ok('руководитель по ссылке может принять материал');
  E(ld, 'closeTask()'); E(ld, 'closeLayer()');
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

  // сдача этапа: исполнитель разом загружает сделанное → руководитель возвращает → снова сдаёт → «Принять этап»
  E(gw, `ui.view = 'mine'; ui.myProject = '${pid}'; render()`); await wait(50);
  assert.ok($(gw, `[data-sssend="${pid}|${sid}"]`).disabled); ok('«Отправить на проверку» неактивна, пока ничего не прикреплено');
  await E(gw, `ssUpload(projById('${pid}'), projById('${pid}').stages.find(s => s.id === '${sid}'), [new File(['a'], 'Итог этапа.pdf'), new File(['b'], 'Видео монтаж.mp4')])`); await wait(100);
  { const li = $(gw, `[data-sslink="${pid}|${sid}"] input`); li.value = 'https://drive.google.com/folder/abc'; li.form.dispatchEvent(new gw.w.Event('submit', { bubbles: true, cancelable: true })); await wait(80); }
  assert.equal(gw.w.document.querySelectorAll(`[data-ssdrop="${pid}|${sid}"] .ss-items li`).length, 3); ok('в «Сдать этап» два файла с русскими названиями и ссылка');
  $(gw, `#ssnote-${sid}`).value = 'Всё готово';
  $(gw, `[data-sssend="${pid}|${sid}"]`).click(); await wait(100);
  assert.ok($(gw, '.ss-wait')); ok('исполнитель: «Этап сдан на проверку»');
  await wait(3000);
  assert.equal(E(own, 'stageSubmissions().length'), 1); ok('руководитель получил сдачу этапа');
  E(own, `ui.view = 'review'; ui.revTab = 'pending'; render()`); await wait(50);
  assert.ok($(own, '.tabs [data-view="review"]') && $(own, `.rv-card [data-ssok="${pid}|${sid}"]`) && /Всё готово/.test($(own, '.rv-card').textContent)); ok('раздел «Приёмка»: сданный этап с файлами, «Принять» и «Вернуть»');
  assert.ok(E(ld, 'guestViews().includes("review")') && E(gw, '!guestViews().includes("review")')); ok('«Приёмка» есть у руководителя по ссылке и нет у исполнителя');
  E(ld, `ui.view = 'mine'; ui.myProject = '${pid}'; render()`); await wait(100);
  assert.ok(E(ld, 'stageSubmissions().length') === 1 && $(ld, '.ss-ask [data-ssok]')); ok('руководитель по ссылке видит сдачу с «Принять этап»');
  $(own, '#bell').click(); await wait(50);
  assert.ok(/Сдача этапов/.test($(own, '.pop').textContent) && /сдал этап/.test($(own, '.pop').textContent)); ok('сдача этапа — в колокольчике');
  E(own, 'closeLayer()');
  E(own, `ui.view = 'production'; ui.prodProject = '${pid}'; render()`); await wait(100);
  assert.ok($(own, '.ss-ask .ss-items .fchip') && /Всё готово/.test($(own, '.ss-ask').textContent)); ok('под этапом у руководителя — сданные файлы и комментарий');
  $(own, '.ss-ask [data-ssno]').click(); await wait(50);
  $(own, '#gateTx').value = 'Нужна ещё одна версия';
  $(own, '#gateF').dispatchEvent(new own.w.Event('submit', { bubbles: true, cancelable: true })); await wait(3000);
  E(gw, 'render()'); await wait(100);
  assert.ok($(gw, '.ss-back') && /ещё одна версия/.test($(gw, '.ss-back').textContent) && $(gw, `[data-sssend="${pid}|${sid}"]`)); ok('исполнитель видит, что этап вернули и почему, и может сдать снова');
  $(gw, `[data-sssend="${pid}|${sid}"]`).click(); await wait(3000);
  E(own, 'render()'); await wait(100);
  $(own, '.ss-ask [data-ssok]').click(); await wait(3000);
  assert.equal(E(own, `projById('${pid}').stages.find(s => s.id === '${sid}').status`), 'done'); ok('«Принять этап» закрывает этап');
  E(own, `ui.view = 'review'; ui.revTab = 'accepted'; render()`); await wait(50);
  assert.ok($(own, '.rv-card.rv-done .rv-ok') && $(own, '.rv-card.rv-done').textContent.includes(E(own, `projById('${pid}').name`))); ok('«Приёмка» → «Принятые»: этап в истории');
  E(own, `ui.revTab = 'rejected'; render()`); await wait(30);
  assert.ok(!$(own, '.rv-card') || $(own, '.empty')); ok('«Возвращённые»: возвращённый ранее этап после повторной сдачи и приёмки там не висит');
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
  {
    E(gw, `ui.view = 'mine'; ui.myProject = '${pid}'; render()`); await wait(50);
    assert.ok(!$(gw, '.pf-add')); ok('у исполнителя на доске нет «Добавить подэтап»');
  }
  assert.equal(own.errors.length, 0, own.errors.join('\n')); assert.equal(gw.errors.length, 0, gw.errors.join('\n')); assert.equal(ld.errors.length, 0, ld.errors.join('\n')); ok('ошибок на страницах нет');
  own.w.close(); gw.w.close(); ld.w.close();
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
