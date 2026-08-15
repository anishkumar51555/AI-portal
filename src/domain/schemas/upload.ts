import { z } from "zod";

/**
 * Upload presign request.
 *
 * Spec: docs/03-api-contract.md §3.6
 */

/** Storage's own name for a zip; browsers disagree on which they send. */
export const ZIP_CONTENT_TYPES = [
  "application/zip",
  "application/x-zip-compressed",
] as const;

/**
 * Note what is NOT here: an object key.
 *
 * The client never supplies one. A client-chosen key is a bucket-wide write
 * primitive — `../../templates/skill/1.0.0/skill-template-1.0.0.zip` would
 * overwrite an official template (docs/08 §4, threat 7). The server derives
 * every key from the caller's own id.
 */
export const presignBodySchema = z
  .object({
    /**
     * Used only for the `Content-Disposition` a downloader eventually sees, and
     * for the error message. Constrained anyway: it is user input, and a
     * permissive filename is how a traversal reaches a log line or a header.
     */
    fileName: z
      .string()
      .regex(
        /^[A-Za-z0-9._-]{1,128}\.zip$/,
        "File name may contain letters, numbers, dot, underscore and hyphen only, and must end in .zip",
      ),
    /**
     * The client's CLAIM about the size. Checked here to fail fast with a clear
     * message, but never trusted: the presigned POST carries a
     * `content-length-range` condition so storage itself rejects an oversized
     * body regardless of what was declared.
     */
    sizeBytes: z.number().int().positive(),
    contentType: z.enum(ZIP_CONTENT_TYPES),
  })
  .strict();

export type PresignBody = z.infer<typeof presignBodySchema>;
