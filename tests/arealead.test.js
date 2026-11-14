// Руководитель одной области: приглашение из пространства области даёт доступ только к пространствам этой области
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
const dump = w => { const o = {}; for (let i = 0; i < w.localStorage.length; i++){ const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; };
(async () => {
  const be = makeBackend();
  const A = 'aaaaaaaa-0000-0000-0000-000000000041', V = 'bbbbbbbb-0000-0000-0000-000000000042';
  be.profiles.set(A, { id: A, name: 'Александр Владелец', email: 'a@x.y', avatar_url: '', job_title: '', contact: '' });
  be.profiles.set(V, { id: V, name: 'Вика Фандо', email: 'v@x.y', avatar_url: '', job_title: '', contact: '' });
  // владелец: основное пространство, область «Вика Фандо» с пространством «Вика» и пространство «Icon SMM» в основной области
  const m = openApp(be, A, 'https://kz.test/', { meta: { name: 'Александр Владелец' } }); await wait(4500);
  const area = await m.w.eval(`createArea('Вика Фандо')`); await wait(200);
  const spV = await m.w.eval(`createSpace({ name:'Вика', kind:'agency', area:'${area}', copy:false })`);
  const spI = await m.w.eval(`createSpace({ name:'Icon SMM', kind:'smm', area:'', copy:false })`); await wait(300);
  const proj = m.w.eval('JSON.stringify(db.projects[0])'); const mainNames = m.w.eval('db.projects.map(p => p.name)');
  const store0 = dump(m.w); m.w.close();
  // владелец открывает пространство «Вика», заводит в нём проект и приглашает Вику
  const o = openApp(be, A, 'https://kz.test/', { meta: { name: 'Александр Владелец' } }, { ...store0, 'kz-space': spV, 'kz-pick-seen': '1' }); await wait(4500);
  const $ = (x, s) => x.w.document.querySelector(s);
  $(o, '#spPick')?.remove();
  o.w.eval(`{ const p = JSON.parse(${JSON.stringify(proj)}); p.id = 'pvika1'; p.name = 'Проект Вики'; db.projects = [p]; commit(); }`); await wait(2500);
  assert.ok(be.rows.has(`data/users/${A}/spaces/list/${spV}/items/p_pvika1`)); ok('проект пространства «Вика» в облаке');
  $(o, '[data-view="team"]').click(); await wait(100); $(o, '[data-invite]').click(); await wait(50);
  assert.ok(/Доступ к области «Вика Фандо»/.test($(o, '.lead-check').textContent) && /Вика/.test($(o, '.lead-check small').textContent)); ok('в пространстве области — галочка «Доступ к области «Вика Фандо»»');
  $(o, '#iName').value = 'Вика Фандо'; $(o, '#iEmail').value = 'v@x.y'; $(o, '#iLead').checked = true;
  $(o, '#iForm').dispatchEvent(new o.w.Event('submit', { bubbles: true, cancelable: true })); await wait(800);
  const link = $(o, '#tlIn').value; const code = link.split('invite=')[1];
  const inv = be.rows.get('inv/' + code).data;
  assert.equal(inv.role, 'arealead'); assert.equal(inv.area, area); ok('ссылка — на область, а не на все проекты');
  assert.ok(/область «Вика Фандо»/.test($(o, '#tlT').textContent)); ok('в окне ссылки видно, к какой области доступ');
  $(o, '[data-close]').click(); await wait(100);
  // Вика входит по ссылке
  const v1 = openApp(be, V, link, { meta: { name: 'Вика Фандо' } }); await wait(5000);
  assert.ok(be.rows.has(`team/${A}/areas/${area}/${V}`)); ok('Вика вписана руководителем области');
  assert.ok(!be.rows.has(`team/${A}/managers/${V}`) && !be.rows.has(`data/users/${V}/links/lead/${A}`)); ok('общим руководителем (все проекты) она не стала');
  assert.equal(be.rows.get(`data/users/${V}/links/area/${A}.${area}`)?.data.area, area); ok('у Вики запомнена область');
  assert.equal(v1.w.localStorage.getItem('kz-org'), `${A}:${spV}`); assert.ok(v1.reloads.length >= 1); ok('после входа открывается пространство «Вика»');
  const keep = dump(v1.w); v1.w.close();
  // после перезагрузки: видит только проекты пространства «Вика»
  const v2 = openApp(be, V, 'https://kz.test/', { meta: { name: 'Вика Фандо' } }, keep); await wait(5000);
  $(v2, '#spPick')?.remove();
  const vNames = v2.w.eval('db.projects.map(p => p.name)');
  assert.deepEqual(vNames, ['Проект Вики']); ok('Вика видит только проекты своей области');
  assert.ok(!mainNames.some(x => vNames.includes(x))); ok('проектов основного пространства у неё нет');
  assert.equal($(v2, '#spaceName').textContent, 'Вика'); ok('в шапке — название пространства');
  const orgs = v2.w.eval('spaces.orgs.map(x => x.label)');
  assert.ok(orgs.includes('Вика') && !orgs.includes('Icon SMM') && !orgs.some(x => /^Проекты:/.test(x))); ok('в списке пространств только «Вика», без «Icon SMM» и всех проектов');
  const me = v2.w.eval('userById(ME)'); assert.equal(me.account_id, V); assert.equal(me.area, area); ok('«Вы» — её запись в команде пространства');
  v2.w.eval(`projById('pvika1').name = 'Правка Вики'; commit();`); await wait(2500);
  assert.equal(JSON.parse(be.rows.get(`data/users/${A}/spaces/list/${spV}/items/p_pvika1`).data.json).name, 'Правка Вики'); ok('правка Вики сохраняется в пространстве владельца');
  assert.ok(![...be.rows.keys()].some(k => k.startsWith(`data/users/${A}/p_`) && JSON.parse(be.rows.get(k).data.json || '{}').name === 'Правка Вики')); ok('основное пространство не тронуто');
  v2.w.document.querySelector('[data-view="team"]').click(); await wait(100);
  assert.ok(!$(v2, '#commonLink')); v2.w.document.querySelector('[data-invite]').click(); await wait(50);
  assert.ok($(v2, '#iLead') && /этой области/.test($(v2, '.lead-check').textContent)); ok('Вика может пригласить руководителя только своей области');
  $(v2, '#iName').value = 'Юля Область'; $(v2, '#iEmail').value = 'yo@x.y'; $(v2, '#iLead').checked = true;
  $(v2, '#iForm').dispatchEvent(new v2.w.Event('submit', { bubbles:true, cancelable:true })); await wait(1500);
  const vinv = [...be.rows.values()].find(r => r.path.startsWith('inv/') && r.data.name === 'Юля Область');
  assert.ok(vinv && vinv.data.role === 'arealead' && vinv.data.area === area && vinv.data.ownerId === A); ok('её ссылка — руководитель той же области от имени владельца');
  // повторный вход по ссылке тем, у кого доступ к области уже есть: без ошибки — просто открываем область
  let vre = 0; v2.w.kzReloadHook = () => { vre++; };
  const vcode = vinv.path.split('/')[1]; const r2 = await v2.w.eval(`acceptInvite('${vcode}')`); await wait(300);
  assert.ok(!/не удалось записать/.test(v2.w.eval('ui.joinErr || ""')) && (r2 === 'reload' || vre >= 1)); ok('повторный вход по ссылке руководителя — без ошибки, открывает область');
  v2.w.document.querySelector('[data-close]')?.click(); await wait(50);
  // владелец в основном пространстве: обычная галочка «Доступ руководителя»
  const o2 = openApp(be, A, 'https://kz.test/', { meta: { name: 'Александр Владелец' } }, { ...store0, 'kz-pick-seen': '1' }); await wait(4500);
  $(o2, '#spPick')?.remove();
  $(o2, '[data-view="team"]').click(); await wait(100); $(o2, '[data-invite]').click(); await wait(50);
  assert.ok(/Доступ руководителя/.test($(o2, '.lead-check').textContent)); ok('в основном пространстве — прежний доступ руководителя');
  // владелец убирает Вику в пространстве «Вика»
  o.w.eval(`removeMember(db.users.find(u => u.account_id === '${V}'))`); await wait(300);
  assert.ok(!be.rows.has(`team/${A}/areas/${area}/${V}`)); ok('удаление из команды снимает доступ к области');
  for (const x of [o, v2, o2]) assert.deepEqual(x.errors.filter(e => !/Not implemented/.test(e)), []);
  ok('без ошибок');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
