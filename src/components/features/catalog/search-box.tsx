"use client";

import { useEffect, useRef, useState } from "react";
import { setParam } from "@/lib/catalog-url";
import { useCatalogParams } from "./use-catalog-params";

/**
 * The catalog search box.
 *
 * Debounced by 300 ms so a five-letter word is one request, not five. The input
 * itself is controlled by local state while the URL is the source of truth —
 * the alternative, driving the input straight from `searchParams`, makes typing
 * feel laggy because every character round-trips to the server before it
 * appears.
 *
 * Features: F4.2
 */
export function SearchBox() {
  const { searchParams, apply, isPending } = useCatalogParams();
  const urlQuery = searchParams.get("q") ?? "";

  const [value, setValue] = useState(urlQuery);
  // Distinguishes "the user typed" from "the URL changed underneath us".
  const typing = useRef(false);

  // Keep in step when the URL changes for a reason other than typing — the back
  // button, or the empty state's "Clear filters" button.
  useEffect(() => {
    if (!typing.current) setValue(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    if (!typing.current) return;
    if (value === urlQuery) return;

    const timer = setTimeout(() => {
      typing.current = false;
      apply(setParam(searchParams, "q", value.trim()));
    }, 300);

    return () => clearTimeout(timer);
  }, [value, urlQuery, searchParams, apply]);

  return (
    <div className="relative flex-1">
      <label htmlFor="catalog-search" className="sr-only">
        Search components
      </label>
      <input
        id="catalog-search"
        type="search"
        value={value}
        onChange={(event) => {
          typing.current = true;
          setValue(event.target.value);
        }}
        placeholder="Search components…"
        aria-describedby="catalog-search-hint"
        className="border-input focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
      />
      <p id="catalog-search-hint" className="sr-only">
        Results update as you type. Supports quoted phrases and minus to exclude.
      </p>
      {isPending ? (
        <span
          aria-hidden="true"
          className="border-muted-foreground absolute top-1/2 right-3 size-3 -translate-y-1/2 animate-spin rounded-full border-2 border-t-transparent motion-reduce:animate-none"
        />
      ) : null}
    </div>
  );
}
