// The note outline: which lines are headings, and how they nest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headings, outlineTree } from '../src/headings.mjs';

test('finds ATX headings with their level, text and line', () => {
  const md = '# Project\n\nintro\n## Steps (rough)\ntext\n### Deep ##\n#nottag\n####### seven';
  assert.deepEqual(headings(md), [
    { level: 1, text: 'Project', line: 1 },
    { level: 2, text: 'Steps (rough)', line: 4 },
    { level: 3, text: 'Deep', line: 6 },
  ]);
});

test('skips front matter and fenced code', () => {
  const md = '---\ntitle: x\n# not\n---\n# Real\n```\n# code\n```\n~~~py\n# also code\n~~~\n## After';
  assert.deepEqual(headings(md).map(h => h.text), ['Real', 'After']);
});

test('nests headings by level, jumps included', () => {
  const tree = outlineTree(headings('# A\n### A1\n## A2\n# B\n## B1'));
  const shape = n => n.map(h => [h.text, shape(h.children)]);
  assert.deepEqual(shape(tree), [['A', [['A1', []], ['A2', []]]], ['B', [['B1', []]]]]);
});
