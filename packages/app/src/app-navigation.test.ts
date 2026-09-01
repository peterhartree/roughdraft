import { afterEach, describe, expect, it } from "vitest";
import {
  PREVIEW_PATH,
  ROUGHDRAFT_FLAVORED_MARKDOWN_PATH,
  abbreviateDisplayPath,
  buildLocationForLinkedMarkdownDocument,
  formatOpenFileParentPath,
  getRequestedPathState,
  syncRequestedPathInUrl,
} from "./app-navigation";

describe("app navigation", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("reads absolute markdown paths from the path query parameter", () => {
    window.history.replaceState(
      null,
      "",
      "/?path=%2FUsers%2Fme%2F.claude%2Fplans%2Fexample.md",
    );

    expect(getRequestedPathState()).toEqual({
      rawPath: "/Users/me/.claude/plans/example.md",
      projectPath: "/Users/me/.claude/plans",
      documentPath: "example.md",
    });
  });

  it("keeps absolute paths in the path query parameter", () => {
    window.history.replaceState(null, "", "/");

    syncRequestedPathInUrl("/Users/me/.claude/plans/example.md");

    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe(
      "?path=%2FUsers%2Fme%2F.claude%2Fplans%2Fexample.md",
    );
  });

  it("does not treat reserved app pages as file paths", () => {
    window.history.replaceState(null, "", ROUGHDRAFT_FLAVORED_MARKDOWN_PATH);

    expect(getRequestedPathState()).toEqual({
      rawPath: null,
      projectPath: null,
      documentPath: null,
    });

    window.history.replaceState(null, "", PREVIEW_PATH);

    expect(getRequestedPathState()).toEqual({
      rawPath: null,
      projectPath: null,
      documentPath: null,
    });
  });

  it("builds Roughdraft routes for linked markdown documents", () => {
    window.history.replaceState(
      null,
      "",
      "/?path=%2FUsers%2Fme%2Fproject%2F.context%2Flocal-link-source.md",
    );

    expect(
      buildLocationForLinkedMarkdownDocument({
        projectPath: "/Users/me/project/.context",
        currentDocumentPath: "local-link-source.md",
        href: "local-link-target.md",
      }),
    ).toBe("/?path=%2FUsers%2Fme%2Fproject%2F.context%2Flocal-link-target.md");
  });

  it("resolves nested markdown links relative to the current document", () => {
    window.history.replaceState(null, "", "/");

    expect(
      buildLocationForLinkedMarkdownDocument({
        projectPath: "/Users/me/project",
        currentDocumentPath: "notes/source.md",
        href: "../index.md#summary",
      }),
    ).toBe("/?path=%2FUsers%2Fme%2Fproject%2Findex.md#summary");
  });

  it("leaves non-markdown links for the file resolver", () => {
    expect(
      buildLocationForLinkedMarkdownDocument({
        projectPath: "/Users/me/project",
        currentDocumentPath: "source.md",
        href: "diagram.png",
      }),
    ).toBeNull();
  });
});

describe("display path abbreviation", () => {
  it("abbreviates a known prefix in tilde form", () => {
    expect(abbreviateDisplayPath("~/Documents/Projects/work/p38")).toBe(
      "/work/p38",
    );
  });

  it("abbreviates the expanded home form of a known prefix", () => {
    expect(abbreviateDisplayPath("/Users/ph/Documents/Projects/work/p38")).toBe(
      "/work/p38",
    );
  });

  it("shows an abbreviated folder itself as a root path", () => {
    expect(abbreviateDisplayPath("~/Documents/Projects")).toBe("/");
  });

  it("applies the replacement of a later abbreviation entry", () => {
    expect(
      abbreviateDisplayPath("~/.agents/skills/chief-of-staff/references"),
    ).toBe("/chief-of-staff/references");
  });

  it("leaves paths without a known prefix unchanged", () => {
    expect(abbreviateDisplayPath("~/Documents/www/Tools")).toBe(
      "~/Documents/www/Tools",
    );
  });

  it("does not match a prefix that is not on a segment boundary", () => {
    expect(abbreviateDisplayPath("~/Documents/ProjectsArchive/work")).toBe(
      "~/Documents/ProjectsArchive/work",
    );
  });

  it("abbreviates the parent path shown for an open file", () => {
    expect(
      formatOpenFileParentPath("/Users/ph/Documents/Projects/work/p38/plan.md"),
    ).toBe("/work/p38");
  });

  it("keeps unabbreviated parent paths in home-collapsed form", () => {
    expect(formatOpenFileParentPath("/Users/ph/notes/plan.md")).toBe("~/notes");
  });
});
