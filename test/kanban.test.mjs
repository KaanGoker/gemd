import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// Optional: a real Obsidian Kanban file for the lossless tests, e.g. GEMD_BOARD=~/vault/To\ Do.md npm test
const REAL = process.env.GEMD_BOARD;
const skipReal = !REAL || !existsSync(REAL);
import { isKanban, parse, moveCard, toggle, apply, addCard, settings, setSetting, cardSource, editCard, deleteCard, duplicateCard, archiveCards, addLane, renameLane, deleteLane, moveLane, sortLane, archiveLane, blockId, foldSplice, rebase, setDate, linkCard, tagsOf, insertCard, diffRange } from '../src/kanban.mjs';

const sample = '---\n\nkanban-plugin: board\n\n---\n\n## A\n\n- [ ] one #x\n\t- [ ] sub\n- [x] two\n\n\n## B\n\n\n\n## C\n\n- [ ] three\n- plain note\n\n%% kanban:settings\n```\n{"complete-lists":["C"]}\n```\n%%';

test('parses lanes, cards and subs', () => {
  assert.ok(isKanban(sample));
  const lanes = parse(sample);
  assert.deepEqual(lanes.map(l => l.title), ['A', 'B', 'C']);
  assert.equal(lanes[0].cards.length, 2);
  assert.equal(lanes[0].cards[0].subs[0].text, 'sub');
  assert.equal(lanes[0].cards[1].checked, true);
});

test('move to empty lane and back restores the text byte for byte', () => {
  let lanes = parse(sample);
  let t = apply(sample, moveCard(sample, lanes[0].cards[0], lanes[1], null));
  lanes = parse(t);
  assert.equal(lanes[1].cards[0].text, 'one #x');
  assert.equal(lanes[1].cards[0].subs.length, 1);
  assert.equal(lanes[0].cards.length, 1);
  t = apply(t, moveCard(t, lanes[1].cards[0], lanes[0], lanes[0].cards[0]));
  assert.equal(t, sample);
});

test('move down past later lanes and before a card', () => {
  const lanes = parse(sample);
  const t = apply(sample, moveCard(sample, lanes[0].cards[1], lanes[2], lanes[2].cards[0]));
  assert.deepEqual(parse(t)[2].cards.map(c => c.text), ['two', 'three', 'plain note']);
});

test('dropping a card on itself is a no-op', () => {
  const lanes = parse(sample);
  assert.deepEqual(moveCard(sample, lanes[0].cards[0], lanes[0], lanes[0].cards[1]), []);
});

test('toggle twice is identity', () => {
  const c = parse(sample)[0].cards[0];
  const t = apply(sample, toggle(sample, c.marker));
  assert.equal(parse(t)[0].cards[0].checked, true);
  assert.equal(apply(t, toggle(t, c.marker)), sample);
});

test('real board: every card moved out and back is lossless', { skip: skipReal }, () => {
  const real = readFileSync(REAL, 'utf8');
  const lanes = parse(real);
  assert.ok(lanes.length > 5);
  for (const [li, lane] of lanes.entries()) for (const [ci] of lane.cards.entries()) {
    let l = parse(real);
    const target = l[(li + 1) % l.length];
    let t = apply(real, moveCard(real, l[li].cards[ci], target, null));
    l = parse(t);
    const moved = l[(li + 1) % l.length].cards.at(-1);
    t = apply(t, moveCard(t, moved, l[li], l[li].cards[ci] ?? null));
    assert.equal(t, real, `lane ${lane.title} card ${ci}`);
  }
});

test('a hand-written line without a checkbox is a card and moves losslessly', () => {
  let l = parse(sample);
  const plain = l[2].cards[1];
  assert.equal(plain.text, 'plain note');
  assert.equal(plain.checked, null);
  let t = apply(sample, moveCard(sample, plain, l[0], null));
  l = parse(t);
  assert.equal(l[0].cards.at(-1).text, 'plain note');
  t = apply(t, moveCard(t, l[0].cards.at(-1), l[2], null));
  assert.equal(t, sample);
});

test('add a card to an empty lane and to a full one', () => {
  let t = apply(sample, addCard(sample, parse(sample)[1], 'new one'));
  assert.deepEqual(parse(t)[1].cards.map(c => c.text), ['new one']);
  assert.ok(t.includes('## B\n\n- [ ] new one\n'));
  t = apply(t, addCard(t, parse(t)[0], 'last'));
  assert.deepEqual(parse(t)[0].cards.map(c => c.text), ['one #x', 'two', 'last']);
});

