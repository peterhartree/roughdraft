import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentOwners } from "./document-owners.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createDirectory(): string {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-document-owners-")),
  );
  temporaryDirectories.push(directory);
  return directory;
}

describe("document ownership", () => {
  it("releases a superseded undelivered open without releasing a sidebar document", () => {
    const owners = new DocumentOwners();
    owners.claim("a", "/tmp/queued.md");
    owners.claim("a", "/tmp/open.md");
    owners.report("a", ["/tmp/open.md"]);
    owners.releasePending("a", "/tmp/queued.md");
    owners.releasePending("a", "/tmp/open.md");
    expect(owners.find("/tmp/queued.md")).toBeNull();
    expect(owners.find("/tmp/open.md")?.windowId).toBe("a");
  });
  it("routes using the sidebar's updated spelling after a rename through an alias", () => {
    const owners = new DocumentOwners();
    const directory = createDirectory();
    const filePath = path.join(directory, "draft.md");
    const aliasPath = path.join(directory, "alias.md");
    fs.writeFileSync(filePath, "# Draft\n");
    fs.symlinkSync(filePath, aliasPath);
    owners.claim("window-a", filePath);
    owners.report("window-a", [filePath]);
    owners.report("window-a", [aliasPath]);
    expect(owners.find(filePath)).toEqual({
      windowId: "window-a",
      path: aliasPath,
    });
  });
  it("reserves a path synchronously against competing windows", () => {
    const owners = new DocumentOwners();
    const filePath = path.join(createDirectory(), "draft.md");

    expect(owners.claim("window-a", filePath)).toEqual({
      status: "claimed",
      path: filePath,
    });
    expect(owners.claim("window-b", filePath)).toEqual({
      status: "owned",
      windowId: "window-a",
      path: filePath,
    });
    expect(owners.find(filePath)).toEqual({
      windowId: "window-a",
      path: filePath,
    });
  });

  it("uses one identity for a file and its symlink while preserving display spelling", () => {
    const owners = new DocumentOwners();
    const directory = createDirectory();
    const filePath = path.join(directory, "draft.md");
    const aliasPath = path.join(directory, "alias.md");
    fs.writeFileSync(filePath, "# Draft\n");
    fs.symlinkSync(filePath, aliasPath);

    owners.claim("window-a", aliasPath);

    expect(owners.claim("window-a", filePath)).toEqual({
      status: "claimed",
      path: aliasPath,
    });
    expect(owners.claim("window-b", filePath)).toEqual({
      status: "owned",
      windowId: "window-a",
      path: aliasPath,
    });
  });

  it("canonicalises a missing file through its real parent", () => {
    const owners = new DocumentOwners();
    const directory = createDirectory();
    const realParent = path.join(directory, "documents");
    const aliasParent = path.join(directory, "alias");
    fs.mkdirSync(realParent);
    fs.symlinkSync(realParent, aliasParent);
    const displayPath = path.join(aliasParent, "future.md");
    const realPath = path.join(realParent, "future.md");

    owners.claim("window-a", displayPath);

    expect(owners.find(realPath)).toEqual({
      windowId: "window-a",
      path: displayPath,
    });
  });

  it("retains a pending reservation across an older whole-list report", () => {
    const owners = new DocumentOwners();
    const directory = createDirectory();
    const existingPath = path.join(directory, "existing.md");
    const newPath = path.join(directory, "new.md");
    owners.claim("window-a", existingPath);
    owners.report("window-a", [existingPath]);
    owners.claim("window-a", newPath);

    owners.report("window-a", [existingPath]);

    expect(owners.find(newPath)).toEqual({
      windowId: "window-a",
      path: newPath,
    });
    expect(owners.claim("window-b", newPath)).toMatchObject({
      status: "owned",
      windowId: "window-a",
    });
  });

  it("releases committed claims omitted from a later report", () => {
    const owners = new DocumentOwners();
    const filePath = path.join(createDirectory(), "draft.md");
    owners.claim("window-a", filePath);
    owners.report("window-a", [filePath]);

    owners.report("window-a", []);

    expect(owners.find(filePath)).toBeNull();
    expect(owners.claim("window-b", filePath)).toEqual({
      status: "claimed",
      path: filePath,
    });
  });

  it("does not acquire paths from reports or steal another window's claim", () => {
    const owners = new DocumentOwners();
    const directory = createDirectory();
    const ownedPath = path.join(directory, "owned.md");
    const unclaimedPath = path.join(directory, "unclaimed.md");
    owners.claim("window-a", ownedPath);

    owners.report("window-b", [ownedPath, unclaimedPath]);

    expect(owners.find(ownedPath)).toEqual({
      windowId: "window-a",
      path: ownedPath,
    });
    expect(owners.find(unclaimedPath)).toBeNull();
  });

  it("rolls back a failed operation and releases every claim when a window closes", () => {
    const owners = new DocumentOwners();
    const directory = createDirectory();
    const pendingPath = path.join(directory, "pending.md");
    const committedPath = path.join(directory, "committed.md");
    const otherPath = path.join(directory, "other.md");
    owners.claim("window-a", pendingPath);
    owners.claim("window-a", committedPath);
    owners.report("window-a", [committedPath]);
    owners.claim("window-b", otherPath);

    owners.release("window-a", pendingPath);
    owners.releaseWindow("window-a");

    expect(owners.find(pendingPath)).toBeNull();
    expect(owners.find(committedPath)).toBeNull();
    expect(owners.find(otherPath)).toEqual({
      windowId: "window-b",
      path: otherPath,
    });
  });
});
