import { describe, expect, it } from "vitest";
import {
  formatSectionLink,
  headingSlug,
  parseNoteLine,
  readDocumentNotes,
  withFrontmatterOf,
  writeDocumentNotes,
} from "./document-notes";

describe("readDocumentNotes", () => {
  it("reads a block of notes from the frontmatter", () => {
    const markdown =
      "---\ntitle: Memo\nnotes: |\n  First line\n\n  Second line\n---\n\n# Memo\n";

    expect(readDocumentNotes(markdown)).toEqual({
      status: "ok",
      notes: "First line\n\nSecond line",
    });
  });

  it("treats a document without frontmatter or notes as having none", () => {
    expect(readDocumentNotes("# Memo\n")).toEqual({ status: "ok", notes: "" });
    expect(readDocumentNotes("---\ntitle: Memo\n---\n\n# Memo\n")).toEqual({
      status: "ok",
      notes: "",
    });
  });

  it("reports frontmatter it cannot read instead of guessing", () => {
    expect(
      readDocumentNotes("---\ntitle: [unclosed\n---\n\nBody\n"),
    ).toMatchObject({ status: "unavailable" });
    expect(
      readDocumentNotes("---\nnotes:\n  - a\n---\n\nBody\n"),
    ).toMatchObject({
      status: "unavailable",
    });
  });
});

describe("writeDocumentNotes", () => {
  it("adds frontmatter to a document that has none", () => {
    expect(writeDocumentNotes("# Memo\n\nBody\n", "Check the claim")).toBe(
      "---\nnotes: |\n  Check the claim\n---\n\n# Memo\n\nBody\n",
    );
  });

  it("keeps every other frontmatter line as written", () => {
    const markdown =
      "---\ntitle:   'Memo'   # spacing kept\ntags: [a,b]\n---\n\n# Memo\n";

    expect(writeDocumentNotes(markdown, "One\n\nTwo")).toBe(
      "---\ntitle:   'Memo'   # spacing kept\ntags: [a,b]\nnotes: |\n  One\n\n  Two\n---\n\n# Memo\n",
    );
  });

  it("replaces existing notes in place", () => {
    const markdown =
      "---\nnotes: |\n  Old\n  notes\ntitle: Memo\n---\n\nBody\n";

    expect(writeDocumentNotes(markdown, "New")).toBe(
      "---\nnotes: |\n  New\ntitle: Memo\n---\n\nBody\n",
    );
  });

  it("removes the field, and frontmatter left empty, when notes are cleared", () => {
    expect(
      writeDocumentNotes(
        "---\ntitle: Memo\nnotes: |\n  Old\n---\n\nBody\n",
        "",
      ),
    ).toBe("---\ntitle: Memo\n---\n\nBody\n");
    expect(
      writeDocumentNotes("---\nnotes: |\n  Old\n---\n\nBody\n", "  \n"),
    ).toBe("Body\n");
  });

  it("round-trips notes with leading spaces, blank lines and section links", () => {
    const notes = "  indented first\n\n[§ 2. Cloud](#2-cloud) see this";
    const written = writeDocumentNotes("Body\n", notes);

    expect(readDocumentNotes(written)).toEqual({ status: "ok", notes });
  });

  it("leaves unreadable frontmatter alone", () => {
    const markdown = "---\ntitle: [unclosed\n---\n\nBody\n";

    expect(writeDocumentNotes(markdown, "Note")).toBe(markdown);
  });
});

describe("withFrontmatterOf", () => {
  it("swaps in the source's frontmatter, adding or removing it", () => {
    const withNotes = "---\nnotes: |\n  Hi\n---\n\nOld body\n";

    expect(withFrontmatterOf("Edited body\n", withNotes)).toBe(
      "---\nnotes: |\n  Hi\n---\n\nEdited body\n",
    );
    expect(withFrontmatterOf(withNotes, "Plain\n")).toBe("Old body\n");
  });
});

describe("section links", () => {
  it("slugs headings the way GitHub anchors them", () => {
    expect(headingSlug("2. Cloud providers as a control point")).toBe(
      "2-cloud-providers-as-a-control-point",
    );
    expect(headingSlug("What’s next?")).toBe("whats-next");
  });

  it("splits a note line into text and section links", () => {
    const link = formatSectionLink("1. Supply [chain]", "1-supply-chain");

    expect(link).toBe("[§ 1. Supply chain](#1-supply-chain)");
    expect(parseNoteLine(`Ask Ben ${link} today`)).toEqual([
      { type: "text", text: "Ask Ben " },
      { type: "section", label: "1. Supply chain", slug: "1-supply-chain" },
      { type: "text", text: " today" },
    ]);
  });
});
