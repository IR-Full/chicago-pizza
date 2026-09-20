#!/usr/bin/env node
/**
 * Fails the build on any dependency advisory that is not explicitly waived.
 *
 * `npm audit` was running with `continue-on-error: true`, which is the same
 * as not running it: an unauthenticated RCE in the framework sat in the
 * dependency tree for weeks and every CI run was green. The gate is only
 * useful if it can say no.
 *
 * A blanket allowlist would recreate the original problem, so every waiver
 * has to name the package, the advisory, why it cannot be reached from this
 * code, and when the claim expires. An expired waiver fails the build — the
 * point is to be forced to look again, not to forget.
 *
 * Reads a report on stdin rather than shelling out to npm:
 *
 *   npm audit --omit=dev --json | node scripts/audit-gate.mjs server
 *
 * `npm audit` exits non-zero whenever it finds anything, so a pipeline that
 * wants this script's verdict has to ignore that exit code — see the CI
 * workflow. Taking the report on stdin also keeps the script free of any
 * assumption about how npm is installed, which is what broke it on Windows:
 * Node refuses to spawn a `.cmd` without a shell, and a shell would
 * concatenate arguments rather than escape them.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const MIN_SEVERITY = 'high';

const workspace = process.argv[2];
if (!workspace) {
  console.error('usage: npm audit --omit=dev --json | node scripts/audit-gate.mjs <server|client>');
  process.exit(2);
}

const waivers = JSON.parse(readFileSync(join(ROOT, 'scripts', 'audit-waivers.json'), 'utf8'));

function readReport() {
  const raw = readFileSync(0, 'utf8').trim();
  if (!raw) {
    console.error('no audit report on stdin — pipe `npm audit --omit=dev --json` into this script');
    process.exit(2);
  }

  try {
    return JSON.parse(raw);
  } catch {
    // Usually npm printing a human-readable error instead of a report.
    console.error('could not parse the audit report:');
    console.error(raw.slice(0, 500));
    process.exit(2);
  }
}

const report = readReport();
const vulnerabilities = Object.values(report.vulnerabilities ?? {});

/**
 * Maps every reported package to the packages an advisory actually
 * originates in.
 *
 * `npm audit` reports a vulnerable transitive dependency once for every
 * package that leads to it, so one flaw in `multer` surfaced as ten separate
 * `@nestjs/*` entries. Waiving those by name would be waiving the framework;
 * following `via` back to the entries that carry an advisory object gives the
 * real source, which is the only thing worth reasoning about.
 *
 * Resolved by iterating to a fixed point rather than by recursion: the graph
 * has cycles (`@nestjs/core` and `@nestjs/websockets` list each other), and a
 * depth-first walk has to decide what an unfinished node contributes while it
 * is still on the stack. Propagating until nothing changes never has to
 * answer that question.
 */
function resolveRootCauses() {
  const roots = new Map();

  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
    // A package with an advisory object attached is a source in its own right.
    roots.set(name, new Set(entry.via.some((via) => typeof via === 'object') ? [name] : []));
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const [name, entry] of Object.entries(report.vulnerabilities)) {
      const current = roots.get(name);

      for (const via of entry.via) {
        if (typeof via === 'object') continue;

        // A `via` that is not itself reported is a leaf source.
        const upstream = roots.get(via) ?? new Set([via]);
        for (const root of upstream) {
          if (current.has(root)) continue;
          current.add(root);
          changed = true;
        }
      }
    }
  }

  return roots;
}

const rootCausesByPackage = resolveRootCauses();

/** Falls back to the package itself so an unresolvable entry still blocks. */
const rootCauses = (name) => {
  const resolved = rootCausesByPackage.get(name);
  return resolved?.size ? [...resolved] : [name];
};

const today = new Date().toISOString().slice(0, 10);
const blocking = [];
const waived = [];
const expired = [];

for (const vulnerability of vulnerabilities) {
  if (SEVERITIES.indexOf(vulnerability.severity) < SEVERITIES.indexOf(MIN_SEVERITY)) continue;

  const roots = rootCauses(vulnerability.name);
  const matched = roots.map((root) => ({ root, waiver: waivers[workspace]?.[root] }));

  // Only when *every* source of this entry is waived is the entry itself
  // waived: a package that is vulnerable for two reasons must not slip
  // through because one of them was excused.
  if (matched.some(({ waiver }) => !waiver)) {
    blocking.push({ vulnerability, roots });
    continue;
  }

  const stale = matched.find(({ waiver }) => waiver.expires < today);
  if (stale) {
    expired.push({ vulnerability, waiver: stale.waiver, root: stale.root });
    continue;
  }

  waived.push({ vulnerability, waiver: matched[0].waiver, roots });
}

// Report each waived advisory once, at its source, rather than once per
// package that happens to depend on it.
const reportedWaivers = new Set();
for (const { vulnerability, waiver, roots } of waived) {
  const key = roots.join(',');
  if (reportedWaivers.has(key)) continue;
  reportedWaivers.add(key);

  console.log(`· waived  ${key} (${vulnerability.severity}) — ${waiver.reason}`);
  console.log(`          expires ${waiver.expires}`);
}

for (const { vulnerability, waiver, root } of expired) {
  console.error(`✗ EXPIRED ${root} (via ${vulnerability.name}): waiver ran out on ${waiver.expires}. Re-check it.`);
}

for (const { vulnerability, roots } of blocking) {
  const titles = vulnerability.via
    .filter((via) => typeof via === 'object')
    .map((via) => via.title)
    .join('; ');
  console.error(`✗ ${vulnerability.name} (${vulnerability.severity}): ${titles || `via ${roots.join(', ')}`}`);
  console.error(`  fix: ${JSON.stringify(vulnerability.fixAvailable)}`);
}

if (blocking.length || expired.length) {
  console.error(
    `\n${workspace}: ${blocking.length} unwaived and ${expired.length} expired advisory/advisories at ${MIN_SEVERITY}+.`,
  );
  console.error('Fix them, or add a waiver in scripts/audit-waivers.json explaining why they cannot be reached.');
  process.exit(1);
}

console.log(`\n${workspace}: no unwaived ${MIN_SEVERITY}+ advisories in production dependencies.`);
