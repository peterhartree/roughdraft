const FILE_BROWSER_PREFERENCES_KEY = "roughdraft.file-browser.v1";
const MAX_PINNED_FOLDERS = 50;
const MAX_PROJECT_PINS = 200;
const MAX_FOLDER_SORT_ORDERS = 500;
const MAX_FOLDER_STATES = 500;

type PreferencesStorage = Pick<Storage, "getItem" | "setItem">;

export interface FileBrowserPreferences {
  /** Projects and folders shown as their own trees above the current project. */
  pinnedFolders: string[];
  /** Files shown as single rows at the top of the Pinned section. */
  pinnedFiles: string[];
  /** Folders whose newest file by name is shown as a Pinned row. */
  newestFilePins: string[];
  /** Files and folders pinned to the top of whichever tree contains them. */
  projectPins: string[];
  /** Folders sorted Z–A; every other folder sorts A–Z. */
  folderSortOrders: Record<string, "desc">;
  /** Explicit open/closed choices; folders without one use the default. */
  folderOpenStates: Record<string, boolean>;
  openSectionHeight: number | null;
  openSectionCollapsed: boolean;
  browseSectionCollapsed: boolean;
}

export const DEFAULT_FILE_BROWSER_PREFERENCES: FileBrowserPreferences = {
  pinnedFolders: [],
  pinnedFiles: [],
  newestFilePins: [],
  projectPins: [],
  folderSortOrders: {},
  folderOpenStates: {},
  openSectionHeight: null,
  openSectionCollapsed: false,
  browseSectionCollapsed: false,
};

function isAbsolutePath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/");
}

function parsePreferences(value: string): FileBrowserPreferences {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  const preferences = { ...DEFAULT_FILE_BROWSER_PREFERENCES };

  if (Array.isArray(parsed.pinnedFolders)) {
    preferences.pinnedFolders = [
      ...new Set(parsed.pinnedFolders.filter(isAbsolutePath)),
    ].slice(0, MAX_PINNED_FOLDERS);
  }

  if (Array.isArray(parsed.pinnedFiles)) {
    preferences.pinnedFiles = [
      ...new Set(parsed.pinnedFiles.filter(isAbsolutePath)),
    ].slice(0, MAX_PINNED_FOLDERS);
  }

  if (Array.isArray(parsed.newestFilePins)) {
    preferences.newestFilePins = [
      ...new Set(parsed.newestFilePins.filter(isAbsolutePath)),
    ].slice(0, MAX_PINNED_FOLDERS);
  }

  if (
    parsed.folderSortOrders &&
    typeof parsed.folderSortOrders === "object" &&
    !Array.isArray(parsed.folderSortOrders)
  ) {
    preferences.folderSortOrders = Object.fromEntries(
      Object.entries(parsed.folderSortOrders as Record<string, unknown>)
        .filter(
          (entry): entry is [string, "desc"] =>
            isAbsolutePath(entry[0]) && entry[1] === "desc",
        )
        .slice(-MAX_FOLDER_SORT_ORDERS),
    );
  }

  if (Array.isArray(parsed.projectPins)) {
    preferences.projectPins = [
      ...new Set(parsed.projectPins.filter(isAbsolutePath)),
    ].slice(0, MAX_PROJECT_PINS);
  }

  if (
    parsed.folderOpenStates &&
    typeof parsed.folderOpenStates === "object" &&
    !Array.isArray(parsed.folderOpenStates)
  ) {
    const entries = Object.entries(
      parsed.folderOpenStates as Record<string, unknown>,
    ).filter(
      (entry): entry is [string, boolean] =>
        isAbsolutePath(entry[0]) && typeof entry[1] === "boolean",
    );
    preferences.folderOpenStates = Object.fromEntries(
      entries.slice(-MAX_FOLDER_STATES),
    );
  }

  if (
    typeof parsed.openSectionHeight === "number" &&
    Number.isFinite(parsed.openSectionHeight) &&
    parsed.openSectionHeight > 0
  ) {
    preferences.openSectionHeight = parsed.openSectionHeight;
  }

  preferences.openSectionCollapsed = parsed.openSectionCollapsed === true;
  preferences.browseSectionCollapsed = parsed.browseSectionCollapsed === true;
  return preferences;
}

export function readFileBrowserPreferences(
  storage: PreferencesStorage,
): FileBrowserPreferences {
  try {
    const value = storage.getItem(FILE_BROWSER_PREFERENCES_KEY);
    if (value) return parsePreferences(value);
  } catch {
    // Corrupt or inaccessible storage falls back to defaults.
  }
  return { ...DEFAULT_FILE_BROWSER_PREFERENCES };
}

export function writeFileBrowserPreferences(
  storage: PreferencesStorage,
  preferences: FileBrowserPreferences,
): void {
  try {
    const folderOpenStates = Object.fromEntries(
      Object.entries(preferences.folderOpenStates).slice(-MAX_FOLDER_STATES),
    );
    storage.setItem(
      FILE_BROWSER_PREFERENCES_KEY,
      JSON.stringify({
        ...preferences,
        pinnedFolders: preferences.pinnedFolders.slice(0, MAX_PINNED_FOLDERS),
        pinnedFiles: preferences.pinnedFiles.slice(0, MAX_PINNED_FOLDERS),
        newestFilePins: preferences.newestFilePins.slice(0, MAX_PINNED_FOLDERS),
        projectPins: preferences.projectPins.slice(0, MAX_PROJECT_PINS),
        folderSortOrders: Object.fromEntries(
          Object.entries(preferences.folderSortOrders).slice(
            -MAX_FOLDER_SORT_ORDERS,
          ),
        ),
        folderOpenStates,
      }),
    );
  } catch {
    // Storage failures must not block browsing.
  }
}

/**
 * Records an explicit folder choice, moving it to the end so the oldest
 * choices are the first dropped when the cap is reached.
 */
export function setFolderOpenState(
  states: Record<string, boolean>,
  folder: string,
  open: boolean,
): Record<string, boolean> {
  const { [folder]: _previous, ...rest } = states;
  const next = { ...rest, [folder]: open };
  const entries = Object.entries(next);
  return entries.length > MAX_FOLDER_STATES
    ? Object.fromEntries(entries.slice(-MAX_FOLDER_STATES))
    : next;
}

export function isFolderOpen(
  states: Record<string, boolean>,
  folder: string,
  isRoot: boolean,
) {
  return states[folder] ?? isRoot;
}

export function setFolderSortOrder(
  orders: Record<string, "desc">,
  folder: string,
  order: "asc" | "desc",
): Record<string, "desc"> {
  const { [folder]: _previous, ...rest } = orders;
  if (order === "asc") return rest;
  const entries = Object.entries({ ...rest, [folder]: "desc" as const });
  return Object.fromEntries(entries.slice(-MAX_FOLDER_SORT_ORDERS));
}

/** Carries a renamed file's pins over to its new path. */
export function renamePinnedFile(
  preferences: FileBrowserPreferences,
  fromPath: string,
  toPath: string,
): FileBrowserPreferences {
  const rename = (paths: string[]) =>
    paths.includes(fromPath)
      ? [...new Set(paths.map((path) => (path === fromPath ? toPath : path)))]
      : paths;
  const pinnedFiles = rename(preferences.pinnedFiles);
  const projectPins = rename(preferences.projectPins);

  return pinnedFiles === preferences.pinnedFiles &&
    projectPins === preferences.projectPins
    ? preferences
    : { ...preferences, pinnedFiles, projectPins };
}
