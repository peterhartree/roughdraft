import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGitHubFileStatus, type GitHubFileStatus } from "./github-file";

/**
 * Looks up the active file's GitHub link and sync state alongside the
 * document load, then again after each completed save and whenever the window
 * regains focus, so commits, pushes and branch switches made elsewhere show
 * up. Returns null while loading and when the file has no GitHub home.
 */
export function useGitHubFile({
  enabled,
  path,
  saved,
}: {
  enabled: boolean;
  path: string | null;
  /** True once the document's latest edits are on disk. */
  saved: boolean;
}) {
  const [entry, setEntry] = useState<{
    path: string;
    status: GitHubFileStatus | null;
  }>();
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);
  // Each lookup and replacement takes a number, so a slow lookup started
  // before a push cannot overwrite the status the push returned.
  const latestRequestRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [enabled, refresh]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken re-runs the lookup on focus
  useEffect(() => {
    if (!enabled || !path || !saved) return;
    const request = ++latestRequestRef.current;
    fetchGitHubFileStatus(path)
      .catch(() => null)
      .then((status) => {
        if (request === latestRequestRef.current) setEntry({ path, status });
      });
  }, [enabled, path, saved, refreshToken]);

  const replace = useCallback(
    (forPath: string, status: GitHubFileStatus | null) => {
      latestRequestRef.current += 1;
      setEntry({ path: forPath, status });
    },
    [],
  );

  return {
    status: enabled && entry && entry.path === path ? entry.status : null,
    replace,
  };
}
