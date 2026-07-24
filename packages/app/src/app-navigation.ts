interface RequestedPathState {
  rawPath: string | null;
  projectPath: string | null;
  documentPath: string | null;
}

export type DocumentEditorViewMode = "rich-text" | "code";
export const ROUGHDRAFT_FLAVORED_MARKDOWN_PATH =
  "/roughdraft-flavored-markdown";
export const PREVIEW_PATH = "/preview";

function normalizePathSeparators(value: string) {
  return value.replace(/\\/g, "/");
}

export function isReservedAppPath(pathname: string) {
  const normalizedPathname = normalizePathSeparators(pathname);
  return [ROUGHDRAFT_FLAVORED_MARKDOWN_PATH, PREVIEW_PATH].includes(
    normalizedPathname,
  );
}

function getRawPathFromLocation(): string | null {
  const searchParams = new URLSearchParams(window.location.search);
  const queryPath = searchParams.get("path")?.trim();
  if (queryPath) return queryPath;

  const normalizedPathname = normalizePathSeparators(window.location.pathname);
  if (isReservedAppPath(normalizedPathname)) return null;

  if (normalizedPathname !== "/" && !normalizedPathname.startsWith("/api")) {
    const decodedPathname = decodeURIComponent(normalizedPathname);
    return decodedPathname.startsWith("/")
      ? decodedPathname
      : `/${decodedPathname}`;
  }

  return null;
}

export function getDocumentEditorViewModeFromLocation(
  fallbackMode: DocumentEditorViewMode,
): DocumentEditorViewMode {
  const searchParams = new URLSearchParams(window.location.search);
  const requestedMode = searchParams.get("editor");
  if (requestedMode === "rich-text" || requestedMode === "code") {
    return requestedMode;
  }
  return fallbackMode;
}

export function getRequestedPathState(): RequestedPathState {
  const rawPath = getRawPathFromLocation();
  return getRequestedPathStateForPath(rawPath);
}

export function getRequestedPathStateForPath(
  rawPath: string | null,
): RequestedPathState {
  if (!rawPath) {
    return { rawPath: null, projectPath: null, documentPath: null };
  }

  const normalizedPath = normalizePathSeparators(rawPath);
  if (!normalizedPath.toLowerCase().endsWith(".md")) {
    return { rawPath, projectPath: rawPath, documentPath: null };
  }

  const lastSlashIndex = Math.max(
    normalizedPath.lastIndexOf("/"),
    normalizedPath.lastIndexOf("\\"),
  );
  const projectPath =
    lastSlashIndex >= 0 ? rawPath.slice(0, lastSlashIndex) || "/" : ".";
  const documentPath = rawPath.slice(lastSlashIndex + 1);

  return { rawPath, projectPath, documentPath };
}

export function formatWorkspacePathForDisplay(path?: string | null) {
  const value = path?.trim();
  if (!value) return null;

  const normalizedPath = normalizePathSeparators(value);
  const collapsedHomePath = normalizedPath.replace(
    /^\/Users\/[^/]+(?=\/|$)/,
    "~",
  );
  return value.includes("\\")
    ? collapsedHomePath.replace(/\//g, "\\")
    : collapsedHomePath;
}

export function getPathLeaf(path?: string | null) {
  const value = path?.trim();
  if (!value) return null;

  const segments = value.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || value;
}

export function formatOpenFileParentPath(path: string) {
  const projectPath = getRequestedPathStateForPath(path).projectPath;
  return formatWorkspacePathForDisplay(projectPath) ?? projectPath ?? path;
}

export function joinPath(basePath: string, relativePath: string) {
  const separator = basePath.includes("\\") ? "\\" : "/";
  const normalizedBasePath = basePath.endsWith(separator)
    ? basePath.slice(0, -1)
    : basePath;

  return relativePath
    .split("/")
    .filter(Boolean)
    .reduce(
      (result, segment) => `${result}${separator}${segment}`,
      normalizedBasePath,
    );
}

function isExternalUrl(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//");
}

function linkedMarkdownPathParts(href: string) {
  const trimmedHref = href.trim();
  if (
    !trimmedHref ||
    isExternalUrl(trimmedHref) ||
    trimmedHref.startsWith("#")
  ) {
    return null;
  }

  const match = trimmedHref.match(/^([^?#]*)(?:\?[^#]*)?(#.*)?$/);
  const documentPath = match?.[1] ?? "";
  if (!documentPath.toLowerCase().endsWith(".md")) return null;

  return {
    documentPath,
    hash: match?.[2] ?? "",
  };
}

function fileUrlForAbsolutePath(absolutePath: string) {
  const normalizedPath = normalizePathSeparators(absolutePath);
  return new URL(`file://${encodeURI(normalizedPath)}`);
}

export function buildLocationForLinkedMarkdownDocument({
  projectPath,
  currentDocumentPath,
  href,
}: {
  projectPath?: string | null;
  currentDocumentPath?: string | null;
  href: string;
}): string | null {
  if (!projectPath || !currentDocumentPath) return null;

  const linkedPath = linkedMarkdownPathParts(href);
  if (!linkedPath) return null;

  const currentAbsolutePath = joinPath(projectPath, currentDocumentPath);
  const targetUrl = new URL(
    encodeURI(linkedPath.documentPath),
    fileUrlForAbsolutePath(currentAbsolutePath),
  );
  const targetPath = decodeURI(targetUrl.pathname);
  const url = new URL(window.location.href);

  url.pathname = "/";
  url.search = "";
  url.searchParams.set("path", targetPath);
  url.hash = linkedPath.hash;

  return `${url.pathname}${url.search}${url.hash}`;
}

function buildLocationForPath(path?: string | null) {
  const nextPath = path?.trim() || null;
  const url = new URL(window.location.href);

  if (nextPath) {
    if (!nextPath.startsWith("/") && !nextPath.includes("\\")) {
      url.pathname = nextPath.startsWith("/") ? nextPath : `/${nextPath}`;
      url.searchParams.delete("path");
    } else {
      url.pathname = "/";
      url.searchParams.set("path", nextPath);
    }
  } else {
    url.searchParams.delete("path");
    url.pathname = "/";
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildLocationForDocumentEditorViewMode(
  mode: DocumentEditorViewMode,
) {
  const url = new URL(window.location.href);
  url.searchParams.set("editor", mode);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function syncRequestedPathInUrl(path?: string | null) {
  const nextLocation = buildLocationForPath(path);
  const currentLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextLocation !== currentLocation) {
    window.history.replaceState(null, "", nextLocation);
  }
}
