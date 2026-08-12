/**
 * Idempotent database seed.
 *
 *   npm run db:seed
 *
 * Runs `upsert` everywhere, never `create`, so running it twice against the same
 * database produces identical row counts. That is not a nicety — the seed runs
 * on every fresh clone, in CI, and after `db:reset`, and a seed that only works
 * on an empty database is a seed nobody trusts to run.
 *
 * Spec: docs/02-data-model.md §6
 * Features: F2.13
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ZipArchive } from "archiver";
import { z } from "zod";
import { prisma } from "@/server/db";
import { putObject } from "@/server/storage/storage.service";
import { componentKey, templateKey } from "@/domain/storage-keys";
import { env } from "@/lib/env";

const DIST_DIR = join(process.cwd(), "templates", ".dist");

const C = {
  green: "\x1b[32m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
};

// ─────────────────────────── 1. Tags ───────────────────────────

const TAGS: ReadonlyArray<readonly [slug: string, label: string]> = [
  ["pdf", "PDF"],
  ["rag", "RAG"],
  ["search", "Search"],
  ["database", "Database"],
  ["github", "GitHub"],
  ["slack", "Slack"],
  ["vision", "Vision"],
  ["audio", "Audio"],
  ["scraping", "Scraping"],
  ["email", "Email"],
  ["calendar", "Calendar"],
  ["code-gen", "Code generation"],
  ["testing", "Testing"],
  ["observability", "Observability"],
  ["security", "Security"],
  ["finance", "Finance"],
  ["translation", "Translation"],
  ["summarization", "Summarization"],
  ["workflow", "Workflow"],
  ["data-extraction", "Data extraction"],
] as const;

async function seedTags(): Promise<number> {
  for (const [slug, label] of TAGS) {
    await prisma.tag.upsert({
      where: { slug },
      update: { label },
      create: { slug, label },
    });
  }
  return TAGS.length;
}

// ───────────────────────── 2. Templates ─────────────────────────

/**
 * The build script's output index. Parsed rather than trusted: it is a file on
 * disk that a stale build or a hand-edit could have corrupted, and every
 * external input gets parsed before anything reads it.
 */
const distIndexSchema = z.array(
  z.object({
    type: z.enum(["skill", "plugin", "agent", "mcp-gateway"]),
    dbType: z.enum(["SKILL", "PLUGIN", "AGENT", "MCP_GATEWAY"]),
    version: z.string(),
    sizeBytes: z.number().int().positive(),
    checksumSha256: z.string().length(64),
    fileName: z.string(),
  }),
);

/**
 * Catalog copy for the `/templates` page.
 *
 * Deliberately NOT taken from each template's component.json: those manifests
 * carry placeholder values (`my-skill`, "TODO: describe…") that the developer
 * is meant to replace. Rendering a TODO marker on the catalog page would be a
 * bug, so the portal authors its own display copy here.
 */
const TEMPLATE_COPY = {
  skill: {
    name: "Skill Template",
    description:
      "A working extractive summariser with a passing test suite. Start here to package a single, well-defined capability that a model can invoke.",
  },
  plugin: {
    name: "Plugin Template",
    description:
      "A hook and a slash command, wired and tested. Start here to extend an existing tool's behaviour — the secret-guard hook shows the fail-open pattern.",
  },
  agent: {
    name: "Agent Template",
    description:
      "A real Claude Messages API loop with tool use, an iteration cap, and a calculator tool that does not use eval. Start here for autonomous multi-step work.",
  },
  "mcp-gateway": {
    name: "MCP Gateway Template",
    description:
      "A Model Context Protocol server over stdio, exposing two tools and one resource. Start here to put an existing system behind an MCP interface.",
  },
} as const;

