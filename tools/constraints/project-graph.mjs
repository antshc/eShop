#!/usr/bin/env node
// project-graph.mjs — architecture constraint: hold today's project-reference graph.
// Reads every project listed in eShop.slnx, collects its <ProjectReference> edges, and compares them
// with the recorded baseline. A new edge widens a boundary and is reported; a removed edge tightens
// it and is only noted (ratchet the baseline down with --update).
// Usage: node tools/constraints/project-graph.mjs [--update]
// Exit: 0 no new edges, 1 new edges, 2 could not run.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const bail = (msg) => { console.error('project-graph: ' + msg); process.exit(2); };

let top;
try { top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(); }
catch { bail('not inside a git work tree'); }

const solution = join(top, 'eShop.slnx');
const baselineFile = join(top, 'tools/constraints/project-references.baseline.txt');
if (!existsSync(solution)) bail('eShop.slnx not found');

const projects = [...readFileSync(solution, 'utf8').matchAll(/Path="([^"]+\.csproj)"/g)].map((m) => m[1]);
if (projects.length === 0) bail('no projects found in eShop.slnx');

const name = (p) => basename(p).replace(/\.csproj$/, '');
const edges = new Set();
for (const p of projects) {
  const abs = join(top, p);
  if (!existsSync(abs)) bail('project listed in eShop.slnx is missing: ' + p);
  const xml = readFileSync(abs, 'utf8');
  for (const m of xml.matchAll(/<ProjectReference\s+Include="([^"]+)"/g)) {
    const target = resolve(dirname(abs), m[1].replace(/\\/g, '/'));
    if (!existsSync(target)) bail(`${p} references a missing project: ${relative(top, target)}`);
    edges.add(`${name(p)} -> ${name(target)}`);
  }
}
const current = [...edges].sort();

if (process.argv.includes('--update')) {
  const header = '# Allowed project references (From -> To), recorded from eShop.slnx.\n'
    + '# Regenerate with: node tools/constraints/project-graph.mjs --update\n'
    + '# Adding a line widens an architecture boundary and needs review (see CONSTRAINTS.md).\n';
  writeFileSync(baselineFile, header + current.join('\n') + '\n');
  console.log(`project-graph: baseline written (${current.length} edges)`);
  process.exit(0);
}

if (!existsSync(baselineFile)) bail('no baseline; run with --update once');
const baseline = new Set(readFileSync(baselineFile, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));

const added = current.filter((e) => !baseline.has(e));
const gone = [...baseline].filter((e) => !edges.has(e));

if (gone.length) {
  console.log(`project-graph: ${gone.length} baseline edge(s) no longer exist; tighten with --update:`);
  for (const e of gone) console.log('  - ' + e);
}
if (added.length === 0) { console.log(`project-graph: clean (${current.length} edges, none new)`); process.exit(0); }
console.error(`project-graph: ${added.length} new project reference(s) not in the baseline:`);
for (const e of added) console.error('  [boundary-widened] ' + e);
console.error('\nRemove the reference, or get the new edge reviewed and recorded with --update in its own commit.');
process.exit(1);
