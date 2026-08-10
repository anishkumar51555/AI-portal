---
name: new-endpoint
description: Scaffold an API endpoint that matches the documented contract — guard, Zod parse, service delegation, error envelope, and an integration test. Use when adding or changing anything under src/app/api/.
---

# /new-endpoint — build an endpoint on-contract

Every endpoint in this project is already specified in
[`docs/03-api-contract.md`](../../../docs/03-api-contract.md). **Find it there first.**
If it is not documented, the contract does not exist yet — write the doc section first,
get it agreed, then build.

## 1. Read the contract

From `docs/03-api-contract.md`, extract exactly:

- path, method, and auth mark (— / 🔒 / 🔑 / 👑)
- request shape
- success status and body shape
- every documented error code for this endpoint
- rate limit, if listed in §4

Quote the success shape back before writing code. If the doc is silent on something you
need, **stop and ask** — do not invent it.

## 2. The shape every handler takes

```ts
// src/app/api/components/[slug]/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { requireOwnership } from "@/server/auth/guards";
import { updateComponentSchema } from "@/domain/schemas/api/component";
import { componentService } from "@/server/services/component.service";
import { toResponse, getRequestId } from "@/domain/errors";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }, // Promise in Next 15+
) {
  const requestId = getRequestId(req);
  try {
    const { slug } = await params;
    const user = await requireOwnership(slug); // 1. authorize
    const body = updateComponentSchema.parse(await req.json()); // 2. validate
    const data = await componentService.update(user, slug, body); // 3. delegate
    return NextResponse.json(
      { data },
      {
        // 4. respond
        status: 200,
        headers: { "X-Request-Id": requestId },
      },
    );
  } catch (err) {
    return toResponse(err, requestId); // 5. one handler
  }
}
```

**Authorize before validate.** No reason to parse a request from someone not allowed to
make it.

## 3. Rules

| Rule                                | Why                                                |
| ----------------------------------- | -------------------------------------------------- |
| Handler ≤ ~25 lines                 | Longer means logic leaked out of the service       |
| No Prisma in `app/`                 | Boundary rule — go through a repository            |
| No business logic in `app/`         | It belongs in a service and must be unit-testable  |
| Schema in `src/domain/schemas/api/` | Never inline in the route file                     |
| `.strict()` on bodies               | An unknown key is a typo, and typos should be loud |
| Query schemas coerce and clamp      | `?page=abc` degrades to page 1; it never 400s      |
| Error codes from the taxonomy       | `docs/03 §1.2` is closed — never invent one        |
| One `toResponse()`                  | No bespoke error formatting anywhere               |

## 4. Server Actions get identical treatment

A Server Action is a public HTTP endpoint. `requireAuth()` first line, Zod parse second.
Being called from a form grants it nothing.

## 5. Test it

Endpoints are covered by **integration** tests, not unit tests — a unit test with a mocked
Prisma tests the mock.

```ts
// tests/integration/components-patch.test.ts
it("rejects an attempt to change an immutable field", async () => {
  const res = await PATCH(reqWith({ type: "AGENT" }), { params: p });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe("VALIDATION_ERROR");
});

it("returns 404, not 403, for a component owned by someone else", async () => {
  // enumeration-oracle defence — docs/08 §2.2
  const res = await PATCH(reqAs(otherUser), { params: p });
  expect(res.status).toBe(404);
});
```

Cover, at minimum: the happy path, one auth failure, one validation failure, and every
`409`/`422` this endpoint documents.

## 6. Checklist before reporting done

- [ ] Path, method, and status codes match the doc exactly
- [ ] Response body key-for-key identical to the documented shape
- [ ] Guard called, and it is the right one for the auth mark
- [ ] Every input Zod-parsed
- [ ] Every documented error code reachable and correct
- [ ] Rate limit applied if listed in `docs/03 §4`
- [ ] `X-Request-Id` on the response
- [ ] Integration test covering happy path + auth failure + validation failure
- [ ] If the contract changed, `docs/03-api-contract.md` updated in the same commit
