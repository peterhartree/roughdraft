export interface Page {
  id: string;
  title: string;
  content: string;
  version?: string;
  modifiedAt?: number;
}

export interface MarkdownFileChangeEvent {
  path: string;
  exists: boolean;
  version: string | null;
}

export class MarkdownFileConflictError extends Error {
  current: Page;

  constructor(current: Page) {
    super("Markdown file changed on disk");
    this.name = "MarkdownFileConflictError";
    this.current = current;
  }
}

export class MarkdownFileNotFoundError extends Error {
  constructor(relativePath: string) {
    super(`Markdown file not found: ${relativePath}`);
    this.name = "MarkdownFileNotFoundError";
  }
}

export interface StoredAsset {
  markdownPath: string;
  previewUrl: string;
  mimeType: string;
}

export interface BackendInfo {
  kind: "local-files" | "local-storage" | "remote";
  label: string;
  detail: string;
  projectPath?: string;
  sessionId?: string;
  originPath?: string;
}

export interface StorageBackend {
  info: BackendInfo;
  canManageProjects: boolean;
  getMarkdownFile(relativePath: string): Promise<Page>;
  saveMarkdownFile(
    relativePath: string,
    content: string,
    expectedVersion?: string,
  ): Promise<Page | undefined>;
  watchMarkdownFile?(
    relativePath: string,
    onChange: (event: MarkdownFileChangeEvent) => void,
  ): () => void;
  saveAsset(file: File): Promise<StoredAsset>;
  resolveFileUrl(path: string): string | null;
  openProject(path: string): Promise<void>;
}
