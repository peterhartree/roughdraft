import fs from "node:fs";
import path from "node:path";

export const NEW_MARKDOWN_FILE_NAME = "Untitled.md";

/**
 * The folder File > New starts in: the active document's, else the most
 * recently opened document's, else the fallback.
 */
export function newMarkdownFileDirectory(
  currentUrl: string,
  recentDocumentPaths: string[],
  fallbackDirectory: string,
): string {
  let activePath: string | null = null;
  try {
    activePath = new URL(currentUrl).searchParams.get("path")?.trim() || null;
  } catch {
    activePath = null;
  }

  const documentPath = [activePath, recentDocumentPaths[0]].find(
    (candidate): candidate is string =>
      typeof candidate === "string" && path.isAbsolute(candidate),
  );
  return documentPath ? path.dirname(documentPath) : fallbackDirectory;
}

/**
 * Creates an empty Markdown file at the path chosen in the save dialog and
 * returns it. The dialog has already confirmed replacing an existing file;
 * that file goes to the Trash rather than being overwritten.
 */
export async function createMarkdownFile(
  chosenPath: string,
  trashItem: (filePath: string) => Promise<void>,
): Promise<string> {
  const targetPath =
    path.extname(chosenPath).toLowerCase() === ".md"
      ? chosenPath
      : `${chosenPath}.md`;

  let existing: fs.Stats | null = null;
  try {
    existing = fs.lstatSync(targetPath);
  } catch {
    existing = null;
  }
  if (existing) {
    // Only the exact path the dialog asked about may be replaced.
    if (targetPath !== chosenPath || !existing.isFile()) {
      throw new Error(`${path.basename(targetPath)} already exists.`);
    }
    await trashItem(targetPath);
  }

  fs.writeFileSync(targetPath, "", { flag: "wx" });
  return targetPath;
}
