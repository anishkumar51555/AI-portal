import { describe, it, expect } from "vitest";
import {
  checkAgainstArchive,
  checkAgainstExisting,
  compareSemver,
  findSecrets,
  isStrictlyNewer,
} from "@/domain/schemas/manifest-checks";
import {
  clone,
  validAgent,
  validGateway,
  validPlugin,
  validSkill,
} from "@tests/fixtures/manifests";

/**
 * Validations a schema cannot express.
 * Features: F2.7, F3.9, F3.18
 */

describe("[F3.9] secret detection in manifests", () => {
  it.each([
    ["ghp_" + "a".repeat(36), "GitHub personal access token"],
    ["sk-ant-" + "x".repeat(30), "Anthropic API key"],
    ["AKIA" + "ABCDEFGHIJKLMNOP", "AWS access key id"],
    ["xoxb-" + "1234567890abcdef", "Slack token"],
    ["AIza" + "b".repeat(35), "Google API key"],
    ["-----BEGIN RSA PRIVATE KEY-----", "Private key"],
    ["postgresql://user:hunter2@db.example.com/app", "Database URL with inline password"],
  ])("flags %s", (secret, expectedLabel) => {
    const m = clone(validSkill);
    m.description = `A useful skill. Configure with ${secret} to get started.`;

    const found = findSecrets(m);
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe("description");
    expect(found[0]?.message).toContain(expectedLabel);
  });

  it("NEVER echoes the matched secret back in the message", () => {
    // Reporting the value would leak it a second time — into our logs, our
    // error response, and whatever screenshot the user posts asking for help.
    const secret = "ghp_" + "z".repeat(36);
    const m = clone(validGateway);
    m.mcp.auth.envVars = [];
    m.description = `Gateway configured with ${secret} for access.`;

    const [error] = findSecrets(m);
    expect(error).toBeDefined();
    expect(error!.message).not.toContain(secret);
    expect(error!.message).not.toContain("ghp_");
  });

  it("reports the exact path of a secret nested in an array", () => {
    const m = clone(validSkill);
    m.skill.triggers = ["do the thing", "use key sk-" + "a".repeat(40)];

    const [error] = findSecrets(m);
    expect(error?.path).toBe("skill.triggers[1]");
  });

  it("does not flag legitimate environment variable NAMES", () => {
    // The whole point of auth.envVars: names are expected, values are not.
    const m = clone(validGateway);
    m.mcp.auth.envVars = ["POSTGRES_URL", "API_KEY", "AWS_SECRET_ACCESS_KEY"];
    expect(findSecrets(m)).toHaveLength(0);
  });

  it("does not flag ordinary prose that merely mentions keys", () => {
    const m = clone(validSkill);
    m.description = "Reads an API key from the environment and calls the service.";
    expect(findSecrets(m)).toHaveLength(0);
  });

  it("returns nothing for a clean manifest of every type", () => {
    for (const m of [validSkill, validPlugin, validGateway]) {
      expect(findSecrets(m)).toHaveLength(0);
    }
  });
});

describe("[F2.7] manifest cross-validated against its archive", () => {
  const skillEntries = ["component.json", "README.md", "SKILL.md", "src/index.ts"];

  it("passes when every declared path is present", () => {
    expect(checkAgainstArchive(validSkill, skillEntries)).toHaveLength(0);
  });

  it("rejects an entrypoint that is not in the archive", () => {
    const errors = checkAgainstArchive(validSkill, ["component.json", "SKILL.md"]);
    expect(errors.map((e) => e.path)).toContain("entrypoint");
  });

  it("rejects a skill whose instructions file is missing", () => {
    const errors = checkAgainstArchive(validSkill, ["component.json", "src/index.ts"]);
    expect(errors.map((e) => e.path)).toContain("skill.instructions");
  });

  it("rejects a plugin hook handler that is not in the archive", () => {
    const errors = checkAgainstArchive(validPlugin, ["component.json", "src/index.ts"]);
    expect(errors.map((e) => e.path)).toContain("plugin.hooks[0].handler");
  });

  it("hints at the folder-vs-contents mistake, which is the usual cause", () => {
    const errors = checkAgainstArchive(validSkill, ["my-skill/src/index.ts"]);
    expect(errors[0]?.message).toMatch(/zip the folder CONTENTS/i);
  });

  it("rejects an entrypoint extension that contradicts runtime.language", () => {
    const m = clone(validSkill);
    m.runtime.language = "python";
    m.entrypoint = "src/index.ts";

    const errors = checkAgainstArchive(m, [...skillEntries]);
    const entrypointErrors = errors.filter((e) => e.path === "entrypoint");
    expect(entrypointErrors.some((e) => e.message.includes(".py"))).toBe(true);
  });

  it("accepts a matching python entrypoint", () => {
    const m = clone(validSkill);
    m.runtime.language = "python";
    m.entrypoint = "src/main.py";
    expect(
      checkAgainstArchive(m, ["component.json", "SKILL.md", "src/main.py"]),
    ).toHaveLength(0);
  });

  it("treats an inline agent system prompt as prose, not a path", () => {
    // A prompt with spaces is inline; requiring it to exist as a file would be
    // wrong, and reporting it missing would be baffling.
    const m = clone(validSkill);
    expect(checkAgainstArchive(m, skillEntries)).toHaveLength(0);
  });
});

