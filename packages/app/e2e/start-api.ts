import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../../server/src/index";

// Playwright must never touch the real Trash, so "trashed" files are moved
// into a scratch directory instead.
const fakeTrashDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "roughdraft-e2e-trash-"),
);

async function moveToFakeTrash(absolutePath: string): Promise<void> {
  const destination = path.join(
    fs.mkdtempSync(path.join(fakeTrashDir, "item-")),
    path.basename(absolutePath),
  );
  // copy + unlink rather than rename, since the temp directory may sit on a
  // different volume from the test fixtures.
  await fs.promises.copyFile(absolutePath, destination);
  await fs.promises.unlink(absolutePath);
}

await createServer(Number(process.env.API_PORT ?? 4317), undefined, {
  trashFile: moveToFakeTrash,
});
