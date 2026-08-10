---
name: test-feature
description: Write the local test cases that validate a feature, driven by the feature registry in tests/feature-map.ts. Use after building any feature, or when the test matrix shows a feature has no test. Ensures every feature this project ships is actually validated.
---

# /test-feature — validate a feature properly

Every feature has an ID in [`tests/feature-map.ts`](../../../tests/feature-map.ts).
`npm run test:matrix` reports which IDs have tests. This skill closes a gap in that
report.

## Procedure

### 1. Find the feature

```powershell
npm run test:matrix -- --phase P3     # what is missing in this phase
```

Take the ID, title, **level**, and **spec** reference from the registry. The level is not
a suggestion — a feature marked `integration` is not validated by a unit test with a
mocked database.

### 2. Read the spec section it names

One section. That section defines correct behaviour; your test asserts _that_, not what
the code happens to do.

### 3. Write the test in the right place

| Level         | Location                      | Uses                                                                    |
| ------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `unit`        | `tests/unit/*.test.ts`        | Pure functions. No DB, no network, no containers.                       |
| `integration` | `tests/integration/*.test.ts` | **Real** Postgres + **real** MinIO. Never mock Prisma or the S3 client. |
| `e2e`         | `tests/e2e/*.spec.ts`         | Playwright. Seeded session cookie, never real GitHub OAuth.             |
| `manual`      | `docs/11` §7 checklist        | Not automatable — add a checklist line instead.                         |

### 4. Tag it so the tracker sees it

Put the ID in square brackets in the describe or it title:

```ts
describe("[F3.3] archive inspector — decompression bombs", () => {
  it("[F3.3] aborts before reading the whole archive", async () => { ... });
});
```

### 5. Test the property, not just the outcome

This is the difference between a test that proves something and a test that passes.

```ts
// ✗ weak — any implementation that eventually rejects passes this
await expect(inspect(bomb)).rejects.toThrow();

// ✓ strong — proves the EARLY abort, which is the actual defence.
//   Anyone can reject a bomb after decompressing it; not decompressing it is the point.
const onEntry = vi.fn();
await expect(inspect(bomb, limits, { onEntry })).rejects.toMatchObject({
  code: "ARCHIVE_UNSAFE",
});
expect(onEntry.mock.calls.length).toBeLessThan(50);
```

Ask: _if the implementation were subtly wrong, would this test still pass?_ If yes, the
test is not finished.

### 6. Verify it actually fails without the code

Break the implementation deliberately and confirm the test goes red. A test that passes
against broken code is worse than no test — it is a false guarantee.

### 7. Re-run the tracker

```powershell
npm run test:matrix -- --phase P3
npm run test:matrix -- --gate P3     # exit 1 if any CRITICAL feature is untested
```

## Available fixtures

`npm run fixtures:build` regenerates these in `tests/fixtures/archives/`:

| Fixture                | Contains                                            |
| ---------------------- | --------------------------------------------------- |
| `valid.zip`            | Clean skill component, manifest at root             |
| `zip-slip.zip`         | **Forged** — `../../evil.txt`                       |
| `absolute-path.zip`    | **Forged** — `/etc/passwd`                          |
| `windows-path.zip`     | **Forged** — `C:\Windows\System32\evil.dll`         |
| `bomb.zip`             | 65 KB → 64 MB of zeros                              |
| `symlink.zip`          | Symlink entry to `/etc/shadow`                      |
| `too-many-entries.zip` | 1500 entries                                        |
| `no-manifest.zip`      | No `component.json`                                 |
| `nested-manifest.zip`  | `my-skill/component.json` — the common user mistake |
| `invalid-manifest.zip` | Three deliberate schema errors                      |
| `not-a-zip.zip`        | Wrong magic bytes                                   |

The three path-attack fixtures are byte-forged because `archiver` sanitizes entry names
and cannot produce them. Read `scripts/build-fixtures.mts` before adding a new one.

## Adding a feature to the registry

If you build something with no ID, add the row to `tests/feature-map.ts` **first**, then
write the test. Set `critical: true` only if the phase should not be called done without
it — the `--gate` flag blocks on exactly those.

## Rules

- Never lower a coverage threshold to make a run pass.
- Never tag a feature ID from a test that does not actually exercise it. The tracker
  greps for tags; a decorative tag makes the report lie.
- Never mock Prisma or the S3 client in an integration test.
- Never automate the real GitHub OAuth screen — that tests GitHub.
