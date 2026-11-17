// Obsidian link helpers shared by the host and the webview: anchors, embedded sections, renames.

const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `Note#Heading` -> ['Note', 'Heading'], `Note#^id` -> ['Note', '^id'], `#Heading` -> ['', 'Heading'].
export function splitLink(link) {
  const i = link.indexOf('#');
  return i < 0 ? [link.trim(), ''] : [link.slice(0, i).trim(), link.slice(i + 1).trim()];
}

const plain = s => s.replace(/[*_`=~[\]]/g, '').trim().toLowerCase();
const fence = l => /^\s*(```|~~~)/.test(l);

// 0-based line of `Heading` (the last part of `A#B` nests) or `^block` in a note, or -1.
export function findAnchor(text, sub) {
  const lines = text.split('\n');
  let code = false;
  const want = sub.startsWith('^') ? sub : plain(sub.split('#').filter(Boolean).at(-1) || '');
  return lines.findIndex(l => {
    if (fence(l)) { code = !code; return false; }
    if (code) return false;
    if (sub.startsWith('^')) return l.trimEnd().endsWith(' ' + want) || l.trim() === want;
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    return !!m && plain(m[2]) === want;
  });
}

// What `![[Note]]`, `![[Note#Heading]]` or `![[Note#^id]]` shows: the note without front matter,
// the heading with everything under it up to the next heading of the same or higher level, or the block's line.
export function section(text, sub) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (!sub) {
    if (lines[0] === '---') { const end = lines.indexOf('---', 1); if (end > 0) return lines.slice(end + 1).join('\n').trim(); }
    return text.trim();
  }
  const at = findAnchor(lines.join('\n'), sub);
  if (at < 0) return null;
  if (sub.startsWith('^')) return lines[at].replace(/\s*\^[\w-]+\s*$/, '');
  const level = /^#+/.exec(lines[at])[0].length;
  let end = at + 1, code = false;
  for (; end < lines.length; end++) {
    if (fence(lines[end])) code = !code;
    const h = !code && /^(#{1,6})\s/.exec(lines[end]);
    if (h && h[1].length <= level) break;
  }
  return lines.slice(at, end).join('\n').trim();
}

// Every link to `oldName` written for `newName`: `[[old]]`, `[[old|x]]`, `[[old#h]]`, `![[old]]`, `[[dir/old]]`
// and Markdown links `[x](dir/old.md)`, spaces raw or as %20. Names are without `.md` for notes, with the extension otherwise.
// Returns [text, count].
export function renameLinks(text, oldName, newName, note = true) {
  let n = 0;
  const wiki = new RegExp(`(!?\\[\\[)((?:[^\\]|#^\\n]*/)?)${reEsc(oldName)}(\\.md)?(?=[\\]|#^])`, 'gi');
  let out = text.replace(wiki, (_, open, dir, ext) => { n++; return open + dir + newName + (ext || ''); });
  const ext = note ? '.md' : '';
  const pairs = [[oldName, newName]];
  if (encodeURI(oldName) !== oldName) pairs.push([encodeURI(oldName), encodeURI(newName)]);
  for (const [o, nw] of pairs) {
    const md = new RegExp(`(\\]\\((?:[^)\\s]*/)?)${reEsc(o + ext)}(?=[)#])`, 'gi');
    out = out.replace(md, (_, head) => { n++; return head + nw + ext; });
  }
  return [out, n];
}
