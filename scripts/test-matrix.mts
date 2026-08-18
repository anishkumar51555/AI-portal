/**
 * Feature coverage tracker.
 *
 * Scans tests/ for feature tags like [F3.2] and reports, per phase, which
 * features in tests/feature-map.ts actually have a test behind them.
 *
 * This answers a question coverage percentage cannot: "is the thing that
 * matters validated?" You can hit 80% line coverage with every security guard
 * untested. You cannot pass this report with one missing.
 *
 *   npm run test:matrix              full report
 *   npm run test:matrix -- --phase P3    one phase
 *   npm run test:matrix -- --gate P3     exit 1 if any CRITICAL feature in P3 is untested
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { FEATURES, type Feature, type Phase } from "../tests/feature-map.ts";

const ROOT = process.cwd();
const TEST_DIR = join(ROOT, "tests");

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
} as const;

interface Hit {
  file: string;
  count: number;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "fixtures" || e.name === "node_modules") continue;
      out.push(...(await walk(full)));
      // `.tsx` too: component tests live there, and matching only `.ts`
      // silently skipped the README-sanitization suite (F4.8).
    } else if (/\.(test|spec)\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

async function collectHits(): Promise<Map<string, Hit[]>> {
  const files = await walk(TEST_DIR);
  const hits = new Map<string, Hit[]>();

  for (const file of files) {
    const src = await readFile(file, "utf8");
    const counts = new Map<string, number>();

    // [F3.2] anywhere in the file — describe titles, it titles, comments.
    for (const m of src.matchAll(/\[(F\d+\.\d+)\]/g)) {
      const id = m[1];
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    for (const [id, count] of counts) {
      const list = hits.get(id) ?? [];
      list.push({ file: relative(ROOT, file).replace(/\\/g, "/"), count });
      hits.set(id, list);
    }
  }
  return hits;
}

/**
 * Which test directories may satisfy a feature of a given level.
 *
 * A feature declared `integration` asserts something about a running endpoint
 * against a real database. A unit test of the helper that endpoint will one day
 * call does NOT establish it — and tagging it there marks the feature green
 * before the endpoint exists. That has happened three times in this project
 * (F3.1–F3.8, F3.12, F3.14), which is why it is now enforced rather than
 * remembered.
 */
const LEVEL_DIRS: Record<Feature["level"], string[]> = {
  // A HIGHER level satisfies a lower one: an integration test that exercises a
  // pure helper end to end is more evidence than a unit test, not less. Only
  // the downward direction is a lie — a unit test of a helper cannot establish
  // that an endpoint calls it.
  unit: ["tests/unit/", "tests/integration/", "tests/e2e/"],
  integration: ["tests/integration/", "tests/e2e/"],
  e2e: ["tests/e2e/"],
  manual: ["tests/unit/", "tests/integration/", "tests/e2e/"],
};

/**
 * Keep only the tags that sit in a directory able to establish the feature.
 *
 * Coverage is computed from THIS, not from the raw tags — otherwise a unit test
 * of a helper marks an integration feature green, which is precisely the false
 * confidence the matrix exists to prevent.
 */
function hitsAtCorrectLevel(features: Feature[], hits: Map<string, Hit[]>) {
  const filtered = new Map<string, Hit[]>();

  for (const feature of features) {
    const found = hits.get(feature.id);
    if (!found) continue;

    const allowed = LEVEL_DIRS[feature.level];
    const valid = found.filter((h) => allowed.some((dir) => h.file.startsWith(dir)));
    if (valid.length > 0) filtered.set(feature.id, valid);
  }

  return filtered;
}

/** Tags found in a directory that cannot satisfy the feature's declared level. */
function misplacedTags(features: Feature[], hits: Map<string, Hit[]>) {
  const problems: Array<{ id: string; level: string; files: string[] }> = [];

  for (const feature of features) {
    const found = hits.get(feature.id);
    if (!found) continue;

    const allowed = LEVEL_DIRS[feature.level];
    const wrong = found.filter((h) => !allowed.some((dir) => h.file.startsWith(dir)));
    if (wrong.length > 0) {
      problems.push({
        id: feature.id,
        level: feature.level,
        files: wrong.map((w) => w.file),
      });
    }
  }

  return problems;
}

