# Getting started

You downloaded this from the AI Component Ecosystem Portal. It is a working
component — it runs and its tests pass right now, before you change anything.

## Five steps to make it yours

### 1. Rename it

Open `component.json` and replace every `TODO`:

- `name` — lowercase, hyphens, no spaces. This becomes your URL: `/components/your-name`
- `displayName` — what people see in the catalog
- `description` — 10 to 300 characters, saying what it actually does
- `author.name` — you
- `keywords` — 1 to 10 tags; these are how people find it

### 2. Build it

Implement `src/` — the entrypoint is the file named in `component.json`.

### 3. Describe it

Rewrite `README.md`. **It becomes your component's page in the catalog**, so
write it for someone deciding whether to use your component, not for yourself.

### 4. Verify it

```bash
npm install
npm test
```

### 5. Publish it

```bash
npm run pack
```

That writes `dist/<name>-<version>.zip`. Upload it at `/publish`.

---

## The one mistake everybody makes

**Zip the folder CONTENTS, not the folder.**

`component.json` must be at the **root** of the archive:

```
✅ correct                    ❌ wrong
   component.json                my-skill/component.json
   README.md                     my-skill/README.md
   src/index.ts                  my-skill/src/index.ts
```

If you select the folder in Explorer or Finder and choose "Compress", you get
the wrong one, and publishing fails with `MANIFEST_MISSING`.

`npm run pack` always produces the correct layout. Use it.

## Editor autocomplete for free

`component.json` starts with a `$schema` line pointing at the portal's published
schema. VS Code and most editors will use it to autocomplete field names and
underline mistakes **as you type** — long before you upload anything.

## What gets rejected

The portal validates every upload before it enters the catalog. Common causes:

| Error                    | Means                                                                |
| ------------------------ | -------------------------------------------------------------------- |
| `MANIFEST_MISSING`       | No `component.json` at the archive root — see the zip mistake above  |
| `MANIFEST_INVALID`       | A field is wrong; the response names the exact path and what to fix  |
| `ARCHIVE_UNSAFE`         | The zip contains `..` paths, symlinks, or expands too far            |
| `ARCHIVE_TOO_LARGE`      | Over 10 MB compressed, or 50 MB expanded                             |
| `SLUG_TAKEN`             | That `name` is already published — choose another                    |
| `VERSION_NOT_INCREASING` | New version must sort above the current one (`1.10.0` beats `1.9.0`) |

Unknown fields are rejected too. That is deliberate: a typo like `decsription`
should be a loud error now, not a silently missing description later.
