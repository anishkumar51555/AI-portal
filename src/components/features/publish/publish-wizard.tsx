"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBytes } from "@/lib/format";

/**
 * The publish wizard.
 *
 * Implements the state machine in docs/04 Flow 3. Two rules shape the whole
 * component:
 *
 *  - **Client checks are UX, never security.** Every one of them is re-checked
 *    server-side; they exist only to fail in 10 ms instead of after a 10 MB
 *    upload.
 *  - **Never lose the user's file.** Every error path returns to a state where
 *    the same file is still selected and the button says "Try again". Making
 *    someone re-pick a file to retry is the fastest way to lose them.
 *
 * Spec: docs/04-sequence-flows.md Flow 3 · docs/03 §3.6–3.7
 * Features: F3.22
 */

interface FieldError {
  path: string;
  message: string;
}

type State =
  | { step: "idle" }
  | { step: "presigning" }
  | { step: "uploading"; percent: number }
  | { step: "validating" }
  | { step: "succeeded"; slug: string; version: string; url: string }
  | { step: "invalid"; message: string; errors: FieldError[] }
  | { step: "failed"; message: string };

const MAX_BYTES = 10 * 1024 * 1024;

const BUSY: State["step"][] = ["presigning", "uploading", "validating"];

export function PublishWizard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState("");
  const [changelog, setChangelog] = useState("");
  const [state, setState] = useState<State>({ step: "idle" });

  const busy = BUSY.includes(state.step);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setState({ step: "idle" });

    if (!chosen) {
      setFile(null);
      return;
    }

    // Client precheck. Mirrors the server's rules so the common mistakes are
    // caught instantly — the server rejects them again regardless.
    if (!chosen.name.toLowerCase().endsWith(".zip")) {
      setFile(null);
      setState({ step: "failed", message: "That is not a .zip archive." });
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setFile(null);
      setState({
        step: "failed",
        message: `Archives are limited to ${formatBytes(MAX_BYTES)}. That one is ${formatBytes(chosen.size)}.`,
      });
      return;
    }

    setFile(chosen);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file || busy) return;

    try {
      setState({ step: "presigning" });
      const presign = await postJson<PresignData>("/api/uploads/presign", {
        fileName: sanitizeName(file.name),
        sizeBytes: file.size,
        contentType: "application/zip",
      });

      setState({ step: "uploading", percent: 0 });
      await uploadWithProgress(presign.uploadUrl, presign.fields, file, (percent) =>
        setState({ step: "uploading", percent }),
      );

      setState({ step: "validating" });
      const published = await postJson<PublishedData>("/api/components", {
        stagingKey: presign.stagingKey,
        tags: parseTags(tags),
        changelog: changelog.trim() === "" ? null : changelog.trim(),
      });

      setState({
        step: "succeeded",
        slug: published.slug,
        version: published.version,
        url: published.url,
      });
      router.refresh();
    } catch (err) {
      setState(toState(err));
    }
  }

  function reset() {
    setFile(null);
    setTags("");
    setChangelog("");
    setState({ step: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  if (state.step === "succeeded") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Published {state.slug}</CardTitle>
          <CardDescription>Version {state.version} is live in the catalog.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={() => router.push(state.url)}>View it</Button>
          <Button variant="outline" onClick={reset}>
            Publish another
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="archive" className="text-sm font-medium">
          Component archive
        </label>
        <input
          ref={inputRef}
          id="archive"
          name="archive"
          type="file"
          accept=".zip,application/zip"
          onChange={chooseFile}
          disabled={busy}
          aria-describedby="archive-hint"
          className="border-input file:bg-muted hover:border-ring rounded-md border px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:px-3 file:py-1.5 file:text-sm disabled:opacity-50"
        />
        <p id="archive-hint" className="text-muted-foreground text-sm">
          A .zip with <code className="bg-muted rounded px-1">component.json</code> at its
          root — zip the folder&rsquo;s contents, not the folder. Max{" "}
          {formatBytes(MAX_BYTES)}.
        </p>
        {file ? (
          <p className="text-sm">
            Selected: <span className="font-medium">{file.name}</span>{" "}
            <span className="text-muted-foreground">({formatBytes(file.size)})</span>
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="tags" className="text-sm font-medium">
          Tags <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          id="tags"
          name="tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          disabled={busy}
          placeholder="pdf, data-extraction"
          aria-describedby="tags-hint"
          className="border-input rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        />
        <p id="tags-hint" className="text-muted-foreground text-sm">
          Comma separated. Your manifest&rsquo;s keywords are added automatically.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="changelog" className="text-sm font-medium">
          Changelog <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <textarea
          id="changelog"
          name="changelog"
          value={changelog}
          onChange={(e) => setChangelog(e.target.value)}
          disabled={busy}
          rows={3}
          className="border-input rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        />
      </div>

      {/* Progress and status are announced, not just drawn (rules/60). */}
      <div aria-live="polite" className="flex flex-col gap-3">
        {state.step === "uploading" ? (
          <div className="flex flex-col gap-1">
            <div
              role="progressbar"
              aria-valuenow={state.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
              className="bg-muted h-2 w-full overflow-hidden rounded-full"
            >
              <div
                className="bg-primary h-full transition-[width] duration-150"
                style={{ width: `${state.percent}%` }}
              />
            </div>
            <p className="text-muted-foreground text-sm">Uploading… {state.percent}%</p>
          </div>
        ) : null}

        {state.step === "presigning" ? (
          <p className="text-muted-foreground text-sm">Preparing upload…</p>
        ) : null}

        {state.step === "validating" ? (
          <p className="text-muted-foreground text-sm">
            Validating your archive and manifest…
          </p>
        ) : null}

        {state.step === "failed" ? (
          <p className="text-destructive text-sm" role="alert">
            {state.message}
          </p>
        ) : null}

        {state.step === "invalid" ? <ManifestErrors state={state} /> : null}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!file || busy}>
          {busy ? <Spinner /> : null}
          {state.step === "invalid" || state.step === "failed" ? "Try again" : "Publish"}
        </Button>
        {file && !busy ? (
          <Button type="button" variant="ghost" onClick={reset}>
            Clear
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * The response that makes the demo: every manifest problem, addressed to the
 * exact field path, all at once.
 */
function ManifestErrors({ state }: { state: Extract<State, { step: "invalid" }> }) {
  return (
    <div
      role="alert"
      className="border-destructive/40 bg-destructive/5 rounded-md border p-4"
    >
      <p className="text-destructive text-sm font-medium">{state.message}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {state.errors.map((error, i) => (
          <li key={`${error.path}-${i}`} className="text-sm">
            <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
              {error.path}
            </code>
            <span className="text-muted-foreground ml-2">{error.message}</span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground mt-3 text-xs">
        Fix these in <code className="bg-muted rounded px-1">component.json</code>, re-zip,
        and publish again. Your file is still selected.
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="mr-2 inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
    />
  );
}

// ─────────────────────────── plumbing ───────────────────────────

interface ApiError {
  code: string;
  message: string;
  details?: FieldError[];
}

class RequestFailed extends Error {
  constructor(readonly error: ApiError) {
    super(error.message);
  }
}

interface PresignData {
  uploadUrl: string;
  fields: Record<string, string>;
  stagingKey: string;
  maxSizeBytes: number;
}

interface PublishedData {
  slug: string;
  version: string;
  url: string;
  checksumSha256: string;
}

/**
 * POST JSON to our own API and unwrap the `{ data }` envelope.
 *
 * The `as T` narrows a parsed-but-unknown body after the `res.ok` check. This
 * is our own endpoint answering our own contract — the schema that guarantees
 * the shape runs server-side, and a mismatch here is a bug in this repo rather
 * than untrusted input (rules/10).
 */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = (await res.json().catch(() => null)) as {
    data?: unknown;
    error?: ApiError;
  } | null;

  if (!res.ok || !payload?.data) {
    throw new RequestFailed(
      payload?.error ?? { code: "INTERNAL_ERROR", message: "Something went wrong." },
    );
  }
  return payload.data as T;
}

/**
 * Upload via XMLHttpRequest rather than fetch.
 *
 * `fetch` still cannot report upload progress in any shipping browser — there
 * is no readable stream for the request body — so a progress bar built on it
 * can only be a lie. XHR's `upload.onprogress` is the real thing.
 */
function uploadWithProgress(
  url: string,
  fields: Record<string, string>,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    // Every policy field must precede the file part — storage ignores anything
    // that comes after it (docs/03 §3.6).
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      reject(
        new RequestFailed({
          code: "UPLOAD_FAILED",
          message:
            xhr.status === 413
              ? "Storage rejected the file as too large."
              : `The upload failed (${xhr.status}). Your file is still selected — try again.`,
        }),
      );
    };
    xhr.onerror = () =>
      reject(
        new RequestFailed({
          code: "NETWORK",
          message: "The upload failed. Check your connection and try again.",
        }),
      );

    xhr.send(form);
  });
}

function toState(err: unknown): State {
  if (!(err instanceof RequestFailed)) {
    return { step: "failed", message: "Something went wrong. Please try again." };
  }

  const { code, message, details } = err.error;

  // Field-level problems get the dedicated renderer; everything else is a
  // single sentence.
  if (details && details.length > 0) {
    return { step: "invalid", message, errors: details };
  }
  if (code === "UNAUTHENTICATED") {
    return { step: "failed", message: "Your session expired. Sign in and try again." };
  }
  return { step: "failed", message };
}

/** The server derives the storage key; this only shapes the eventual filename. */
function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "-").slice(-128);
  return cleaned.toLowerCase().endsWith(".zip") ? cleaned : `${cleaned}.zip`;
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0)
    .slice(0, 10);
}
