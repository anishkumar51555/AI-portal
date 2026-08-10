# Appendix — Interview Talking Points

You are building this partly to get hired. This page is about converting the work into
answers. Read it once now so you build with these in mind, and again the night before an
interview.

## 1. The 30-second pitch

> "I built a registry and template hub for AI components — Skills, Plugins, Agents, and
> MCP Gateways. Developers download a boilerplate template, build their component against
> a published manifest specification, and publish it back. Every upload is validated
> server-side against a Zod schema and screened for archive-level attacks before it
> enters the catalog. It's Next.js and TypeScript over PostgreSQL and S3-compatible
> storage, containerized, with a CI/CD pipeline. The interesting part isn't the CRUD —
> it's the manifest spec, because that's what turns a file host into a platform."

Practise this until it is fluent. The last sentence is what earns the follow-up question,
and the follow-up question is where you win.

## 2. Lead with the demo, not the code

Rehearse this exact sequence. Three minutes.

1. **Download the MCP Gateway template.** "Every template is itself a valid publishable
   component — that's what closes the loop."
2. **Publish it unchanged.** → 201, live in the catalog.
3. **Break the manifest** — `version: "1.0"`, delete `runtime.language`. Re-zip. Publish.
   → **422 with two precise field errors.** _Pause here. This is the moment._
4. **Upload `zip-slip.zip`.** → `ARCHIVE_UNSAFE`. "It accepts archives from strangers and
   redistributes them, so it has to assume they're hostile."
5. **Search the catalog, filter, download.**

Step 3 is what separates this from a CRUD app. Do not rush past it.

## 3. Answers to the questions you will actually get

**"Why not MERN? You said that's your background."**

> "The data is relational — components, versions, tags, owners — and versions have to be
> immutable so a checksum means something. In Postgres that's a unique constraint the
> engine enforces; in Mongo it's application logic I could get wrong. And Next.js means
> one deployable with types shared across the API boundary instead of two services and a
> CORS config. I know MERN, but it was the wrong tool for this shape. That's in ADR-003."

**"Walk me through the upload flow."**

> Draw it. Presign → direct PUT to a staging prefix → publish call that validates and
> promotes. Then: "Vercel caps request bodies at 4.5 MB, so proxying a 10 MB archive
> through a function just fails. That constraint forced the design — and it turned out to
> be the better architecture anyway, because the app becomes a control plane and storage
> the data plane."

**"How do you handle partial failure?"**

> "I promote the object in storage _before_ committing the database transaction. If the
> process dies in between, I get an orphaned object — wasted bytes, invisible, harmless.
> The other ordering gives a catalog row pointing at a file that doesn't exist, which is a
> user-visible 404. When you can't have atomicity, you pick which side fails safe."

That answer alone puts you ahead of most candidates at any level.

**"What's your biggest security concern?"**

> "That the portal redistributes code from strangers. I mitigate the archive layer —
> zip-slip, decompression bombs, symlinks, entry floods, per-user staging isolation. But I
> don't execute or sandbox the code, so I can't detect a malicious _payload_. That's
> documented as an explicit limitation with mitigations: every component is attributable
> to a GitHub identity, admins can suspend in seconds, and everything's in an audit log.
> v2 would add static analysis."

Naming a limitation precisely is stronger than claiming safety. Interviewers are testing
whether you know where your own boundaries are.

**"How would you scale this?"**

> "First thing to break is validation — it's the only CPU-bound path. I'd move
> `archive.inspector` behind a queue and make publish async with a PENDING status. Then a
> read replica plus CDN caching for the catalog, since reads dwarf writes. Search only
> needs a real engine past about 100k components. I kept it a modular monolith on purpose
> — the boundaries are enforced by lint rules, so extraction is mechanical when it's
> actually needed."

Naming the _order_ of extraction is the answer. "Microservices" is not.

**"Why is `requireOwnership` returning 404 instead of 403?"**

> "A 403 confirms the resource exists, which makes the endpoint an enumeration oracle. 404
> for 'exists but isn't yours' leaks nothing."

