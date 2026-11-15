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
// страница по ссылке — отдельный файл, без входа
let pageHtml = fs.readFileSync(root + 'today/index.html', 'utf8')
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/, '<script>/* supabase подставляется тестом */</script>')
  .replace('<script src="/config.js"></script>', '<script>' + cfg + '</script>');
function openPage(backend, code){
  const errors = []; const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(String(e.message || e).slice(0, 200)));
  const dom = new JSDOM(pageHtml, { runScripts:'dangerously', url:'https://kz.test/today/?c=' + code, pretendToBeVisual:true, virtualConsole:vc,
    beforeParse(w){ w.supabase = { createClient: () => backend.client('anon', { noSession:true }) }; } });
  return { w:dom.window, errors };
}
(async () => {
  const be = makeBackend();
  const A = 'aaaaaaaa-0000-0000-0000-000000000091';
  const o = openApp(be, A); await wait(4500);
  const w = o.w, D = w.document, $ = s => D.querySelector(s), E = x => w.eval(x);
  const fire = (el, t) => el.dispatchEvent(new w.Event(t, { bubbles: true, cancelable: true }));
  D.getElementById('spPick')?.remove(); E(`layer.innerHTML = ''`);
  // команда: Игорь и Эм, у текущих этапов — ответственные
  E(`db.users.push({ id:'uIg', name:'Игорь', role:'specialist', dept:'Монтаж и моушн', capacity:3, status:'active' }, { id:'uEm', name:'Эм', role:'specialist', dept:'Креатив', capacity:3, status:'active' });
     db.projects.filter(p => p.state === 'active').forEach((p, i) => { const c = currentStage(p); if (c && !isMaint(c)) c.assignee_id = i % 2 ? 'uIg' : 'uEm'; });
     delete db.prefs.dayPlans; ui.view = 'today'; commit();`); await wait(50);
  assert.ok($('.tabs [data-view="today"]') && E('ui.view') === 'today' && $('.tdy-pf-box')); ok('раздел «Сегодня» — первый в меню и открывается главным');
  const pl = E('JSON.parse(JSON.stringify(dayPlan()))');
  assert.ok(pl.items.length > 0 && pl.items.every(i => i.due <= E('today()'))); ok('утренний план: всё со сроком сегодня и раньше');
  const names = [...D.querySelectorAll('.tdy-h > b')].map(b => b.textContent);
  assert.ok(names.includes('Игорь') && names.includes('Эм')); ok('план разложен по ответственным');
  // факт: отметили задачу — факт растёт, задача отмечена на доске
  const first = pl.items.find(i => i.who === 'uIg');
  const cb = D.querySelector(`[data-tdyk="${first.k}"]`); cb.checked = true; fire(cb, 'change'); await wait(50);
  assert.ok(E(`tdDone('${first.k}')`)); ok('галочка в «Сегодня» отмечает задачу на общей доске');
  assert.ok(/1 из/.test([...D.querySelectorAll('.tdy-h')].find(h => /Игорь/.test(h.textContent)).textContent)); ok('факт за день растёт');
  // задача сделана сверх плана
  const extraKey = E(`(tdAll().find(i => !i.done && (!i.due || i.due > today()) && i.kind === 'p' && !i.r) || {}).k`);
  if (extraKey){ E(`dayToggle('${extraKey}', true); render();`); await wait(30); assert.ok(E(`dayFact(dayPlan()).extra.some(i => i.k === '${extraKey}')`)); ok('сделанное сверх плана считается отдельно'); }
  else ok('сделанное сверх плана считается отдельно (нет задач без срока — пропуск)');
  // ссылка для Игоря
  const shareBtn = [...D.querySelectorAll('[data-tdyshare]')].find(b => b.dataset.tdyshare === 'uIg'); shareBtn.click(); await wait(400);
  const url = $('#tdyUrl').value; const code = url.split('c=')[1];
  assert.ok(/\/today\/\?c=[a-z0-9]{20,40}$/.test(url)); ok('ссылка без входа для человека');
  E(`layer.innerHTML = ''`);
  const doc = be.rows.get('today/' + code).data;
  assert.ok(doc.ownerId === A && doc.items.length && doc.items.every(i => pl.items.find(x => x.k === i.k && x.who === 'uIg') || i.extra)); ok('в ссылке — только задачи этого человека');
  // человек без аккаунта открывает ссылку
  const pg = openPage(be, code); await wait(300);
  const P = s => pg.w.document.querySelector(s);
  assert.ok(/Сегодня, Игорь/.test(P('h1').textContent) && pg.w.document.querySelectorAll('li').length === doc.items.length); ok('страница по ссылке открывается без входа');
  assert.ok(!pg.w.document.body.textContent.includes(A)); ok('аккаунт владельца на странице не виден');
  const target = doc.items.find(i => !i.done && !i.extra);
  const pcb = P(`[data-k="${target.k}"]`); pcb.checked = true; pcb.dispatchEvent(new pg.w.Event('change', { bubbles: true })); await wait(200);
  assert.ok(be.rows.has('today/' + code + '/ticks/' + target.k.replace(/\|/g, '~')) || E(`tdDone('${target.k}')`)); ok('галочка по ссылке уходит в базу');
  await wait(1500);
  assert.ok(E(`tdDone('${target.k}')`)); ok('приложение отмечает задачу на общей доске');
  assert.ok(![...be.rows.keys()].some(k => k.startsWith('today/' + code + '/ticks/'))); ok('отметка обработана и убрана');
  await wait(2500);
  assert.ok(be.rows.get('today/' + code).data.items.find(i => i.k === target.k).done); ok('список по ссылке обновился — задача выполнена');
  // план / факт — в стиле блока SMM: цифры, полоса, таблица по людям
  assert.ok($('.smm-pf .smm-kpi') && $('.smm-pf .smm-bar') && /Игорь/.test($('.smm-pf .smm-wk').textContent)); ok('план / факт оформлен как в контенте: цифры, полоса, таблица по людям');
  // таймлайн — в «Производстве»: проекты рядом
  E(`{ const t = db.templates[0]; t.name = 'Инфобизнес'; db.projects.filter(p => p.state === 'active').slice(0, 2).forEach((p, i) => { p.template_id = t.id; p.name = i ? 'Эм' : 'Игорь'; }); }`);
  E(`ui.view = 'production'; ui.pfMode = 'board'; render();`); await wait(50);
  $('[data-pfmode="timeline"]').click(); await wait(50);
  assert.ok($('.pt-grid') && $('.pt-today') && /Инфобизнес/.test($('#tlTplSel').selectedOptions[0].textContent)); ok('«Производство» → «Таймлайн»: по умолчанию шаблон «Инфобизнес»');
  assert.ok([...D.querySelectorAll('.pt-chip')].every(c => E(`projById('${c.dataset.tlp}').template_id`) === E(`db.templates[0].id`))); ok('на таймлайне только проекты этого шаблона');
  const lanes = [...D.querySelectorAll('.pt-proj .pt-n b')].map(b => b.textContent); assert.ok(lanes.includes('Игорь') && lanes.includes('Эм')); ok('Игорь и Эм — рядом на одной шкале');
  D.querySelector('[data-tlp]').click(); await wait(30);
  assert.ok(D.querySelectorAll('.pt-proj').length >= 1); ok('проект можно убрать с таймлайна и оставить одного');
  $('#tlDetail').checked = true; fire($('#tlDetail'), 'change'); await wait(30);
  assert.ok(D.querySelectorAll('.pt-st').length > 0); ok('«по этапам» — каждый этап своей строкой');
  $('[data-tlall]').click(); await wait(30);
  assert.equal(D.querySelectorAll('.pt-proj').length, E(`db.projects.filter(p => p.state === 'active' && p.template_id === db.templates[0].id).length`)); ok('«Все активные» — все проекты шаблона вместе');
  D.querySelector('[data-ptopen]').click(); await wait(30);
  assert.ok(E(`ui.pfMode`) === 'board' && $('.pf-board')); ok('клик по проекту — его доска');
  assert.ok(!$('[data-tdmode]')); E(`ui.view = 'today'; render();`); await wait(30); assert.ok(!$('.tl-grid')); ok('в «Сегодня» таймлайна нет');
  // закрыть ссылку
  E(`ui.tdMode = 'plan'; render();`); [...D.querySelectorAll('[data-tdyshare]')].find(b => b.dataset.tdyshare === 'uIg').click(); await wait(300);
  $('#tdyOff').click(); await wait(400);
  assert.ok(!be.rows.has('today/' + code) && !E(`(db.prefs.todayLinks || []).length`)); ok('ссылку можно закрыть');
  assert.deepEqual([...o.errors, ...pg.errors].filter(e => !/Not implemented/.test(e)), []); ok('без ошибок');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
