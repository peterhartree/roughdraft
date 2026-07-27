import { describe, expect, it } from "vitest";
import { shouldAllowRendererPermission } from "./permission-policy.js";

const roughdraftOrigin = "http://localhost:7373";

describe("desktop renderer permission policy", () => {
  it("allows the validated Roughdraft renderer to write to the clipboard", () => {
    expect(
      shouldAllowRendererPermission({
        permission: "clipboard-sanitized-write",
        requestingOrigin: roughdraftOrigin,
        validatedOrigin: roughdraftOrigin,
        isMainFrame: true,
      }),
    ).toBe(true);
  });

  it.each([
    [
      "clipboard read",
      "clipboard-read",
      roughdraftOrigin,
      roughdraftOrigin,
      true,
    ],
    ["geolocation", "geolocation", roughdraftOrigin, roughdraftOrigin, true],
    [
      "a different port",
      "clipboard-sanitized-write",
      "http://localhost:7374",
      roughdraftOrigin,
      true,
    ],
    [
      "a lookalike host",
      "clipboard-sanitized-write",
      "http://localhost:7373.evil.example",
      roughdraftOrigin,
      true,
    ],
    [
      "a missing validated origin",
      "clipboard-sanitized-write",
      roughdraftOrigin,
      null,
      true,
    ],
    [
      "a subframe",
      "clipboard-sanitized-write",
      roughdraftOrigin,
      roughdraftOrigin,
      false,
    ],
  ])("denies %s", (_label, permission, requestingOrigin, validatedOrigin, isMainFrame) => {
    expect(
      shouldAllowRendererPermission({
        permission,
        requestingOrigin,
        validatedOrigin,
        isMainFrame,
      }),
    ).toBe(false);
  });
});
