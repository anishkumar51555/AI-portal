import { z } from "zod";
import {
  URL_TYPES,
  slugName,
  toDbType,
  type DbComponentType,
} from "@/domain/schemas/manifest";

/**
 * Catalog search query.
 *
 * Every field COERCES AND CLAMPS; nothing here throws. A malformed URL should
 * degrade to sensible results, not a 400 — `?page=abc` is far more likely to be
 * a stale bookmark or a crawler than an attack, and an error page teaches the
 * visitor nothing (rules/30).
 *
 * Spec: docs/03-api-contract.md §3.4
 */

export const SORT_OPTIONS = [
  "relevance",
  "downloads",
  "newest",
  "updated",
  "name",
] as const;
export type CatalogSort = (typeof SORT_OPTIONS)[number];

/**
 * CLAMP an integer into range; fall back only when it is not a number at all.
 *
 * The distinction matters and is easy to get wrong: `.max(100).catch(20)` does
 * not clamp — an over-max value fails the check, so `?pageSize=99999` silently
 * becomes 20 rather than 100. Someone asking for far too much should get the
 * most they are allowed, not the least (rules/30: "coerce and clamp").
 */
const clampedInt = (min: number, max: number, fallback: number) =>
  z.coerce
    .number()
    .int()
    .catch(fallback)
    .transform((value) => Math.min(max, Math.max(min, value)));

/** Tolerate anything; fall back rather than reject. */
const lenientEnum = <T extends readonly [string, ...string[]]>(
  values: T,
  fallback: T[number],
) =>
  z
    .string()
    .transform((value) => (values.includes(value) ? value : fallback))
    .pipe(z.enum(values))
    .catch(fallback);

export const catalogQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(200)
    .transform((value) => (value === "" ? undefined : value))
    .optional()
    .catch(undefined),

  /**
   * Repeatable: `?type=skill&type=agent`. Accepts a single value or an array,
   * because that is what `searchParams` hands over depending on the count.
   */
  type: z
    .union([z.string(), z.array(z.string())])
    .transform((value) => {
      const list = Array.isArray(value) ? value : [value];
      return list.filter((t): t is (typeof URL_TYPES)[number] =>
        (URL_TYPES as readonly string[]).includes(t),
      );
    })
    .optional()
    .catch(undefined),

  /** CSV of tag slugs, AND semantics, capped so the query stays bounded. */
  tags: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => /^[a-z0-9-]{1,30}$/.test(t))
        .slice(0, 10),
    )
    .optional()
    .catch(undefined),

  sort: lenientEnum(SORT_OPTIONS, "relevance"),

  page: clampedInt(1, 10_000, 1),
  pageSize: clampedInt(1, 100, 20),
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

/** The shape the repository wants: database enums, resolved sort, offset. */
export interface CatalogCriteria {
  q?: string;
  types: DbComponentType[];
  tags: string[];
  sort: CatalogSort;
  page: number;
  pageSize: number;
  skip: number;
  /** ADMINs also see SUSPENDED components. */
  includeSuspended: boolean;
}

export function toCriteria(query: CatalogQuery, includeSuspended = false): CatalogCriteria {
  // "relevance" is meaningless without a query — there is nothing to rank
  // against — so it degrades to the next most useful ordering (docs/03 §3.4).
  const sort = query.sort === "relevance" && !query.q ? "downloads" : query.sort;

  return {
    q: query.q,
    types: (query.type ?? []).map(toDbType),
    tags: query.tags ?? [],
    sort,
    page: query.page,
    pageSize: query.pageSize,
    skip: (query.page - 1) * query.pageSize,
    includeSuspended,
  };
}

// ─────────────────────── response shapes ───────────────────────

/**
 * One catalog result, as the API returns it.
 *
 * Lives in `domain/` rather than beside the service because UI components must
 * be able to name it, and `components/` may not import from `server/` — not
 * even a type (docs/01 §4).
 */
export interface CatalogItem {
  slug: string;
  displayName: string;
  type: string;
  urlType: string;
  summary: string;
  latestVersion: string | null;
  downloadCount: number;
  tags: string[];
  owner: { githubLogin: string | null; image: string | null };
  updatedAt: string;
}

export interface CatalogPage {
  data: CatalogItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  facets: {
    types: Array<{ type: string; urlType: string; count: number }>;
    tags: Array<{ slug: string; label: string; count: number }>;
  };
}

/**
 * The `:slug` route param.
 *
 * `.strict()` and the same `slugName` rule the manifest enforces, so a slug that
 * could never have been published cannot even reach the database. Unlike the
 * query schema above this one THROWS — a malformed path segment is a broken
 * link, not a filter to degrade.
 */
export const slugParamSchema = z.object({ slug: slugName }).strict();
