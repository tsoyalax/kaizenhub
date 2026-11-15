// Шаблоны из другого пространства: выбрать пространство → отметить шаблоны → копия с этапами, подэтапами и карточками
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
      if (extra && extra.session) for (const k in extra.session) w.sessionStorage.setItem(k, extra.session[k]);
    }
  });
  return { dom, w: dom.window, errors };
}
// Правка и удаление подэтапа в одном проекте не попадают в другие проекты того же шаблона
(async () => {
  const be = makeBackend();
  const o = openApp(be, 'aaaaaaaa-0000-0000-0000-0000000000a1'); await wait(4500);
  const w = o.w, D = w.document, $ = s => D.querySelector(s), E = x => w.eval(x);
  D.getElementById('spPick')?.remove(); E(`layer.innerHTML = ''`);
  // два проекта на одном шаблоне — «Игорь» и «Эм»
  const tid = E(`db.templates[0].id`);
  E(`{ const t = tplById('${tid}'); ['Игорь', 'Эм'].forEach(n => createProject({ name:n, client:'Инфо', template_id:t.id, start_date:today(), pm_id:ME, worker_id:null, priority:'medium' })); }`); await wait(50);
  const [ig, em] = E(`['Игорь', 'Эм'].map(n => db.projects.find(p => p.name === n).id)`);
  const firstSub = pid => E(`(() => { const p = projById('${pid}'); const s = p.stages.find(s => (s.subs || []).length); return { sid:s.id, xid:s.subs[0].id, name:s.subs[0].name }; })()`);
  const a = firstSub(ig), b = firstSub(em);
  assert.equal(a.name, b.name); ok('оба проекта по одному шаблону — одинаковые подэтапы');
  // карточка подэтапа у Игоря
  E(`tasksFromSubs(projById('${ig}'), { ...projById('${ig}').stages.find(s => s.id === '${a.sid}'), subs:[projById('${ig}').stages.find(s => s.id === '${a.sid}').subs[0]] }); commit();`);
  const tIg = E(`taskFor('${ig}', '${a.sid}', '${a.xid}').id`);
  E(`openTask('${tIg}')`); await wait(50);
  assert.equal(E(`draftOf(taskById('${tIg}')).asTpl`), false); ok('«Сохранить как шаблон карточки» по умолчанию выключено');
  E(`ui.taskDraft = draftOf(taskById('${tIg}')); ui.taskDraft.description = 'Только для Игоря'; ui.taskDraft.items.push({ id:null, text:'Пункт Игоря', done:false }); saveTaskDraft();`); await wait(50);
  assert.equal(E(`taskById('${tIg}').description`), 'Только для Игоря'); ok('правка сохранилась у Игоря');
  E(`syncAllTemplates('${tid}'); commit();`); await wait(30);
  const tEm = E(`taskFor('${em}', '${b.sid}', '${b.xid}')?.description || ''`);
  assert.ok(!/Игоря/.test(tEm) && !E(`JSON.stringify(db.cardTpls || {})`).includes('Пункт Игоря')); ok('у Эма и в шаблоне правки Игоря нет');
  // удалить подэтап у Игоря — пропадает только у Игоря и не возвращается
  E(`layer.innerHTML = ''; openTask('${tIg}')`); await wait(50);
  D.querySelector('[data-tedit]')?.click(); await wait(30);
  D.querySelector('[data-tdel]').click(); await wait(30);
  D.querySelector('#cfmOk').click(); await wait(100);
  const hasSub = pid => E(`projById('${pid}').stages.some(s => (s.subs || []).some(x => x.name === '${a.name}'))`);
  assert.ok(!hasSub(ig) && !E(`taskById('${tIg}')`)); ok('«Удалить подэтап» убирает его с доски Игоря');
  assert.ok(hasSub(em)); ok('у Эма подэтап остался');
  E(`syncAllTemplates('${tid}'); ensureSharedTasks(); commit();`); await wait(50);
  assert.ok(!hasSub(ig)); ok('синхронизация с шаблоном не возвращает удалённый подэтап');
  assert.ok(E(`tplById('${tid}').stages.some(s => (s.subs || []).some(x => x.name === '${a.name}'))`)); ok('в шаблоне подэтап остался');
  assert.deepEqual(o.errors.filter(e => !/Not implemented/.test(e)), []); ok('без ошибок');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
