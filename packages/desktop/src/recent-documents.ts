import path from "node:path";

const MAX_RECENT_DOCUMENTS = 20;
const MAX_PATH_LENGTH = 4_096;

export interface RecentDocumentMenuEntry {
  label: string;
  path: string;
}

// The renderer owns the recent-documents list; accept only what the File menu
// can safely show and hand back to the native open path.
export function parseRecentDocumentPaths(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_RECENT_DOCUMENTS) return null;

  const paths: string[] = [];
  for (const candidate of value) {
    if (
      typeof candidate !== "string" ||
      candidate.length > MAX_PATH_LENGTH ||
      !path.isAbsolute(candidate) ||
      path.extname(candidate).toLowerCase() !== ".md"
    ) {
      return null;
    }
    if (!paths.includes(candidate)) paths.push(candidate);
  }

  return paths;
}

// Filenames alone, with the parent folder appended where two entries share a
// name, as macOS does in its own Open Recent menus.
export function createRecentDocumentMenuEntries(
  paths: string[],
): RecentDocumentMenuEntry[] {
  const nameCounts = new Map<string, number>();
  for (const filePath of paths) {
    const name = path.basename(filePath);
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  return paths.map((filePath) => {
    const name = path.basename(filePath);
    const label =
      (nameCounts.get(name) ?? 0) > 1
        ? `${name} — ${path.basename(path.dirname(filePath))}`
        : name;
    return { label, path: filePath };
  });
}
