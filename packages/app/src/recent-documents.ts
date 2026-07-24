export interface RecentDocument {
  path: string;
  modifiedAt: number;
  lastViewedAt: number;
}

const RECENT_DOCUMENTS_KEY = "roughdraft.recent-documents.v1";
const MAX_RECENT_DOCUMENTS = 20;
const MAX_STORED_RECENT_DOCUMENTS_LENGTH = 100_000;
const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;

type RecentDocumentStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

function sortRecentDocuments(documents: RecentDocument[]) {
  return [...documents].sort(
    (left, right) =>
      right.lastViewedAt - left.lastViewedAt ||
      right.modifiedAt - left.modifiedAt ||
      left.path.localeCompare(right.path),
  );
}

function parseRecentDocuments(value: string): RecentDocument[] | null {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length > MAX_RECENT_DOCUMENTS) {
    return null;
  }

  const seenPaths = new Set<string>();
  const documents: RecentDocument[] = [];
  for (const candidate of parsed) {
    if (!candidate || typeof candidate !== "object") return null;
    const document = candidate as Record<string, unknown>;
    if (
      typeof document.path !== "string" ||
      !document.path.trim() ||
      seenPaths.has(document.path) ||
      typeof document.modifiedAt !== "number" ||
      !Number.isFinite(document.modifiedAt) ||
      Math.abs(document.modifiedAt) > MAX_DATE_TIMESTAMP ||
      typeof document.lastViewedAt !== "number" ||
      !Number.isFinite(document.lastViewedAt) ||
      Math.abs(document.lastViewedAt) > MAX_DATE_TIMESTAMP
    ) {
      return null;
    }

    seenPaths.add(document.path);
    documents.push({
      path: document.path,
      modifiedAt: document.modifiedAt,
      lastViewedAt: document.lastViewedAt,
    });
  }

  return sortRecentDocuments(documents);
}

export function readRecentDocuments(
  storage: RecentDocumentStorage,
): RecentDocument[] {
  try {
    const value = storage.getItem(RECENT_DOCUMENTS_KEY);
    if (!value) return [];
    if (value.length <= MAX_STORED_RECENT_DOCUMENTS_LENGTH) {
      const documents = parseRecentDocuments(value);
      if (documents) return documents;
    }
  } catch {
    // Invalid or inaccessible storage should never block Roughdraft startup.
  }

  try {
    storage.removeItem(RECENT_DOCUMENTS_KEY);
  } catch {
    // Nothing else can be done when browser persistence is unavailable.
  }
  return [];
}

export function writeRecentDocuments(
  storage: RecentDocumentStorage,
  documents: RecentDocument[],
): void {
  try {
    const seenPaths = new Set<string>();
    const uniqueDocuments = sortRecentDocuments(documents)
      .filter((document) => {
        if (seenPaths.has(document.path)) return false;
        seenPaths.add(document.path);
        return true;
      })
      .slice(0, MAX_RECENT_DOCUMENTS);
    storage.setItem(RECENT_DOCUMENTS_KEY, JSON.stringify(uniqueDocuments));
  } catch {
    // Opening files remains available if browser persistence is unavailable.
  }
}

export function touchRecentDocument(
  documents: RecentDocument[],
  file: Pick<RecentDocument, "path" | "modifiedAt">,
  viewedAt = Date.now(),
): RecentDocument[] {
  const latestStoredView = documents.reduce(
    (latest, document) => Math.max(latest, document.lastViewedAt),
    Number.NEGATIVE_INFINITY,
  );
  const lastViewedAt = Math.max(viewedAt, latestStoredView + 1);
  const remaining = documents.filter((document) => document.path !== file.path);

  return sortRecentDocuments([...remaining, { ...file, lastViewedAt }]).slice(
    0,
    MAX_RECENT_DOCUMENTS,
  );
}

export function removeRecentDocument(
  documents: RecentDocument[],
  path: string,
): RecentDocument[] {
  if (!documents.some((document) => document.path === path)) return documents;
  return documents.filter((document) => document.path !== path);
}
