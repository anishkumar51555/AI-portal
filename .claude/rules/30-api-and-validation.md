# Rule 30 — API design & validation

The contract is [`docs/03-api-contract.md`](../../docs/03-api-contract.md). **Read the
relevant section before writing an endpoint.** Do not invent request or response shapes.

## Every handler follows this order

```
1. requestId   ← from middleware header
2. authorize   ← requireAuth / requireRole / requireOwnership
3. validate    ← Zod parse of body, query, and params
4. delegate    ← call exactly one service method
5. respond     ← shape the success case
6. catch       ← toResponse(err, requestId)
```

Authorize **before** validate. There is no reason to spend parsing effort on a request
from someone who is not allowed to make it.

## Validation

- **Every** external input is Zod-parsed before any other code reads it. Bodies, query
  strings, route params, Server Action arguments, webhook payloads, env vars.
- Body and param schemas use `.strict()` — unknown keys are an error.
- Query-string schemas **coerce and clamp**; they never throw. `?page=abc` becomes page 1,
  not a 400. A malformed URL should degrade, not error.
- Schemas live in `src/domain/schemas/`, never inline in a route file.

```ts
// query params: coerce, clamp, default — never throw
export const catalogQuerySchema = z.object({
  q: z.string().max(200).optional(),
  type: z.array(z.enum(URL_TYPES)).optional(),
  tags: z
    .string()
    .transform((s) => s.split(",").slice(0, 10))
    .optional(),
  sort: z
    .enum(["relevance", "downloads", "newest", "updated", "name"])
    .default("relevance"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
```

## Responses

| Case      | Status  | Body                                                 |
| --------- | ------- | ---------------------------------------------------- |
| Read      | 200     | `{ data: … }`                                        |
| List      | 200     | `{ data: [...], pagination: {...} }`                 |
| Create    | 201     | `{ data: … }`                                        |
| Delete    | 204     | _(empty)_                                            |
| Download  | 302     | `Location:` presigned URL, `Cache-Control: no-store` |
| Any error | 4xx/5xx | the error envelope below                             |

```jsonc
{
  "error": {
    "code": "MANIFEST_INVALID", // from the closed taxonomy in docs/03 §1.2
    "message": "Human-readable, safe to display",
    "details": [{ "path": "tools[0].name", "message": "Required" }],
  },
  "requestId": "01JQ8Z…",
}
```

**Never invent an error code.** The taxonomy in
[`docs/03 §1.2`](../../docs/03-api-contract.md#12-error-code-taxonomy) is closed. To add
one, update that doc in the same commit.

## Status codes that are commonly got wrong

- **400** — could not parse. Malformed JSON, wrong type.
- **422** — parsed fine, semantically invalid. A well-formed manifest with `version: "1.0"`.
- **403 vs 404** — for a resource that exists but is not yours, return **404**. A 403
  confirms existence and turns the endpoint into an enumeration oracle.
- **409** — a conflict with current state. Slug taken, version exists, duplicate checksum.
- **429** — always with `Retry-After` and the `X-RateLimit-*` headers.

## Errors

- Throw `AppError(code, status, message?, details?)` from services. Never construct a
  `NextResponse` outside `app/`.
- One `toResponse()` handler formats every error. No bespoke error formatting in routes.
- **A 500 body never contains a stack trace, SQL fragment, file path, or exception
  message.** Log the detail with the `requestId`; return the id.

## Server Actions

**A Server Action is a public HTTP endpoint.** It gets the same treatment as a Route
Handler: `requireAuth()` on the first line, Zod parse on the second. The fact that it is
called from a form component grants it nothing.

```ts
"use server";
export async function deleteComponent(slug: string) {
  const user = await requireOwnership(slug); // ← not optional
  const parsed = slugSchema.parse(slug); // ← not optional
  await componentService.softDelete(user, parsed);
  revalidatePath("/dashboard");
}
```

## Rate limiting

Endpoints listed in [`docs/03 §4`](../../docs/03-api-contract.md#4-rate-limits) are rate
limited. Apply the limit after auth (so it keys on `userId`) and before the service call.
