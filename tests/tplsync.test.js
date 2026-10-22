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
  const D = w.document, $ = s => D.querySelector(s);
  // проекты одного шаблона: один ещё в начале, другой уже прошёл середину
  const tid = E(`db.projects.find(p => p.state === 'active').template_id`);
  E(`(() => { const ps = db.projects.filter(p => p.template_id === '${tid}' && p.state === 'active'); window.__early = ps.find(p => p.stages.indexOf(currentStage(p)) <= 1)?.id; window.__late = ps.find(p => p.stages.indexOf(currentStage(p)) >= 3)?.id; })()`);
  const early = E('window.__early'), late = E('window.__late');
  assert.ok(early && late); ok('подготовка: проект в начале и проект, прошедший середину');
  const tpl = () => E(`JSON.parse(JSON.stringify(tplById('${tid}')))`);
  const P = id => E(`JSON.parse(JSON.stringify(projById('${id}')))`);
  // 0) связи этапов с шаблоном восстанавливаются сами
  E('syncAllTemplates()');
  assert.ok(P(early).stages.every(s => s.tsid) && P(early).stages.every(s => (s.subs || []).every(x => x.tsub))); ok('этапы и подэтапы проекта связаны с шаблоном');
  // 1) пустой этап вне шаблона (как «6. 1») убирается, свой этап из проекта — нет
  E(`(() => { const p = projById('${early}'); p.stages.push({ id:'junk', position:99, name:'1', days:2, status:'not_started', subs:[], planned_start:today(), due_date:addDays(today(),2) }); })()`);
  E(`addStage(projById('${early}'))`);
  E('syncAllTemplates()');
  assert.ok(!P(early).stages.some(s => s.id === 'junk')); ok('пустой не начатый этап вне шаблона убран');
  assert.ok(P(early).stages.some(s => s.custom && s.name === 'Новый этап')); ok('этап, добавленный в проекте вручную, остался');
  // 2) переименование этапа и подэтапа в шаблоне
  const t0 = tpl(); const st2 = t0.stages[2]; const sub2 = st2.subs[0];
  const doneBefore = P(late).stages.find(s => s.tsid === st2.id).status;
  E(`(() => { const t = tplById('${tid}'); t.stages[2].name = 'Этап по-новому'; t.stages[2].subs[0].name = 'Подэтап по-новому'; syncAllTemplates(); })()`);
  const se = P(early).stages.find(s => s.tsid === st2.id), sl = P(late).stages.find(s => s.tsid === st2.id);
  assert.ok(se.name === 'Этап по-новому' && sl.name === 'Этап по-новому'); ok('переименование этапа в шаблоне — во всех идущих проектах');
  assert.equal(sl.status, doneBefore); ok('статус и прогресс этапа сохранены');
  assert.ok(se.subs.some(x => x.tsub === sub2.id && x.name === 'Подэтап по-новому')); ok('переименование подэтапа в шаблоне');
  const tkE = E(`(db.tasks.find(t => t.project_id === '${early}' && t.substage_id === '${se.subs.find(x => x.tsub === sub2.id).id}') || {}).title`);
  assert.ok(!tkE || tkE === 'Подэтап по-новому'); ok('карточка подэтапа переименована вместе с ним');
  // 3) новый этап в середине шаблона
  E(`(() => { const t = tplById('${tid}'); t.stages.splice(2, 0, { id:'tNEW', name:'Новый шаг', days:2, approval:false, subs:[{ id:'tNEWx', name:'Сделать шаг' }] }); syncAllTemplates(); })()`);
  const ie = P(early).stages.findIndex(s => s.tsid === 'tNEW');
  assert.ok(ie === 2 || (ie > 0 && P(early).stages[ie - 1].tsid === t0.stages[1].id)); ok('новый этап шаблона встал на своё место в проекте');
  assert.ok(P(early).stages[ie].subs.some(x => x.tsub === 'tNEWx')); ok('с подэтапами из шаблона');
  assert.ok(!P(late).stages.some(s => s.tsid === 'tNEW')); ok('в проект, который уже прошёл это место, этап не вставлен');
  // 4) новый подэтап
  E(`(() => { const t = tplById('${tid}'); t.stages.at(-1).subs.push({ id:'tSUBx', name:'Новый подэтап' }); syncAllTemplates(); })()`);
  assert.ok(P(early).stages.some(s => (s.subs || []).some(x => x.tsub === 'tSUBx'))); ok('новый подэтап шаблона добавлен в проекты');
  // 5) удаление этапа из шаблона
  E(`(() => { const t = tplById('${tid}'); t.stages = t.stages.filter(s => s.id !== 'tNEW'); syncAllTemplates(); })()`);
  assert.ok(!P(early).stages.some(s => s.tsid === 'tNEW')); ok('удалённый из шаблона не начатый этап убран из проектов');
  const firstId = t0.stages[0].id;
  E(`(() => { const t = tplById('${tid}'); t.stages = t.stages.filter(s => s.id !== '${firstId}'); syncAllTemplates(); })()`);
  const kept = P(late).stages.find(s => s.name === t0.stages[0].name);
  assert.ok(kept && !kept.tsid && kept.status === 'done'); ok('этап с работой остаётся в проекте, даже если его убрали из шаблона');
  // 6) этап шаблона, удалённый в проекте вручную, не возвращается
  const lastT = tpl().stages.at(-1).id;
  E(`(() => { const p = projById('${early}'); removeStage(p, p.stages.find(s => s.tsid === '${lastT}')); syncAllTemplates(); })()`);
  assert.ok(!P(early).stages.some(s => s.tsid === lastT)); ok('этап, удалённый в проекте вручную, синхронизация не возвращает');
  // 7) повторный запуск ничего не меняет
  const snap = JSON.stringify(E('db.projects.map(p => p.stages)'));
  assert.equal(E('syncAllTemplates()'), 0); assert.equal(JSON.stringify(E('db.projects.map(p => p.stages)')), snap); ok('повторная синхронизация ничего не меняет');
  // 8) через редактор шаблона: переименование этапа доходит до проектов
  D.querySelector('.tabs [data-view="templates"]').click(); await wait(100); $('[data-settab="templates"]').click(); await wait(100); $(`[data-tpl="${tid}"]`).click(); await wait(100);
  const inp = D.querySelector('.trow input[data-f="name"]'); inp.value = 'Бриф 2.0'; inp.dispatchEvent(new w.Event('input', { bubbles: true })); inp.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(50);
  $('#tSave').click(); await wait(300);
  const L = JSON.parse(w.localStorage.getItem('agency-pipeline-demo-v2'));
  const t1 = L.templates.find(t => t.id === tid).stages[0];
  assert.ok(L.projects.filter(p => p.template_id === tid && p.state === 'active').every(p => p.stages.some(s => s.tsid === t1.id && s.name === 'Бриф 2.0'))); ok('редактор шаблона: переименование сразу во всех идущих проектах');
  // 9) завершённые проекты не меняются
  const done = E(`(db.projects.find(p => p.template_id === '${tid}' && p.state === 'completed') || {}).id`);
  if (done) { assert.ok(!P(done).stages.some(s => s.name === 'Бриф 2.0')); ok('завершённые проекты не меняются'); }
  assert.equal(o.errors.length, 0, o.errors.join('\n')); ok('ошибок нет');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
