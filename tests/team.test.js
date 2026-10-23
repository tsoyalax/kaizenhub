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
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', T = 'cccccccc-0000-0000-0000-000000000003';
  const $ = (o, s) => o.w.document.querySelector(s);
  const change = (o, el, v) => { el.value = v; el.dispatchEvent(new o.w.Event('change', { bubbles: true })); };

  // владелец: первый запуск, данные уходят в аккаунт
  const own = openApp(be, A, 'https://kz.test/', { meta: { name: 'Owner A', avatar_url: 'https://img/a.png' } });
  await wait(4500);
  assert.ok($(own, '#meBtn')); ok('в шапке есть кнопка профиля');

  // 1) приглашение в команду по ссылке
  $(own, '[data-view="team"]').click(); await wait(100);
  $(own, '[data-invite]').click(); await wait(50);
  $(own, '#iName').value = 'Тимур Тестов'; $(own, '#iEmail').value = 't@x.y';
  $(own, '#iForm').dispatchEvent(new own.w.Event('submit', { bubbles: true, cancelable: true }));
  await wait(800);
  const link = $(own, '#tlIn') && $(own, '#tlIn').value;
  assert.ok(link && /\?invite=[a-z0-9]{8,32}$/.test(link), 'нет ссылки: ' + link); ok('после добавления сотрудника показана ссылка-приглашение');
  const code = link.split('invite=')[1];
  assert.equal(be.rows.get('inv/' + code).data.kind, 'team'); ok('ссылка в команду записана в базу');
  { const m = $(own, '[data-sendmail]'); assert.ok(m && m.getAttribute('href').startsWith('mailto:t%40x.y?') && m.getAttribute('href').includes(encodeURIComponent(link))); ok('приглашение: кнопка «Почта» открывает письмо на адрес сотрудника со ссылкой');
    assert.ok($(own, '.send-row a[href^="https://t.me/share/url"]') && $(own, '.send-row a[href^="https://wa.me/"]')); ok('приглашение: можно отправить в Telegram и WhatsApp'); }
  $(own, '[data-close]').click(); await wait(100);
  assert.ok(own.w.document.getElementById('app').textContent.includes('Ждём входа по ссылке')); ok('в «Команде» статус «Ждём входа по ссылке»');

  // назначаем сотрудника ответственным за этап проекта
  $(own, '[data-view="matrix"]').click(); await wait(100);
  const openBtn = $(own, '.prow[data-open]'); const pid = openBtn.dataset.open; openBtn.click(); await wait(200); $(own, '[data-dtab="stages"]').click(); await wait(50);
  const sel = $(own, '[data-sassign]'); const sid = sel.dataset.sassign;
  const memberOpt = [...sel.options].find(o => o.textContent.startsWith('Тимур'));
  change(own, sel, memberOpt.value); await wait(1500);
  assert.ok(!be.rows.has('sp/' + pid) || !(be.rows.get('sp/' + pid).data.memberIds || []).length); ok('пока человек не вошёл, проект ему не открыт');

  // 2) сотрудник открывает ссылку и входит (через Google: роли в профиле ещё нет)
  const wk = openApp(be, T, link, { meta: { name: 'Тимур Google', avatar_url: 'https://img/t.png' } });
  await wait(4000);
  assert.ok(be.rows.has(`team/${A}/members/${T}`)); ok('сотрудник вписан в команду по ссылке');
  assert.ok(wk.w.document.body.classList.contains('guest')); ok('сотрудник видит версию исполнителя');
  assert.ok(!be.rows.has('inv/' + code)); ok('ссылка одноразовая: после входа отключена');
  const sp = be.rows.get('sp/' + pid);
  assert.ok(sp && sp.data.memberIds.includes(T)); ok('проект, где он назначен, открылся ему автоматически');
  assert.ok(wk.w.document.getElementById('app').textContent.includes(JSON.parse(sp.data.json).name)); ok('сотрудник видит этот проект во «Моих проектах»');
  assert.equal(be.rows.size && [...be.rows.keys()].filter(k => k.startsWith('sp/') && k.split('/').length === 2 && be.rows.get(k).data.memberIds.includes(T)).length, 1); ok('другие проекты ему не открыты');

  // 3) профиль: сотрудник заполняет должность и контакт, владелец видит их в «Команде»
  $(wk, '#meBtn').click(); await wait(300);
  assert.ok($(wk, '#mForm')); ok('у сотрудника открывается окно профиля');
  assert.ok($(wk, '.prof-head img')); ok('в профиле фото из Google');
  $(wk, '#mTitle2').value = 'Моушн-дизайнер'; $(wk, '#mContact').value = '@timur';
  $(wk, '#mForm').dispatchEvent(new wk.w.Event('submit', { bubbles: true, cancelable: true })); await wait(300);
  assert.equal(be.profiles.get(T).job_title, 'Моушн-дизайнер'); ok('профиль сохранён в базе');
  await own.w.refreshProfiles(true); await wait(200);
  $(own, '[data-view="team"]').click(); await wait(100);
  const teamTxt = own.w.document.getElementById('app').textContent
  assert.ok(teamTxt.includes('Моушн-дизайнер') && teamTxt.includes('@timur') && teamTxt.includes('вошёл в приложение')); ok('владелец видит должность, контакт и что человек вошёл');
  assert.ok(own.w.document.querySelector('.members img[src="https://img/t.png"]')); ok('владелец видит фото сотрудника');

  // 4) владелец меняет свой профиль
  $(own, '#meBtn').click(); await wait(300);
  assert.equal($(own, '#mEmail').readOnly, true); ok('почта аккаунта не редактируется вручную');
  $(own, '#mTitle2').value = 'Директор';
  $(own, '#mForm').dispatchEvent(new own.w.Event('submit', { bubbles: true, cancelable: true })); await wait(300);
  assert.equal(be.profiles.get(A).job_title, 'Директор'); ok('свой профиль владельца сохранён');
  assert.equal(be.profiles.get(T).job_title, 'Моушн-дизайнер'); ok('чужой профиль не задет');

  // 5) сняли с этапа — доступ к проекту закрылся
  $(own, '[data-view="matrix"]').click(); await wait(100);
  $(own, `.prow[data-open="${pid}"]`).click(); await wait(200); $(own, '[data-dtab="stages"]').click(); await wait(50);
  change(own, $(own, `[data-sassign="${sid}"]`), ''); await wait(1500);
  const sp2 = be.rows.get('sp/' + pid);
  assert.ok(!sp2 || !(sp2.data.memberIds || []).includes(T)); ok('сняли с назначения — доступ к проекту закрыт');

  // 6) выбор ответственного есть везде, где он показан
  $(own, '[data-view="matrix"]').click(); await wait(150);
  const md = own.w.document;
  assert.equal(md.querySelectorAll('.mx select.cell-as[data-qassign]').length, md.querySelectorAll('.mx button.cell').length); ok('«Матрица»: в каждой ячейке этапа можно выбрать ответственного');
  assert.equal(md.querySelectorAll('.mx select[data-ppm]').length, md.querySelectorAll('.mx .prow').length); ok('«Матрица»: у каждого проекта можно выбрать PM');
  assert.equal(md.querySelectorAll('.mx select[data-pworker]').length, md.querySelectorAll('.mx .prow').length); ok('«Матрица»: у каждого проекта можно выбрать исполнителя');
  const pw = md.querySelector('.mx select[data-pworker]'); const mpid = pw.dataset.pworker;
  change(own, pw, [...pw.options].find(o => o.textContent.startsWith('Тимур')).value); await wait(1500);
  assert.ok(be.rows.get('sp/' + mpid).data.memberIds.includes(T)); ok('исполнитель проекта, выбранный в матрице, получает доступ');
  { const nm = JSON.parse(be.rows.get('sp/' + mpid).data.json).name; await wait(1000);
    assert.ok(wk.w.document.getElementById('app').textContent.includes(nm)); ok('назначенный проект сразу появился у исполнителя на экране, без перезагрузки'); }
  const ca = md.querySelector(`.mx select.cell-as[data-qassign^="${mpid}|"]`); const cq = ca.dataset.qassign;
  const cellOf = () => md.querySelector(`.mx select.cell-as[data-qassign="${cq}"]`).closest('td');
  if (!cellOf().querySelector('.who:not(.inherit):not(.none)')) { assert.ok(cellOf().querySelector('.who.inherit')); ok('этап без своего ответственного подписан «исп.» серым'); }
  change(own, ca, [...ca.options].find(o => o.textContent.startsWith('Гоша') || o.textContent.startsWith('Owner')).value); await wait(300);
  assert.ok(cellOf().querySelector('.who:not(.inherit):not(.none)')); ok('после назначения этапа подпись становится своей');
  change(own, md.querySelector(`.mx select[data-pworker="${mpid}"]`), ''); await wait(1500);
  $(own, '[data-view="kanban"]').click(); await wait(150);
  assert.ok(own.w.document.querySelectorAll('.card select[data-qassign]').length > 0); ok('«Канбан»: на карточке можно выбрать ответственного');
  $(own, '[data-view="production"]').click(); await wait(150);
  assert.ok(own.w.document.querySelectorAll('.pf-col select[data-qassign]').length > 0); ok('«Производство»: у каждого этапа можно выбрать ответственного');
  const card = $(own, '.pf-card[data-pfsub]'); card.click(); await wait(200);
  assert.ok($(own, '[data-tqassign]')); ok('окно подэтапа: ответственного можно выбрать без режима редактирования');
  const tq = $(own, '[data-tqassign]'); change(own, tq, [...tq.options].find(o => o.textContent.startsWith('Тимур')).value); await wait(1500);
  const tpid = [...be.rows.keys()].filter(k => /^sp\/[^/]+$/.test(k) && be.rows.get(k).data.memberIds.includes(T));
  assert.ok(tpid.length >= 1); ok('назначение на подэтап тоже открывает проект');
  change(own, $(own, '[data-tqassign]'), ''); await wait(300); $(own, '[data-tclose]').click(); await wait(1500);

  // 7) человек вошёл по ссылке на доску — он появляется в «Команде», и его можно назначить на другой проект
  const G = 'dddddddd-0000-0000-0000-000000000004';
  be.profiles.set(G, { id: G, name: 'Гоша Ссылкин', email: 'g@x.y', avatar_url: '', job_title: 'Монтажёр', contact: '' });
  const projs = [...own.w.document.querySelectorAll('.pf-item[data-pfsel]')].map(b => b.dataset.pfsel);
  const p1 = projs[0], p2 = projs[1];
  await own.w.createLink(p1, 'worker'); await wait(500);
  const bcode = [...be.rows.values()].find(r => r.path.startsWith('inv/') && r.data.pid === p1).path.slice(4);
  const gw = openApp(be, G, 'https://kz.test/?invite=' + bcode, { meta: { role: 'guest' } });
  await wait(4000);
  $(own, '[data-view="team"]').click(); await wait(1500);
  const tt = own.w.document.getElementById('app').textContent;
  assert.ok(tt.includes('Гоша Ссылкин') && tt.includes('вошёл по ссылке на доску'), tt.slice(0, 300)); ok('вошедший по ссылке на доску появился в «Команде»');
  $(own, '[data-view="production"]').click(); await wait(150);
  $(own, `.pf-item[data-pfsel="${p2}"]`).click(); await wait(150);
  const qs = $(own, '.pf-col select[data-qassign]');
  change(own, qs, [...qs.options].find(o => o.textContent.startsWith('Гоша')).value); await wait(4000);
  assert.ok(be.rows.get('sp/' + p2).data.memberIds.includes(G)); ok('его можно назначить на другой проект прямо с доски');
  const gtxt = gw.w.document.getElementById('app').textContent;
  assert.equal(gw.w.document.querySelectorAll('.pf-item[data-pfsel]').length, 2, gtxt.slice(0, 200)); ok('он видит оба проекта: по ссылке и по назначению');

  // 4) общая ссылка для исполнителей: одна на всех, многоразовая
  $(own, '[data-view="team"]').click(); await wait(100);
  $(own, '#commonLink').click(); await wait(50);
  $(own, '#clNew').click(); await wait(600);
  const clink = $(own, '#clIn') && $(own, '#clIn').value;
  assert.ok(clink && /\?invite=[a-z0-9]{8,32}$/.test(clink)); ok('общая ссылка: создана и показана');
  const ccode = clink.split('invite=')[1];
  assert.ok(be.rows.get('inv/' + ccode).data.common); ok('общая ссылка: записана в базу');
  $(own, '[data-close]').click(); await wait(50);
  const X1 = 'xxxxxxxx-0000-0000-0000-000000000011', X2 = 'xxxxxxxx-0000-0000-0000-000000000012';
  const e1 = openApp(be, X1, clink, { meta: { name: 'Исполнитель Один' } }); await wait(4000);
  const e2 = openApp(be, X2, clink, { meta: { name: 'Исполнитель Два' } }); await wait(4000);
  assert.ok(be.rows.has(`team/${A}/members/${X1}`) && be.rows.has(`team/${A}/members/${X2}`)); ok('общая ссылка: по ней вошли двое');
  assert.ok(e1.w.document.body.classList.contains('guest') && e2.w.document.body.classList.contains('guest')); ok('общая ссылка: оба видят версию исполнителя');
  assert.ok(be.rows.has('inv/' + ccode)); ok('общая ссылка: после входа продолжает работать');
  await wait(1500);
  const users = own.w.eval('db.users');
  assert.ok(users.some(u => u.account_id === X1) && users.some(u => u.account_id === X2)); ok('общая ссылка: оба появились в «Команде» руководителя');
  assert.equal(users.filter(u => u.account_id === X1).length, 1); ok('общая ссылка: без дублей');
  $(own, '#commonLink').click(); await wait(50); $(own, '#clOff').click(); await wait(400);
  assert.ok(!be.rows.has('inv/' + ccode) && !own.w.eval('db.prefs.teamLink')); ok('общая ссылка: отключается');
  e1.w.close(); e2.w.close();

  // 5) выход из аккаунта — в окне профиля, у руководителя и у исполнителя
  for (const [o, who] of [[own, 'руководитель'], [wk, 'исполнитель']]){
    let out = 0; o.w.kzSignOut = () => { out++; };
    o.w.document.getElementById('meBtn').click(); await wait(300);
    const b = o.w.document.getElementById('mOut');
    assert.ok(b && /Выйти/.test(b.textContent), who); ok(`выход: у ${who === 'руководитель' ? 'руководителя' : 'исполнителя'} в профиле есть «Выйти из аккаунта»`);
    b.click(); await wait(300);
    assert.equal(out, 1); ok(`выход: кнопка выходит из аккаунта (${who})`);
    o.w.document.querySelector('[data-close]')?.click(); await wait(50);
  }

  assert.equal(own.errors.length, 0, own.errors.join('\n')); assert.equal(wk.errors.length, 0, wk.errors.join('\n')); assert.equal(gw.errors.length, 0, gw.errors.join('\n')); ok('ошибок на страницах нет');
  own.w.close(); wk.w.close(); gw.w.close();
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
