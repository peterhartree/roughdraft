import { useEffect, useState } from "react";

async function fetchGitHubLink(path: string): Promise<string | null> {
  const query = new URLSearchParams({ path });
  const response = await fetch(`/api/github-link?${query}`);
  if (!response.ok) return null;
  const body = (await response.json()) as { url?: unknown };
  return typeof body.url === "string" ? body.url : null;
}

/**
 * Looks up the active file's GitHub blob URL alongside the document load,
 * and again when the window regains focus so a branch switch is picked up.
 * Returns null while loading and whenever there is no GitHub link.
 */
export function useGitHubLink({
  enabled,
  path,
}: {
  enabled: boolean;
  path: string | null;
}): string | null {
  const [link, setLink] = useState<{ path: string; url: string | null }>();
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => setRefreshToken((token) => token + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [enabled]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken re-runs the lookup on focus
  useEffect(() => {
    if (!enabled || !path) return;
    let cancelled = false;
    fetchGitHubLink(path)
      .catch(() => null)
      .then((url) => {
        if (!cancelled) setLink({ path, url });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, path, refreshToken]);

  return enabled && link && link.path === path ? link.url : null;
}
