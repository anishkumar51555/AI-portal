# Appendix — Learning Path (from MERN)

What is genuinely new, what transfers, and what to read — in the order you will need it.
Roughly 12–15 hours of learning spread across the build, not front-loaded.

## What already transfers

| You know                                | Still true here                  |
| --------------------------------------- | -------------------------------- |
| React components, props, JSX            | Unchanged                        |
| `useState`, `useEffect`                 | Unchanged — in Client Components |
| npm, `package.json`, async/await        | Unchanged                        |
| REST concepts, HTTP verbs, status codes | Unchanged                        |
| Git                                     | Unchanged                        |

Roughly 60% of what you know carries over untouched. The new material is concentrated in
five areas.

---

## 1. TypeScript — before day 1 (≈3 h)

The only genuinely mandatory prerequisite. Everything else you can learn as you go.

**Learn:** basic types · interfaces vs types · unions and literal types · generics
(enough to read them) · `unknown` vs `any` · optional chaining and nullish coalescing ·
type inference · utility types (`Partial`, `Pick`, `Omit`, `Record`).

**Skip for now:** conditional types, mapped types, template literal types, declaration
merging. You will not need them, and they are where tutorials lose people.

**The mental shift:** TypeScript is not "JavaScript with annotations". It is a way of
making illegal states unrepresentable. `type Status = "PUBLISHED" | "SUSPENDED"` means a
typo is a compile error, not a silent bug.

**Do this:** rewrite one small MERN Express route in TypeScript. Two hours, and it teaches
more than six hours of video.

