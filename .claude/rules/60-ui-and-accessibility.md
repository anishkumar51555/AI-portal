# Rule 60 — UI & accessibility

## Server vs Client Components

**Server Component is the default.** Add `"use client"` only when the component needs
state, an effect, a browser API, or an event handler.

Push `"use client"` as far down the tree as possible — a client parent drags every child
into the browser bundle.

```tsx
// ✓ page stays server-rendered; only the interactive leaf is a client component
export default async function CatalogPage({ searchParams }) {
  const params = catalogQuerySchema.parse(await searchParams);
  const page = await componentService.search(params);
  return (
    <>
      <SearchBox defaultValue={params.q} /> {/* "use client" lives here */}
      <ComponentGrid items={page.data} /> {/* server-rendered */}
    </>
  );
}
```

Rendering strategy per route:
[`docs/01 §6`](../../docs/01-architecture.md#6-rendering-strategy). Follow it.

## URL is the state

Search, filters, sort, and page live in `searchParams`, not in React state. Client
controls call `router.replace()` with updated params.

This gives shareable URLs, a working back button, server-rendered results, and no state
library — for free. Do not add a client store for catalog state.

## Component structure

| Location                             | Contents                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `src/components/ui/`                 | shadcn primitives. **Generated — do not hand-edit.** Regenerate instead.    |
| `src/components/features/‹feature›/` | Composed feature UI                                                         |
| `src/app/…/page.tsx`                 | Route composition only. Fetch and arrange; do not define components inline. |

Components take typed props from `@/domain`. A UI component **never** imports from
`server/`.

## Every list view needs four states

Not three. Missing states are the most common review finding in a student project.

1. **Loading** — `loading.tsx` with skeletons matching the real layout's dimensions
2. **Empty** — explains why it is empty and offers an action ("Clear filters")
3. **Error** — `error.tsx` with a retry button, never a raw error message
4. **Populated**

A bare spinner on a blank page is not a loading state.

## Accessibility — non-negotiable

| Requirement   | Rule                                                               |
| ------------- | ------------------------------------------------------------------ |
| Semantic HTML | `<nav> <main> <article> <button>`. A clickable `<div>` is a bug.   |
| Keyboard      | Every interactive element reachable and operable by keyboard       |
| Focus         | Never `outline: none` without a visible replacement                |
| Labels        | Every input has a `<label>`; errors linked with `aria-describedby` |
| Images        | `alt` on every image, including avatars                            |
| Contrast      | 4.5:1 body text, 3:1 large text                                    |
| Live regions  | Upload progress and toasts in `aria-live`                          |
| Motion        | Respect `prefers-reduced-motion`                                   |

`eslint-plugin-jsx-a11y` is enabled and blocking. Do not disable a rule to ship a
component.

## Forms

- Client-side validation is UX. **Server-side validation is the real thing.** Both, always.
- Map API `details[].path` back to the corresponding field so errors appear inline.
- Disable submit while pending; show a spinner in the button, not over the page.
- Never lose user input on an error. The upload wizard keeps the selected file.

## Styling

- Tailwind utilities. No CSS modules, no styled-components, no inline `style` objects
  except for genuinely dynamic values.
- Design tokens come from the shadcn theme variables. No hard-coded hex colours.
- Mobile-first: base styles are mobile, `sm:`/`md:`/`lg:` scale up.
- **No horizontal scroll at 375 px on any page.** Check it.

## Performance

- `next/image` for every image, with explicit `width`/`height` to prevent layout shift.
- `next/font` for fonts. No `<link>` to Google Fonts.
- Wrap slow server sections in `<Suspense>` so the shell streams immediately.
- No `useEffect` fetch waterfalls — if you are fetching in an effect, it probably belongs
  in a Server Component.
