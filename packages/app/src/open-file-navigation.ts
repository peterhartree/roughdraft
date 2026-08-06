import { formatOpenFileParentPath, getPathLeaf } from "./app-navigation";

export interface OpenFileItem {
  path: string;
  modifiedAt: number;
  openedAt: number;
  unread: boolean;
}

export type OpenFileUpsert = Omit<OpenFileItem, "openedAt"> & {
  openedAt?: number;
};

interface OpenFileShortcutEvent {
  key: string;
  code: string;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
}

type OpenFileShortcut = { type: "select-index"; index: number };

function compareOpenFiles(left: OpenFileItem, right: OpenFileItem) {
  return (
    right.openedAt - left.openedAt ||
    right.modifiedAt - left.modifiedAt ||
    left.path.localeCompare(right.path)
  );
}

export function sortOpenFiles(files: OpenFileItem[]) {
  return [...files].sort(compareOpenFiles);
}

export function upsertOpenFile(
  files: OpenFileItem[],
  file: OpenFileUpsert,
  now = Date.now(),
) {
  const existingIndex = files.findIndex(
    (candidate) => candidate.path === file.path,
  );
  const existing = existingIndex === -1 ? undefined : files[existingIndex];
  // Refreshes (saves, disk changes) keep the original open time so the
  // sidebar only reorders when a file is opened.
  const openedAt = file.openedAt ?? existing?.openedAt ?? now;
  if (
    existing &&
    existing.modifiedAt === file.modifiedAt &&
    existing.unread === file.unread &&
    existing.openedAt === openedAt
  ) {
    return files;
  }

  const nextFiles = [...files];

  if (existingIndex === -1) {
    nextFiles.push({ ...file, openedAt });
  } else {
    nextFiles[existingIndex] = {
      ...nextFiles[existingIndex],
      ...file,
      openedAt,
    };
  }

  return sortOpenFiles(nextFiles);
}

export function markOpenFileRead(files: OpenFileItem[], path: string) {
  const fileIndex = files.findIndex(
    (file) => file.path === path && file.unread,
  );
  if (fileIndex === -1) return files;

  const nextFiles = [...files];
  nextFiles[fileIndex] = { ...nextFiles[fileIndex], unread: false };
  return nextFiles;
}

export function getOpenFileCloseCandidates(
  files: OpenFileItem[],
  activePath: string,
) {
  const activeIndex = files.findIndex((file) => file.path === activePath);
  if (activeIndex === -1) return [];

  return [
    ...files.slice(activeIndex + 1),
    ...files.slice(0, activeIndex).reverse(),
  ].map((file) => file.path);
}

export function filterOpenFiles(files: OpenFileItem[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return files;
  return files.filter((file) =>
    getOpenFileName(file.path).toLocaleLowerCase().includes(normalizedQuery),
  );
}

export function getOpenFileName(path: string) {
  return getPathLeaf(path) ?? path;
}

export { formatOpenFileParentPath };

function hasExactCommandModifiers(event: OpenFileShortcutEvent) {
  return (
    event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.repeat &&
    !event.isComposing
  );
}

export function getOpenFileShortcut(
  event: OpenFileShortcutEvent,
  fileCount: number,
): OpenFileShortcut | null {
  if (!hasExactCommandModifiers(event)) return null;

  const digitMatch = event.code.match(/^Digit([1-9])$/);
  if (digitMatch) {
    const index = Number(digitMatch[1]) - 1;
    return index < fileCount ? { type: "select-index", index } : null;
  }

  return null;
}

export function isOpenFileSwitcherShortcut(event: OpenFileShortcutEvent) {
  return event.code === "KeyP" && hasExactCommandModifiers(event);
}

export function isToggleOpenFileSidebarShortcut(event: OpenFileShortcutEvent) {
  return (
    event.key.toLocaleLowerCase() === "e" &&
    event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    event.shiftKey &&
    !event.repeat &&
    !event.isComposing
  );
}

export function isCloseOpenFileShortcut(event: OpenFileShortcutEvent) {
  return (
    event.key.toLocaleLowerCase() === "w" && hasExactCommandModifiers(event)
  );
}

export function isCloseAllOpenFilesShortcut(event: OpenFileShortcutEvent) {
  return (
    event.key.toLocaleLowerCase() === "w" &&
    event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    event.shiftKey &&
    !event.repeat &&
    !event.isComposing
  );
}

export function shouldHandleOpenRequestInSession(
  backendKind: "local-files" | "local-storage" | "remote" | undefined,
  activePath: string | null,
) {
  return (
    Boolean(activePath) &&
    (backendKind === undefined || backendKind === "local-files")
  );
}
