import { useEffect, useState } from "react";
import { checkToken } from "../lib/github";
import { getToken, setToken, REPO, stashedCount, clearStash } from "../lib/store";

type Status = "idle" | "checking" | "ok" | "readonly" | "bad";

const TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new?" +
  "description=Cookbook%20editor&target_name=jwollberg";

export default function TokenPanel({ compact = false }: { compact?: boolean }) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const existing = getToken();
    setConnected(Boolean(existing));
    setPending(stashedCount());
    if (existing) void verify(existing, false);
    // Runs once on mount; verify is stable enough for this narrow use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify(token: string, persist: boolean) {
    setStatus("checking");
    setMessage("");
    const result = await checkToken({ ...REPO, token });

    if (!result.ok) {
      setStatus("bad");
      setMessage(result.message);
      return;
    }
    if (!result.canWrite) {
      setStatus("readonly");
      setMessage(result.message);
      return;
    }

    if (persist) {
      setToken(token);
      setConnected(true);
      setValue("");
    }
    setStatus("ok");
    setMessage(result.message);
  }

  function disconnect() {
    setToken(null);
    setConnected(false);
    setStatus("idle");
    setMessage("");
  }

  const tone =
    status === "ok"
      ? "var(--olive)"
      : status === "bad" || status === "readonly"
        ? "var(--accent)"
        : "var(--muted)";

  if (connected && compact) {
    return (
      <span className="chip chip-olive" title={message}>
        ● Editing enabled
      </span>
    );
  }

  return (
    <div className="card" style={{ padding: "20px 22px 22px" }}>
      <span className="lbl">Editing access</span>

      {connected ? (
        <>
          <p style={{ margin: "10px 0 0", color: "var(--ink-2)" }}>
            {status === "checking" ? "Checking token…" : message || "Token stored in this browser."}
          </p>
          {pending > 0 && (
            <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--muted)" }}>
              {pending} local edit{pending === 1 ? "" : "s"} not yet in the published build. They
              show for you now and will appear for everyone once the rebuild finishes.{" "}
              <button
                className="btn btn-ghost btn-sm"
                style={{ minHeight: 0, padding: "2px 6px", textDecoration: "underline" }}
                onClick={() => {
                  clearStash();
                  setPending(0);
                }}
              >
                Discard
              </button>
            </p>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button className="btn btn-sm" onClick={disconnect}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: "10px 0 0", color: "var(--ink-2)" }}>
            Reading this site needs nothing. Saving needs a GitHub fine-grained token scoped to{" "}
            <code>
              {REPO.owner}/{REPO.repo}
            </code>{" "}
            with <strong>Contents: read and write</strong>.
          </p>

          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <input
              className="input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="github_pat_…"
              aria-label="GitHub fine-grained token"
              style={{ flex: "1 1 260px" }}
            />
            <button
              className="btn btn-primary"
              disabled={!value.trim() || status === "checking"}
              onClick={() => void verify(value.trim(), true)}
            >
              {status === "checking" ? "Checking…" : "Connect"}
            </button>
          </div>

          <p style={{ margin: "12px 0 0", fontSize: 13 }}>
            <a href={TOKEN_URL} target="_blank" rel="noopener noreferrer">
              Create a token on GitHub →
            </a>
          </p>

          {/* Stated plainly rather than buried: this is a real tradeoff, and
              the person pasting the token should know the blast radius. */}
          <p style={{ margin: "14px 0 0", fontSize: 12, color: "var(--muted)" }}>
            The token is kept in this browser's local storage, never sent anywhere but GitHub. Scope
            it to this one repo and nothing else, so a leak costs you recipe JSON and nothing more.
            Revoke it any time from GitHub settings.
          </p>
        </>
      )}

      {message && !connected && (
        <p style={{ margin: "12px 0 0", fontSize: 13, color: tone }} role="status">
          {message}
        </p>
      )}
    </div>
  );
}
