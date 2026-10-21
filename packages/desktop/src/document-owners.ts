import fs from "node:fs";
import path from "node:path";

export interface DocumentOwner {
  windowId: string;
  path: string;
}

export type DocumentClaimResult =
  | { status: "claimed"; path: string }
  | { status: "owned"; windowId: string; path: string };

interface OwnershipRecord extends DocumentOwner {
  state: "pending" | "committed";
}

export function canonicalDocumentPath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);

  try {
    return fs.realpathSync.native(resolvedPath);
  } catch {
    try {
      const realParent = fs.realpathSync.native(path.dirname(resolvedPath));
      return path.join(realParent, path.basename(resolvedPath));
    } catch {
      return resolvedPath;
    }
  }
}

export class DocumentOwners {
  private readonly ownershipByPath = new Map<string, OwnershipRecord>();

  claim(windowId: string, filePath: string): DocumentClaimResult {
    const canonicalPath = canonicalDocumentPath(filePath);
    const existing = this.ownershipByPath.get(canonicalPath);
    if (existing) {
      if (existing.windowId === windowId) {
        return { status: "claimed", path: existing.path };
      }
      return {
        status: "owned",
        windowId: existing.windowId,
        path: existing.path,
      };
    }

    this.ownershipByPath.set(canonicalPath, {
      windowId,
      path: filePath,
      state: "pending",
    });
    return { status: "claimed", path: filePath };
  }

  find(filePath: string): DocumentOwner | null {
    const owner = this.ownershipByPath.get(canonicalDocumentPath(filePath));
    return owner ? { windowId: owner.windowId, path: owner.path } : null;
  }

  report(windowId: string, filePaths: string[]): void {
    const reportedPaths = new Set<string>();
    for (const filePath of filePaths) {
      const canonicalPath = canonicalDocumentPath(filePath);
      const owner = this.ownershipByPath.get(canonicalPath);
      if (owner?.windowId !== windowId) continue;

      owner.state = "committed";
      owner.path = filePath;
      reportedPaths.add(canonicalPath);
    }

    for (const [canonicalPath, owner] of this.ownershipByPath) {
      if (
        owner.windowId === windowId &&
        owner.state === "committed" &&
        !reportedPaths.has(canonicalPath)
      ) {
        this.ownershipByPath.delete(canonicalPath);
      }
    }
  }

  releasePending(windowId: string, filePath: string): void {
    const canonicalPath = canonicalDocumentPath(filePath);
    for (const [key, owner] of this.ownershipByPath) {
      if (
        owner.windowId === windowId &&
        owner.state === "pending" &&
        (key === canonicalPath || owner.path === filePath)
      )
        this.ownershipByPath.delete(key);
    }
  }

  release(windowId: string, filePath: string): void {
    const canonicalPath = canonicalDocumentPath(filePath);
    for (const [key, owner] of this.ownershipByPath) {
      if (
        owner.windowId === windowId &&
        (key === canonicalPath || owner.path === filePath)
      )
        this.ownershipByPath.delete(key);
    }
  }

  releaseWindow(windowId: string): void {
    for (const [canonicalPath, owner] of this.ownershipByPath) {
      if (owner.windowId === windowId) {
        this.ownershipByPath.delete(canonicalPath);
      }
    }
  }
}
