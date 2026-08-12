/**
 * Slash command: count TODO comments in the workspace.
 *
 * A command is a program the user invokes by name. It receives its arguments on
 * argv and writes its result to stdout — whatever it prints is what the user
 * sees.
 */
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", ".next"]);
const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".py",
  ".go",
  ".rs",
]);

export interface TodoHit {
  file: string;
  line: number;
  text: string;
}

async function walk(dir: string, root: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found; // unreadable directory is not worth failing the command over
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...(await walk(full, root)));
    } else if (CODE_EXTENSIONS.has(extname(entry.name))) {
      found.push(full);
    }
  }
  return found;
}

/** Pure enough to test: give it a file list, get back the hits. */
export async function findTodos(root: string): Promise<TodoHit[]> {
  const files = await walk(root, root);
  const hits: TodoHit[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }

    content.split(/\r?\n/).forEach((line, index) => {
      // Comment markers only — otherwise every string containing the word
      // "todo" is a false positive.
      if (/(?:\/\/|#|\/\*|\*)\s*TODO\b/.test(line)) {
        hits.push({ file, line: index + 1, text: line.trim().slice(0, 120) });
      }
    });
  }

  return hits;
}

export function format(hits: TodoHit[], root: string): string {
  if (hits.length === 0) return "No TODO comments found.";

  const lines = hits.map(
    (h) => `  ${h.file.replace(root, "").replace(/\\/g, "/")}:${h.line}  ${h.text}`,
  );
  return `${hits.length} TODO comment${hits.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
}

async function main(): Promise<void> {
  const root = process.argv[2] ?? process.cwd();
  process.stdout.write(`${format(await findTodos(root), root)}\n`);
}

if (process.argv[1]?.includes("count-todos")) {
  void main();
}
