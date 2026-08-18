"use client";

import {
  clearFilters,
  hasActiveFilters,
  setParam,
  toggleMultiParam,
  toggleTag,
} from "@/lib/catalog-url";
import { SORT_OPTIONS } from "@/domain/schemas/catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCatalogParams } from "./use-catalog-params";

/**
 * Type, tag and sort controls.
 *
 * Every control writes to the URL and nothing else — there is no local filter
 * state to drift out of step with what is on screen (rules/60).
 *
 * Features: F4.3, F4.4
 */

const TYPE_LABELS: Record<string, string> = {
  skill: "Skills",
  plugin: "Plugins",
  agent: "Agents",
  "mcp-gateway": "MCP Gateways",
};

const SORT_LABELS: Record<string, string> = {
  relevance: "Best match",
  downloads: "Most downloaded",
  newest: "Newest",
  updated: "Recently updated",
  name: "Name (A–Z)",
};

interface FilterSidebarProps {
  types: Array<{ urlType: string; count: number }>;
  tags: Array<{ slug: string; label: string; count: number }>;
}

export function FilterSidebar({ types, tags }: FilterSidebarProps) {
  const { searchParams, apply, isPending } = useCatalogParams();

  const activeTypes = searchParams.getAll("type");
  const activeTags = (searchParams.get("tags") ?? "").split(",").filter(Boolean);
  const sort = searchParams.get("sort") ?? "relevance";

  return (
    <aside
      aria-label="Filters"
      data-pending={isPending ? "" : undefined}
      className="flex flex-col gap-6 data-pending:opacity-60"
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="catalog-sort" className="text-sm font-medium">
          Sort
        </label>
        <select
          id="catalog-sort"
          value={sort}
          onChange={(event) => apply(setParam(searchParams, "sort", event.target.value))}
          className="border-input rounded-md border px-3 py-2 text-sm"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {SORT_LABELS[option] ?? option}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Type</legend>
        {types.length === 0 ? (
          <p className="text-muted-foreground text-sm">No types to filter by.</p>
        ) : (
          types.map((type) => {
            const checked = activeTypes.includes(type.urlType);
            return (
              <label
                key={type.urlType}
                className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    apply(toggleMultiParam(searchParams, "type", type.urlType))
                  }
                  className="accent-primary size-4"
                />
                <span className="flex-1">{TYPE_LABELS[type.urlType] ?? type.urlType}</span>
                {/* The count comes from a facet query that ignores the type
                    filter, so a zero here means "nothing matches your OTHER
                    filters" — never "you have this box unticked". */}
                <span className="text-muted-foreground tabular-nums">{type.count}</span>
              </label>
            );
          })
        )}
      </fieldset>

      {tags.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Tags</legend>
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const active = activeTags.includes(tag.slug);
              return (
                <li key={tag.slug}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => apply(toggleTag(searchParams, tag.slug))}
                    className="focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <Badge
                      variant={active ? "default" : "outline"}
                      className="cursor-pointer"
                    >
                      {tag.label}
                      <span className="ml-1 tabular-nums opacity-70">{tag.count}</span>
                    </Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}

      {hasActiveFilters(searchParams) ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => apply(clearFilters(searchParams))}
        >
          Clear filters
        </Button>
      ) : null}
    </aside>
  );
}
