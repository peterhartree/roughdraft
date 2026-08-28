export const DROPPED_MARKDOWN_IPC_CHANNEL = "roughdraft:open-dropped-markdown";

export function resolveDroppedMarkdownPath<T>(
  files: ArrayLike<T>,
  getPath: (file: T) => string,
): string | null {
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;

    const filePath = getPath(file);
    if (filePath.toLowerCase().endsWith(".md")) return filePath;
  }

  return null;
}
