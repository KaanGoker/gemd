import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrap, link } from '../src/format.mjs';

const run = (t, r) => { let s = t; for (const c of [...r.changes].sort((a, b) => b.from - a.from)) s = s.slice(0, c.from) + c.insert + s.slice(c.to ?? c.from); return [s, s.slice(r.from, r.to)]; };

test('wrap adds and removes marks around the selection', () => {
  assert.deepEqual(run('a word b', wrap('a word b', 2, 6, '**')), ['a **word** b', 'word']);
  assert.deepEqual(run('a **word** b', wrap('a **word** b', 4, 8, '**')), ['a word b', 'word']);
  assert.deepEqual(run('a **word** b', wrap('a **word** b', 2, 10, '**')), ['a word b', 'word']);
  assert.deepEqual(run('ab', wrap('ab', 1, 1, '*')), ['a**b', '']);
  assert.deepEqual(run('x', wrap('x', 0, 1, '%%')), ['%%x%%', 'x']);
});

test('link puts the selection in the text or the address', () => {
  assert.deepEqual(run('see docs', link('see docs', 4, 8)), ['see [docs]()', '']);
  assert.equal(link('see docs', 4, 8).from, 11);
  assert.deepEqual(run('go https://a.b', link('go https://a.b', 3, 14)), ['go [](https://a.b)', '']);
  assert.equal(link('', 0, 0).from, 1);
});
