# Rule 70 — Testing

Strategy and coverage targets: [`docs/11-testing-strategy.md`](../../docs/11-testing-strategy.md).

## What gets a test, and what does not

| Area                   | Coverage         | Why                                                   |
| ---------------------- | ---------------- | ----------------------------------------------------- |
| `domain/schemas/`      | **95%**          | The specification. A bug corrupts the catalog.        |
| `archive.inspector`    | **95%**          | Security boundary. Every guard needs a test.          |
| `server/services/`     | 80%              | Business logic                                        |
| `server/repositories/` | 60%              | Covered by integration tests                          |
| `app/api/`             | integration only | Thin handlers — unit tests would test mocks           |
| `components/`          | ~0%              | Manual + E2E. UI unit tests rot fastest, catch least. |

Coverage is deliberately uneven. Do not "improve" it by adding shallow UI tests.

## Test behaviour, not implementation

```ts
// ✗ tests the implementation — breaks on any refactor
expect(mockPrisma.component.create).toHaveBeenCalledWith({ data: {...} });

// ✓ tests the behaviour — survives refactors
const result = await componentService.publish(user, input);
expect(result.slug).toBe("pdf-extractor");
expect(await prisma.component.count()).toBe(1);
```

Integration tests use a **real** Postgres and a **real** MinIO. Never mock Prisma or the
S3 client — a mocked database tests your mock.

## Naming

```ts
describe("archive.inspector", () => {
  it("rejects an entry containing a parent-directory segment", …);
  it("aborts a decompression bomb before reading all entries", …);
});
```

Say what the behaviour is, not what the function is called. `it("works")` and
`it("test 1")` are not acceptable.

## Test the property, not just the outcome

```ts
// weak: any implementation that eventually rejects passes
await expect(inspect(bomb)).rejects.toThrow();

// strong: proves it aborted EARLY, which is the actual defence
const onEntry = vi.fn();
await expect(inspect(bomb, limits, { onEntry })).rejects.toMatchObject({
  code: "ARCHIVE_UNSAFE",
});
expect(onEntry.mock.calls.length).toBeLessThan(50);
```

## Isolation

- Every test is independent and order-independent.
- Integration tests reset state in `beforeEach` (transaction rollback or
  `TRUNCATE … CASCADE`). Never rely on a previous test's rows.
- No shared mutable module state between tests.
- No `test.only` or `describe.only` committed. CI fails on it.

## Fixtures

Malicious archive fixtures live in `tests/fixtures/archives/` and are committed:
`valid.zip`, `zip-slip.zip`, `absolute-path.zip`, `bomb.zip`, `symlink.zip`,
`too-many-entries.zip`, `no-manifest.zip`, `nested-manifest.zip`.

Manifest fixtures live in `tests/fixtures/manifests/` — one valid and several invalid per
type. Build fixtures with a script so they are reproducible.

## When adding a feature

1. If it touches `domain/` or `server/services/`, it needs a test in the same commit.
2. If it fixes a bug, write the failing test **first**, then fix it. That test is the
   permanent proof the bug cannot return.
3. If it changes an API contract, update
   [`docs/03-api-contract.md`](../../docs/03-api-contract.md) in the same commit.

## Do not

- Do not skip a failing test to make CI green. Fix it or revert the change.
- Do not lower a coverage threshold to pass. Write the test.
- Do not add a snapshot test for anything that is not genuinely stable.
- Do not automate the real GitHub OAuth flow in E2E. Seed a session cookie via
  `storageState` — testing GitHub's login page is testing GitHub.
