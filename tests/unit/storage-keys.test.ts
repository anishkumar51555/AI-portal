import { describe, it, expect, vi } from "vitest";
import {
  assertOwnStagingKey,
  componentKey,
  downloadFilename,
  isOwnStagingKey,
  stagingKey,
  templateKey,
} from "@/domain/storage-keys";
import { AppError } from "@/domain/errors";

/**
 * Object-key derivation and the staging isolation boundary.
 *
 * Pure functions, so the security boundary is testable without a bucket.
 *
 * Deliberately untagged. F3.11 and F3.12 are declared `integration` because they
 * are claims about what the PRESIGN and PUBLISH endpoints do — proving
 * `assertOwnStagingKey` works in isolation does not establish that anything
 * calls it. F3.11 is covered by tests/integration/presign.test.ts; F3.12 waits
 * for the publish endpoint. `npm run test:matrix` now enforces this.
 */

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(AppError.is(e)).toBe(true);
    return (e as AppError).code;
  }
  throw new Error("expected a throw, got none");
}

describe("keys are derived by the server, never supplied", () => {
  it("builds a staging key under the caller's own prefix", () => {
    const key = stagingKey("usr_abc123");
    expect(key).toMatch(/^staging\/usr_abc123\/[0-9A-HJKMNP-TV-Z]{26}\.zip$/);
  });

  it("gives every upload a unique key, so two uploads cannot collide", () => {
    const keys = new Set(Array.from({ length: 200 }, () => stagingKey("usr_abc123")));
    expect(keys.size).toBe(200);
  });

  it("produces time-ordered staging keys (ULID, not UUID)", () => {
    // Lexicographic order matches creation order, which makes a bucket listing
    // chronological and the 24h lifecycle sweep easy to reason about.
    //
    // The ordering guarantee is per MILLISECOND: a ULID's first 10 characters
    // are the timestamp, the remaining 16 are fresh randomness on every call.
    // Two keys minted inside the same millisecond therefore sort arbitrarily —
    // which is fine, because nothing here depends on sub-millisecond order.
    // Fake timers make that boundary explicit instead of leaving the test to
    // win a coin flip on how fast the machine is.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const first = stagingKey("usr_a");
      vi.setSystemTime(new Date("2026-01-01T00:00:00.001Z"));
      const second = stagingKey("usr_a");
      vi.setSystemTime(new Date("2026-01-01T06:00:00.000Z"));
      const third = stagingKey("usr_a");

      expect([third, first, second].sort()).toEqual([first, second, third]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("builds the documented component and template keys", () => {
    expect(componentKey("pdf-extractor", "1.2.0")).toBe(
      "components/pdf-extractor/1.2.0/pdf-extractor-1.2.0.zip",
    );
    expect(templateKey("mcp-gateway", "1.0.0")).toBe(
      "templates/mcp-gateway/1.0.0/mcp-gateway-template-1.0.0.zip",
    );
  });

  it("accepts hyphens and dots, which real slugs and versions contain", () => {
    // Guards a real bug from an earlier draft: a character-range typo rejected
    // every hyphenated slug, which is most of them.
    expect(() => componentKey("pdf-extractor", "1.0.0-beta.1")).not.toThrow();
    expect(() => componentKey("a-b-c-d", "10.20.30")).not.toThrow();
  });

  it.each([
    ["../../etc", "parent traversal"],
    ["a/b", "path separator"],
    ["a\\b", "backslash"],
    ["", "empty"],
    [".hidden", "leading dot"],
    ["has space", "whitespace"],
    ["semi;colon", "punctuation"],
    ["x".repeat(129), "over length"],
  ])("refuses to build a key from %s (%s)", (segment) => {
    expect(codeOf(() => componentKey(segment, "1.0.0"))).toBe("VALIDATION_ERROR");
    expect(codeOf(() => componentKey("ok-slug", segment))).toBe("VALIDATION_ERROR");
  });

  it("refuses a traversal in the userId, so one user cannot target another's prefix", () => {
    expect(codeOf(() => stagingKey("../victim"))).toBe("VALIDATION_ERROR");
  });
});

describe("staging isolation boundary", () => {
  const ALICE = "usr_alice";
  const own = stagingKey(ALICE);

  it("accepts the caller's own key", () => {
    expect(() => assertOwnStagingKey(own, ALICE)).not.toThrow();
    expect(isOwnStagingKey(own, ALICE)).toBe(true);
  });

  it("REJECTS another user's key — the whole point of the boundary", () => {
    // Without this, an authenticated user can publish someone else's upload as
    // their own. Session checks do not catch it: the attacker really is signed in.
    const bobs = stagingKey("usr_bob");
    expect(codeOf(() => assertOwnStagingKey(bobs, ALICE))).toBe("STAGING_FORBIDDEN");
    expect(isOwnStagingKey(bobs, ALICE)).toBe(false);
  });

  it.each([
    ["staging/usr_alice/../usr_bob/x.zip", "traversal out of the prefix"],
    ["staging//usr_alice/x.zip", "double slash"],
    ["staging/usr_alice2/x.zip", "prefix-collision with a similar user id"],
    ["components/pdf/1.0.0/pdf-1.0.0.zip", "a non-staging key entirely"],
    ["templates/skill/1.0.0/skill-template-1.0.0.zip", "an official template"],
    ["staging/usr_alice/", "empty object segment"],
    ["staging/usr_alice/nested/x.zip", "nested path"],
    ["", "empty string"],
  ])("rejects %s (%s)", (key) => {
    expect(codeOf(() => assertOwnStagingKey(key, ALICE))).toBe("STAGING_FORBIDDEN");
  });

  it("rejects a key that merely CONTAINS the caller's prefix", () => {
    // startsWith alone is not enough; an attacker controls the whole string.
    expect(codeOf(() => assertOwnStagingKey("x/staging/usr_alice/a.zip", ALICE))).toBe(
      "STAGING_FORBIDDEN",
    );
  });

  it("keeps the offending key in log context, out of the response", () => {
    let err: AppError | undefined;
    try {
      assertOwnStagingKey("staging/usr_bob/secret.zip", ALICE);
    } catch (e) {
      err = e as AppError;
    }
    expect(err!.context).toMatchObject({ key: "staging/usr_bob/secret.zip" });
    // The message a user sees names no key at all.
    expect(err!.message).not.toContain("usr_bob");
    expect(err!.details).toBeUndefined();
  });
});

describe("download filenames", () => {
  it("produces an attachment disposition with a readable name", () => {
    expect(downloadFilename("pdf-extractor", "1.2.0")).toBe(
      'attachment; filename="pdf-extractor-1.2.0.zip"',
    );
  });

  it("neutralises characters that would break the header or inject a directive", () => {
    // A quote in the filename would terminate the quoted string early and let
    // an attacker append their own header directive.
    const value = downloadFilename('evil"; rm -rf /; x="', "1.0.0");
    expect(value.match(/"/g)).toHaveLength(2);
    expect(value).not.toContain("; rm");
  });
});