function render(features: Feature[], hits: Map<string, Hit[]>) {
  const phases = [...new Set(features.map((f) => f.phase))].sort();
  let totalCovered = 0;
  const critMissing: Feature[] = [];

  for (const phase of phases) {
    const inPhase = features.filter((f) => f.phase === phase);
    const covered = inPhase.filter((f) => hits.has(f.id));
    totalCovered += covered.length;

    const pct = Math.round((covered.length / inPhase.length) * 100);
    const bar =
      "█".repeat(Math.round(pct / 5)) +
      C.dim +
      "░".repeat(20 - Math.round(pct / 5)) +
      C.reset;
    const colour = pct === 100 ? C.green : pct > 0 ? C.yellow : C.dim;

    console.log(
      `\n${C.bold}${phase}${C.reset}  ${colour}${bar}${C.reset} ` +
        `${colour}${covered.length}/${inPhase.length}${C.reset} ${C.dim}(${pct}%)${C.reset}`,
    );

    for (const f of inPhase) {
      const h = hits.get(f.id);
      const crit = f.critical ? `${C.red}!${C.reset}` : " ";
      if (h) {
        const n = h.reduce((s, x) => s + x.count, 0);
        console.log(
          `  ${C.green}✓${C.reset} ${crit} ${C.bold}${f.id.padEnd(6)}${C.reset} ${f.title}`,
        );
        console.log(
          `        ${C.dim}${n} tag(s) · ${h.map((x) => x.file).join(", ")}${C.reset}`,
        );
      } else {
        if (f.critical) critMissing.push(f);
        console.log(
          `  ${C.red}✗${C.reset} ${crit} ${C.bold}${f.id.padEnd(6)}${C.reset} ${C.dim}${f.title}${C.reset}`,
        );
        console.log(`        ${C.dim}${f.level} · ${f.spec}${C.reset}`);
      }
    }
  }

  const pct = Math.round((totalCovered / features.length) * 100);
  console.log(
    `\n${C.bold}────────────────────────────────────────────────${C.reset}\n` +
      `${C.bold}${totalCovered}/${features.length}${C.reset} features have tests ${C.dim}(${pct}%)${C.reset}` +
      `   ${C.red}!${C.reset} ${C.dim}= critical${C.reset}\n`,
  );

  return critMissing;
}

// ── main ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

/** Read the value after a flag. Returns undefined when the flag is absent —
 *  a bare indexOf(...) + 1 resolves to args[0] when the flag is missing. */
function flagValue(flag: string): Phase | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : (args[i + 1] as Phase | undefined);
}

const gateArg = flagValue("--gate");
const scope = gateArg ?? flagValue("--phase");

const features = scope ? FEATURES.filter((f) => f.phase === scope) : FEATURES;

if (features.length === 0) {
  console.error(`No features found for phase "${scope}".`);
  process.exit(1);
}

const rawHits = await collectHits();
const hits = hitsAtCorrectLevel(features, rawHits);
const critMissing = render(features, hits);

// A tag in the wrong kind of test file is worse than a missing tag: it reports
// the feature as covered. Always checked, and fatal under --gate.
const misplaced = misplacedTags(features, rawHits);
if (misplaced.length > 0) {
  console.error(
    `${C.red}${C.bold}MISPLACED TAGS${C.reset} — these features are declared at one ` +
      `level but claimed by a test at another:
` +
      misplaced
        .map(
          (m) =>
            `  ${m.id}  (level: ${m.level})  claimed by ${m.files.join(", ")}\n` +
            `        A ${m.level} feature cannot be established by that file.`,
        )
        .join("\n") +
      "\n",
  );
  // Fatal only when the tag is the ONLY thing claiming the feature — that is a
  // false green. A stray beside a correctly-levelled tag is just untidy.
  const falselyCovered = misplaced.filter((m) => !hits.has(m.id));
  if (falselyCovered.length > 0 && args.includes("--gate")) process.exit(1);
}

if (args.includes("--gate")) {
  if (critMissing.length > 0) {
    console.error(
      `${C.red}${C.bold}GATE FAILED${C.reset} — ${critMissing.length} critical feature(s) in ${gateArg} have no test:\n` +
        critMissing.map((f) => `  ${f.id}  ${f.title}\n        → ${f.spec}`).join("\n"),
    );
    process.exit(1);
  }
  console.log(
    `${C.green}${C.bold}GATE PASSED${C.reset} — every critical feature in ${gateArg} has a test.\n`,
  );
}
