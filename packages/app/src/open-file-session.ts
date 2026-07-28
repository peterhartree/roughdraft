import type { OpenFileItem } from "./open-file-navigation";
import {
  type DocumentViewState,
  getRestorableDocumentViewState,
} from "./document-view-state";

const OPEN_FILE_SESSION_KEY = "roughdraft.open-file-session.v1";
const MAX_RESTORED_FILES = 100;
const MAX_STORED_SESSION_LENGTH = 1_000_000;

type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface OpenFileSession {
  activePath: string;
  files: OpenFileItem[];
  viewStates?: Record<string, DocumentViewState>;
}

type OpenFileSessionInput = Omit<OpenFileSession, "viewStates"> & {
  viewStates?:
    | Record<string, DocumentViewState>
    | Map<string, DocumentViewState>;
};

function parseOpenFileSession(
  value: string,
  now: number,
): OpenFileSession | null {
  const parsed = JSON.parse(value) as {
    activePath?: unknown;
    files?: unknown;
    viewStates?: unknown;
  };
  if (
    typeof parsed.activePath !== "string" ||
    !parsed.activePath.trim() ||
    !Array.isArray(parsed.files) ||
    parsed.files.length === 0 ||
    parsed.files.length > MAX_RESTORED_FILES
  ) {
    return null;
  }

  const seenPaths = new Set<string>();
  const files: OpenFileItem[] = [];
  for (const candidate of parsed.files) {
    if (!candidate || typeof candidate !== "object") return null;
    const file = candidate as Record<string, unknown>;
    if (
      typeof file.path !== "string" ||
      !file.path.trim() ||
      seenPaths.has(file.path) ||
      typeof file.modifiedAt !== "number" ||
      !Number.isFinite(file.modifiedAt) ||
      (file.openedAt !== undefined &&
        (typeof file.openedAt !== "number" ||
          !Number.isFinite(file.openedAt))) ||
      typeof file.unread !== "boolean"
    ) {
      return null;
    }

    seenPaths.add(file.path);
    files.push({
      path: file.path,
      modifiedAt: file.modifiedAt,
      // Sessions stored before open times existed keep their saved order:
      // synthesised open times decrease with the stored index.
      openedAt:
        typeof file.openedAt === "number" ? file.openedAt : now - files.length,
      unread: file.unread,
    });
  }

  if (!seenPaths.has(parsed.activePath)) return null;

  const viewStates: Record<string, DocumentViewState> = {};
  if (
    parsed.viewStates &&
    typeof parsed.viewStates === "object" &&
    !Array.isArray(parsed.viewStates)
  ) {
    const storedViewStates = parsed.viewStates as Record<string, unknown>;
    for (const file of files) {
      const state = getRestorableDocumentViewState(
        storedViewStates[file.path],
        now,
      );
      if (state) viewStates[file.path] = state;
    }
  }

  return Object.keys(viewStates).length > 0
    ? { activePath: parsed.activePath, files, viewStates }
    : { activePath: parsed.activePath, files };
}

export function readOpenFileSession(
  storage: SessionStorage,
  now = Date.now(),
): OpenFileSession | null {
  try {
    const value = storage.getItem(OPEN_FILE_SESSION_KEY);
    if (!value) return null;
    if (value.length > MAX_STORED_SESSION_LENGTH) {
      clearOpenFileSession(storage);
      return null;
    }
    const session = parseOpenFileSession(value, now);
    if (session) return session;
  } catch {
    // Invalid or inaccessible storage should never block Roughdraft startup.
  }

  clearOpenFileSession(storage);
  return null;
}

export function writeOpenFileSession(
  storage: SessionStorage,
  session: OpenFileSessionInput,
  now = Date.now(),
): void {
  try {
    const files = session.files.slice(0, MAX_RESTORED_FILES);
    if (!files.some((file) => file.path === session.activePath)) {
      const activeFile = session.files.find(
        (file) => file.path === session.activePath,
      );
      if (activeFile) {
        files.splice(files.length - 1, 1, activeFile);
      }
    }

    const viewStates: Record<string, DocumentViewState> = {};
    for (const file of files) {
      const value =
        session.viewStates instanceof Map
          ? session.viewStates.get(file.path)
          : session.viewStates?.[file.path];
      const state = getRestorableDocumentViewState(value, now);
      if (state) viewStates[file.path] = state;
    }
    const storedSession: OpenFileSession = {
      activePath: session.activePath,
      files,
      ...(Object.keys(viewStates).length > 0 ? { viewStates } : {}),
    };

    storage.setItem(OPEN_FILE_SESSION_KEY, JSON.stringify(storedSession));
  } catch {
    // Editing remains available if browser persistence is unavailable.
  }
}

export function clearOpenFileSession(storage: SessionStorage): void {
  try {
    storage.removeItem(OPEN_FILE_SESSION_KEY);
  } catch {
    // Nothing else can be done when browser persistence is unavailable.
  }
}
