import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { R2Bucket } from "./bucket";

let dir: string;
let bucket: R2Bucket;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bucket-"));
  bucket = new R2Bucket(join(dir, "photos"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("R2Bucket", () => {
  it("keeps an object and its content type, and deletes both", async () => {
    await bucket.put("recipes/r1/a.jpg", new Uint8Array([1, 2, 3]).buffer, { httpMetadata: { contentType: "image/jpeg" } });
    const object = await bucket.get("recipes/r1/a.jpg");
    expect(object && [...object.body]).toEqual([1, 2, 3]);
    expect(object?.httpMetadata?.contentType).toBe("image/jpeg");
    expect(object?.httpEtag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    await bucket.delete("recipes/r1/a.jpg");
    expect(await bucket.get("recipes/r1/a.jpg")).toBeNull();
  });

  it("finds nothing outside its folder, whatever the key", async () => {
    writeFileSync(join(dir, "secret.txt"), "not a photo");
    for (const key of ["../secret.txt", "recipes/../../secret.txt", "/secret.txt", "..\\secret.txt", "recipes//a.jpg", "./a.jpg", ""]) {
      expect(await bucket.get(key)).toBeNull();
    }
    await expect(bucket.put("../escape.jpg", "x")).rejects.toThrow(/Refused/);
    expect(existsSync(join(dir, "escape.jpg"))).toBe(false);
  });
});
