// 설정 화면 / 고정 항목(고정일·고정 주기) / 목록 색·순서 동작 테스트
// 실행: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/fixed-check.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/npm-tools/node_modules/playwright']) {
  try { ({ chromium } = require(p)); break; } catch {}
}
if (!chromium) { console.error('playwright not found'); process.exit(1); }

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const off = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return iso(d); };
const dow = s => new Date(s + 'T00:00:00').getDay();
const diffDays = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const isWeekend = s => dow(s) === 0 || dow(s) === 6;

let n = 0;
let launchOpts = {};
let browser;
try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }

async function fresh(initial) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await ctx.newPage();
  const state = { data: initial || { todos: [], history: {}, rules: {} }, saves: 0 };
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/todos') {
      if (route.request().method() === 'POST') { state.data = JSON.parse(route.request().postData()); state.saves++; return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: state.data });
    }
    if (url.hostname === 'localhost' && url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    return route.abort();
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost/');
  await page.waitForSelector('#addInput');
  await page.waitForTimeout(450);
  return { page, state, errors, ctx };
}
const settle = page => page.waitForTimeout(450);
const ok = async (name, fn, initial) => {
  const t = await fresh(initial);
  try { await fn(t); } finally { assert.deepEqual(t.errors, [], 'page errors'); await t.ctx.close(); }
  n++; console.log('ok', n, name);
};
const openSettings = async page => { await page.click('#cycleBtn'); await page.waitForSelector('#settings.show'); };
const addFixedDay = async (page, name, { weeks = 1, wd = 5, slot = 'after' } = {}) => {
  await openSettings(page);
  await page.fill('#fixName', name);
  await page.click('#fixForm [data-mode="day"]');
  await page.selectOption('#fxWeeks', String(weeks));
  await page.click(`#fxWd button[data-wd="${wd}"]`);
  await page.click(`#fixForm [data-slot="${slot}"]`);
  await page.click('#fxAdd');
  await settle(page);
};
const fixedDates = (data, key) => data.todos.filter(t => t.fixed && t.text === key).map(t => t.date).sort();

await ok('gear opens settings: fixed tab first, variable tab holds the old cycle list, back closes', async ({ page }) => {
  await openSettings(page);
  assert.equal(await page.locator('#tabFix').isVisible(), true);
  assert.equal(await page.locator('#tabVar').isVisible(), false);
  await page.click('.tab[data-tab="var"]');
  assert.equal(await page.locator('#tabVar').isVisible(), true);
  assert.equal(await page.locator('#cycleList .cycle-row').count(), 1);
  await page.click('#setBack');
  assert.equal(await page.locator('#settings.show').count(), 0);
}, { todos: [], history: { '영양제': [{ date: off(-8), slot: 'after' }, { date: off(-4), slot: 'after' }] }, rules: {} });

await ok('설거지: 매주 금요일 퇴근후 creates weekly Friday evening todos', async ({ page, state }) => {
  await addFixedDay(page, '설거지', { weeks: 1, wd: 5, slot: 'after' });
  const r = state.data.rules['설거지'];
  assert.equal(r.type, 'day'); assert.equal(r.weeks, 1); assert.equal(r.weekday, 5); assert.equal(r.slot, 'after');
  const dates = fixedDates(state.data, '설거지');
  assert.ok(dates.length >= 12, 'about 13 Fridays in 90 days, got ' + dates.length);
  assert.ok(dates.every(d => dow(d) === 5), 'all Fridays');
  assert.ok(dates.slice(1).every((d, i) => diffDays(dates[i], d) === 7), 'weekly');
  assert.ok(dates[0] >= off(0) && diffDays(off(0), dates[0]) < 7, 'first Friday within a week');
  assert.ok(state.data.todos.filter(t => t.text === '설거지').every(t => t.slot === 'after' && t.fixed === true));
  assert.ok(!state.data.todos.some(t => t.text === '설거지' && (t.recurring || t.isRecurringType)), 'not mixed into 변동 주기');
  assert.equal(Object.keys(state.data.history).length, 0);
});

await ok('이번 주 금요일 퇴근후 칸에 빨간 글씨로 보임', async ({ page }) => {
  await addFixedDay(page, '설거지');
  await page.click('#setBack');
  const li = page.locator('li.item', { hasText: '설거지' }).first();
  assert.equal(await li.locator('.item-text').getAttribute('class'), 'item-text k-fix');
  assert.equal(await li.locator('.item-text').evaluate(e => getComputedStyle(e).color), 'rgb(163, 53, 46)');
  assert.ok(await li.evaluate(e => e.closest('.slot-block').querySelector('.slot-label').textContent) === '퇴근후');
});

