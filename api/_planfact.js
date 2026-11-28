// План-факт роликов для бота Kaizen AI (файл с «_» — Vercel не делает из него отдельную функцию): из сводки (pf_get) собирает короткий текстовый ответ.
// Сводка: { title, page, accounts:[…], best:{url,views,account} (лучший ролик недели), digest, weekPlan, weekPlans:{ "YYYY-MM-DD"(понедельник): N },
//           days:{ "YYYY-MM-DD": { pubs, fresh, views, acc:{ имя: N } } }, checked_at, fetch_error }
// Неделя Пн–Вс, время Алматы. Светофор: успеваем ли к плану недели по темпу (план × прошедшие дни / 7).

const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const today0 = now => { const t = new Date((now || Date.now()) + 5 * 3600e3); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())); };
const iso = d => d.toISOString().slice(0, 10);
const add = (d, n) => new Date(d.getTime() + n * 864e5);
const monday = d => add(d, -((d.getUTCDay() + 6) % 7));
const human = d => d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
const fmt = n => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ');
const plural = (n, a, b, c) => { n = Math.abs(Math.round(n)); const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };
const pubW = n => plural(n, 'публикация', 'публикации', 'публикаций');
const light = (f, p) => p <= 0 ? 'n' : f / p >= 1 ? 'g' : f / p >= 0.8 ? 'y' : 'r';
const DOT = { g: '🟢', y: '🟡', r: '🔴', n: '⚪️' };
const VERD = { g: 'Успеваем', y: 'Немного не успеваем', r: 'Не успеваем', n: 'Плана нет' };

// вопрос про план-факт (текст или расшифровка голосового)
const PF_RX = /план[\s\-–—]*(и\s*)?факт|^\/planfact\b|^(📊\s*)?план-факт$|(отста[её]м|успева[её]м)[^.!]*\?|выполня[её]м\s+(ли\s+)?план|сколько\s+(\S+\s+){0,4}(вышл|опубликова|выложи)/i;

