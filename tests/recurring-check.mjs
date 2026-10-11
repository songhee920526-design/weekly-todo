// 반복 할일 기능(칩 선택 / 이름 수정·병합 / 삭제) 동작 테스트
// 실행: node tests/recurring-check.mjs   (Playwright + Chromium 필요)
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

function seed() {
  return {
    todos: [
      { id: 'manual1', text: '청소기', date: off(2), slot: 'before', createdAt: 1, isRecurringType: true },
    ],
    history: {
      '빨래하기': [{ date: off(-10), slot: 'before' }, { date: off(-6), slot: 'before' }],
      '빨래하귀': [{ date: off(-3), slot: 'before' }],
      '영양제': [{ date: off(-8), slot: 'after' }, { date: off(-4), slot: 'after' }],
    },
  };
}

let n = 0;
const browser = await chromium.launch();
async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const state = { data: seed(), saves: 0 };
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/todos') {
      if (route.request().method() === 'POST') {
        state.data = JSON.parse(route.request().postData());
        state.saves++;
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: state.data });
    }
    if (url.hostname === 'localhost' && url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    return route.abort();
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost/');
  await page.waitForSelector('#addInput');
  await page.waitForTimeout(450); // 초기 자동 생성 저장 대기
  return { page, state, errors, ctx };
}
const settle = page => page.waitForTimeout(450);
const ok = async (name, fn) => { const t = await fresh(); try { await fn(t); } finally { assert.deepEqual(t.errors, [], 'page errors'); await t.ctx.close(); } n++; console.log('ok', n, name); };
const openCycle = async page => { await page.click('#cycleBtn'); await page.waitForSelector('.cycle-row'); };

await ok('chips hidden until repeat toggle is on', async ({ page }) => {
  assert.equal(await page.locator('#recurChips.show').count(), 0);
  await page.click('#recurToggle');
  assert.equal(await page.locator('#recurChips.show').count(), 1);
  await page.click('#recurToggle');
  assert.equal(await page.locator('#recurChips.show').count(), 0);
});

await ok('chips list every repeat item and tapping fills the input exactly', async ({ page }) => {
  await page.click('#recurToggle');
  const chips = await page.locator('.chip').allTextContents();
  assert.deepEqual(chips.sort(), ['빨래하귀', '빨래하기', '영양제', '청소기'].sort());
  await page.locator('.chip', { hasText: '영양제' }).click();
  assert.equal(await page.inputValue('#addInput'), '영양제');
  assert.ok(await page.locator('.chip.selected', { hasText: '영양제' }).count() === 1);
});

await ok('adding via chip creates a repeat todo with the exact title', async ({ page, state }) => {
  await page.click('#recurToggle');
  await page.locator('.chip', { hasText: '빨래하기' }).click();
  await page.click('#addBtn');
  await settle(page);
  const added = state.data.todos.filter(t => t.text === '빨래하기' && !t.recurring);
  assert.equal(added.length, 1);
  assert.equal(added[0].isRecurringType, true);
});

await ok('rename without collision updates history and todo titles', async ({ page, state }) => {
  await openCycle(page);
  await page.locator('.cycle-row', { hasText: '영양제' }).locator('.js-edit').click();
  await page.fill('#cycleEditInput', '비타민');
  await page.click('.js-save');
  await settle(page);
  assert.ok(!('영양제' in state.data.history));
  assert.equal(state.data.history['비타민'].length, 2);
  assert.ok(state.data.todos.every(t => t.text !== '영양제'));
  assert.ok(state.data.todos.some(t => t.text === '비타민' && t.recurring));
});

await ok('rename onto existing title merges history and recalculates cycle', async ({ page, state }) => {
  await openCycle(page);
  await page.locator('.cycle-row', { hasText: '빨래하귀' }).locator('.js-edit').click();
  await page.fill('#cycleEditInput', '빨래하기');
  await page.press('#cycleEditInput', 'Enter');
  await settle(page);
  assert.ok(!('빨래하귀' in state.data.history));
  assert.equal(state.data.history['빨래하기'].length, 3);
  const auto = state.data.todos.filter(t => t.text === '빨래하기' && t.recurring).sort((a, b) => a.date < b.date ? -1 : 1);
  assert.ok(auto.length >= 3, 'upcoming regenerated');
  assert.ok(auto.every(t => t.cycleDays === 3), 'new cycle 3 days (4,3 -> 3.5 floored)');
  assert.equal(auto[0].date, off(0));
  assert.equal(new Set(auto.map(t => t.date)).size, auto.length, 'no duplicate dates');
  const row = await page.locator('.cycle-row', { hasText: '빨래하기' }).innerText();
  assert.match(row, /주기 3일마다/);
  assert.match(row, /완료 3번/);
  assert.equal(await page.locator('.cycle-row', { hasText: '빨래하귀' }).count(), 0);
});

await ok('empty rename is rejected and nothing changes', async ({ page, state }) => {
  await openCycle(page);
  await page.locator('.cycle-row', { hasText: '영양제' }).locator('.js-edit').click();
  await page.fill('#cycleEditInput', '   ');
  await page.click('.js-save');
  await settle(page);
  assert.ok('영양제' in state.data.history);
  assert.equal(await page.locator('#cycleEditInput').count(), 1, 'still editing');
});

await ok('cancel confirm keeps everything', async ({ page, state }) => {
  page.on('dialog', d => d.dismiss());
  await openCycle(page);
  await page.locator('.cycle-row', { hasText: '영양제' }).locator('.js-del').click();
  await settle(page);
  assert.ok('영양제' in state.data.history);
  assert.ok(state.data.todos.some(t => t.text === '영양제' && t.recurring));
});

await ok('delete removes history and scheduled todos after confirm', async ({ page, state }) => {
  let msg = '';
  page.on('dialog', d => { msg = d.message(); d.accept(); });
  await openCycle(page);
  await page.locator('.cycle-row', { hasText: '영양제' }).locator('.js-del').click();
  await settle(page);
  assert.match(msg, /정말 삭제할까요/);
  assert.ok(!('영양제' in state.data.history));
  assert.ok(state.data.todos.every(t => t.text !== '영양제'));
  assert.equal(await page.locator('.cycle-row', { hasText: '영양제' }).count(), 0);
  assert.ok('빨래하기' in state.data.history, 'others untouched');
});

await ok('deleting keeps a hand-added todo but unmarks it as repeating', async ({ page, state }) => {
  page.on('dialog', d => d.accept());
  await openCycle(page);
  await page.locator('.cycle-row', { hasText: '청소기' }).locator('.js-del').click();
  await settle(page);
  const t = state.data.todos.find(x => x.id === 'manual1');
  assert.ok(t, 'todo kept');
  assert.equal(t.isRecurringType, false);
  assert.equal(await page.locator('.cycle-row', { hasText: '청소기' }).count(), 0);
});

await browser.close();
console.log(`\n${n} behavior tests passed`);
