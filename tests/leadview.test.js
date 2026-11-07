// Руководитель видит актуальные статусы этапов, которые меняют исполнители, — и старая копия со своего телефона их не откатывает
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
  const be = makeBackend();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', T = 'cccccccc-0000-0000-0000-000000000003';
  be.profiles.set(T, { id: T, name: 'Тимур Исполнитель', email: 't@x.y', avatar_url: '', job_title: '', contact: '' });
  const own = openApp(be, A, 'https://kz.test/', { meta: { name: 'Владелец' } }); await wait(4500);
  const D = own.w.document, $ = s => D.querySelector(s);
  D.querySelector('[data-view="team"]').click(); await wait(100); $('[data-invite]').click(); await wait(50);
  $('#iName').value = 'Тимур Исполнитель'; $('#iEmail').value = 't@x.y';
  $('#iForm').dispatchEvent(new own.w.Event('submit', { bubbles: true, cancelable: true })); await wait(800);
  const link = $('#tlIn').value; $('[data-close]').click(); await wait(50);
  const wk = openApp(be, T, link, { meta: { name: 'Тимур Исполнитель' } }); await wait(6000);
  const tu = own.w.eval(`db.users.find(u => u.account_id === '${T}')`);
  const O = x => own.w.eval(x), W = x => wk.w.eval(x);
  const pid = O(`db.projects.find(p => p.state === 'active' && currentStage(p) && !isMaint(currentStage(p)) && (currentStage(p).subs || []).length && p.stages.filter(s => !isMaint(s)).indexOf(currentStage(p)) < p.stages.filter(s => !isMaint(s)).length - 1).id`);
  O(`(() => { const p = projById('${pid}'); p.stages.forEach(s => { if (!isMaint(s)) s.assignee_id = '${tu.id}'; }); commit(); })()`); await wait(4000);
  assert.ok(W(`!!projById('${pid}')`)); ok('исполнитель видит проект');
  const sid = O(`currentStage(projById('${pid}')).id`);
  const stale = O(`JSON.stringify({ p:projById('${pid}'), t:db.tasks.filter(t => t.project_id === '${pid}') })`);   // так проект выглядел на телефоне руководителя
  // исполнитель отмечает все пункты карточек текущего этапа — этап закрывается, следующий в работе
  W(`(() => { const p = projById('${pid}'); const s = p.stages.find(x => x.id === '${sid}'); s.gate = false; (s.subs || []).forEach(x => { x.files = false; });
    ext.tasks.filter(t => t.project_id === p.id && t.stage_id === s.id).forEach(t => { t.checklist.forEach(i => { i.done = true; i.completed_at = new Date().toISOString(); }); syncTaskToSub(t); });
    (s.subs || []).forEach(x => { if (!x.done) toggleSub(p, s, x, true); }); queueAutoClose(p.id); save(); })()`);
  await wait(5000);
  const stOf = E => E(`projById('${pid}').stages.find(s => s.id === '${sid}').status`);
  assert.equal(stOf(W), 'done'); ok('у исполнителя этап закрыт');
  assert.equal(stOf(O), 'done'); ok('у руководителя этап закрыт');
  // телефон руководителя со старой копией сохранил проект в своё облако — компьютер получил эту копию
  O(`(() => { const st = JSON.parse(${JSON.stringify(stale)}); const r = { meta:{ ...metaOf(), savedAt:Date.now() }, reports:db.reports,
    projects:db.projects.map(p => p.id === '${pid}' ? st.p : JSON.parse(JSON.stringify(p))),
    tasks:[...db.tasks.filter(t => t.project_id !== '${pid}').map(t => JSON.parse(JSON.stringify(t))), ...st.t] }; cloudApply(r); })()`);
  assert.equal(stOf(O), 'done'); ok('старая копия со своего телефона не откатила этап у руководителя');
  assert.ok(O(`projById('${pid}').stages.find(s => s.id === '${sid}').subs.every(x => x.done)`)); ok('отметки исполнителя на месте');
  assert.ok(O(`db.tasks.filter(t => t.project_id === '${pid}' && t.stage_id === '${sid}').every(t => t.checklist.every(i => i.done))`)); ok('пункты карточек исполнителя на месте');
  // даже если прежняя копия у руководителя уже была старой — свежее берётся из общего документа
  O(`(() => { const st = JSON.parse(${JSON.stringify(stale)}); db.projects = db.projects.map(p => p.id === '${pid}' ? st.p : p);
    const r = { meta:{ ...metaOf(), savedAt:Date.now() }, reports:db.reports, projects:db.projects.map(p => JSON.parse(JSON.stringify(p))), tasks:db.tasks.map(t => JSON.parse(JSON.stringify(t))) }; cloudApply(r); })()`);
  assert.equal(stOf(O), 'done'); ok('уже откатившийся этап восстанавливается из общего документа');
  await wait(3000);
  assert.equal(stOf(W), 'done'); ok('у исполнителя по-прежнему закрыт');
  { // руководитель принял все материалы этапа — этап закрыт, следующий в работе
    const q = O(`db.projects.find(p => p.id !== '${pid}' && p.state === 'active' && currentStage(p) && !isMaint(currentStage(p)) && (currentStage(p).subs || []).length >= 2 && p.stages.indexOf(currentStage(p)) < p.stages.length - 2).id`);
    const qs = O(`currentStage(projById('${q}')).id`);
    O(`(() => { const p = projById('${q}'), s = p.stages.find(x => x.id === '${qs}'); s.gate = true;
      s.subs.forEach((x, i) => { x.files = true; let t = taskFor(p.id, s.id, x.id);
        if (!t){ t = makeTask({ project_id:p.id, stage_id:s.id, substage_id:x.id, title:x.name, checklist:[{ id:'c'+i, text:'Сделать', done:false }] }); db.tasks.push(t); }
        t.mats = [{ id:'m'+i, kind:'link', url:'https://x.y/'+i, name:'Файл '+i, by:'w', byName:'Влад', at:new Date().toISOString() }]; });
      save(); })()`);
    const tids = JSON.parse(O(`JSON.stringify(db.tasks.filter(t => t.project_id === '${q}' && t.stage_id === '${qs}').map(t => t.id + '|' + t.mats[0].id))`));
    for (const k of tids){ const b = D.createElement('button'); b.dataset.matok = k; b.dataset.v = '1'; D.body.appendChild(b); b.click(); b.remove(); await wait(30); }
    await wait(200);
    assert.equal(O(`projById('${q}').stages.find(x => x.id === '${qs}').status`), 'done'); ok('приняты все материалы этапа — этап закрыт');
    assert.notEqual(O(`currentStage(projById('${q}')).id`), '${qs}'); ok('следующий этап — в работе');
  }
  { // материалы приняты раньше (до обновления), этап остался открытым — закрывается, когда придут данные
    const q = O(`db.projects.find(p => p.state === 'active' && shareCount(p) && currentStage(p) && !isMaint(currentStage(p)) && (currentStage(p).subs || []).length && p.stages.indexOf(currentStage(p)) < p.stages.length - 2)?.id || ''`);
    if (q){
      const qs = O(`currentStage(projById('${q}')).id`);
      O(`(() => { const p = projById('${q}'), s = p.stages.find(x => x.id === '${qs}'); s.gate = true;
        s.subs.forEach((x, i) => { x.files = true; x.done = true; let t = taskFor(p.id, s.id, x.id);
          if (!t){ t = makeTask({ project_id:p.id, stage_id:s.id, substage_id:x.id, title:x.name, checklist:[] }); db.tasks.push(t); }
          t.mats = [{ id:'n'+i, kind:'link', url:'https://x.y/'+i, name:'Ф'+i, at:new Date().toISOString(), ok:true, okBy:'Я', okAt:new Date().toISOString() }]; });
        localSave(); })()`);
      O(`autoCloseStages(projById('${q}'), true)`); await wait(100);
      assert.equal(O(`projById('${q}').stages.find(x => x.id === '${qs}').status`), 'done'); ok('принятые раньше материалы закрывают этап');
    }
  }
  { // у исполнителя старое приложение: отметил всё, но этап не закрыл — у руководителя этап закрывается сам или уходит в «Приёмку»
    const sid2 = O(`currentStage(projById('${pid}')).id`);
    if (O(`!isMaint(currentStage(projById('${pid}'))) && (currentStage(projById('${pid}')).subs || []).length > 0`)){
      W(`(() => { const p = projById('${pid}'), s = p.stages.find(x => x.id === '${sid2}'); s.gate = true;
        ext.tasks.filter(t => t.project_id === p.id && t.stage_id === s.id).forEach(t => { t.checklist.forEach(i => { i.done = true; i.completed_at = new Date().toISOString(); }); syncTaskToSub(t); });
        s.subs.forEach(x => { x.done = true; }); save(); })()`);
      await wait(5000);
      assert.equal(O(`projById('${pid}').stages.find(x => x.id === '${sid2}').sub?.status`), 'pending'); ok('этап с приёмкой: у руководителя он в «Приёмке»');
      assert.notEqual(O(`projById('${pid}').stages.find(x => x.id === '${sid2}').status`), 'done'); ok('и без приёмки сам не закрылся');
    }
  }
  assert.equal(own.errors.length + wk.errors.length, 0, own.errors.concat(wk.errors).join('\n')); ok('ошибок нет');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
