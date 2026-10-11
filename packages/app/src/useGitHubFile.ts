import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGitHubFileStatus, type GitHubFileStatus } from "./github-file";

interface Entry {
  path: string;
  status: GitHubFileStatus | null;
  /** Whether this status followed a fetch from GitHub on open or focus. */
  checkedGitHub: boolean;
}

/**
 * Looks up the active file's GitHub link and sync state. Opening a file and
 * refocusing the window first answer from the local copy, then fetch from
 * GitHub to catch changes pushed elsewhere; each completed save answers from
 * the local copy alone. Returns null while loading and when the file has no
 * GitHub home.
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
  const [entry, setEntry] = useState<Entry>();
  const [focusToken, setFocusToken] = useState(0);
  // Every lookup takes a number, and only the newest may set the status, so
  // a slow lookup cannot overwrite a newer answer.
  const latestRequestRef = useRef(0);
  // A local lookup started while a fetch is under way would answer from
  // before the fetch; it waits and runs once the fetch is done instead.
  const fetchInFlightRef = useRef(0);
  const localWaitingRef = useRef(false);

  const lookUp = useCallback((forPath: string, fromGitHub: boolean) => {
    if (!fromGitHub && fetchInFlightRef.current !== 0) {
      localWaitingRef.current = true;
      return;
    }
    const request = ++latestRequestRef.current;
    if (fromGitHub) fetchInFlightRef.current = request;
    fetchGitHubFileStatus(forPath, { fetch: fromGitHub })
      .catch(() => null)
      .then((status) => {
        if (request === latestRequestRef.current) {
          setEntry({ path: forPath, status, checkedGitHub: fromGitHub });
        }
        if (!fromGitHub || fetchInFlightRef.current !== request) return;
        fetchInFlightRef.current = 0;
        if (localWaitingRef.current) {
          localWaitingRef.current = false;
          lookUp(forPath, false);
        }
      });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => setFocusToken((token) => token + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [enabled]);

  // Opening a file: answer locally at once, then check GitHub.
  useEffect(() => {
    if (!enabled || !path) return;
    fetchInFlightRef.current = 0;
    localWaitingRef.current = false;
    lookUp(path, false);
    lookUp(path, true);
  }, [enabled, path, lookUp]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: path is read at focus time, not a trigger
  useEffect(() => {
    if (!enabled || !path || focusToken === 0) return;
    lookUp(path, true);
  }, [enabled, focusToken, lookUp]);

  // After each save. Opening a file already looks up, so path is not a trigger.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!enabled || !path || !saved) return;
    lookUp(path, false);
  }, [enabled, saved, lookUp]);

  const replace = useCallback(
    (forPath: string, status: GitHubFileStatus | null) => {
      latestRequestRef.current += 1;
      setEntry({ path: forPath, status, checkedGitHub: false });
    },
    [],
  );

  const current = enabled && entry && entry.path === path ? entry : null;
  return {
    status: current?.status ?? null,
    checkedGitHub: current?.checkedGitHub ?? false,
    replace,
  };
}