test('moving into a complete list ticks the card', () => {
  assert.deepEqual(settings(sample)['complete-lists'], ['C']);
  const l = parse(sample);
  const t = apply(sample, moveCard(sample, l[0].cards[0], l[2], null, true));
  const moved = parse(t)[2].cards.at(-1);
  assert.equal(moved.text, 'one #x');
  assert.equal(moved.checked, true);
  assert.equal(moved.subs[0].checked, false);
});

test('archive: created after the last lane, then reused; archived lanes are flagged', () => {
  let l = parse(sample);
  let t = apply(sample, archiveCards(sample, [l[0].cards[1]]));
  l = parse(t);
  assert.deepEqual(l.map(x => [x.title, x.archive]), [['A', false], ['B', false], ['C', false], ['Archive', true]]);
  assert.deepEqual(l[3].cards.map(c => c.text), ['two']);
  assert.ok(t.includes('\n***\n\n## Archive\n\n- [x] two\n'));
  t = apply(t, archiveCards(t, [l[2].cards[0]]));
  assert.deepEqual(parse(t)[3].cards.map(c => c.text), ['two', 'three']);
  assert.ok(t.endsWith('%% kanban:settings\n```\n{"complete-lists":["C"]}\n```\n%%'));
});

test('card edit round trip, duplicate and delete', () => {
  const c = parse(sample)[0].cards[0];
  assert.equal(cardSource(sample, c), 'one #x\n\t- [ ] sub');
  assert.equal(apply(sample, editCard(sample, c, cardSource(sample, c))), sample);
  const t = apply(sample, editCard(sample, c, 'renamed\n\t- [x] sub'));
  assert.equal(parse(t)[0].cards[0].text, 'renamed');
  assert.equal(parse(t)[0].cards[0].subs[0].checked, true);
  assert.deepEqual(parse(apply(sample, duplicateCard(sample, c)))[0].cards.map(x => x.text), ['one #x', 'one #x', 'two']);
  assert.deepEqual(parse(apply(sample, deleteCard(sample, c)))[0].cards.map(x => x.text), ['two']);
});

test('lanes: add, rename, move there and back losslessly, delete', () => {
  let t = apply(sample, addLane(sample, 'D'));
  assert.deepEqual(parse(t).map(l => l.title), ['A', 'B', 'C', 'D']);
  t = apply(t, addCard(t, parse(t)[3], 'in d'));
  assert.deepEqual(parse(t)[3].cards.map(c => c.text), ['in d']);
  assert.deepEqual(parse(t)[2].cards.map(c => c.text), ['three', 'plain note']);
  assert.equal(parse(apply(sample, renameLane(sample, parse(sample)[1], 'Bee')))[1].title, 'Bee');
  let l = parse(sample);
  let m = apply(sample, moveLane(sample, l[0], null));
  assert.deepEqual(parse(m).map(x => x.title), ['B', 'C', 'A']);
  l = parse(m);
  m = apply(m, moveLane(m, l[2], l[0]));
  assert.deepEqual(parse(m).map(x => x.title), ['A', 'B', 'C']);
  assert.deepEqual(parse(m)[0].cards.map(c => c.text), ['one #x', 'two']);
  assert.deepEqual(parse(apply(sample, deleteLane(sample, parse(sample)[1]))).map(x => x.title), ['A', 'C']);
});

test('settings rewrite keeps the rest, prepend and sort', () => {
  const t = apply(sample, setSetting(sample, 'list-collapse', [true]));
  assert.deepEqual(settings(t), { 'complete-lists': ['C'], 'list-collapse': [true] });
  assert.equal(t.slice(0, t.indexOf('%%')), sample.slice(0, sample.indexOf('%%')));
  const bare = '---\nkanban-plugin: board\n---\n\n## A\n\n- [ ] b @{2026-10-30}\n- [ ] a\n- [ ] c @{2026-10-01}\n';
  assert.deepEqual(settings(apply(bare, setSetting(bare, 'x', 1))), { x: 1 });
  assert.deepEqual(parse(apply(bare, addCard(bare, parse(bare)[0], 'top', true)))[0].cards[0].text, 'top');
  assert.deepEqual(parse(apply(bare, sortLane(bare, parse(bare)[0], 'date')))[0].cards.map(c => c.text[0]), ['c', 'b', 'a']);
  assert.deepEqual(parse(apply(bare, sortLane(bare, parse(bare)[0], 'text')))[0].cards.map(c => c.text[0]), ['a', 'b', 'c']);
});

