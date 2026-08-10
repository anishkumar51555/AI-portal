# 13 — Feature Test Matrix

**The question this answers:** _is the thing that matters actually validated?_

Coverage percentage cannot answer it. You can hit 80% line coverage with every security
guard untested. This matrix maps each shippable feature to a test, and a script reports
which features have one.

## 1. How it works

```
tests/feature-map.ts          ← the registry: 65 features, each with an ID
        │
        │  tests reference an ID in their title:
        │      describe("[F3.3] archive inspector — bombs", …)
        ▼
scripts/test-matrix.mts       ← greps tests/ for [Fx.y] tags
        │
        ▼
npm run test:matrix           ← the report
```

Three commands:

```powershell
npm run test:matrix                  # all 65 features, grouped by phase
npm run test:matrix -- --phase P3    # one phase
npm run test:matrix -- --gate P3     # exit 1 if any CRITICAL feature is untested
```

`--gate` is what makes a phase's completion checkable rather than a feeling. Wire it into
CI once the phase is underway.

## 2. Sample output

```
P3  ██████░░░░░░░░░░░░░░ 7/22 (32%)
  ✓ ! F3.1   Archive inspector rejects zip-slip (.. path segments)
        2 tag(s) · tests/unit/fixtures.test.ts
  ✗ ! F3.6   Archive inspector computes a stable SHA-256 over the stream
        unit · docs/03 §3.7

────────────────────────────────────────────────
7/65 features have tests (11%)   ! = critical
```

`✗` rows print the **level** and the **spec section**, so the next action is unambiguous:
you know where the test goes and which section defines correct behaviour.

## 3. The registry

`tests/feature-map.ts`. Each row carries:

| Field      | Meaning                                                                      |
| ---------- | ---------------------------------------------------------------------------- |
| `id`       | Stable, e.g. `F3.3`. Never reused, never renumbered.                         |
| `phase`    | `P0`–`P5`, matching [`09-implementation-plan.md`](09-implementation-plan.md) |
| `title`    | What the user or system can do, in one line                                  |
| `level`    | `unit` · `integration` · `e2e` · `manual` — **not a suggestion**             |
| `spec`     | The section defining correct behaviour                                       |
| `critical` | If true, the phase is not done without it. `--gate` blocks on these.         |

`level` matters: a feature marked `integration` is not validated by a unit test with a
mocked database. Mocking Prisma tests the mock.

## 4. Distribution

| Phase                 | Features | Critical | What they cover                                                                     |
| --------------------- | -------: | -------: | ----------------------------------------------------------------------------------- |
| P0 Foundation         |        5 |        4 | Env validation, health, error envelope, no leakage in 500s                          |
| P1 Auth               |        7 |        5 | Guards, the 404-not-403 rule, role escalation, cookie flags                         |
| P2 Data + Templates   |       13 |       11 | Storage round-trip, presign conditions, the full manifest schema, template validity |
| P3 Manifest + Publish |       22 |       18 | Six archive guards, staging isolation, transaction atomicity, fail-safe ordering    |
| P4 Catalog            |       12 |        7 | Search ranking, filter composition, suspension visibility, markdown sanitization    |
| P5 Ship               |        6 |        6 | Non-root container, headers, CSP, both E2E journeys, migration-drift detection      |
| **Total**             |   **65** |   **51** |                                                                                     |

P3 carries a third of the matrix because it is the differentiator and the security
surface. That weighting is deliberate.

## 5. Fixtures

`npm run fixtures:build` regenerates eleven archives in `tests/fixtures/archives/`.
They are gitignored and rebuilt on demand — reproducible, and legible as code rather
than as opaque binaries.

| Fixture                |   On disk | What makes it dangerous                             |
| ---------------------- | --------: | --------------------------------------------------- |
| `valid.zip`            |    1.0 KB | Nothing — the happy path                            |
| `zip-slip.zip`         |    0.8 KB | Entry `../../evil.txt`                              |
| `absolute-path.zip`    |    0.8 KB | Entry `/etc/passwd`                                 |
| `windows-path.zip`     |    0.9 KB | Entry `C:\Windows\System32\evil.dll`                |
| `bomb.zip`             | **65 KB** | Expands to **64 MB** — a ~1000:1 ratio              |
| `symlink.zip`          |    0.6 KB | Symlink entry to `/etc/shadow`                      |
| `too-many-entries.zip` |    177 KB | 1500 entries                                        |
| `no-manifest.zip`      |    0.3 KB | No `component.json`                                 |
| `nested-manifest.zip`  |    0.8 KB | `my-skill/component.json` — the common user mistake |
| `invalid-manifest.zip` |    0.7 KB | Three deliberate schema errors                      |
| `not-a-zip.zip`        |   0.04 KB | Wrong magic bytes                                   |

### 5.1 Two findings from building these

**`archiver` cannot produce a malicious archive.** It runs every entry name through
`sanitizePath()`, stripping `..`, leading `/`, and drive prefixes. Correct and responsible
of the library — and it means the three path-attack fixtures are **forged byte by byte**
in `scripts/build-fixtures.mts`, writing the local file headers, central directory, and
EOCD record directly. That is exactly what a real attacker does: no honest library will
do it for them.

**`yauzl` rejects those archives too, and that shapes the implementation.** With default
options yauzl throws `Error: absolute path: …` on a hostile entry name. Useful defence in
depth, but it surfaces as an opaque error that would become a **500**. So
`archive.inspector` must read with `decodeStrings: false`, decode names itself, and run
its own guards — producing `422 ARCHIVE_UNSAFE` with a message a publisher can act on.

Both findings are recorded in `PROJECT-STATE.md` and asserted by
`tests/unit/fixtures.test.ts`.

## 6. Coverage thresholds

Line coverage complements the matrix; it does not replace it. Thresholds in
`vitest.config.ts` are deliberately uneven:

| Path                                       |    Lines | Why                                            |
| ------------------------------------------ | -------: | ---------------------------------------------- |
| `src/domain/schemas/**`                    |      95% | The specification. A bug corrupts the catalog. |
| `src/server/services/archive.inspector.ts` |      95% | Security boundary. Every guard needs a test.   |
| Global                                     |      70% | Meaningful without being performative          |
| `src/components/**`                        | excluded | UI unit tests rot fastest and catch least      |

Being able to say _"95% on the validator, 0% on the UI, and here is why"_ is a better
answer than _"85% overall"_.

## 7. Workflow

When a feature is built:

1. `npm run test:matrix -- --phase P3` — find its row
2. Read the one spec section it names
3. Write the test at the declared level, tagging `[Fx.y]` in the title
4. **Break the implementation on purpose** and confirm the test goes red. A test that
   passes against broken code is a false guarantee.
5. `npm run test:matrix -- --gate P3` before calling the phase done

The [`/test-feature`](../.claude/skills/test-feature/SKILL.md) skill walks this.

## 8. Adding a feature

Add the row to `tests/feature-map.ts` **first**, then write the test, then build it. Set
`critical: true` only if the phase genuinely should not ship without it — an
everything-is-critical list gates nothing.
