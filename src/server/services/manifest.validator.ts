import { AppError, toFieldErrors, type FieldError } from "@/domain/errors";
import { manifestSchema, type ComponentManifest } from "@/domain/schemas/manifest";
import {
  checkAgainstArchive,
  checkAgainstExisting,
  findSecrets,
  isStrictlyNewer,
} from "@/domain/schemas/manifest-checks";

/**
 * The single entry point for validating a `component.json`.
 *
 * This is the differentiating feature of the whole portal, so the priority here
 * is not "reject bad input" — any schema does that — but **error quality**. A
 * publisher whose manifest is wrong should be told exactly which field, at
 * which array index, and what to do about it, in one response rather than
 * discovering one problem per upload.
 *
 * Everything below composes pieces that already exist. Keeping the ORDER in one
 * place is the point: run the cheap structural check before the expensive
 * cross-checks, and never report a downstream error that is really an upstream
 * one in disguise.
 *
 * Spec: docs/06-component-manifest-spec.md §5.1, §7 · docs/03 §1.2
 * Features: F3.9, F3.18, F3.19
 */

/** What the archive inspector already learned, fed in for cross-validation. */
export interface ArchiveFacts {
  /** Every file path in the archive, POSIX-style, relative to the root. */
  paths: readonly string[];
}

/** The component this manifest is a new version OF, when one exists. */
export interface ExistingComponent {
  name: string;
  type: ComponentManifest["type"];
  latestVersion: string | null;
}

export interface ValidateOptions {
  archive?: ArchiveFacts;
  existing?: ExistingComponent | null;
}

/**
 * Parse raw manifest text into a validated manifest, or throw with per-field details.
 *
 * Throws `MANIFEST_INVALID` (422) for anything wrong with the content. Note the
 * status: the request was well-formed, so this is not a 400 — the JSON parsed,
 * it just does not mean anything valid (rules/30).
 */
export function validateManifest(
  raw: string,
  options: ValidateOptions = {},
): ComponentManifest {
  const json = parseJson(raw);
  const manifest = parseSchema(json);

  // Collected rather than thrown one at a time: a publisher fixing three
  // problems should see three, not play whack-a-mole across three uploads.
  const problems: FieldError[] = [
    ...findSecrets(manifest),
    ...(options.archive ? checkAgainstArchive(manifest, options.archive.paths) : []),
    ...(options.existing ? checkAgainstExisting(manifest, options.existing) : []),
  ];

  if (problems.length > 0) {
    throw new AppError("MANIFEST_INVALID", messageFor(problems), { details: problems });
  }

  // Version ordering is checked LAST and thrown separately, because it is not a
  // manifest defect — the file is perfectly valid, it just conflicts with what
  // is already published. That is a 409, not a 422 (docs/03 §1.2), and
  // collapsing the two would tell the publisher to "fix their manifest" when
  // the only thing wrong is the number they chose.
  if (options.existing?.latestVersion) {
    assertVersionIncreases(manifest.version, options.existing.latestVersion);
  }

  return manifest;
}

function assertVersionIncreases(candidate: string, latest: string): void {
  if (candidate === latest) {
    throw new AppError(
      "VERSION_EXISTS",
      `Version ${candidate} is already published. Published versions are immutable — bump the version.`,
    );
  }

  if (!isStrictlyNewer(candidate, latest)) {
    throw new AppError(
      "VERSION_NOT_INCREASING",
      `Version ${candidate} is not newer than the published ${latest}. ` +
        `Versions compare numerically, so 1.10.0 IS newer than 1.9.0.`,
    );
  }
}

/**
 * Malformed JSON — a trailing comma, a smart quote from a word processor.
 *
 * `JSON.parse`'s own message ("Unexpected token } in JSON at position 412") is
 * genuinely useful here, unusually for a library error: it points at the
 * character. It is safe to surface because the input is the user's own file,
 * so it leaks nothing they do not already have.
 */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new AppError(
      "MANIFEST_INVALID",
      "component.json is not valid JSON. Check for a trailing comma or an unquoted key.",
      {
        details: [
          { path: "(root)", message: err instanceof Error ? err.message : "Parse failed" },
        ],
        cause: err,
      },
    );
  }
}

function parseSchema(json: unknown): ComponentManifest {
  const result = manifestSchema.safeParse(json);
  if (result.success) return result.data;

  // A discriminated union cannot pick a branch without a valid `type`, so every
  // other field error is suppressed until it is fixed. Saying so directly beats
  // the raw "Invalid discriminator value" a publisher would otherwise get.
  const badDiscriminator = result.error.issues.some(
    (issue) => issue.path.length === 1 && issue.path[0] === "type",
  );
  if (badDiscriminator) {
    throw new AppError(
      "MANIFEST_INVALID",
      'The "type" field must be one of: skill, plugin, agent, mcp-gateway. ' +
        "Nothing else can be checked until it is valid.",
      { details: [{ path: "type", message: "Unknown or missing component type." }] },
    );
  }

  // Same phrasing as the cross-check path below. Without this, a schema failure
  // fell back to the generic default message while a secret-scan failure said
  // "component.json has 3 problems." — two different voices for the same class
  // of error, from the publisher's point of view.
  const details = toFieldErrors(result.error);
  throw new AppError("MANIFEST_INVALID", messageFor(details), { details });
}

function messageFor(problems: FieldError[]): string {
  return problems.length === 1
    ? "component.json has 1 problem."
    : `component.json has ${problems.length} problems.`;
}

/**
 * Validate without throwing.
 *
 * For callers that want to report every problem at once — the publish wizard's
 * client-side precheck — rather than reacting to the first failure.
 */
export function tryValidateManifest(
  raw: string,
  options: ValidateOptions = {},
): { ok: true; manifest: ComponentManifest } | { ok: false; errors: FieldError[] } {
  try {
    return { ok: true, manifest: validateManifest(raw, options) };
  } catch (err) {
    if (AppError.is(err)) {
      return {
        ok: false,
        errors: err.details ?? [{ path: "(root)", message: err.message }],
      };
    }
    throw err;
  }
}
