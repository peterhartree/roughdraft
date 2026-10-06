import { joinPath } from "./app-navigation";

export interface MarkdownTreeFile {
  /** POSIX-style path relative to the listing root. */
  path: string;
  modifiedAt: number;
}

export interface MarkdownTreeListing {
  root: string;
  name: string;
  kind: "git" | "folder";
  files: MarkdownTreeFile[];
  truncated: boolean;
}

export interface FileBrowserFile {
  kind: "file";
  name: string;
  path: string;
  modifiedAt: number;
}

export interface FileBrowserDirectory {
  kind: "directory";
  name: string;
  path: string;
  children: FileBrowserNode[];
}

export type FileBrowserNode = FileBrowserFile | FileBrowserDirectory;

const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function sortChildren(directory: FileBrowserDirectory) {
  directory.children.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return nameCollator.compare(left.name, right.name);
  });
  for (const child of directory.children) {
    if (child.kind === "directory") sortChildren(child);
  }
}

/** Turns a flat server listing into a folders-first tree of absolute paths. */
export function buildFileBrowserTree(
  listing: MarkdownTreeListing,
): FileBrowserDirectory {
  const root: FileBrowserDirectory = {
    kind: "directory",
    name: listing.name,
    path: listing.root,
    children: [],
  };
  const directories = new Map<string, FileBrowserDirectory>([["", root]]);

  for (const file of listing.files) {
    const segments = file.path.split("/").filter(Boolean);
    const filename = segments.pop();
    if (!filename) continue;

    let parent = root;
    let relativeDirectory = "";
    for (const segment of segments) {
      relativeDirectory = relativeDirectory
        ? `${relativeDirectory}/${segment}`
        : segment;
      let directory = directories.get(relativeDirectory);
      if (!directory) {
        directory = {
          kind: "directory",
          name: segment,
          path: joinPath(listing.root, relativeDirectory),
          children: [],
        };
        directories.set(relativeDirectory, directory);
        parent.children.push(directory);
      }
      parent = directory;
    }

    parent.children.push({
      kind: "file",
      name: filename,
      path: joinPath(listing.root, file.path),
      modifiedAt: file.modifiedAt,
    });
  }

  sortChildren(root);
  return root;
}

export function isPathInside(directory: string, path: string) {
  const prefix = directory.endsWith("/") ? directory : `${directory}/`;
  return path.startsWith(prefix);
}

/**
 * The folders that must be expanded to reveal `filePath` under `root`,
 * from the root itself down to the file's parent.
 */
export function getRevealFolders(root: string, filePath: string): string[] {
  if (!isPathInside(root, filePath)) return [];

  const folders = [root];
  const segments = filePath
    .slice(root.length)
    .split("/")
    .filter(Boolean)
    .slice(0, -1);
  let current = root;
  for (const segment of segments) {
    current = joinPath(current, segment);
    folders.push(current);
  }
  return folders;
}

/**
 * Pinned roots shown below the current project. A pin that is the current
 * project is shown once, as the project.
 */
export function getPinnedRootsToShow(
  pinnedFolders: string[],
  projectRoot: string | null,
) {
  return pinnedFolders.filter((folder) => folder !== projectRoot);
}
