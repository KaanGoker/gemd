// The note outline: ATX headings outside front matter and fenced code, nested by level.

export function headings(text) {
  const lines = text.split('\n'), out = [];
  let n = 0, fence = null;
  if (lines[0] === '---') { n = lines.indexOf('---', 1) + 1; if (!n) n = 0; }
  for (; n < lines.length; n++) {
    const l = lines[n], f = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; continue; }
    if (f) { fence = f[1]; continue; }
    const h = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(l);
    if (h && h[2]) out.push({ level: h[1].length, text: h[2], line: n + 1 });
  }
  return out;
}

export function outlineTree(list) {
  const root = { level: 0, children: [] }, stack = [root];
  for (const h of list) {
    while (stack.at(-1).level >= h.level) stack.pop();
    const node = { ...h, children: [] };
    stack.at(-1).children.push(node);
    stack.push(node);
  }
  return root.children;
}