async function seedTemplates(): Promise<number> {
  let index;
  try {
    index = distIndexSchema.parse(
      JSON.parse(await readFile(join(DIST_DIR, "index.json"), "utf8")),
    );
  } catch {
    console.log(
      `  ${C.yellow}skipped${C.reset} ${C.dim}— no templates/.dist/index.json. Run \`npm run templates:build\` first.${C.reset}`,
    );
    return 0;
  }

  for (const entry of index) {
    const bytes = await readFile(join(DIST_DIR, entry.fileName));

    // Re-verify the checksum against the bytes on disk. index.json and the .zip
    // are two files that can fall out of step — if someone rebuilds one and not
    // the other, the Template row would advertise a checksum the object does
    // not have, and every integrity check downstream would fail confusingly.
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== entry.checksumSha256) {
      throw new Error(
        `${entry.fileName}: checksum does not match index.json.\n` +
          `  Run \`npm run templates:build\` to regenerate both together.`,
      );
    }

    const key = templateKey(entry.type, entry.version);

    // NON-NEGOTIABLE #7 — storage first, database second. An orphaned object is
    // harmless; a Template row pointing at a missing object is a user-visible
    // 404 on the download button.
    await putObject(key, bytes);

    const copy = TEMPLATE_COPY[entry.type];
    await prisma.template.upsert({
      where: { type: entry.dbType },
      update: {
        name: copy.name,
        description: copy.description,
        version: entry.version,
        objectKey: key,
        sizeBytes: entry.sizeBytes,
        checksumSha256: entry.checksumSha256,
      },
      create: {
        type: entry.dbType,
        name: copy.name,
        description: copy.description,
        version: entry.version,
        objectKey: key,
        sizeBytes: entry.sizeBytes,
        checksumSha256: entry.checksumSha256,
      },
    });
  }

  return index.length;
}

// ──────────────────── 3. Demo catalog (dev only) ────────────────────

const DEMO_COMPONENTS = [
  {
    slug: "pdf-extractor",
    displayName: "PDF Extractor",
    type: "SKILL",
    summary: "Pulls clean text, tables, and metadata out of PDFs, including scanned ones.",
    tags: ["pdf", "data-extraction"],
  },
  {
    slug: "repo-summarizer",
    displayName: "Repo Summarizer",
    type: "SKILL",
    summary:
      "Reads a repository and produces an architecture summary a new joiner can follow.",
    tags: ["summarization", "code-gen"],
  },
  {
    slug: "secret-guard",
    displayName: "Secret Guard",
    type: "PLUGIN",
    summary:
      "Blocks commits and tool calls that would write a credential into the repository.",
    tags: ["security", "testing"],
  },
  {
    slug: "slack-notifier",
    displayName: "Slack Notifier",
    type: "PLUGIN",
    summary:
      "Posts build results and review requests into a Slack channel from any workflow.",
    tags: ["slack", "workflow"],
  },
  {
    slug: "release-captain",
    displayName: "Release Captain",
    type: "AGENT",
    summary: "Drafts release notes from merged pull requests, then opens the tagging PR.",
    tags: ["github", "workflow"],
  },
  {
    slug: "test-writer",
    displayName: "Test Writer",
    type: "AGENT",
    summary: "Writes failing tests from a bug report, then iterates until they pass.",
    tags: ["testing", "code-gen"],
  },
  {
    slug: "postgres-gateway",
    displayName: "Postgres Gateway",
    type: "MCP_GATEWAY",
    summary:
      "Exposes a read-only Postgres database to MCP clients with per-query row limits.",
    tags: ["database", "security"],
  },
  {
    slug: "web-scout",
    displayName: "Web Scout",
    type: "MCP_GATEWAY",
    summary:
      "Search and fetch tools for the open web, with a domain allowlist and caching.",
    tags: ["search", "scraping"],
  },
] as const;

/**
 * Build a tiny but REAL archive for a demo component.
 *
 * The demo catalog exists so the portal is never empty in a screenshot — but a
 * catalog whose download buttons 404 is worse than an empty one. These archives
 * are genuine zips with a genuine manifest, so every demo row is downloadable.
 *
 * The fixed `date` is what makes this deterministic: without it archiver stamps
 * the current time into each entry header, the bytes differ on every run, and
 * the checksum — which is globally unique — would collide on the second seed.
 */
const FIXED_DATE = new Date("2026-01-01T00:00:00.000Z");

