#!/usr/bin/env node
// floor-guard.mjs — diff-scoped check of the CONSTRAINTS.md floor.
// Adapted from .github/skills/constraint-driven-development/references/floor-guard.md for C#, MSBuild and TypeScript.
// Usage: node tools/constraints/floor-guard.mjs [--base <ref>]   (default base: origin/main)
// Exit: 0 clean, 1 floor violation(s), 2 could not run. Never reports matched values beyond 120 chars of the line.
import { execFileSync } from 'node:child_process';

const base = (() => {
  const i = process.argv.indexOf('--base');
  return i > -1 ? process.argv[i + 1] : 'origin/main';
})();

// `git diff --no-index` exits 1 whenever the two sides differ, which is the normal case for a
// new file, so that output is kept. Any other failure is null, and null never reads as clean.
const git = (args, { diffExit = false } = {}) => {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { return diffExit && e.status === 1 && typeof e.stdout === 'string' ? e.stdout : null; }
};
const bail = (msg) => { console.error('floor-guard: ' + msg); process.exit(2); };

const top = git(['rev-parse', '--show-toplevel'])?.trim();
if (!top) bail('not inside a git work tree');
process.chdir(top);

const mergeBase = git(['merge-base', base, 'HEAD'])?.trim();
if (!mergeBase) bail('no merge base against ' + base + ' (shallow clone? fetch with full history)');

const tracked = git(['diff', '--unified=0', mergeBase, '--']);
if (tracked === null) bail('could not diff against ' + mergeBase);
const untrackedFiles = git(['ls-files', '--others', '--exclude-standard']);
if (untrackedFiles === null) bail('could not list untracked files');
const untracked = untrackedFiles.split('\n').filter(Boolean).map((f) => {
  const d = git(['diff', '--no-index', '--unified=0', '/dev/null', f], { diffExit: true });
  if (d === null) bail('could not diff untracked file ' + f);
  return d;
}).join('\n');
const diff = tracked + '\n' + untracked;

