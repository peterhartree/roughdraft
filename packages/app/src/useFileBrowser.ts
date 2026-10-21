import { useCallback, useEffect, useRef, useState } from "react";
import { getRevealFolders, type MarkdownTreeListing } from "./file-browser";
import {
  FILE_BROWSER_PREFERENCES_KEY,
  type FileBrowserPreferences,
  isFolderOpen,
  readFileBrowserPreferences,
  renamePinnedFile,
  setFolderOpenState,
  setFolderSortOrder,
  writeFileBrowserPreferences,
} from "./file-browser-preferences";

export type TreeLoadState =
  | { status: "loading"; listing: MarkdownTreeListing | null }
  | { status: "ready"; listing: MarkdownTreeListing }
  | { status: "error"; listing: MarkdownTreeListing | null; error: string };

async function fetchMarkdownTree(
  params: { file: string } | { root: string },
): Promise<MarkdownTreeListing> {
  const query = new URLSearchParams(params);
  const response = await fetch(`/api/markdown-tree?${query}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as MarkdownTreeListing;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not list files";
}

/**
 * Loads the active file's project and the pinned folders, refreshing on
 * window focus rather than watching folders continuously.
 */
export function useFileBrowser({
  enabled,
  activePath,
}: {
  enabled: boolean;
  activePath: string | null;
}) {
  const [preferences, setPreferences] = useState<FileBrowserPreferences>(() =>
    readFileBrowserPreferences(window.localStorage),
  );
  const [project, setProject] = useState<TreeLoadState | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const projectRequestRef = useRef(0);
  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  const updatePreferences = useCallback(
    (update: (current: FileBrowserPreferences) => FileBrowserPreferences) => {
      // Another desktop window may have written shared pins since this
      // renderer last received a storage event. Base each mutation on the
      // latest stored value so it does not overwrite that newer change.
      const current = readFileBrowserPreferences(window.localStorage);
      const next = update(current);
      if (next !== current) {
        writeFileBrowserPreferences(window.localStorage, next);
      }
      setPreferences(next);
    },
    [],
  );

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== FILE_BROWSER_PREFERENCES_KEY) return;
      setPreferences(readFileBrowserPreferences(window.localStorage));
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, refresh]);

  // refreshToken is a trigger: each focus refetches the same paths.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!enabled || !activePath) {
      setProject(null);
      return;
    }
    const request = ++projectRequestRef.current;
    setProject((current) => ({
      status: "loading",
      listing: current?.listing ?? null,
    }));
    fetchMarkdownTree({ file: activePath }).then(
      (listing) => {
        if (request !== projectRequestRef.current) return;
        setProject({ status: "ready", listing });
      },
      (error: unknown) => {
        if (request !== projectRequestRef.current) return;
        setProject({
          status: "error",
          listing: null,
          error: errorMessage(error),
        });
      },
    );
  }, [enabled, activePath, refreshToken]);

  const pinnedFolders = preferences.pinnedFolders;
  const pins = useFolderListings(enabled, pinnedFolders, refreshToken);
  // Newest-file pins also re-check on every document switch, so a plan
  // created and opened by an agent shows up without a focus change.
  const newestFilePins = useFolderListings(
    enabled,
    preferences.newestFilePins,
    `${refreshToken}:${activePath ?? ""}`,
  );

  const projectRoot = project?.listing?.root ?? null;

  // Reveal the active file in every tree that contains it. Pin changes do
  // not re-run this, so folders the user has since closed stay closed.
  const pinnedFoldersRef = useRef(pinnedFolders);
  pinnedFoldersRef.current = pinnedFolders;
  useEffect(() => {
    if (!activePath) return;
    const roots = [projectRoot, ...pinnedFoldersRef.current].filter(
      (root): root is string => Boolean(root),
    );
    const folders = roots.flatMap((root) => getRevealFolders(root, activePath));
    updatePreferences((current) => {
      let folderOpenStates = current.folderOpenStates;
      for (const folder of folders) {
        if (!isFolderOpen(folderOpenStates, folder, roots.includes(folder))) {
          folderOpenStates = setFolderOpenState(folderOpenStates, folder, true);
        }
      }
      return folderOpenStates === current.folderOpenStates
        ? current
        : { ...current, folderOpenStates };
    });
  }, [activePath, projectRoot, updatePreferences]);

  const renamePinnedPath = useCallback(
    (fromPath: string, toPath: string) =>
      updatePreferences((current) =>
        renamePinnedFile(current, fromPath, toPath),
      ),
    [updatePreferences],
  );

  return {
    preferences,
    project,
    projectRoot,
    pinnedRoots: pinnedFolders,
    projectRootIsPinned:
      projectRoot !== null && pinnedFolders.includes(projectRoot),
    refresh,
    renamePinnedFile: renamePinnedPath,
    pinFile: (path: string) =>
      updatePreferences((current) =>
        current.pinnedFiles.includes(path)
          ? current
          : { ...current, pinnedFiles: [...current.pinnedFiles, path] },
      ),
    unpinFile: (path: string) =>
      updatePreferences((current) => ({
        ...current,
        pinnedFiles: current.pinnedFiles.filter((pin) => pin !== path),
      })),
    folderSortOrder: (folder: string): "asc" | "desc" =>
      preferences.folderSortOrders[folder] ?? "asc",
    setFolderSortOrder: (folder: string, order: "asc" | "desc") =>
      updatePreferences((current) => {
        const folderSortOrders = setFolderSortOrder(
          current.folderSortOrders,
          folder,
          order,
        );
        return (current.folderSortOrders[folder] ?? "asc") === order
          ? current
          : { ...current, folderSortOrders };
      }),
    pinToProject: (path: string) =>
      updatePreferences((current) =>
        current.projectPins.includes(path)
          ? current
          : { ...current, projectPins: [...current.projectPins, path] },
      ),
    unpinFromProject: (path: string) =>
      updatePreferences((current) => ({
        ...current,
        projectPins: current.projectPins.filter((pin) => pin !== path),
      })),
    pins,
    newestFilePins,
    pinNewestFile: (folder: string) =>
      updatePreferences((current) =>
        current.newestFilePins.includes(folder)
          ? current
          : {
              ...current,
              newestFilePins: [...current.newestFilePins, folder],
            },
      ),
    unpinNewestFile: (folder: string) =>
      updatePreferences((current) => ({
        ...current,
        newestFilePins: current.newestFilePins.filter((pin) => pin !== folder),
      })),
    isFolderOpen: (folder: string, isRoot: boolean) =>
      isFolderOpen(preferences.folderOpenStates, folder, isRoot),
    toggleFolder: (folder: string, isRoot: boolean) =>
      updatePreferences((current) => ({
        ...current,
        folderOpenStates: setFolderOpenState(
          current.folderOpenStates,
          folder,
          !isFolderOpen(current.folderOpenStates, folder, isRoot),
        ),
      })),
    pinFolder: (folder: string) =>
      updatePreferences((current) =>
        current.pinnedFolders.includes(folder)
          ? current
          : { ...current, pinnedFolders: [...current.pinnedFolders, folder] },
      ),
    unpinFolder: (folder: string) =>
      updatePreferences((current) => ({
        ...current,
        pinnedFolders: current.pinnedFolders.filter((pin) => pin !== folder),
      })),
    setOpenSectionHeight: (height: number) =>
      updatePreferences((current) => ({
        ...current,
        openSectionHeight: Math.round(height),
      })),
    toggleOpenSection: () =>
      updatePreferences((current) => ({
        ...current,
        openSectionCollapsed: !current.openSectionCollapsed,
      })),
    toggleBrowseSection: () =>
      updatePreferences((current) => ({
        ...current,
        browseSectionCollapsed: !current.browseSectionCollapsed,
      })),
  };
}

/** Fetches each folder's listing, refetching whenever `trigger` changes. */
function useFolderListings(
  enabled: boolean,
  folders: string[],
  trigger: unknown,
): Record<string, TreeLoadState> {
  const [listings, setListings] = useState<Record<string, TreeLoadState>>({});

  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger forces a refetch
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setListings((current) =>
      Object.fromEntries(
        folders.map((folder) => [
          folder,
          {
            status: "loading",
            listing: current[folder]?.listing ?? null,
          } satisfies TreeLoadState,
        ]),
      ),
    );
    for (const folder of folders) {
      fetchMarkdownTree({ root: folder }).then(
        (listing) => {
          if (cancelled) return;
          setListings((current) => ({
            ...current,
            [folder]: { status: "ready", listing },
          }));
        },
        (error: unknown) => {
          if (cancelled) return;
          setListings((current) => ({
            ...current,
            [folder]: {
              status: "error",
              listing: null,
              error: errorMessage(error),
            },
          }));
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [enabled, folders, trigger]);

  return listings;
}
