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
  const be = makeBackend(); const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const ta = openApp(be, A); await wait(4500);
  const tb = openApp(be, A); await wait(3500);
  const wa = ta.w, wb = tb.w;
  const remoteProj = id => JSON.parse(be.rows.get(`data/users/${A}/p_${id}`).data.json);
  const remoteTasks = () => [...be.rows.entries()].filter(([k]) => k.startsWith(`data/users/${A}/t_`)).map(([, r]) => JSON.parse(r.data.json));
  const tplId = wa.eval(`db.projects.find(p => p.state === 'active').template_id`);
  const ids = wa.eval(`db.projects.filter(p => p.state === 'active' && p.template_id === '${tplId}').map(p => p.id)`);
  const other = wb.eval(`(db.projects.find(p => p.state === 'active' && p.template_id !== '${tplId}') || db.projects.find(p => p.template_id !== '${tplId}')).id`);
  assert.ok(ids.length >= 2 && other); ok('подготовка: несколько проектов одного процесса и проект другого');
  // 1) вкладка B правит свой проект, но ещё не отправила правку в облако
  wb.eval(`projById('${other}').name = 'Правка во вкладке B'; save(); clearTimeout(cloud.timer);`);
  assert.ok(wb.eval('cloud.pending')); ok('вкладка B: есть неотправленная правка');
  // 2) вкладка A добавляет в шаблон подэтап с карточкой
  wa.eval(`ui.view='templates'; ui.setTab='templates'; ui.tplSel='${tplId}'; render();
    ui.draft = JSON.parse(JSON.stringify(tplById('${tplId}')));
    ui.draft.stages.at(-1).subs.push({ id:'zz', name:'сайт', card:{ d:'Сделать сайт', c:['a','b','c'] } }); renderTemplates();`);
  wa.document.getElementById('tSave').click(); await wait(3000);
  const hasSite = p => p.stages.at(-1).subs.some(x => x.name === 'сайт');
  assert.ok(ids.every(id => hasSite(remoteProj(id)))); ok('вкладка A: подэтап «сайт» записан во все проекты процесса');
  // 3) вкладка B отправляет свою правку — чужие изменения не затираются
  wb.eval('flushCloud()'); await wait(3000);
  assert.ok(ids.every(id => hasSite(remoteProj(id)))); ok('вкладка B со старыми данными не стёрла подэтап из проектов');
  assert.ok(ids.every(id => remoteTasks().some(t => t.project_id === id && t.title === 'сайт' && t.checklist.length === 3))); ok('карточки «сайт» тоже на месте');
  assert.ok(wb.eval(`db.templates.find(t => t.id === '${tplId}').stages.at(-1).subs.some(x => x.name === 'сайт')`)); ok('вкладка B получила новый шаблон');
  assert.equal(remoteProj(other).name, 'Правка во вкладке B'); ok('правка вкладки B тоже сохранилась');
  assert.ok(ids.every(id => wb.eval(`projById('${id}').stages.at(-1).subs.some(x => x.name === 'сайт')`))); ok('вкладка B показывает подэтап во всех проектах');
  // 4) вкладку B закрыли с неотправленной правкой и открыли снова после изменений на A
  wb.eval(`projById('${other}').client = 'Клиент из B'; save(); clearTimeout(cloud.timer);`);
  const keep = { 'agency-pipeline-demo-v2': wb.localStorage.getItem('agency-pipeline-demo-v2'), 'agency-pipeline-demo-v2-sync': wb.localStorage.getItem('agency-pipeline-demo-v2-sync'), 'agency-pipeline-demo-v2-dirty': wb.localStorage.getItem('agency-pipeline-demo-v2-dirty') };
  wb.close();
  wa.eval(`projById('${ids[0]}').name = 'Правка во вкладке A'; commit();`); await wait(2500);
  const tc = openApp(be, A, undefined, undefined, keep); await wait(4500);
  assert.equal(remoteProj(ids[0]).name, 'Правка во вкладке A'); assert.equal(tc.w.eval(`projById('${ids[0]}').name`), 'Правка во вкладке A'); ok('повторный вход: изменения с другой вкладки не затёрты');
  assert.equal(remoteProj(other).client, 'Клиент из B'); ok('повторный вход: несохранённая правка этой вкладки дописана в облако');
  tc.w.close();
  // 5) подэтап добавили только в одном проекте и сохранили его карточку как шаблон — он появляется во всех проектах процесса
  const D = wa.document, fire = (el, t) => el.dispatchEvent(new wa.Event(t, { bubbles: true, cancelable: true }));
  const p0 = ids[0];
  wa.eval(`(() => { const p = projById('${p0}'); const s = p.stages.at(-1); s.subs.push({ id:'onlyhere', name:'лендинг', done:false });
    const t = makeTask({ project_id:p.id, stage_id:s.id, substage_id:'onlyhere', title:'лендинг', checklist:['x','y'] }); t.id = 'tkland'; db.tasks.push(t); commit(); })()`);
  wa.eval(`openTask('tkland')`); await wait(100); D.querySelector('[data-tedit]').click(); await wait(100);
  const cb = D.getElementById('tdTpl'); if (!cb.checked){ cb.checked = true; fire(cb, 'change'); }
  const desc = D.querySelector('#tdDesc') || D.querySelector('[data-td="description"]'); desc.value = 'Как делать лендинг'; fire(desc, 'input'); fire(desc, 'change');
  D.getElementById('tkForm').dispatchEvent(new wa.Event('submit', { bubbles: true, cancelable: true })); await wait(200); wa.eval('closeTask()');
  assert.ok(wa.eval(`tplById('${tplId}').stages.at(-1).subs.some(x => x.name === 'лендинг')`)); ok('подэтап из проекта попал в шаблон');
  assert.ok(ids.every(id => wa.eval(`projById('${id}').stages.at(-1).subs.some(x => x.name === 'лендинг') && db.tasks.some(t => t.project_id === '${id}' && t.title === 'лендинг' && t.checklist.length === 2)`))); ok('и во все проекты процесса — с карточкой');
  assert.ok(ids.every(id => wa.eval(`projById('${id}').stages.at(-1).subs.some(x => x.name === 'сайт')`))); ok('остальные подэтапы на месте');
  assert.equal(ta.errors.length + tb.errors.length, 0, ta.errors.concat(tb.errors).join('\n')); ok('ошибок нет');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