// `---`/`+++` are headers only between a file's `diff` line and its first `@@` hunk.
const added = [], removed = [], deleted = [];
const pathOf = (s) => s.replace(/^[ab]\//, '');
let file = '', oldFile = '', inHeader = false;
for (const line of diff.split('\n')) {
  if (line.startsWith('diff ')) inHeader = true;
  else if (line.startsWith('@@')) inHeader = false;
  else if (inHeader) {
    if (line.startsWith('--- ')) oldFile = pathOf(line.slice(4));
    else if (line.startsWith('+++ ')) {
      const newFile = pathOf(line.slice(4));
      file = newFile === '/dev/null' ? oldFile : newFile;
      if (newFile === '/dev/null') deleted.push(file);
    }
  }
  else if (line.startsWith('+')) added.push({ file, text: line.slice(1) });
  else if (line.startsWith('-')) removed.push({ file, text: line.slice(1) });
}

const findings = [];
const flag = (rule, f, text) => findings.push({ rule, file: f, text: text.trim().slice(0, 120) });
const isTest = (f) => /^(tests|e2e)\//.test(f) || /\.(test|spec)\.[cm]?[jt]s$/.test(f) || /Tests?\.cs$/.test(f);
const isConstraints = (f) => /(^|\/)CONSTRAINTS\.md$/.test(f);
const isGuardSource = (f) => f.startsWith('tools/constraints/') || f.startsWith('.github/skills/constraint-driven-development/');
const isBaseline = (f) => f === 'tools/constraints/project-references.baseline.txt';

const isCode = (f) => /\.(cs|razor|cshtml|csproj|props|targets|[cm]?[jt]sx?|json|ya?ml)$/.test(f) || /(^|\/)\.editorconfig$/.test(f);

// 1. Silenced checker: C# pragmas/attributes, MSBuild/editorconfig switches, JS/TS comments.
const SUPPRESSIONS = new RegExp([
  '#pragma\\s+warning\\s+disable', '\\[(assembly:\\s*)?SuppressMessage', 'ReSharper\\s+disable',
  '\\[ExcludeFromCodeCoverage', '<NoWarn>', '<TreatWarningsAsErrors>\\s*false',
  '<WarningsNotAsErrors>', 'dotnet_diagnostic\\.\\S+\\.severity\\s*=\\s*(none|silent|suggestion)',
  '@ts-ignore', '@ts-nocheck', 'eslint-disable', 'istanbul ignore', 'nosemgrep', 'gitleaks:allow',
].join('|'));
// 4. Unfinished work.
const STUBS = /throw\s+new\s+NotImplementedException|throw new Error\(.*[Nn]ot implemented|catch\s*(\([^)]*\))?\s*\{\s*\}|\bTODO\b/;
// 2. A test made easier: skipped, ignored, or focused (which skips the rest).
const SKIPS = /\[(Fact|Theory|TestMethod)\s*\([^)]*Skip\s*=|\[Ignore\b|\b(test|it|describe)\.(skip|fixme|only)\b|\bxit\(|\bxdescribe\(/;
const ASSERTS = /\bAssert\.|\bexpect\(|\.Should\(|\bassert\b/;

for (const { file, text } of added) {
  if (isGuardSource(file)) continue; // the guard's own patterns would match themselves
  if (isConstraints(file) && /^\| *(W|E)\d+ *\|/.test(text)) flag('new-exception', file, text);
  if (!isCode(file)) continue; // prose (e.g. Markdown) may name these patterns without using them
  if (SUPPRESSIONS.test(text)) flag('silenced-checker', file, text);
  if (STUBS.test(text)) flag('unfinished-work', file, text);
  if (SKIPS.test(text)) flag('test-made-easier', file, text);
}
// Creating the baseline records today's graph; only additions to an existing baseline widen it.
const baselineExisted = git(['cat-file', '-e', `${mergeBase}:tools/constraints/project-references.baseline.txt`]) !== null;
for (const { file, text } of added) {
  if (baselineExisted && isBaseline(file) && text.trim() && !text.trim().startsWith('#')) flag('boundary-widened', file, text);
}

for (const f of deleted) if (isTest(f)) flag('test-deleted', f, 'file deleted');
for (const { file, text } of removed) {
  if (isTest(file) && !deleted.includes(file) && ASSERTS.test(text)) flag('assertion-removed', file, text);
}

// A rule in CONSTRAINTS.md weakened or removed (see the reference for the pairing logic).
const ruleKey = (t) => {
  const s = t.trim();
  if (/^\|[\s:-]+\|/.test(s) && /^[|\s:-]+$/.test(s)) return null; // table separator row
  if (s.startsWith('|')) return s.split('|').map((c) => c.trim()).filter(Boolean)[0] ?? '';
  if (/^[-*] /.test(s)) return s.slice(2).split(':')[0].trim();
  return null;
};
const isException = (t) => /^\| *(W|E)\d+ *\|/.test(t.trim());
const MIN_BEFORE = /(>=|>|≥|at least|minimum|\bmin\b|no less than|not fall|not drop)\s*$/;
const MAX_BEFORE = /(<=|<|≤|at most|maximum|\bmax\b|no more than|under|below|not grow|not exceed)\s*$/;
const MIN_AFTER = /^\s*\S*\s*(or more|or higher|must not fall|must not drop)/;
const MAX_AFTER = /^\s*\S*\s*(or less|or lower|must not grow|must not exceed)/;
const thresholds = (t) => {
  const out = [], re = /\d+(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 40).toLowerCase();
    const dir = MIN_BEFORE.test(before) || MIN_AFTER.test(after) ? 'min'
      : MAX_BEFORE.test(before) || MAX_AFTER.test(after) ? 'max' : null;
    out.push({ n: Number(m[0]), dir });
  }
  return out;
};
const removedRules = removed.filter((l) => isConstraints(l.file) && ruleKey(l.text) !== null);
const addedRules = added.filter((l) => isConstraints(l.file) && ruleKey(l.text) !== null);
for (const r of removedRules) {
  const a = addedRules.find((x) => ruleKey(x.text) === ruleKey(r.text));
  if (!a) {
    if (!isException(r.text)) flag('rule-removed', r.file, r.text);
    continue;
  }
  const before = thresholds(r.text), after = thresholds(a.text);
  let verdict = null;
  for (const dir of ['min', 'max', null]) {
    const was = before.filter((x) => x.dir === dir), now = after.filter((x) => x.dir === dir);
    was.forEach((b, i) => {
      const n = now[i];
      if (verdict) return;
      if (!n) verdict = 'threshold-removed';
      else if (n.n === b.n) return;
      else if (dir === 'min' ? n.n < b.n : dir === 'max' ? n.n > b.n : true) {
        verdict = dir ? 'threshold-loosened' : 'threshold-changed';
      }
    });
  }
  if (verdict) flag(verdict, r.file, r.text + '  ->  ' + a.text);
}

if (findings.length === 0) { console.log(`floor-guard: clean (diff vs ${base} @ ${mergeBase.slice(0, 7)})`); process.exit(0); }
console.error('floor-guard: ' + findings.length + ' floor violation(s):');
for (const f of findings) console.error(`  [${f.rule}] ${f.file}: ${f.text}`);
if (findings.some((f) => f.rule === 'rule-removed')) {
  console.error('\nA rule-removed finding can also mean the rule\'s label changed: rename a rule in one commit and change its thresholds in another.');
}
console.error('\nEach is a move that lowers the bar. Fix the code, or route it through a tracked exception in CONSTRAINTS.md.');
process.exit(1);