test('real board: archive lane is separate, every lane moved to the end and back is lossless', { skip: skipReal }, () => {
  const real = readFileSync(REAL, 'utf8');
  const board = parse(real).filter(l => !l.archive);
  assert.equal(parse(real).filter(l => l.archive).map(l => l.title).join(), 'Archive');
  for (let i = 0; i < board.length - 1; i++) {
    let l = parse(real).filter(x => !x.archive);
    let t = apply(real, moveLane(real, l[i], null));
    l = parse(t).filter(x => !x.archive);
    assert.equal(l.at(-1).title, board[i].title);
    t = apply(t, moveLane(t, l.at(-1), l[i]));
    assert.equal(t, real, `lane ${board[i].title}`);
  }
});

test('archive a lane, middle and last, and block ids', () => {
  let t = apply(sample, archiveLane(sample, parse(sample)[0]));
  assert.deepEqual(parse(t).map(l => l.title), ['B', 'C', 'Archive']);
  assert.deepEqual(parse(t)[2].cards.map(c => c.text), ['one #x', 'two']);
  t = apply(t, archiveLane(t, parse(t)[1]));
  assert.deepEqual(parse(t).map(l => l.title), ['B', 'Archive']);
  assert.deepEqual(parse(t)[1].cards.map(c => c.text), ['one #x', 'two', 'three', 'plain note']);
  const last = apply(sample, archiveLane(sample, parse(sample)[2]));
  assert.deepEqual(parse(last).map(l => [l.title, l.archive]), [['A', false], ['B', false], ['Archive', true]]);
  assert.deepEqual(parse(last)[2].cards.map(c => c.text), ['three', 'plain note']);
  const c = parse(sample)[0].cards[0], { id, changes } = blockId(sample, c);
  const b = apply(sample, changes);
  assert.equal(parse(b)[0].cards[0].text, 'one #x ^' + id);
  assert.equal(parse(b)[0].cards[0].subs.length, 1);
  assert.deepEqual(blockId(b, parse(b)[0].cards[0]), { id, changes: [] });
});

test('review fixes: broken settings untouched, sort keeps loose text, fold flags follow lanes, rebase', () => {
  const broken = sample.replace('{"complete-lists":["C"]}', '{"complete-lists":["C"');
  assert.deepEqual(setSetting(broken, 'x', 1), []);
  const loose = '---\nkanban-plugin: board\n---\n\n## A\n\n- [ ] b\na loose note\n- [ ] a\n';
  assert.deepEqual(sortLane(loose, parse(loose)[0], 'text'), []);
  const folded = apply(sample, setSetting(sample, 'list-collapse', [true, false, true]));
  assert.deepEqual(settings(apply(folded, foldSplice(folded, 1, 0, 1)))['list-collapse'], [true, false, false, true]);
  assert.deepEqual(settings(apply(folded, foldSplice(folded, 0, 1)))['list-collapse'], [false, true]);
  const base = 'aaa\nbbb\nccc\n', next = 'aaa\nBBBB\nccc\n';
  assert.deepEqual(rebase([{ from: 0, to: 1, insert: 'X' }, { from: 9, to: 10, insert: 'Y' }], base, next), [{ from: 0, to: 1, insert: 'X' }, { from: 10, to: 11, insert: 'Y' }]);
  assert.equal(rebase([{ from: 5, to: 6, insert: 'Z' }], base, next), null);
});

test('card metadata: one tag definition, dates, links from cards, insert at a line start', () => {
  assert.deepEqual(tagsOf('fix #bug and #1 and a#b #tr/ist'), ['#bug', '#tr/ist']);
  const t = '---\nkanban-plugin: board\n---\n\n## A\n\n- [ ] call Alan @{2026-10-01} #job\n\t- [ ] sub\n- [ ] plain\n';
  let c = parse(t)[0].cards[0];
  assert.equal(parse(apply(t, setDate(t, c, '2026-11-05')))[0].cards[0].text, 'call Alan @{2026-11-05} #job');
  assert.equal(parse(apply(t, setDate(t, parse(t)[0].cards[1], '2026-11-05')))[0].cards[1].text, 'plain @{2026-11-05}');
  const link = linkCard(t, c);
  assert.equal(link.name, 'call Alan');
  const linked = parse(apply(t, link.changes))[0].cards[0];
  assert.equal(linked.text, '[[call Alan]] @{2026-10-01} #job');
  assert.equal(linked.subs.length, 1);
  assert.equal(linkCard(t, { ...c, text: '#job @{2026-10-01}' }), null);
  assert.deepEqual(parse(apply(t, insertCard(parse(t)[0].cards[1].start, 'mid\nline')))[0].cards.map(x => x.text), ['call Alan @{2026-10-01} #job', 'mid line', 'plain']);
  assert.deepEqual(diffRange('abcXdef', 'abcYYdef'), { from: 3, to: 4, insert: 'YY' });
  assert.equal(apply('abc', [diffRange('abc', 'abc')]), 'abc');
});