async function demoArchive(component: (typeof DEMO_COMPONENTS)[number], version: string) {
  const manifest = {
    manifestVersion: "1.0",
    name: component.slug,
    version,
    type: component.type.toLowerCase().replace("_", "-"),
    description: component.summary,
    license: "MIT",
    author: { name: "Portal Demo" },
    keywords: [...component.tags],
    runtime: { language: "typescript", node: ">=20" },
    entrypoint: "src/index.ts",
  };

  const chunks: Buffer[] = [];
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on("data", (chunk: Buffer) => chunks.push(chunk));

  archive.append(`${JSON.stringify(manifest, null, 2)}\n`, {
    name: "component.json",
    date: FIXED_DATE,
  });
  archive.append(`# ${component.displayName}\n\n${component.summary}\n`, {
    name: "README.md",
    date: FIXED_DATE,
  });
  archive.append(`export const name = ${JSON.stringify(component.slug)};\n`, {
    name: "src/index.ts",
    date: FIXED_DATE,
  });

  await archive.finalize();
  const bytes = Buffer.concat(chunks);

  return { bytes, checksum: createHash("sha256").update(bytes).digest("hex"), manifest };
}

async function seedDemoCatalog(): Promise<number> {
  const demoUser = await prisma.user.upsert({
    where: { email: "demo@ai-portal.local" },
    update: {},
    create: {
      email: "demo@ai-portal.local",
      name: "Portal Demo",
      githubLogin: "portal-demo",
      role: "PUBLISHER",
    },
  });

  const version = "1.0.0";

  for (const item of DEMO_COMPONENTS) {
    const { bytes, checksum, manifest } = await demoArchive(item, version);
    const key = componentKey(item.slug, version);

    // Storage before database, same rule as the templates above.
    await putObject(key, bytes);

    const component = await prisma.component.upsert({
      where: { slug: item.slug },
      update: { displayName: item.displayName, summary: item.summary },
      create: {
        slug: item.slug,
        name: item.slug,
        displayName: item.displayName,
        type: item.type,
        summary: item.summary,
        readme: `# ${item.displayName}\n\n${item.summary}\n`,
        license: "MIT",
        ownerId: demoUser.id,
      },
    });

    // ComponentVersion rows are INSERT-ONLY (non-negotiable #4), so this is a
    // find-or-create rather than an upsert with an update branch — re-running
    // the seed must never rewrite a published version.
    let componentVersion = await prisma.componentVersion.findUnique({
      where: { componentId_version: { componentId: component.id, version } },
    });

    componentVersion ??= await prisma.componentVersion.create({
      data: {
        componentId: component.id,
        version,
        manifest,
        objectKey: key,
        sizeBytes: bytes.byteLength,
        checksumSha256: checksum,
        publishedById: demoUser.id,
      },
    });

    await prisma.component.update({
      where: { id: component.id },
      data: { latestVersionId: componentVersion.id },
    });

    for (const tagSlug of item.tags) {
      const tag = await prisma.tag.findUnique({ where: { slug: tagSlug } });
      if (!tag) continue;
      await prisma.componentTag.upsert({
        where: { componentId_tagId: { componentId: component.id, tagId: tag.id } },
        update: {},
        create: { componentId: component.id, tagId: tag.id },
      });
    }
  }

  return DEMO_COMPONENTS.length;
}

// ─────────────────────────────── main ───────────────────────────────

async function main() {
  console.log(
    `\n${C.bold}Seeding${C.reset} ${C.dim}(idempotent — safe to re-run)${C.reset}\n`,
  );

  const tags = await seedTags();
  console.log(`  ${C.green}✓${C.reset} tags        ${C.dim}${tags} upserted${C.reset}`);

  const templates = await seedTemplates();
  if (templates > 0) {
    console.log(
      `  ${C.green}✓${C.reset} templates   ${C.dim}${templates} uploaded + upserted${C.reset}`,
    );
  }

  if (env.NODE_ENV === "production") {
    console.log(
      `  ${C.yellow}skipped${C.reset} demo catalog ${C.dim}— NODE_ENV=production${C.reset}`,
    );
  } else {
    const demo = await seedDemoCatalog();
    console.log(`  ${C.green}✓${C.reset} demo        ${C.dim}${demo} components${C.reset}`);
  }

  const counts = {
    tags: await prisma.tag.count(),
    templates: await prisma.template.count(),
    components: await prisma.component.count(),
    versions: await prisma.componentVersion.count(),
  };
  console.log(
    `\n${C.dim}rows: ${Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join("  ")}${C.reset}\n`,
  );
}

await main();
await prisma.$disconnect();
