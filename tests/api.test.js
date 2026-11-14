// Тест серверной функции api/sample.js с подменой fetch
const assert = require('assert');
const handler = require('../api/sample.js');
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';

let anthropicReply = { status: 200, body: { content: [{ type: 'text', text: '{"rows":[{"campaign":"A","spend":10}]}' }] } };
let userOk = true, calls = [];
global.fetch = async (url, opts) => {
  calls.push({ url, opts });
  if (String(url).includes('/auth/v1/user')) return userOk ? { ok: true, json: async () => ({ id: 'u1' }) } : { ok: false, json: async () => ({}) };
  return { ok: anthropicReply.status === 200, status: anthropicReply.status, json: async () => anthropicReply.body };
};
const mkRes = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const call = async (body, auth = 'Bearer tok', method = 'POST', extra = {}) => { const res = mkRes(); await handler({ method, headers: { authorization: auth, ...extra }, body }, res); return res; };
let n = 0; const ok = (name) => { n++; console.log('PASS ' + name); };

(async () => {
  let r = await call({}, 'Bearer tok', 'GET'); assert.equal(r.code, 405); ok('GET отклонён');
  userOk = false; r = await call({ prompt: 'hi' }); assert.equal(r.code, 401); assert.equal(r.body.error.code, 'not_granted'); ok('без входа — 401');
  userOk = true;
  r = await call({ prompt: '' }); assert.equal(r.code, 400); ok('пустой запрос — 400');
  r = await call({ prompt: 'x'.repeat(60001) }); assert.equal(r.code, 413); assert.equal(r.body.error.code, 'prompt_too_large'); ok('слишком длинный запрос — 413');
  r = await call({ prompt: 'p', images: [{ media_type: 'image/gif', data: 'AAAA' }] }); assert.equal(r.code, 400); assert.equal(r.body.error.code, 'image_rejected'); ok('gif отклонён');
  r = await call({ prompt: 'p', images: Array(5).fill({ media_type: 'image/png', data: 'AAAA' }) }); assert.equal(r.code, 400); ok('больше 4 картинок отклонено');
  r = await call({ prompt: 'p', images: [{ media_type: 'image/png', data: 'не base64!' }] }); assert.equal(r.code, 400); ok('мусор вместо base64 отклонён');

  calls = [];
  r = await call({ prompt: 'Верни JSON', mode: 'json', images: [{ media_type: 'image/jpeg', data: 'AAAA' }] });
  assert.equal(r.code, 200); assert.deepEqual(r.body.json, { rows: [{ campaign: 'A', spend: 10 }] }); ok('json-режим: ответ разобран');
  const sent = JSON.parse(calls.find(c => String(c.url).includes('anthropic')).opts.body);
  assert.equal(sent.model, 'claude-sonnet-5-5'); assert.equal(sent.messages[0].content[0].type, 'image'); assert.equal(sent.messages[0].content[1].type, 'text');
  assert.equal(calls.find(c => String(c.url).includes('anthropic')).opts.headers['x-api-key'], 'test-key'); ok('запрос к Claude собран верно (модель, картинка+текст, ключ)');
  assert.ok(!JSON.stringify(r.body).includes('test-key')); ok('ключ не утекает в ответ');

  // свой ключ из «Настройки → AI» (заголовок x-anthropic-key) — вместо ключа сервера; неверный — понятная ошибка
  const own = 'sk-ant-api03-' + 'a'.repeat(40); calls = [];
  r = await call({ prompt: 'p', mode: 'json' }, 'Bearer tok', 'POST', { 'x-anthropic-key': own });
  assert.equal(calls.find(c => String(c.url).includes('anthropic')).opts.headers['x-api-key'], own); ok('свой ключ используется вместо ключа сервера');
  assert.ok(!JSON.stringify(r.body).includes(own)); ok('свой ключ не утекает в ответ');
  calls = []; await call({ prompt: 'p', mode: 'json' }, 'Bearer tok', 'POST', { 'x-anthropic-key': 'мусор' });
  assert.equal(calls.find(c => String(c.url).includes('anthropic')).opts.headers['x-api-key'], 'test-key'); ok('кривой ключ игнорируется — ключ сервера');
  anthropicReply = { status: 401, body: { error: { message: 'invalid x-api-key' } } };
  r = await call({ prompt: 'p' }, 'Bearer tok', 'POST', { 'x-anthropic-key': own }); assert.equal(r.body.error.code, 'bad_key'); ok('неверный свой ключ — bad_key');
  const envKey = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  r = await call({ prompt: 'p' }); assert.equal(r.body.error.code, 'no_key'); ok('нет ни своего, ни серверного ключа — no_key');
  process.env.ANTHROPIC_API_KEY = envKey;
  anthropicReply = { status: 200, body: { content: [{ type: 'text', text: '```json\n{"a":1}\n```' }] } };
  r = await call({ prompt: 'p', mode: 'json' }); assert.deepEqual(r.body.json, { a: 1 }); ok('json в ```-обёртке разобран');
  anthropicReply = { status: 200, body: { content: [{ type: 'text', text: 'не json' }] } };
  r = await call({ prompt: 'p', mode: 'json' }); assert.equal(r.code, 422); assert.equal(r.body.error.code, 'invalid_json'); ok('не-json -> invalid_json');
  anthropicReply = { status: 200, body: { content: [{ type: 'text', text: 'Резюме' }, { type: 'text', text: ' готово' }] } };
  r = await call({ prompt: 'p' }); assert.deepEqual(r.body, { text: 'Резюме готово' }); ok('текстовый режим');
  anthropicReply = { status: 429, body: { error: { message: 'rl' } } };
  r = await call({ prompt: 'p' }); assert.equal(r.code, 429); assert.equal(r.body.error.code, 'rate_limited'); ok('429 от Claude -> rate_limited');
  anthropicReply = { status: 500, body: { error: { message: 'boom' } } };
  r = await call({ prompt: 'p' }); assert.equal(r.code, 502); ok('сбой Claude -> 502');

  // лимит на человека: 20 за окно (часть уже израсходована выше)
  anthropicReply = { status: 200, body: { content: [{ type: 'text', text: 'ok' }] } };
  let last; for (let i = 0; i < 25; i++) last = await call({ prompt: 'p' });
  assert.equal(last.code, 429); ok('лимит запросов на человека работает');
  console.log(`\nИтого: ${n} проверок прошло`);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