Small, and it lands every time.

**"What would you do differently?"**

> Have a real answer. Candidates who say "nothing" look uncritical. Something like: "I'd
> build the archive inspector before the upload UI. I built the wizard first and then had
> to reshape its error handling around the real validator's output. Contract first, UI
> second."

**"What was the hardest part?"**

> Pick something technical and specific. The discriminated union and getting error paths
> to serialize as `tools[0].name` instead of `tools,0,name` is a good one — small, real,
> and it shows you cared about the error message quality.

## 4. Talking about AI-assisted development

Increasingly asked, and often mishandled. Be direct.

> "I used Claude Code, but I set it up properly first — the repo has rules files enforcing
> the architecture boundaries, and I gave it one task at a time against a written spec. It
> wrote a lot of the code; I wrote the specification and reviewed every diff. I don't
> commit code I can't explain."

Then be ready to prove it: know your own upload pipeline, your Prisma schema, and your
guard functions line by line. **Anything you cannot explain in an interview should not be
in the repo.** That is not a rule about AI; it is a rule about code ownership.

## 5. What to put on the résumé

> **AI Component Ecosystem Portal** — _Next.js 16, TypeScript, PostgreSQL, Prisma, Docker_
> Full-stack registry for AI components (Skills, Plugins, Agents, MCP Gateways) with a
> formal, versioned manifest specification enforced at publish time.
>
> - Designed a Zod-based discriminated-union schema validating four component types, with
>   field-level error reporting and a published JSON Schema for editor tooling.
> - Built a two-phase presigned upload pipeline (browser → S3-compatible storage) with
>   streaming archive inspection guarding against zip-slip, decompression bombs, and
>   symlink escapes.
> - Implemented GitHub OAuth with role-based access control, immutable versioned releases
>   with SHA-256 integrity, and Postgres full-text search over a GIN-indexed `tsvector`.
> - Containerized with a multi-stage non-root Dockerfile; CI/CD via GitHub Actions
>   (and Azure DevOps) with migration-drift detection and container vulnerability scanning.
> - 10 Architecture Decision Records documenting technology trade-offs.

Every bullet is a specific, verifiable technical claim. No "developed a web application
using modern technologies."

## 6. GitHub repository checklist

The repo _is_ the portfolio. A reviewer spends ~90 seconds on it.

- [ ] Live demo URL at the very top of the README
- [ ] A GIF or screenshot within the first screen — most reviewers never scroll
- [ ] The architecture diagram embedded in the README
- [ ] A quickstart a stranger can follow in 10 minutes
- [ ] Repo description and topics filled in
- [ ] `docs/` and `adr/` linked from the README
- [ ] Clean commit history — Conventional Commits, no "update" ×40
- [ ] Green CI badge
- [ ] MIT licence, `CONTRIBUTING.md`, `SECURITY.md`
- [ ] No `.env` in history — verify with `git log --all --full-history -- .env*`
- [ ] Pinned as a featured repository on your profile

## 7. Things not to say

| Don't                                     | Do                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| "It's a full-stack CRUD app"              | "It's a registry with an enforced component specification"                                                                     |
| "I used AI to build it" (as a disclaimer) | "I specified it, directed the implementation, and reviewed every change"                                                       |
| "It's secure"                             | "Here are the threats I mitigated and the one I explicitly didn't"                                                             |
| "I'd use microservices at scale"          | "The first thing to extract is validation, because it's the only CPU-bound path"                                               |
| "I didn't have time to test it"           | "I put 95% coverage on the validator and the archive inspector, ~0% on UI components, because that's where bugs are expensive" |
| "It's just a student project"             | Nothing. Never say this. Let the work speak.                                                                                   |

## 8. The one thing to internalize

Most student projects are judged on whether they work. This one is designed to be judged
on whether you **made decisions**. The ADRs, the documented non-goals, the named
limitation on code execution, the deliberate uneven test coverage, the fail-safe ordering
in the publish pipeline — these exist so that when an interviewer probes, there is
something underneath.

Build it so that every "why did you…?" has an answer. That is the whole strategy.
