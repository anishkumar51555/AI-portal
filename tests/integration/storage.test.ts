import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { storageAvailable } from "./_helpers";
import {
  copyObject,
  createPresignedUpload,
  deleteObject,
  getObjectStream,
  getSignedDownloadUrl,
  headObject,
  putObject,
} from "@/server/storage/storage.service";
import { componentKey, stagingKey } from "@/domain/storage-keys";
import { type AppError } from "@/domain/errors";

/**
 * Storage against a REAL MinIO.
 *
 * Never mocked. Storage semantics — presigned conditions, copy behaviour, 404
 * shapes — are exactly where the interesting bugs live, and a mocked S3 client
 * would assert only that our mock behaves like our mock.
 *
 * Features: F2.1, F2.2, F2.3
 */

let up = false;
const created: string[] = [];

/** Track a key so it is cleaned up even if the test fails. */
function track(key: string): string {
  created.push(key);
  return key;
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

beforeAll(async () => {
  up = await storageAvailable();
  if (!up) console.warn("\n  ⚠ MinIO unavailable — run: npm run docker:up\n");
});

afterAll(async () => {
  await Promise.all(created.map((k) => deleteObject(k).catch(() => undefined)));
});

describe("[F2.1] object lifecycle: put, head, copy, get, delete", () => {
  it("round-trips an object through every operation", async (ctx) => {
    if (!up) ctx.skip();

    const key = track(stagingKey("usr_roundtrip"));
    const body = Buffer.from("PK pretend archive contents");

    await putObject(key, body);

    const head = await headObject(key);
    expect(head).not.toBeNull();
    expect(head!.sizeBytes).toBe(body.byteLength);
    expect(head!.contentType).toBe("application/zip");

    const streamed = await readAll(await getObjectStream(key));
    expect(streamed.equals(body)).toBe(true);

    const permanent = track(componentKey("round-trip", "1.0.0"));
    await copyObject(key, permanent);

    // The copy is byte-identical — this is what makes the published checksum
    // still describe the archive that was validated.
    expect((await readAll(await getObjectStream(permanent))).equals(body)).toBe(true);

    await deleteObject(key);
    expect(await headObject(key)).toBeNull();
    // Deleting the source must not touch the promoted copy.
    expect(await headObject(permanent)).not.toBeNull();
  });

  it("headObject returns null for a missing key rather than throwing", async (ctx) => {
    if (!up) ctx.skip();
    expect(await headObject("staging/usr_nobody/does-not-exist.zip")).toBeNull();
  });

  it("getObjectStream on a missing key throws STAGING_NOT_FOUND, not a 500", async (ctx) => {
    if (!up) ctx.skip();
    // A publisher whose upload expired should get an actionable 404, not an
    // opaque internal error.
    await expect(getObjectStream("staging/usr_nobody/gone.zip")).rejects.toMatchObject({
      code: "STAGING_NOT_FOUND",
    });
  });

  it("copyObject from a missing source throws STAGING_NOT_FOUND", async (ctx) => {
    if (!up) ctx.skip();
    await expect(
      copyObject("staging/usr_nobody/gone.zip", track(componentKey("nope", "1.0.0"))),
    ).rejects.toMatchObject({ code: "STAGING_NOT_FOUND" });
  });

  it("deleteObject on a missing key is a no-op", async (ctx) => {
    if (!up) ctx.skip();
    // Cleanup runs on BOTH the success and rejection paths of publishing. A
    // cleanup that can throw is a cleanup that eventually gets skipped.
    await expect(
      deleteObject("staging/usr_nobody/never-existed.zip"),
    ).resolves.toBeUndefined();
  });

  it("never leaks provider internals in an error response", async (ctx) => {
    if (!up) ctx.skip();
    try {
      await getObjectStream("staging/usr_nobody/gone.zip");
    } catch (e) {
      const err = e as AppError;
      expect(err.message).not.toMatch(/localhost:9000|minio|Bucket|<\?xml/i);
      expect(err.details).toBeUndefined();
    }
  });
});

describe("[F2.2] presigned upload is constrained by storage itself", () => {
  it("returns a POST target with the fields the browser must send", async (ctx) => {
    if (!up) ctx.skip();

    const key = stagingKey("usr_presign");
    const presigned = await createPresignedUpload(key, "application/zip");

    expect(presigned.key).toBe(key);
    expect(presigned.url).toMatch(/^https?:\/\//);
    expect(presigned.fields).toHaveProperty("Policy");
    expect(presigned.fields).toHaveProperty("key", key);
    expect(new Date(presigned.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("ACCEPTS an upload within the size limit", async (ctx) => {
    if (!up) ctx.skip();

    const key = track(stagingKey("usr_within"));
    const { url, fields } = await createPresignedUpload(key, "application/zip");

    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append(
      "file",
      new Blob([Buffer.from("small archive")], { type: "application/zip" }),
    );

    const res = await fetch(url, { method: "POST", body: form });
    expect(res.status).toBeLessThan(400);
    expect(await headObject(key)).not.toBeNull();
  });

  it("REJECTS an oversized upload at the bucket, before it reaches us", async (ctx) => {
    if (!up) ctx.skip();

    // The point of content-length-range: the client is the one reporting its
    // size, so a client that lies — or a plain curl command — must still be
    // stopped. This proves storage enforces it, not our application code.
    const key = stagingKey("usr_toobig");
    const { url, fields } = await createPresignedUpload(key, "application/zip");

    const oversized = Buffer.alloc(
      Number(process.env.MAX_UPLOAD_BYTES ?? 10_485_760) + 1024,
      0,
    );
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append("file", new Blob([oversized], { type: "application/zip" }));

    const res = await fetch(url, { method: "POST", body: form });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await headObject(key)).toBeNull();
  });

  it("REJECTS an empty upload", async (ctx) => {
    if (!up) ctx.skip();

    const key = stagingKey("usr_empty");
    const { url, fields } = await createPresignedUpload(key, "application/zip");

    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append("file", new Blob([], { type: "application/zip" }));

    const res = await fetch(url, { method: "POST", body: form });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await headObject(key)).toBeNull();
  });

  it("REJECTS a content type other than the one signed", async (ctx) => {
    if (!up) ctx.skip();

    const key = stagingKey("usr_wrongtype");
    const { url, fields } = await createPresignedUpload(key, "application/zip");

    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.set("Content-Type", "text/html"); // swap after signing
    form.append("file", new Blob([Buffer.from("<script>")], { type: "text/html" }));

    const res = await fetch(url, { method: "POST", body: form });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await headObject(key)).toBeNull();
  });
});

describe("[F2.3] presigned download", () => {
  it("serves the object and forces a sensible filename", async (ctx) => {
    if (!up) ctx.skip();

    const key = track(componentKey("download-me", "2.1.0"));
    const body = Buffer.from("archive bytes");
    await putObject(key, body);

    const url = await getSignedDownloadUrl(key, "download-me", "2.1.0");
    const res = await fetch(url);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="download-me-2.1.0.zip"',
    );
    expect(Buffer.from(await res.arrayBuffer()).equals(body)).toBe(true);
  });

  it("carries an expiry, so a leaked URL stops working", async (ctx) => {
    if (!up) ctx.skip();

    const key = track(componentKey("expiring", "1.0.0"));
    await putObject(key, Buffer.from("x"));

    const url = await getSignedDownloadUrl(key, "expiring", "1.0.0");
    const expires = new URL(url).searchParams.get("X-Amz-Expires");

    expect(expires).not.toBeNull();
    expect(Number(expires)).toBeLessThanOrEqual(300); // docs/03 section 3.9
  });

  it("an unsigned request to the same object is refused — the bucket is private", async (ctx) => {
    if (!up) ctx.skip();

    const key = track(componentKey("private-check", "1.0.0"));
    await putObject(key, Buffer.from("secret"));

    const signed = await getSignedDownloadUrl(key, "private-check", "1.0.0");
    const unsigned = new URL(signed);
    unsigned.search = ""; // strip the signature

    const res = await fetch(unsigned.toString());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("a tampered signature is refused", async (ctx) => {
    if (!up) ctx.skip();

    const key = track(componentKey("tamper-check", "1.0.0"));
    await putObject(key, Buffer.from("secret"));

    // Point a validly-signed URL at a different object: the signature covers
    // the key, so this must fail rather than serve the other object.
    const signed = await getSignedDownloadUrl(key, "tamper-check", "1.0.0");
    const res = await fetch(signed.replace("tamper-check", "some-other-component"));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
