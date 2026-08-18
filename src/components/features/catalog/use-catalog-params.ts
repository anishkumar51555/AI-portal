"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toQueryString } from "@/lib/catalog-url";

/**
 * Write catalog state back to the URL.
 *
 * `router.replace`, not `push`: typing four characters into the search box
 * should not put four entries in the history, so Back returns to wherever the
 * visitor came from rather than walking them backwards through their own
 * keystrokes.
 *
 * `scroll: false` because the results are further down the page — jumping to
 * the top on every filter click loses the reader's place.
 *
 * The returned `isPending` comes from `useTransition`, so the UI can show that
 * new results are loading while the CURRENT ones stay on screen. Without it,
 * every keystroke blanks the grid.
 */
export function useCatalogParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const apply = useCallback(
    (next: URLSearchParams) => {
      startTransition(() => {
        router.replace(`${pathname}${toQueryString(next)}`, { scroll: false });
      });
    },
    [router, pathname],
  );

  return { searchParams, apply, isPending };
}