await ok('completing a fixed-day todo does not recreate it or change the others', async ({ page, state }) => {
  await addFixedDay(page, '설거지');
  await page.click('#setBack');
  const before = fixedDates(state.data, '설거지');
  await page.locator('li.item', { hasText: '설거지' }).first().locator('.check').click();
  await settle(page);
  const after = fixedDates(state.data, '설거지');
  assert.deepEqual(after, before.slice(1), 'only the completed one is gone');
  await page.reload(); await page.waitForSelector('#addInput'); await settle(page);
  assert.deepEqual(fixedDates(state.data, '설거지'), before.slice(1), 'still gone after reload');
  assert.equal(Object.keys(state.data.history).length, 0, 'no history / no average');
});

await ok('postponing then completing a fixed-day todo leaves later Fridays alone', async ({ page, state }) => {
  await addFixedDay(page, '설거지');
  await page.click('#setBack');
  const before = fixedDates(state.data, '설거지');
  const li = page.locator('li.item', { hasText: '설거지' }).first();
  await li.locator('button.act[aria-label="미루기"]').click();
  await settle(page);
  await page.locator('li.item', { hasText: '설거지' }).locator('.check').first().click();
  await settle(page);
  assert.deepEqual(fixedDates(state.data, '설거지').slice(0, 3), before.slice(1, 4));
});

await ok('2주마다 월요일: every 14 days, weekday kept', async ({ page, state }) => {
  await addFixedDay(page, '침구 정리', { weeks: 2, wd: 1, slot: 'before' });
  const dates = fixedDates(state.data, '침구 정리');
  assert.ok(dates.length >= 6);
  assert.ok(dates.every(d => dow(d) === 1));
  assert.ok(dates.slice(1).every((d, i) => diffDays(dates[i], d) === 14));
  assert.match(await page.locator('#fixedList .cycle-row').first().innerText(), /2주마다 월요일 · 출근전/);
});

await ok('weekend weekday goes to 하루 (weekend slot)', async ({ page, state }) => {
  await addFixedDay(page, '장보기', { weeks: 1, wd: 6, slot: 'before' });
  const todos = state.data.todos.filter(t => t.text === '장보기');
  assert.ok(todos.length >= 12 && todos.every(t => t.slot === 'weekend'));
  assert.match(await page.locator('#fixedList .cycle-row').first().innerText(), /매주 토요일 · 하루/);
});

await ok('fixed cycle: late completion restarts the count from the written date', async ({ state, page }) => {
  await page.locator('li.item', { hasText: '화분 물주기' }).locator('.check').click(); // off(2)에 적힌 날짜
  await settle(page);
  const dates = fixedDates(state.data, '화분 물주기');
  assert.deepEqual(dates.slice(0, 3).map(d => diffDays(off(2), d)), [14, 28, 42]);
  assert.ok(dates.every(d => diffDays(off(2), d) % 14 === 0));
  assert.equal(state.data.history['화분 물주기'], undefined, 'no average / history');
  assert.equal(state.data.rules['화분 물주기'].days, 14, 'cycle never changes');
}, { todos: [2, 14, 28].map((k, i) => ({ id: 'c' + i, text: '화분 물주기', date: off(k), slot: isWeekend(off(k)) ? 'weekend' : 'before', createdAt: 1, fixed: true })), history: {}, rules: { '화분 물주기': { type: 'cycle', days: 14, slot: 'before' } } });

await ok('fixed cycle added from settings: one todo today, then series after completing', async ({ page, state }) => {
  await openSettings(page);
  await page.fill('#fixName', '화분 물주기');
  await page.click('#fixForm [data-mode="cycle"]');
  await page.fill('#fxDays', '10');
  await page.click('#fixForm [data-slot="before"]');
  await page.click('#fxAdd');
  await settle(page);
  assert.deepEqual(state.data.todos.filter(t => t.fixed).map(t => t.date), [off(0)], 'only the first todo');
  assert.deepEqual(state.data.rules['화분 물주기'], { type: 'cycle', days: 10, slot: 'before' });
  await page.click('#setBack');
  await page.locator('li.item', { hasText: '화분 물주기' }).locator('.check').click();
  await settle(page);
  const d = fixedDates(state.data, '화분 물주기');
  assert.deepEqual(d.slice(0, 3).map(x => diffDays(off(0), x)), [10, 20, 30]);
});

