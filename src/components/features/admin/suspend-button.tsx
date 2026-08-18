"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Suspend one component.
 *
 * A reason is required by the API, so it is prompted for here rather than sent
 * as a placeholder — an audit row reading "suspended" with no cause is useless
 * six months later.
 */
export function SuspendButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function suspend() {
    const reason = window.prompt(`Why is "${slug}" being suspended?`);
    if (reason === null || reason.trim().length < 3) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/components/${slug}/suspend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suspended: true, reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message: string };
        } | null;
        throw new Error(body?.error?.message ?? "Suspend failed.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suspend failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" size="sm" onClick={suspend} disabled={busy}>
        {busy ? "Suspending…" : "Suspend"}
      </Button>
      {error ? (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      ) : null}
    </div>
  );
}
