// Проверка «переходника» напрямую: формы снимков, фильтр where, приглашения, удаления, ошибки
const fs = require('fs'), assert = require('assert');
const { JSDOM } = require('jsdom');
const { makeBackend } = require('./fake-supabase');
const shimSrc = fs.readFileSync(__dirname + '/../claude-shim.js', 'utf8');
const cfgSrc = fs.readFileSync(__dirname + '/../config.js', 'utf8');
let n = 0; const ok = m => { n++; console.log('PASS ' + m); };
const wait = ms => new Promise(r => setTimeout(r, ms));

function boot(backend, userId, extra) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://kz.test/', pretendToBeVisual: true });
  const w = dom.window;
  w.supabase = { createClient: () => backend.client(userId, extra) };
  w.eval(cfgSrc); w.eval(shimSrc);
  return w;
}
(async () => {
  const be = makeBackend();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', B = 'bbbbbbbb-0000-0000-0000-000000000002';
  const wa = boot(be, A);
  const user = await wa.claude.use('user'), db = await wa.claude.use('db');
  assert.equal(await user.id(), A); assert.equal((await user.me()).isOwner, true); ok('user.id / me.isOwner');
  const wg = boot(be, B, { meta: { role: 'guest' } });
  assert.equal((await (await wg.claude.use('user')).me()).isOwner, false); ok('гость: isOwner=false');
  assert.equal(await wa.claude.use('nothing'), null); ok('неизвестный модуль -> null');

  // set / get / onSnapshot (документ)
  await db.doc('sp/p1').set({ ownerId: A, memberIds: [B], members: [{ id: B, role: 'worker' }], json: '{}' });
  let g = await db.doc('sp/p1').get(); assert.equal(g.exists, true); assert.equal(g.data().ownerId, A); ok('doc.set/get');
  g = await db.doc('sp/none').get(); assert.equal(g.exists, false); assert.equal(g.data(), undefined); ok('doc.get несуществующего: exists=false');

  const seen = [];
  const un = db.doc('sp/p1').onSnapshot(s => seen.push(s.exists ? s.data().json : null));
  await wait(50); assert.deepEqual(seen, ['{}']); ok('doc.onSnapshot: первый снимок сразу');
  await db.doc('sp/p1').update({ json: '{"v":2}' }); await wait(300);
  assert.deepEqual(seen, ['{}', '{"v":2}']); ok('doc.update -> новый снимок');
  await db.doc('sp/p1').update({ json: '{"v":2}' }); await wait(300);
  assert.equal(seen.length, 2); ok('без изменений повторных снимков нет');
  await db.doc('sp/p1').delete(); await wait(300);
  assert.equal(seen.at(-1), null); ok('удаление документа замечено');
  un();

  // коллекции и where
  await db.doc('sp/p2').set({ ownerId: A, memberIds: [B], json: '2' });
  await db.doc('sp/p3').set({ ownerId: A, memberIds: [], json: '3' });
  await db.doc('sp/p2/tasks/t1').set({ json: 't1' });
  await db.doc('sp/p2/tasks/t2').set({ json: 't2' });
  let col = await db.collection('sp').get(); assert.equal(col.docs.length, 2); ok('collection.get: только прямые потомки (без tasks)');
  const q = await db.collection('sp').where('memberIds', 'array-contains', B).get();
  assert.deepEqual(q.docs.map(d => d.id), ['p2']); ok("where('memberIds','array-contains') фильтрует");
  const tasks = await db.collection('sp/p2/tasks').get();
  assert.deepEqual(tasks.docs.map(d => d.id), ['t1', 't2']); assert.equal(tasks.docs[0].data().json, 't1'); assert.equal(tasks.docs[0].metadata.hasPendingWrites, false); ok('подколлекция: id и data(), metadata');
  assert.equal(db.collection('sp/p2/tasks').doc('t1').path, 'sp/p2/tasks/t1'); ok('collection.doc(id)');

  // подписка на коллекцию + удаление, замеченное через опрос
  const snaps = [];
  const un2 = db.collection('sp/p2/tasks').onSnapshot(s => snaps.push(s.docs.map(d => d.id).join(',')));
  await wait(50); assert.deepEqual(snaps, ['t1,t2']); ok('collection.onSnapshot: первый снимок');
  await db.doc('sp/p2/tasks/t3').set({ json: 't3' }); await wait(300);
  assert.equal(snaps.at(-1), 't1,t2,t3'); ok('новый документ в коллекции виден');
  // удаление «снаружи» (другой клиент): Realtime его не присылает — ловим опросом
  be.rows.delete('sp/p2/tasks/t2'); wa.document.dispatchEvent(new wa.Event('visibilitychange')); await wait(300);
  assert.equal(snaps.at(-1), 't1,t3'); ok('удаление другим клиентом поймано опросом');
  const cnt = snaps.length; wa.document.dispatchEvent(new wa.Event('visibilitychange')); await wait(200);
  assert.equal(snaps.length, cnt); ok('опрос без изменений ничего не вызывает');
  un2(); be.put('sp/p2/tasks/t9', { json: 'x' }); wa.document.dispatchEvent(new wa.Event('visibilitychange')); await wait(200);
  assert.equal(snaps.at(-1), 't1,t3'); ok('после отписки снимков нет');

  // Realtime-событие от другого клиента
  const snaps3 = [];
  const un3 = db.collection('sp/p2/tasks').onSnapshot(s => snaps3.push(s.docs.length)); await wait(60);
  be.put('sp/p2/tasks/t10', { json: 'y' }); be.emit(be.rows.get('sp/p2/tasks/t10')); await wait(300);
  assert.equal(snaps3.at(-1), 4); ok('Realtime-событие обновляет коллекцию'); un3();

  // приглашения
  be.put('inv/abcdefgh12', { pid: 'p2', ownerId: A, role: 'worker' });
  const inv = await db.doc('inv/abcdefgh12').get(); assert.equal(inv.exists, true); assert.equal(inv.data().pid, 'p2'); ok('inv/<код>.get идёт через invite_get');
  assert.equal((await db.doc('inv/zzzzzzzz99').get()).exists, false); ok('неверный код -> exists=false');

  // пользователи
  const pr = await user.profiles([A, 'not-a-uuid']); assert.deepEqual(Object.keys(pr), [A]); ok('profiles пропускает не-uuid');
  const sr = await user.search('bo'); assert.equal(sr[0].isMe, false); assert.equal(sr[0].name, 'Bob'); ok('search возвращает isMe=false');
  assert.deepEqual(await user.search(''), []); ok('пустой поиск -> пусто');

  // ошибки
  be.failRpc = '42501';
  await db.doc('sp/x').set({ ownerId: B }).then(() => assert.fail('должна быть ошибка'), e => assert.equal(e.code, 'not_granted')); ok('42501 -> not_granted');
  be.failRpc = '54000';
  await db.doc('sp/x').set({}).then(() => assert.fail(), e => assert.equal(e.code, 'quota_exceeded')); ok('54000 -> quota_exceeded');
  be.failRpc = 'PGRST301';
  await db.doc('sp/x').set({}).then(() => assert.fail(), e => assert.equal(e.code, 'revoked')); ok('PGRST301 -> revoked');
  be.failRpc = null;
  await db.doc('sp/nope').update({ a: 1 }).then(() => assert.fail(), e => assert.equal(e.code, 'not_found')); ok('update несуществующего -> not_found');

  // sample.limits
  const sample = await wa.claude.use('sample'); const lim = await sample.limits();
  assert.deepEqual(lim.images.mediaTypes, ['image/png', 'image/jpeg', 'image/webp']); assert.equal(lim.images.maxCount, 4); ok('sample.limits');

  // sample.json: ходит на /api/sample с токеном
  let sent = null;
  wa.fetch = async (url, o) => { sent = { url, o }; return { ok: true, json: async () => ({ json: { rows: [] } }) }; };
  const out = await sample.json('prompt', { images: [], modelTier: 'default' });
  assert.deepEqual(out, { rows: [] }); assert.equal(sent.url, '/api/sample'); assert.equal(sent.o.headers.Authorization, 'Bearer tok-' + A); ok('sample.json: запрос с токеном, ответ разобран');
  wa.fetch = async () => ({ ok: false, json: async () => ({ error: { code: 'rate_limited', message: 'm' } }) });
  await sample('p').then(() => assert.fail(), e => assert.equal(e.code, 'rate_limited')); ok('ошибка сервера пробрасывается с кодом');
  let streamed = null; wa.fetch = async () => ({ ok: true, json: async () => ({ text: 'Итог' }) });
  const t = await sample('p', { onText: ({ text }) => { streamed = text; } }); assert.equal(t.text, 'Итог'); assert.equal(streamed, 'Итог'); ok('sample: text + onText');

  // без сессии: показывается экран входа и приложение ждёт
  const wn = boot(be, A, { noSession: true });
  let resolved = false; wn.claude.use('db').then(() => { resolved = true; });
  await wait(100);
  assert.equal(resolved, false); assert.ok(wn.document.querySelector('#kzForm')); assert.ok(/Войти/.test(wn.document.body.textContent)); ok('без входа: экран входа, приложение ждёт');
  { const calls = shimSrc.match(/auth\.signOut\([^)]*\)/g) || [];
    assert.ok(calls.length >= 1 && calls.every(c => /scope:\s*'local'/.test(c)), calls.join(', ')); ok('выход из аккаунта — только на этом устройстве (не выкидывает с других устройств)'); }
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
