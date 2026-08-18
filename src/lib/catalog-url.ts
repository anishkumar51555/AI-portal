/**
 * Catalog URL state.
 *
 * The URL *is* the state (rules/60): search, filters, sort and page live in
 * `searchParams`, never in React state. That buys shareable links, a working
 * back button, server-rendered results, and no client store — for free.
 *
 * These are pure string→string functions so they can be unit tested without a
 * router, a DOM, or a rendered component.
 */

/**
 * Changing any of these resets paging.
 *
 * `sort` is here — reordering makes the current page number meaningless — but
 * it is NOT a filter, so "Clear filters" leaves it alone.
 */
const PAGE_RESETTING = ["q", "type", "tags", "sort"] as const;

/** What "Clear filters" actually clears: things that HIDE rows. */
const CLEARABLE = ["q", "type", "tags"] as const;

function clone(params: URLSearchParams): URLSearchParams {
  return new URLSearchParams(params.toString());
}

/**
 * Any filter change resets to page 1.
 *
 * Without this, narrowing a search while on page 7 lands on an empty page and
 * looks like "no results" — the single most common catalog bug.
 */
function resetPage(next: URLSearchParams): URLSearchParams {
  next.delete("page");
  return next;
}

/** Set a single-valued param, or remove it when the value is empty. */
export function setParam(
  params: URLSearchParams,
  key: string,
  value: string | null,
): URLSearchParams {
  const next = clone(params);

  if (value === null || value === "") next.delete(key);
  else next.set(key, value);

  return (PAGE_RESETTING as readonly string[]).includes(key) ? resetPage(next) : next;
}

/** Add or remove one value of a repeatable param (`?type=skill&type=agent`). */
export function toggleMultiParam(
  params: URLSearchParams,
  key: string,
  value: string,
): URLSearchParams {
  const next = clone(params);
  const current = next.getAll(key);

  next.delete(key);
  for (const existing of current) {
    if (existing !== value) next.append(key, existing);
  }
  if (!current.includes(value)) next.append(key, value);

  return resetPage(next);
}

/** Add or remove one entry of the comma-separated `tags` param. */
export function toggleTag(params: URLSearchParams, slug: string): URLSearchParams {
  const next = clone(params);
  const current = (next.get("tags") ?? "").split(",").filter(Boolean);

  const updated = current.includes(slug)
    ? current.filter((t) => t !== slug)
    : [...current, slug];

  if (updated.length === 0) next.delete("tags");
  else next.set("tags", updated.join(","));

  return resetPage(next);
}

/**
 * Drop every filter, keeping display preferences.
 *
 * `sort` and `pageSize` deliberately survive: someone who chose "newest" and
 * 100 per page is expressing how they want to READ the catalog, not which rows
 * to hide. Silently resetting those is the kind of small betrayal that makes a
 * UI feel unpredictable.
 */
export function clearFilters(params: URLSearchParams): URLSearchParams {
  const next = clone(params);
  for (const key of CLEARABLE) next.delete(key);
  return resetPage(next);
}

/** Is any row-hiding filter active? Drives the "Clear filters" action. */
export function hasActiveFilters(params: URLSearchParams): boolean {
  return CLEARABLE.some((key) => params.getAll(key).length > 0);
}

/** `?a=1&b=2`, or "" when empty — safe to append to a pathname. */
export function toQueryString(params: URLSearchParams): string {
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}
