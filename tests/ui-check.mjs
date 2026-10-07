import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok', n, name); };

ok('viewport blocks zoom', () => {
  const m = html.match(/<meta name="viewport" content="([^"]+)"/)[1];
  assert.match(m, /maximum-scale=1(\.0)?/);
  assert.match(m, /user-scalable=no/);
});
ok('no bare :hover outside hover media query', () => {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const stripped = css.replace(/@media \(hover:hover\) and \(pointer:fine\)\{[\s\S]*?\n  \}/, '');
  assert.ok(!/:hover/.test(stripped), 'found :hover outside media query');
  assert.ok(/@media \(hover:hover\)/.test(css));
});
ok('editable/item text >= 16px (no iOS focus zoom)', () => {
  for (const sel of ['.item-text', '.overdue-text']) {
    const m = html.match(new RegExp(sel.replace('.', '\\.') + '\\{[^}]*font-size:([\\d.]+)px'));
    assert.ok(m && parseFloat(m[1]) >= 16, sel);
  }
});
ok('item max-height fits larger text', () => {
  assert.match(html, /max-height:160px/);
});
ok('touch-action manipulation set', () => {
  assert.match(html, /touch-action:manipulation/);
});
ok('delete button reachable on touch (focus-within)', () => {
  assert.match(html, /li\.item:focus-within \.del\{ opacity:1; \}/);
});
ok('gesture zoom blocked, no touchend preventDefault', () => {
  assert.match(html, /gesturestart/);
  assert.ok(!/touchend/.test(html));
});
ok('inline script parses', () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length > 0);
  scripts.forEach(sc => new vm.Script(sc));
});
console.log(`\n${n} tests passed`);
