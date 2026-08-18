import { z } from "zod";
import { httpsUrl } from "@/domain/schemas/manifest";
import { tagSlug } from "@/domain/schemas/publish";

/**
 * Editing a component outside a publish.
 *
 * Spec: docs/03-api-contract.md §3.10–3.12
 */

/**
 * The ONLY mutable fields.
 *
 * `.strict()` is what enforces immutability: `name`, `type`, `slug` and every
 * version field are absent, so sending one is an unrecognized key and a 400
 * rather than a silently ignored write. Silently ignoring it is worse — the
 * caller believes the rename happened (docs/03 §3.10).
 *
 * `SUSPENDED` is deliberately NOT in the status enum. Suspension is an admin
 * action with its own audited endpoint; letting an owner set it here would let
 * them un-suspend themselves.
 */
export const componentPatchSchema = z
  .object({
    summary: z.string().min(10).max(300).optional(),
    homepage: httpsUrl.nullable().optional(),
    repository: httpsUrl.nullable().optional(),
    tags: z.array(tagSlug).max(10).optional(),
    status: z.enum(["PUBLISHED", "DEPRECATED"]).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to change.",
  });

export type ComponentPatch = z.infer<typeof componentPatchSchema>;

/** Admin suspend / unsuspend. */
export const suspendBodySchema = z
  .object({
    suspended: z.boolean(),
    /**
     * Required when suspending. An audit row saying only "suspended" is
     * useless six months later when someone asks why.
     */
    reason: z.string().min(3).max(500).optional(),
  })
  .strict()
  .refine((body) => !body.suspended || (body.reason?.trim().length ?? 0) >= 3, {
    message: "A reason is required when suspending a component.",
    path: ["reason"],
  });

export type SuspendBody = z.infer<typeof suspendBodySchema>;
