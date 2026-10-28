#!/usr/bin/env node
// check.mjs — runs the CONSTRAINTS.md checks for a lifecycle stage.
// Usage: node tools/constraints/check.mjs [--stage fast|task] [--base <ref>] [--strict]
//   fast: floor guard + project-reference graph (seconds, no build)
//   task: fast + `dotnet build eShop.Web.slnf` (warnings are errors)
// Mode is warn (see CONSTRAINTS.md): floor/architecture findings are reported but exit 0.
// --strict makes them exit 1. A check that could not run exits 2; a failed build exits 1.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const stage = arg('--stage', 'fast');
const base = arg('--base', 'origin/main');
const strict = process.argv.includes('--strict');
if (!['fast', 'task'].includes(stage)) { console.error('check: unknown stage ' + stage); process.exit(2); }

const here = dirname(fileURLToPath(import.meta.url));
const run = (label, cmd, args) => {
  const started = Date.now();
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: join(here, '../..') });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const status = r.error ? 2 : r.status ?? 2;
  return { label, status, secs };
};

const results = [
  run('floor', process.execPath, [join(here, 'floor-guard.mjs'), '--base', base]),
  run('architecture', process.execPath, [join(here, 'project-graph.mjs')]),
];
if (stage === 'task') results.push(run('build', 'dotnet', ['build', 'eShop.Web.slnf', '-nologo', '-v', 'q']));

console.log('\nconstraints (' + stage + (strict ? ', strict' : ', warn') + '):');
for (const r of results) {
  const verdict = r.status === 0 ? 'PASS' : r.status === 2 ? 'COULD NOT RUN' : r.label === 'build' || strict ? 'FAIL' : 'WARN';
  console.log(`  ${r.label.padEnd(13)} ${verdict.padEnd(14)} ${r.secs}s`);
}

if (results.some((r) => r.status === 2)) process.exit(2);
if (results.some((r) => r.status === 1 && (r.label === 'build' || strict))) process.exit(1);
process.exit(0);
