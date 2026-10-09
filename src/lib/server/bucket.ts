/**
 * Cloudflare R2's API over a folder, so Kitchen's photo code runs unchanged on Vault: get, put
 * and delete, as much of it as the app uses. Each object is a file at its key; its content
 * type rides in `<file>.meta.json` beside it.
 *
 * A key is a relative path of plain segments (letters, digits, `.`, `_`, `-`), and nothing
 * else reaches the disk: a key with `..`, a leading slash, a backslash or an empty segment is
 * not found when read and refused when written, so no request names a file outside the folder.
 */

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface R2HTTPMetadata {
  contentType?: string;
}

export interface R2ObjectBody {
  key: string;
  size: number;
  httpEtag: string;
  httpMetadata?: R2HTTPMetadata;
  body: Uint8Array;
  arrayBuffer(): Promise<ArrayBuffer>;
}

const KEY = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

export class R2Bucket {
  constructor(private readonly root: string) {}

  /** The file for a key, or null for a key that could leave the folder. */
  private file(key: string): string | null {
    if (!KEY.test(key) || key.split("/").some((segment) => segment === "." || segment === "..")) return null;
    return join(this.root, ...key.split("/"));
  }

  private fileOrThrow(key: string): string {
    const file = this.file(key);
    if (!file) throw new Error(`Refused object key ${JSON.stringify(key)}`);
    return file;
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const file = this.file(key);
    if (!file) return null;
    try {
      const [body, info] = await Promise.all([readFile(file), stat(file)]);
      const meta = JSON.parse(await readFile(`${file}.meta.json`, "utf8").catch(() => "{}")) as R2HTTPMetadata;
      return {
        key,
        size: info.size,
        httpEtag: `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`,
        httpMetadata: meta,
        body: new Uint8Array(body),
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async put(key: string, value: ArrayBuffer | Uint8Array | string, options?: { httpMetadata?: R2HTTPMetadata }): Promise<void> {
    const file = this.fileOrThrow(key);
    await mkdir(dirname(file), { recursive: true });
    const bytes = typeof value === "string" ? Buffer.from(value) : value instanceof Uint8Array ? value : new Uint8Array(value);
    await writeFile(file, bytes);
    await writeFile(`${file}.meta.json`, JSON.stringify(options?.httpMetadata ?? {}));
  }

  async delete(key: string): Promise<void> {
    const file = this.fileOrThrow(key);
    await rm(file, { force: true });
    await rm(`${file}.meta.json`, { force: true });
  }
}