function planFactText(s, q, now) {
  const t = today0(now), days = s.days || {}, wp = s.weekPlans || {};
  const planOf = k => Math.max(0, +(wp[k] != null ? wp[k] : s.weekPlan) || 0);
  const rec = d => { const r = days[iso(d)] || {}; return { pubs: +r.pubs || 0, fresh: +r.fresh || 0, views: +r.views || 0, acc: r.acc || {} }; };
  const accs = Array.isArray(s.accounts) ? s.accounts : [];

  // неделя
  const ws = monday(t), plan = planOf(iso(ws)); let fact = 0, fresh = 0, views = 0, elapsed = 0; const per = {};
  accs.forEach(a => per[a] = 0);
  for (let i = 0; i < 7; i++) { const d = add(ws, i); if (d > t) break; const r = rec(d); fact += r.pubs; fresh += r.fresh; views += r.views; elapsed++;
    Object.keys(r.acc).forEach(a => per[a] = (per[a] || 0) + (+r.acc[a] || 0)); }
  const pace = plan * elapsed / 7, l = light(fact, pace), left = Math.max(0, plan - fact), daysLeft = Math.max(1, 7 - elapsed + 1);
  const pct = plan ? Math.round(fact / plan * 100) : 0, todayPubs = rec(t).pubs;

  // месяц
  const ms = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)), last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0));
  let mPlan = 0, mPace = 0, mFact = 0;
  for (let d = new Date(ms); d <= last; d = add(d, 1)) { const dp = planOf(iso(monday(d))) / 7; mPlan += dp; if (d <= t) { mPace += dp; mFact += rec(d).pubs; } }
  const ml = light(mFact, mPace), mPct = mPlan ? Math.round(mFact / mPlan * 100) : 0;

  const lines = [];
  lines.push(`📊 ${s.title || 'План-факт роликов'}`);
  lines.push('');
  if (q === 'вечер') {   // вечерний обзор: сначала итог дня
    const r = rec(t), best = s.best;
    lines.push(`Сегодня, ${human(t)}: ${r.pubs} ${pubW(r.pubs)}, новых роликов ${r.fresh}, просмотров ${fmt(r.views)}.`);
    const accDay = Object.keys(r.acc).filter(a => +r.acc[a]).map(a => `@${a} ${r.acc[a]}`);
    if (accDay.length) lines.push(`По аккаунтам: ${accDay.join(', ')}.`);
    if (best && best.url && /^https:\/\//.test(best.url)) lines.push(`Лучший ролик недели: ${fmt(+best.views || 0)} просм., @${best.account || ''} ${best.url}`);
    lines.push('');
  }
  lines.push(`Неделя ${human(ws)} – ${human(add(ws, 6))}: вышло ${fact} из ${plan} ${pubW(plan)} (${pct}%).`);
  if (left === 0 && plan > 0) lines.push(`🟢 План недели выполнен.`);
  else lines.push(`${DOT[l]} ${VERD[l]}: к сегодняшнему дню по плану ${Math.round(pace)}. Осталось ${left}, это примерно ${Math.ceil(left / daysLeft)} в день до воскресенья.`);
  if (q !== 'вечер') lines.push(`Сегодня вышло: ${todayPubs}.`);
  const accLines = Object.keys(per).filter(a => accs.includes(a) || per[a]).map(a => `• @${a}: ${per[a] || 0}`);
  if (accLines.length) { lines.push(''); lines.push('По аккаунтам за неделю:'); lines.push(...accLines); }
  lines.push('');
  lines.push(`Новых роликов: ${fresh}. Просмотров: ${fmt(views)}${fact ? ` (${fmt(views / fact)} на публикацию)` : ''}.`);
  lines.push(`${MONTHS[t.getUTCMonth()]}: вышло ${mFact} из ${Math.round(mPlan)} (${mPct}%) ${DOT[ml]}`);
  const at = s.checked_at ? new Date(s.checked_at) : null;
  if (at && !isNaN(at)) lines.push('', `Данные на ${new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(at)}.` + (s.fetch_error ? ' Свежий сбор не прошёл, новых роликов может не хватать.' : ''));
  if (s.page && /^https:\/\//.test(s.page)) lines.push(`Подробно: ${s.page}`);
  return lines.join('\n');
}

// живая проверка: публикации из ответа Apify (instagram-reel-scraper) → дни недели в формате сводки.
// Один ролик в нескольких аккаунтах узнаём по длительности видео (до 0,01 с), он «новый» в день первой публикации.
function liveDays(items, now) {
  const t = today0(now), ws = monday(t), days = {};
  const vids = (Array.isArray(items) ? items : []).filter(x => x && x.timestamp && x.url && !x.error && (x.videoUrl || x.videoDuration))
    .map(x => ({ ts: Date.parse(x.timestamp), url: String(x.url).replace('/p/', '/reel/'), account: x.ownerUsername || '',
      dur: Math.round((+x.videoDuration || 0) * 100) / 100, views: +(x.videoPlayCount || x.videoViewCount) || 0 }))
    .filter(x => !isNaN(x.ts)).sort((a, b) => a.ts - b.ts);
  const seen = new Set(), keys = new Set(); let best = null;
  for (const v of vids) {
    const k = v.url; if (keys.has(k)) continue; keys.add(k);
    const d = iso(today0(v.ts)); if (d < iso(ws) || d > iso(t)) continue;
    const r = days[d] || (days[d] = { pubs: 0, fresh: 0, views: 0, acc: {} });
    const id = v.dur || v.url; const fresh = !seen.has(id); seen.add(id);
    r.pubs++; r.fresh += fresh ? 1 : 0; r.views += v.views; r.acc[v.account] = (r.acc[v.account] || 0) + 1;
    if (!best || v.views > best.views) best = { url: v.url, views: v.views, account: v.account };
  }
  return { days, best };
}

// сводка + живая проверка: дни этой недели берём из проверки, если в ней не меньше публикаций (Apify иногда пропускает ролики)
function mergeLive(s, live, now) {
  const t = today0(now), ws = monday(t), days = { ...(s.days || {}) };
  for (let i = 0; i < 7; i++) { const k = iso(add(ws, i)); const l = live.days[k];
    if (l && l.pubs >= (+(days[k] || {}).pubs || 0)) days[k] = l; }
  return { ...s, days, best: live.best || s.best, checked_at: new Date(now || Date.now()).toISOString(), fetch_error: null };
}

module.exports = { PF_RX, planFactText, liveDays, mergeLive, sinceMonday: now => { const t = today0(now); return (t.getUTCDay() + 6) % 7 + 1; } };
