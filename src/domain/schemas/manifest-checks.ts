import type { FieldError } from "@/domain/errors";
import type { ComponentManifest } from "./manifest";

/**
 * Validations a schema cannot express.
 *
 * Zod checks the manifest against itself. These check it against the ARCHIVE it
 * shipped in, and against things no type system knows — like whether a string
 * looks like a leaked credential.
 *
 * Pure functions over (manifest, archive paths), so they are fully testable
 * without a zip file or a database.
 *
 * Spec: docs/06-component-manifest-spec.md sections 3.2 and 7
 * Features: F2.7, F3.9
 */

// ─────────────────────── secret detection ───────────────────────

/**
 * Patterns for credentials that must never appear in a manifest.
 *
 * This is NOT general content scanning (explicitly out of scope, docs/00 §3).
 * It is a targeted guard on fields documented to hold NAMES — `auth.envVars`
 * says "POSTGRES_URL", never the URL itself. Cheap, and it catches the single
 * most common publishing mistake.
 */
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bghp_[A-Za-z0-9]{36}\b/, "GitHub personal access token"],
  [/\bgithub_pat_[A-Za-z0-9_]{60,}\b/, "GitHub fine-grained token"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}\b/, "Anthropic API key"],
  [/\bsk-[A-Za-z0-9]{32,}\b/, "API secret key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, "Private key"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, "Slack token"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API key"],
  [/\bpostgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/, "Database URL with inline password"],
];

/**
 * Walk every string in the manifest looking for credential shapes.
 *
 * The error names the PATTERN and the field path, never the matched value.
 * Echoing the secret back would leak it a second time — into our logs, our
 * error responses, and quite possibly the user's screenshot.
 */
export function findSecrets(manifest: unknown): FieldError[] {
  const found: FieldError[] = [];

  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      for (const [pattern, label] of SECRET_PATTERNS) {
        if (pattern.test(value)) {
          found.push({
            path: path || "(root)",
            message: `Looks like a ${label}. Manifests declare variable NAMES, never values — remove it and reference it by name.`,
          });
          break; // one finding per field is enough to act on
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        walk(child, path ? `${path}.${key}` : key);
      }
    }
  };

  walk(manifest, "");
  return found;
}

// ───────────────── manifest ↔ archive consistency ─────────────────

const EXTENSIONS: Record<ComponentManifest["runtime"]["language"], readonly string[]> = {
  typescript: [".ts", ".tsx", ".mts"],
  javascript: [".js", ".mjs", ".cjs", ".jsx"],
  python: [".py"],
};

/** Every path the manifest declares, with the field that declared it. */
function declaredPaths(
  manifest: ComponentManifest,
): Array<{ path: string; field: string }> {
  const out = [{ path: manifest.entrypoint, field: "entrypoint" }];

  switch (manifest.type) {
    case "skill":
      out.push({ path: manifest.skill.instructions, field: "skill.instructions" });
      break;
    case "plugin":
      manifest.plugin.hooks.forEach((h, i) =>
        out.push({ path: h.handler, field: `plugin.hooks[${i}].handler` }),
      );
      manifest.plugin.commands.forEach((c, i) =>
        out.push({ path: c.handler, field: `plugin.commands[${i}].handler` }),
      );
      break;
    case "agent":
      // systemPrompt is a path OR an inline prompt. Treat anything with a
      // newline or a space as inline — a path has neither.
      if (!/[\s\n]/.test(manifest.agent.systemPrompt)) {
        out.push({ path: manifest.agent.systemPrompt, field: "agent.systemPrompt" });
      }
      break;
    case "mcp-gateway":
      break; // stdio `command.run` is an executable, not an archive path
  }
  return out;
}

/**
 * Cross-validate a manifest against the archive it arrived in.
 *
 * `archiveEntries` is the list of file paths inside the zip, POSIX-style and
 * relative to the archive root.
 */
export function checkAgainstArchive(
  manifest: ComponentManifest,
  archiveEntries: readonly string[],
): FieldError[] {
  const errors: FieldError[] = [];
  const entries = new Set(archiveEntries.map((e) => e.replace(/\\/g, "/")));

  // 1. Every declared path must actually be in the archive. A manifest that
  //    points at a file it did not ship is broken for every consumer.
  for (const { path, field } of declaredPaths(manifest)) {
    if (!entries.has(path)) {
      errors.push({
        path: field,
        message: `"${path}" is not in the archive. Check the path, and remember to zip the folder CONTENTS, not the folder.`,
      });
    }
  }

  // 2. The entrypoint extension must match the declared language.
  const allowed = EXTENSIONS[manifest.runtime.language];
  if (!allowed.some((ext) => manifest.entrypoint.endsWith(ext))) {
    errors.push({
      path: "entrypoint",
      message: `runtime.language is "${manifest.runtime.language}", so the entrypoint should end in ${allowed.join(", ")}`,
    });
  }

  return errors;
}

/**
 * Rules that apply when publishing a NEW VERSION of an existing component.
 *
 * `name` and `type` are immutable for a component's whole life — a consumer who
 * depended on an MCP gateway must never wake up to find that slug is now an
 * agent (docs/03 section 3.8).
 */
export function checkAgainstExisting(
  manifest: ComponentManifest,
  existing: { name: string; type: ComponentManifest["type"] },
): FieldError[] {
  const errors: FieldError[] = [];

  if (manifest.name !== existing.name) {
    errors.push({
      path: "name",
      message: `This component is "${existing.name}". A version cannot rename it — publish a new component instead.`,
    });
  }
  if (manifest.type !== existing.type) {
    errors.push({
      path: "type",
      message: `This component is a "${existing.type}". A component's type can never change.`,
    });
  }
  return errors;
}

// ─────────────────────── semver comparison ───────────────────────

/**
 * Compare two semver strings. Returns <0, 0, or >0.
 *
 * Hand-rolled rather than pulled from a package because the need is narrow and
 * the trap is specific: string comparison says "1.9.0" > "1.10.0", which is
 * wrong and would silently let a publisher go backwards. Numeric comparison
 * per component is the whole fix.
 *
 * Pre-release ordering follows semver §11: a pre-release sorts BEFORE its
 * release, so 1.0.0-beta < 1.0.0.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = "", pre = ""] = v.split("+")[0]!.split("-", 2);
    const nums = core.split(".").map(Number);
    return { nums, pre };
  };

  const left = parse(a);
  const right = parse(b);

  for (let i = 0; i < 3; i++) {
    const diff = (left.nums[i] ?? 0) - (right.nums[i] ?? 0);
    if (diff !== 0) return diff;
  }

  // Equal cores: no pre-release outranks any pre-release.
  if (left.pre === right.pre) return 0;
  if (left.pre === "") return 1;
  if (right.pre === "") return -1;

  const lp = left.pre.split(".");
  const rp = right.pre.split(".");
  for (let i = 0; i < Math.max(lp.length, rp.length); i++) {
    const l = lp[i];
    const r = rp[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const lNum = /^\d+$/.test(l);
    const rNum = /^\d+$/.test(r);
    if (lNum && rNum) {
      const d = Number(l) - Number(r);
      if (d !== 0) return d;
    } else if (lNum !== rNum) {
      return lNum ? -1 : 1; // numeric identifiers sort below alphanumeric
    } else if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
}

export function isStrictlyNewer(candidate: string, current: string): boolean {
  return compareSemver(candidate, current) > 0;
}
