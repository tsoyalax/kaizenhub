// Старое устройство не затирает облако; кнопки «Сохранить» и «Синхронизировать»
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
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', K = 'agency-pipeline-demo-v2';
  const be = makeBackend();
  const d1 = openApp(be, A); await wait(4500); const w1 = d1.w; const E1 = x => w1.eval(x);
  E1(`db.onboarded = true; commit()`); await wait(2500);
  const pid = E1(`db.projects.find(p => p.state === 'active').id`);
  const cloudP = () => JSON.parse([...be.rows.values()].find(r => r.path.endsWith('/p_' + pid)).data.json);
  // устройство B открылось и сверилось с облаком — запоминаем его браузер
  const d2 = openApp(be, A); await wait(4500); const w2 = d2.w;
  const store = {}; for (let i = 0; i < w2.localStorage.length; i++){ const k = w2.localStorage.key(i); store[k] = w2.localStorage.getItem(k); }
  w2.close();
  // на A переименовали проект
  E1(`projById('${pid}').name = 'НОВОЕ ИМЯ'; commit()`); await wait(2500);
  assert.equal(cloudP().name, 'НОВОЕ ИМЯ'); ok('правка A в облаке');
  // в браузере B копия проекта отличается от облака не из-за правки (например, пересчитались даты) — и B старый
  const old = JSON.parse(store[K]); const op = old.projects.find(p => p.id === pid); op.recalc = 'пересчитано при открытии'; old.savedAt = Date.now() + 1e7;
  store[K] = JSON.stringify(old); delete store[K + '-dirty'];
  const d3 = openApp(be, A, undefined, undefined, store); await wait(6000);
  assert.equal(d3.w.eval(`projById('${pid}').name`), 'НОВОЕ ИМЯ'); ok('старое устройство показывает данные из облака');
  await wait(2500);
  assert.equal(cloudP().name, 'НОВОЕ ИМЯ'); ok('старое устройство не затёрло облако своей копией');
  // своя несохранённая правка (отмечена в -dirty) при следующем открытии не теряется
  d3.w.eval(`projById('${pid}').client = 'Клиент Б'; save()`);
  const st2 = {}; for (let i = 0; i < d3.w.localStorage.length; i++){ const k = d3.w.localStorage.key(i); st2[k] = d3.w.localStorage.getItem(k); }
  d3.w.close();                                                  // закрыли раньше, чем ушло в облако
  assert.ok(JSON.parse(st2[K + '-dirty'] || '[]').includes('p_' + pid)); ok('несохранённая правка отмечена');
  const d4 = openApp(be, A, undefined, undefined, st2); await wait(6000);
  assert.equal(d4.w.eval(`projById('${pid}').client`), 'Клиент Б'); ok('несохранённая правка подхватилась при открытии');
  await wait(2500); assert.equal(cloudP().client, 'Клиент Б'); assert.equal(cloudP().name, 'НОВОЕ ИМЯ'); ok('и дописалась в облако, не откатив имя');
  // кнопки
  const w4 = d4.w; w4.eval(`openSide && openSide()`); await wait(50);
  assert.ok(w4.document.querySelector('[data-savenow]') && w4.document.querySelector('[data-syncnow]')); ok('кнопки «Сохранить» и «Синхронизировать» есть');
  w4.eval(`projById('${pid}').note = 'через кнопку'; save()`);
  w4.document.querySelector('[data-savenow]').click(); await wait(800);
  assert.equal(cloudP().note, 'через кнопку'); ok('«Сохранить» сразу пишет в облако');
  E1(`projById('${pid}').name = 'С ДРУГОГО УСТРОЙСТВА'; commit()`); await wait(2000);
  w4.eval(`projById('${pid}').name = 'СТАРАЯ КОПИЯ'; cloud.hashes.set('p_${pid}', 'x')`);   // будто вкладка отстала
  w4.document.querySelector('[data-syncnow]').click(); await wait(1500);
  assert.equal(w4.eval(`projById('${pid}').name`), 'С ДРУГОГО УСТРОЙСТВА'); ok('«Синхронизировать» забирает актуальное из облака');
  { // общий проект: старая копия исполнителя не откатывает закрытый владельцем этап
    const q = E1(`db.projects.find(p => p.state === 'active' && p.stages.length > 2 && p.stages[0].status !== 'done' && p.stages[1].subs?.length).id`);
    const stale = JSON.parse(E1(`JSON.stringify(projById('${q}'))`));            // так проект выглядит у исполнителя (вкладка не обновлялась)
    E1(`(() => { const p = projById('${q}'); setStatus(p, p.stages[0], 'done'); })()`); await wait(50);
    assert.equal(E1(`projById('${q}').stages[1].status`), 'in_progress'); ok('владелец закрыл первый этап, второй в работе');
    stale.stages[1].subs[0].done = true; stale.stages[1].subs[0].u = new Date(Date.now() + 1000).toISOString();   // исполнитель отметил пункт во втором этапе
    E1(`shared.pending = false; shared.writing = false; shared.hashes.delete('sp/${q}')`);
    w1.onSharedProject(q, { exists:true, metadata:{}, data:() => ({ json:JSON.stringify(stale), memberIds:[] }) });
    assert.equal(E1(`projById('${q}').stages[0].status`), 'done'); ok('старая копия исполнителя не вернула первый этап');
    assert.equal(E1(`projById('${q}').stages[1].status`), 'in_progress'); ok('второй этап остался в работе');
    assert.ok(E1(`projById('${q}').stages[1].subs[0].done`)); ok('отметка исполнителя во втором этапе принята');
    // старая копия без отметок времени (старая версия приложения) тоже не откатывает
    const stale2 = JSON.parse(JSON.stringify(stale)); stale2.stages.forEach(x => { delete x.su; (x.subs || []).forEach(y => delete y.u); });
    E1(`shared.hashes.delete('sp/${q}')`);
    w1.onSharedProject(q, { exists:true, metadata:{}, data:() => ({ json:JSON.stringify(stale2), memberIds:[] }) });
    assert.equal(E1(`projById('${q}').stages[0].status`), 'done'); ok('копия из старой версии приложения тоже не откатывает этап');
  }
  { // автозакрытие этапа
    const r = E1(`db.projects.find(p => p.state === 'active' && currentStage(p) && !isMaint(currentStage(p)) && (currentStage(p).subs || []).length && !db.tasks.some(t => t.project_id === p.id && t.stage_id === currentStage(p).id && t.checklist.length)).id`);
    const sid = E1(`currentStage(projById('${r}')).id`);
    E1(`(() => { const p = projById('${r}'), s = p.stages.find(x => x.id === '${sid}'); s.gate = false; s.subs.forEach(x => { x.files = false; }); s.subs.forEach(x => toggleSub(p, s, x, true)); })()`); await wait(100);
    assert.equal(E1(`projById('${r}').stages.find(x => x.id === '${sid}').status`), 'done'); ok('все пункты отмечены — этап закрылся сам');
    assert.notEqual(E1(`currentStage(projById('${r}'))?.id`), sid); ok('следующий этап — в работе');
    // этап с приёмкой: отметки исполнителя отправляют его на приёмку, закрывает руководитель
    const sid2 = E1(`currentStage(projById('${r}'))?.id`);
    if (sid2 && E1(`(currentStage(projById('${r}')).subs || []).length > 0 && !isMaint(currentStage(projById('${r}')))`)){
      E1(`(() => { const p = projById('${r}'); p._ext = { role:'worker' }; const s = p.stages.find(x => x.id === '${sid2}'); s.gate = true; s.subs.forEach(x => toggleSub(p, s, x, true)); })()`); await wait(100);
      E1(`delete projById('${r}')._ext`);
      assert.equal(E1(`projById('${r}').stages.find(x => x.id === '${sid2}').status`) !== 'done', true); ok('этап с приёмкой сам не закрылся');
      assert.equal(E1(`projById('${r}').stages.find(x => x.id === '${sid2}').sub?.status`), 'pending'); ok('этап с приёмкой ушёл руководителю на приёмку');
      E1(`ui.view = 'review'; ui.revTab = 'pending'; render()`); await wait(30);
      w1.document.querySelector(`[data-ssok="${r}|${sid2}"]`).click(); await wait(100);
      assert.equal(E1(`projById('${r}').stages.find(x => x.id === '${sid2}').status`), 'done'); ok('после «Принять этап» этап закрыт');
    }
  }
  assert.equal(d1.errors.length + d4.errors.length, 0, d1.errors.concat(d4.errors).join('\n')); ok('ошибок нет');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
