# My Skill

> **This file becomes your component's page in the catalog.** Rewrite it for
> someone deciding whether to use your skill — not for yourself.

A starter Skill for the AI Component Ecosystem Portal. Out of the box it is a
working extractive summariser: it scores sentences by keyword density, keeps the
best few, and returns them in their original order.

## Quick start

```bash
npm install
npm test        # 7 passing tests
npm run build
```

## Usage

```ts
import { execute } from "./src/index.js";

const { summary, wordCount } = execute({
  text: longArticle,
  maxSentences: 3,
});
```

## What a Skill is

A packaged capability an agent loads to perform a task. It has two halves:

| File           | Purpose                                                             |
| -------------- | ------------------------------------------------------------------- |
| `SKILL.md`     | The instructions the model reads — when to use this, and how to act |
| `src/index.ts` | The code, if the skill needs any                                    |

Many skills are instructions only. This one ships both so you can see the shape.

## The manifest

`component.json` declares what this is. The fields that matter most:

- **`skill.triggers`** — phrases a user would say to invoke this. These are how
  your skill gets discovered, so write them the way people actually talk, not
  the way you named the function.
- **`skill.instructions`** — path to the instruction file, relative to the
  archive root.
- **`skill.outputs`** — what callers get back, so they can use it without
  reading your source.

## Making it yours

See [`docs/GETTING-STARTED.md`](docs/GETTING-STARTED.md). Short version: edit
`component.json`, write `SKILL.md`, implement `src/`, run `npm run pack`, upload
the zip.

## Licence

MIT — change it in both `component.json` and `package.json` if you prefer
something else.
