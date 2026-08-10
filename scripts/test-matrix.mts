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
    } else if (/\.(test|spec)\.ts$/.test(e.name)) {
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

const hits = await collectHits();
const critMissing = render(features, hits);

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
