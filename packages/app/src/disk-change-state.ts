import {
  type MarkdownFileChangeEvent,
  MarkdownFileNotFoundError,
  type Page,
  type StorageBackend,
} from "./storage";

export type DocumentDiskChangeState =
  | "clean"
  | "changed"
  | "conflict"
  | "paused"
  | "missing";

export type DiskWatchEventAction =
  | "ignore"
  | "missing"
  | "mark-changed"
  | "reload";

export function resolveDiskWatchEventAction({
  event,
  currentVersion,
  diskChangeState,
  isDirty,
}: {
  event: MarkdownFileChangeEvent;
  currentVersion: string | undefined;
  diskChangeState: DocumentDiskChangeState;
  isDirty: boolean;
}): DiskWatchEventAction {
  if (event.version && currentVersion === event.version) return "ignore";
  if (!event.exists) return "missing";
  if (diskChangeState === "paused") return "ignore";
  if (isDirty) return "mark-changed";
  return "reload";
}

export type DocumentFetchResult =
  | { status: "loaded"; document: Page }
  | { status: "missing" }
  | { status: "error"; error: unknown };

export async function fetchDocumentFromDisk(
  backend: StorageBackend,
  relativePath: string,
): Promise<DocumentFetchResult> {
  try {
    return {
      status: "loaded",
      document: await backend.getMarkdownFile(relativePath),
    };
  } catch (error) {
    if (error instanceof MarkdownFileNotFoundError) {
      return { status: "missing" };
    }
    return { status: "error", error };
  }
}

// A missing file can never be resolved by reloading, so it must not trap the
// user in the active document the way an unresolved content conflict does.
export function diskChangeStateBlocksFileSwitch(
  state: DocumentDiskChangeState,
): boolean {
  return state !== "clean" && state !== "missing";
}
