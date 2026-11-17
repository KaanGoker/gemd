import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitLink, findAnchor, section, renameLinks } from '../src/links.mjs';

const note = '---\ntags: x\n---\n# Top\n\nintro\n\n## Plan **A**\n\nstep ^s1\n\n```\n## not a heading\n```\n\n### Sub\n\nmore\n\n## Next\n\nend';

test('splitLink separates the note from the heading or block', () => {
  assert.deepEqual(splitLink('Note#Plan A'), ['Note', 'Plan A']);
  assert.deepEqual(splitLink('Note#^s1'), ['Note', '^s1']);
  assert.deepEqual(splitLink('#Next'), ['', 'Next']);
  assert.deepEqual(splitLink('Note'), ['Note', '']);
});

test('findAnchor finds headings without formatting, nested parts and blocks, not inside code', () => {
  const lines = note.split('\n');
  assert.equal(lines[findAnchor(note, 'plan a')], '## Plan **A**');
  assert.equal(lines[findAnchor(note, 'Top#Plan A#Sub')], '### Sub');
  assert.equal(lines[findAnchor(note, '^s1')], 'step ^s1');
  assert.equal(findAnchor(note, 'not a heading'), -1);
  assert.equal(findAnchor(note, 'missing'), -1);
});

test('section gives the note body, a heading with its subheadings, or a block', () => {
  assert.ok(section(note, '').startsWith('# Top'));
  assert.equal(section(note, 'Plan A'), '## Plan **A**\n\nstep ^s1\n\n```\n## not a heading\n```\n\n### Sub\n\nmore');
  assert.equal(section(note, 'Next'), '## Next\n\nend');
  assert.equal(section(note, '^s1'), 'step');
  assert.equal(section(note, 'nope'), null);
});

test('renameLinks rewrites wikilinks and Markdown links to the renamed file', () => {
  const t = 'a [[Old Note]] b [[old note|alias]] c ![[Old Note#H]] d [[dir/Old Note]] e [[Old Notes]] f [x](Old%20Note.md) g [y](../Old Note.md#h)';
  const [out, n] = renameLinks(t, 'Old Note', 'New One');
  assert.equal(out, 'a [[New One]] b [[New One|alias]] c ![[New One#H]] d [[dir/New One]] e [[Old Notes]] f [x](New%20One.md) g [y](../New One.md#h)');
  assert.equal(n, 6);
  assert.deepEqual(renameLinks('![[a.png]] ![[a.png|200]]', 'a.png', 'b.png', false), ['![[b.png]] ![[b.png|200]]', 2]);
  assert.deepEqual(renameLinks('nothing here', 'x', 'y'), ['nothing here', 0]);
});