describe("[F3.19] immutable identity across versions", () => {
  it("rejects a rename", () => {
    const errors = checkAgainstExisting(validSkill, { name: "old-name", type: "skill" });
    expect(errors.map((e) => e.path)).toContain("name");
  });

  it("rejects a type change — a component's type is fixed for life", () => {
    // A consumer depending on an MCP gateway must never find that slug is now
    // an agent.
    const errors = checkAgainstExisting(validSkill, {
      name: "pdf-extractor",
      type: "mcp-gateway",
    });
    expect(errors.map((e) => e.path)).toContain("type");
  });

  it("accepts an unchanged identity", () => {
    expect(
      checkAgainstExisting(validSkill, { name: "pdf-extractor", type: "skill" }),
    ).toHaveLength(0);
  });
});

describe("[F3.18] semver comparison", () => {
  it("compares NUMERICALLY, not as strings", () => {
    // The trap this function exists for: "1.9.0" > "1.10.0" as strings, which
    // would silently let a publisher go backwards.
    expect(compareSemver("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(isStrictlyNewer("1.10.0", "1.9.0")).toBe(true);
    expect(isStrictlyNewer("1.9.0", "1.10.0")).toBe(false);
  });

  it.each([
    ["2.0.0", "1.99.99", 1],
    ["1.0.1", "1.0.0", 1],
    ["1.0.0", "1.0.0", 0],
    ["0.0.1", "0.0.2", -1],
    ["10.0.0", "9.0.0", 1],
  ])("compare(%s, %s) sign = %i", (a, b, sign) => {
    expect(Math.sign(compareSemver(a, b))).toBe(sign);
  });

  it("sorts a pre-release BEFORE its release, per semver section 11", () => {
    expect(compareSemver("1.0.0-beta", "1.0.0")).toBeLessThan(0);
    expect(compareSemver("1.0.0", "1.0.0-beta")).toBeGreaterThan(0);
    expect(isStrictlyNewer("1.0.0", "1.0.0-rc.1")).toBe(true);
  });

  it("orders pre-release identifiers correctly", () => {
    expect(compareSemver("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
    expect(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.2")).toBeLessThan(0);
    // Numeric identifiers sort below alphanumeric ones.
    expect(compareSemver("1.0.0-1", "1.0.0-alpha")).toBeLessThan(0);
    // More identifiers wins when the prefix is equal.
    expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
  });

  it("ignores build metadata, which has no precedence", () => {
    expect(compareSemver("1.0.0+build.1", "1.0.0+build.999")).toBe(0);
    expect(compareSemver("1.0.0+abc", "1.0.0")).toBe(0);
  });

  it("rejects equal versions as 'newer' — republishing the same version is a conflict", () => {
    expect(isStrictlyNewer("1.0.0", "1.0.0")).toBe(false);
  });

  it("sorts a realistic release history correctly", () => {
    const shuffled = ["1.10.0", "1.0.0", "2.0.0-rc.1", "1.2.0", "2.0.0", "1.0.0-beta.2"];
    const sorted = [...shuffled].sort(compareSemver);
    expect(sorted).toEqual([
      "1.0.0-beta.2",
      "1.0.0",
      "1.2.0",
      "1.10.0",
      "2.0.0-rc.1",
      "2.0.0",
    ]);
  });
});

describe("[F2.7] declared-path coverage across every component type", () => {
  it("plugin: checks COMMAND handlers, not just hook handlers", () => {
    const m = clone(validPlugin);
    m.plugin.commands = [{ name: "lint", description: "Lint", handler: "src/cmd/lint.ts" }];

    const missing = checkAgainstArchive(m, [
      "component.json",
      "src/index.ts",
      "src/hooks/format.ts",
    ]);
    expect(missing.map((e) => e.path)).toContain("plugin.commands[0].handler");

    const present = checkAgainstArchive(m, [
      "component.json",
      "src/index.ts",
      "src/hooks/format.ts",
      "src/cmd/lint.ts",
    ]);
    expect(present).toHaveLength(0);
  });

  it("agent: a path-shaped systemPrompt must exist in the archive", () => {
    const m = clone(validAgent); // systemPrompt = "prompts/system.md"
    const missing = checkAgainstArchive(m, ["component.json", "src/index.ts"]);
    expect(missing.map((e) => e.path)).toContain("agent.systemPrompt");

    const present = checkAgainstArchive(m, [
      "component.json",
      "src/index.ts",
      "prompts/system.md",
    ]);
    expect(present).toHaveLength(0);
  });

  it("agent: an INLINE systemPrompt is prose, so it is not looked up as a file", () => {
    // Reporting "You are a helpful research assistant." as a missing file would
    // be baffling. Whitespace is the signal that it is inline.
    const m = clone(validAgent);
    m.agent.systemPrompt = "You are a helpful research assistant. Cite your sources.";
    expect(checkAgainstArchive(m, ["component.json", "src/index.ts"])).toHaveLength(0);
  });

  it("mcp-gateway: command.run is an executable, not an archive path", () => {
    // `node` is on PATH, not in the zip — looking it up would always fail.
    const m = clone(validGateway); // command.run = "node"
    expect(checkAgainstArchive(m, ["component.json", "src/server.ts"])).toHaveLength(0);
  });
});

describe("[F3.18] semver edge cases", () => {
  it("treats numerically equal pre-release identifiers as equal", () => {
    // "alpha.01" and "alpha.1" differ as strings but compare equal numerically,
    // so the identifier loop runs to completion without an early return.
    expect(compareSemver("1.0.0-alpha.01", "1.0.0-alpha.1")).toBe(0);
    expect(isStrictlyNewer("1.0.0-alpha.01", "1.0.0-alpha.1")).toBe(false);
  });

  it("handles a missing patch segment without crashing", () => {
    // Not valid semver — the schema rejects it — but the comparator must not
    // throw if it is ever handed one.
    expect(Math.sign(compareSemver("1.2", "1.2.0"))).toBe(0);
    expect(Math.sign(compareSemver("2", "1.9.9"))).toBe(1);
  });
});
