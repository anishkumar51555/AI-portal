import { z } from "zod";

/**
 * Publish request bodies.
 *
 * Note how little is here. Name, type, version, description, and license all
 * come from the manifest INSIDE the archive — never from the request. One
 * source of truth means a client cannot claim a type its manifest contradicts,
 * and there is no pair of fields that can disagree (docs/03 §3.7).
 *
 * Spec: docs/03-api-contract.md §3.7, §3.8
 */

/** A catalog tag: lowercase, hyphenated, short. Same shape as manifest keywords. */
export const tagSlug = z
  .string()
  .regex(
    /^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$/,
    "Tags are lowercase letters, numbers and hyphens, 1–30 characters",
  );

export const publishBodySchema = z
  .object({
    /**
     * Which staged upload to publish. Ownership is asserted server-side against
     * the `staging/{userId}/` prefix before any storage call — this string is
     * fully attacker-controlled (docs/08 §4, threat 6).
     */
    stagingKey: z.string().min(1).max(256),
    tags: z.array(tagSlug).max(10).default([]),
    changelog: z.string().max(2_000).nullable().default(null),
  })
  .strict();

export type PublishBody = z.infer<typeof publishBodySchema>;

/** `POST /api/components/:slug/versions` takes the same body. */
export const publishVersionBodySchema = publishBodySchema;
export type PublishVersionBody = PublishBody;