- [TypeScript Handbook — Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html)
- [Total TypeScript — Beginner's Tutorial](https://www.totaltypescript.com/tutorials/beginners-typescript) (free, exercise-driven)

---

## 2. Next.js App Router & Server Components — before Phase 1 (≈4 h)

The biggest conceptual jump, and the one most likely to confuse you.

**The core idea:** in the App Router, components are **server-rendered by default**. They
run on the server, can be `async`, and can query the database directly. They never ship
JavaScript to the browser. `"use client"` opts a component (and everything it imports)
into the browser.

Coming from MERN, this inverts your instinct. You are used to: React fetches from Express.
Here: the component _is_ the fetch.

```tsx
// Server Component — the default. No useEffect, no loading state, no API call.
export default async function CatalogPage({ searchParams }) {
  const components = await componentService.search(await searchParams);
  return <ComponentGrid items={components} />;
}
```

**Learn:** the `app/` file conventions (`page`, `layout`, `loading`, `error`,
`not-found`) · Server vs Client Components · `searchParams` and `params` (both are
Promises in Next 15+) · Route Handlers · Server Actions · when to `"use client"`.

**The rule that prevents most mistakes:** a component becomes a Client Component only when
it needs state, an effect, a browser API, or an event handler. Push `"use client"` as far
down the tree as possible — a client parent drags every child into the bundle.

**Common traps:**

- Importing a server-only module into a Client Component → build error. Good; it is
  protecting you.
- `useState` in a Server Component → error. Add `"use client"`.
- **Server Actions are public HTTP endpoints.** They need the same auth and validation as
  a Route Handler. Easy to forget; costly.
- Awaiting `params`/`searchParams` — they are Promises now. Most tutorials predate this.

- [Next.js — Server Components](https://nextjs.org/docs/app/building-your-application/rendering/server-components)
- Build one tiny app first: a page listing rows from a hard-coded array, with a client
  search box that writes to the URL. That single exercise covers 80% of the pattern.

---

## 3. SQL & Prisma — before Phase 2 (≈3 h)

**SQL first, Prisma second.** Learn what a join and an index are before you let an ORM
hide them, or you will not be able to debug a slow query.

**Learn:** tables, columns, primary and foreign keys · one-to-many and many-to-many (and
why a join table exists) · `SELECT / WHERE / JOIN / GROUP BY / ORDER BY / LIMIT` ·
what an index does and why `WHERE` on an unindexed column is slow · transactions and why
they matter.

**Then Prisma:** `schema.prisma` syntax · `migrate dev` vs `migrate deploy` · `findMany`
with `where`/`include`/`select` · `$transaction` · `$queryRaw` for the search query.

**Mental model for a MongoDB user:** Mongo lets you embed and denormalize freely and
enforces nothing. Postgres asks you to declare relationships and then _enforces_ them. The
constraint is the feature — a foreign key means an orphaned row is impossible, not merely
unlikely.

- [Prisma — Getting Started](https://www.prisma.io/docs/getting-started)
- [SQLBolt](https://sqlbolt.com/) — interactive, ~90 minutes, genuinely the fastest way in

---

## 4. Zod — before Phase 3 (≈2 h)

Central to this project. You will write more Zod than almost anything else.

**Learn:** primitives and chaining · `object().strict()` · `array`, `record`, `enum`,
`literal` · `discriminatedUnion` ← **the critical one** · `refine` and `superRefine` for
cross-field rules · `safeParse` vs `parse` · `z.infer<typeof schema>` · reading `ZodError`
issues and their `path` arrays.

**The insight:** Zod is not a validation library bolted onto types. The schema _is_ the
type. One definition gives you runtime validation, a TypeScript type, and a JSON Schema.
That is why the manifest spec works the way it does.

> ⚠️ **You are on Zod 4.** Most search results are for v3. Notable changes: `z.url()`
> instead of `z.string().url()`, `z.email()` instead of `z.string().email()`,
> `z.record(keySchema, valueSchema)` now requires both arguments, and the error
> customization API differs. **Use [`06 §5`](../06-component-manifest-spec.md#5-zod-implementation)
> as your reference, not a blog post.**

- [Zod docs](https://zod.dev/)

---

## 5. Docker — before Phase 0 (≈2 h) and Phase 5 (≈1 h)

**Phase 0 needs only:** what an image vs a container is · `docker compose up -d` /
`down` / `ps` / `logs` · what a volume is and why your data survives a restart · what a
port mapping is.

**Phase 5 needs:** writing a Dockerfile · multi-stage builds · layer caching (why copy
`package.json` before source) · `.dockerignore` · why `USER nextjs` matters · `HEALTHCHECK`.

**Mental model:** an image is a class, a container is an instance. Compose is a script
that starts several instances and wires them onto one network.

- [Docker — Get Started](https://docs.docker.com/get-started/)

---

## Schedule

| When          | Topic                    | Hours     |
| ------------- | ------------------------ | --------- |
| Before day 1  | TypeScript essentials    | 3         |
| Before day 1  | Docker basics            | 2         |
| Before day 3  | Next.js App Router + RSC | 4         |
| Before day 5  | SQL + Prisma             | 3         |
| Before day 8  | Zod (v4 specifically)    | 2         |
| Before day 15 | Dockerfile + CI concepts | 1         |
|               | **Total**                | **~15 h** |

Spread these across evenings during the phase before you need them. Do not try to learn
everything in week one — you will retain none of it, and Phase 3 is where the retention
matters.

---

## How to learn while building

1. **Type the code. Never paste it.** Typing forces you to read every token. Pasting is
   how you end up unable to explain your own repo.
2. **Break it on purpose.** Delete a `"use client"`. Remove an `await`. Drop a Zod field.
   Read the error. Errors you have deliberately caused are the fastest teacher available.
3. **Explain it out loud at the end of each phase.** If you cannot narrate the auth flow
   without looking, you have not learned it.
4. **Keep a `NOTES.md`.** Every non-obvious thing you hit. By day 17 it is your revision
   sheet and half your interview prep.
5. **When the agent writes something you do not understand, ask it to explain before you
   commit.** This is the single highest-leverage habit on this list, and the difference
   between a project you built and a project you hosted.

## Common traps for this exact stack

| Trap                                   | Symptom                                                | Fix                                      |
| -------------------------------------- | ------------------------------------------------------ | ---------------------------------------- |
| `useState` in a Server Component       | Build error about hooks                                | Add `"use client"`                       |
| `"use client"` on a page root          | Whole tree ships to the browser; no server data access | Move it down to the interactive leaf     |
| Not awaiting `params` / `searchParams` | Type error or `undefined`                              | They are Promises in Next 15+            |
| Prisma client instantiated per request | Connection pool exhausted                              | `globalThis` singleton in `server/db.ts` |
| MinIO without `forcePathStyle`         | 403 / DNS errors on every S3 call                      | `S3_FORCE_PATH_STYLE=true`               |
| Server Action without an auth check    | Anyone can call it via HTTP                            | `requireAuth()` first line, always       |
| Zod v3 syntax on v4                    | `z.string().url is not a function`                     | Use v4 syntax — see doc 06 §5            |
| Case-only filename mismatch            | Works on Windows, fails in CI                          | `forceConsistentCasingInFileNames: true` |