await ok('validation: empty name, duplicate, name used by 변동 주기, bad day count', async ({ page, state }) => {
  await openSettings(page);
  await page.click('#fxAdd'); await settle(page);
  assert.equal(Object.keys(state.data.rules).length, 0);
  await page.fill('#fixName', '영양제'); await page.click('#fxAdd'); await settle(page);
  assert.equal(Object.keys(state.data.rules).length, 0, '영양제 is a 변동 주기 title');
  await page.fill('#fixName', '설거지'); await page.click('#fxAdd'); await settle(page);
  await page.fill('#fixName', '설거지'); await page.click('#fxAdd'); await settle(page);
  assert.equal(Object.keys(state.data.rules).length, 1, 'duplicate refused');
  await page.fill('#fixName', '화분'); await page.click('#fixForm [data-mode="cycle"]'); await page.fill('#fxDays', '0'); await page.click('#fxAdd'); await settle(page);
  assert.equal(Object.keys(state.data.rules).length, 1, 'days out of range refused');
}, { todos: [], history: { '영양제': [{ date: off(-8), slot: 'after' }, { date: off(-4), slot: 'after' }] }, rules: {} });

await ok('delete fixed item: cancel keeps, confirm removes rule and scheduled todos', async ({ page, state }) => {
  await addFixedDay(page, '설거지');
  const keep = state.data.todos.filter(t => t.fixed).length;
  page.once('dialog', d => d.dismiss());
  await page.locator('#fixedList .cycle-row', { hasText: '설거지' }).locator('.js-fixdel').click();
  await settle(page);
  assert.equal(state.data.todos.filter(t => t.fixed).length, keep);
  let msg = '';
  page.once('dialog', d => { msg = d.message(); d.accept(); });
  await page.locator('#fixedList .cycle-row', { hasText: '설거지' }).locator('.js-fixdel').click();
  await settle(page);
  assert.match(msg, /정말 삭제할까요/);
  assert.equal(state.data.rules['설거지'], undefined);
  assert.equal(state.data.todos.filter(t => t.fixed).length, 0);
  assert.match(await page.locator('#fixedList').innerText(), /아직 고정 항목이 없어요/);
});

await ok('list colors and order: 검(일회성) → 파(변동) → 빨(고정), no 🔁 badge', async ({ page }) => {
  const els = await page.locator('li.item .item-text').evaluateAll(a => a.map(e => ({ t: e.textContent, c: e.className, col: getComputedStyle(e).color })));
  const mine = els.filter(e => ['일회성', '변동', '고정'].includes(e.t));
  assert.deepEqual(mine.map(e => e.t), ['일회성', '변동', '고정']);
  assert.deepEqual(mine.map(e => e.col), ['rgb(35, 42, 61)', 'rgb(43, 94, 167)', 'rgb(163, 53, 46)']);
  assert.equal(await page.locator('li.item >> text=🔁').count(), 0);
}, (() => { const d = off(1); const slot = isWeekend(d) ? 'weekend' : 'before';
  return { todos: [
    { id: 'x1', text: '고정', date: d, slot, createdAt: 1, fixed: true },
    { id: 'x2', text: '변동', date: d, slot, createdAt: 2, isRecurringType: true, recurring: true },
    { id: 'x3', text: '일회성', date: d, slot, createdAt: 3 },
  ], history: {}, rules: {} }; })());

await ok('renaming a fixed todo on the list detaches it (turns into a normal black todo)', async ({ page, state }) => {
  const el = page.locator('li.item .item-text', { hasText: '고정할일' });
  await el.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('다른 이름');
  await page.keyboard.press('Enter');
  await settle(page);
  const t = state.data.todos.find(x => x.id === 'y1');
  assert.equal(t.text, '다른 이름'); assert.equal(t.fixed, false);
  assert.equal(await page.locator('li.item .item-text', { hasText: '다른 이름' }).getAttribute('class'), 'item-text k-one');
}, (() => { const d = off(1); return { todos: [{ id: 'y1', text: '고정할일', date: d, slot: isWeekend(d) ? 'weekend' : 'before', createdAt: 1, fixed: true }], history: {}, rules: { '고정할일': { type: 'cycle', days: 7, slot: 'before' } } }; })());

await ok('old data without rules still loads; 변동 주기 toggle label still works', async ({ page }) => {
  await page.click('#recurToggle');
  assert.equal(await page.locator('#recurChips.show').count(), 1);
  assert.equal(await page.locator('.chip').count(), 0, 'no chips for fixed items');
}, { todos: [], history: {} });

await browser.close();
console.log(`\n${n} fixed/settings tests passed`);
