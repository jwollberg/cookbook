/**
 * Writing back to the repo from the browser.
 *
 * Uses the Git Data API (blobs -> tree -> commit -> update ref) rather than
 * the simpler Contents API. Saving a recipe routinely touches several files
 * at once — the recipe plus any new ingredients it introduced — and
 * sequential single-file PUTs can fail halfway, leaving a recipe referencing
 * an ingredient that was never written. One commit either fully lands or
 * does not.
 *
 * Auth is a single fine-grained PAT scoped to this repo with
 * Contents: read/write, held in localStorage. The site is public, so the
 * token IS the authorization — without one, the editor cannot write.
 */

const API = "https://api.github.com";

export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export interface FileChange {
  /** Repo-relative path, e.g. "public/data/recipes/foo.json". */
  path: string;
  /** File contents. `null` deletes the file. */
  content: string | null;
}

export interface CommitResult {
  sha: string;
  url: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

async function api<T>(cfg: RepoConfig, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text().catch(() => undefined);
    }
    throw new GitHubError(explain(res.status, detail), res.status, detail);
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** Turn GitHub's status codes into something a cook can act on. */
function explain(status: number, detail: unknown): string {
  const message =
    detail && typeof detail === "object" && "message" in detail
      ? String((detail as { message: unknown }).message)
      : "";

  switch (status) {
    case 401:
      return "That token was rejected. It may have expired — generate a new one.";
    case 403:
      return message.toLowerCase().includes("rate limit")
        ? "GitHub rate limit hit. Wait a few minutes and try again."
        : "That token lacks permission. It needs Contents: read and write on this repo.";
    case 404:
      return "Repo not found, or the token cannot see it. Check it is scoped to this repository.";
    case 409:
    case 422:
      return "Someone else changed the repo first. Retrying with the latest version.";
    default:
      return message || `GitHub returned ${status}.`;
  }
}

// ---------------------------------------------------------------------------
// Token / repo checks
// ---------------------------------------------------------------------------

export interface TokenCheck {
  ok: boolean;
  canWrite: boolean;
  message: string;
  login?: string;
}

/**
 * Verify a token before letting the UI pretend it can save.
 *
 * Checks push permission explicitly: a read-only token passes a plain repo
 * fetch and then fails at commit time, which is a far worse place to find out.
 */
export async function checkToken(cfg: RepoConfig): Promise<TokenCheck> {
  try {
    const repo = await api<{ permissions?: { push?: boolean }; full_name: string }>(
      cfg,
      `/repos/${cfg.owner}/${cfg.repo}`,
    );
    const canWrite = Boolean(repo.permissions?.push);
    return {
      ok: true,
      canWrite,
      message: canWrite
        ? `Connected to ${repo.full_name}.`
        : "Token is valid but read-only. It needs Contents: read and write.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach GitHub.";
    return { ok: false, canWrite: false, message };
  }
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

interface RefResponse {
  object: { sha: string };
}
interface CommitResponse {
  sha: string;
  html_url: string;
  tree: { sha: string };
}
interface BlobResponse {
  sha: string;
}
interface TreeResponse {
  sha: string;
}

type TreeEntry = {
  path: string;
  mode: "100644";
  type: "blob";
  sha: string | null;
};

/**
 * Commit a set of file changes as one commit.
 *
 * Retries on a racing push: between reading the branch head and updating it,
 * another session (or a previous save still being processed) may have moved
 * the ref. Rebuilding on the new head is correct here because each save
 * writes whole files it already owns, so replaying it on top loses nothing.
 */
export async function commitFiles(
  cfg: RepoConfig,
  message: string,
  changes: FileChange[],
  attempt = 0,
): Promise<CommitResult> {
  if (changes.length === 0) throw new Error("Nothing to commit.");

  const ref = await api<RefResponse>(cfg, `/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${cfg.branch}`);
  const headSha = ref.object.sha;
  const headCommit = await api<CommitResponse>(
    cfg,
    `/repos/${cfg.owner}/${cfg.repo}/git/commits/${headSha}`,
  );

  const entries: TreeEntry[] = [];
  for (const change of changes) {
    if (change.content === null) {
      // A null sha in a tree entry is how the Git Data API expresses deletion.
      entries.push({ path: change.path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    const blob = await api<BlobResponse>(cfg, `/repos/${cfg.owner}/${cfg.repo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: change.content, encoding: "utf-8" }),
    });
    entries.push({ path: change.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const tree = await api<TreeResponse>(cfg, `/repos/${cfg.owner}/${cfg.repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: headCommit.tree.sha, tree: entries }),
  });

  const commit = await api<CommitResponse>(cfg, `/repos/${cfg.owner}/${cfg.repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] }),
  });

  try {
    await api(cfg, `/repos/${cfg.owner}/${cfg.repo}/git/refs/heads/${cfg.branch}`, {
      method: "PATCH",
      // force stays false so a racing push surfaces as a 422 instead of
      // silently discarding the other commit.
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
  } catch (error) {
    const raced = error instanceof GitHubError && (error.status === 422 || error.status === 409);
    if (raced && attempt < 3) {
      return commitFiles(cfg, message, changes, attempt + 1);
    }
    throw error;
  }

  return { sha: commit.sha, url: commit.html_url };
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const paths = {
  ingredients: () => "public/data/ingredients.json",
  pantry: () => "public/data/pantry.json",
  recipe: (id: string) => `public/data/recipes/${id}.json`,
  meal: (id: string) => `public/data/meals/${id}.json`,
  plan: (id: string) => `public/data/plans/${id}.json`,
};

/** Stable, diff-friendly JSON. Two-space indent and a trailing newline. */
export function serialise(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
