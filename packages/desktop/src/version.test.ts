import fs from "node:fs";
import { describe, expect, it } from "vitest";

function versionOf(manifest: URL): string {
  return (JSON.parse(fs.readFileSync(manifest, "utf8")) as { version: string })
    .version;
}

describe("app version", () => {
  // The app reports its own package version (About Roughdraft, the update
  // check), so it must move with the root version the CLI prints.
  it("matches the Roughdraft release version", () => {
    expect(versionOf(new URL("../package.json", import.meta.url))).toBe(
      versionOf(new URL("../../../package.json", import.meta.url)),
    );
  });
});
