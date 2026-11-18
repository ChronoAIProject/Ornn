// Parse image bytes as data only. Never import, evaluate or execute the bundle.
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const parser = require('./vendor/babel-parser-7.29.3.cjs');

function prove({text, findings}) {
  const ast = parser.parse(text, {sourceType: 'unambiguous', errorRecovery: false});
  const spans = new Set();
  const stack = [[ast, null]];
  while (stack.length) {
    const [node, parent] = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'MemberExpression' && !node.computed && !node.optional
        && node.property.type === 'Identifier'
        // A prefix of a computed member/call is not the captured value.
        && !(parent && ((parent.object === node && /MemberExpression$/.test(parent.type))
          || parent.callee === node || parent.tag === node))) {
      spans.add(`${node.start}:${node.end}`);
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'comments', 'tokens', 'errors', 'extra'].includes(key)) continue;
      if (Array.isArray(value)) {
        for (const child of value) stack.push([child, node]);
      } else if (value && typeof value === 'object') stack.push([value, node]);
    }
  }
  // Same ASCII capture and whitespace grammar as the pinned Gitleaks rule.
  // JS regex indices and Babel spans both use UTF-16 offsets, including astral text.
  const capture = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret|credential|private[_-]?key)["']?[\t\n\f\r ]*[:=][\t\n\f\r ]*["']?([A-Za-z0-9_./+!@#$%^&*=-]{12,})/gid;
  const requested = new Set(findings.map(f => f.candidate_sha256));
  const candidates = new Map();
  let cursor = 0, line = 1;
  for (const match of text.matchAll(capture)) {
    while (cursor < match.index) if (text[cursor++] === '\n') line++;
    const hash = crypto.createHash('sha256').update(match[1]).digest('hex');
    if (!requested.has(hash)) continue;
    const [start, end] = match.indices[1];
    const item = candidates.get(hash) || {value: match[1], valid: true, lines: new Set()};
    item.valid &&= spans.has(`${start}:${end}`);
    item.lines.add(line);
    candidates.set(hash, item);
  }
  // A detector row can collapse duplicate captures. Check ALL occurrences of
  // those exact bytes, even outside an assignment or on another line. One valid
  // expression cannot lend its classification to a string/comment/computed use.
  for (const item of candidates.values()) {
    let start = text.indexOf(item.value);
    while (start !== -1) {
      item.valid &&= spans.has(`${start}:${start + item.value.length}`);
      start = text.indexOf(item.value, start + 1);
    }
  }
  return findings.filter(f => {
    const item = candidates.get(f.candidate_sha256);
    return item && item.valid && item.lines.has(f.line);
  }).map(f => f.finding_id);
}

try {
  const input = fs.readFileSync(0);
  if (input.length > 32 * 1024 * 1024) throw new Error('input-limit');
  process.stdout.write(JSON.stringify(prove(JSON.parse(input.toString('utf8')))));
} catch {
  // Parser diagnostics may quote image-controlled data. Emit no such diagnostics.
  process.stdout.write('[]');
  process.exitCode = 1;
}
