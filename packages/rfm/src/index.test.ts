import { describe, expect, it } from "vitest";
import {
  appendRoughdraftDocumentComment,
  appendRoughdraftReply,
  extractRoughdraftReviewIndex,
  markRoughdraftResolved,
  nextRoughdraftCommentId,
  setRoughdraftReaction,
  validateRoughdraftMarkdown,
} from "./index";

function codes(markdown: string): string[] {
  return validateRoughdraftMarkdown(markdown).diagnostics.map(
    (diagnostic) => diagnostic.code,
  );
}

describe("validateRoughdraftMarkdown", () => {
  it("accepts valid comments, anchored comments, and suggestions", () => {
    const result = validateRoughdraftMarkdown(
      [
        'Please revisit {==this sentence==}{>>Needs a source.<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}.',
        'Add {++one concrete example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z"}.',
        'Use {~~rough~>specific~~}{id="s2" by="user" at="2026-04-28T12:07:00.000Z"} wording.',
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.summary).toMatchObject({
      comments: 1,
      suggestions: 2,
      legacyMetadata: 0,
    });
  });

  it("accepts root comments and suggestions backed by YAML endmatter", () => {
    const result = validateRoughdraftMarkdown(
      [
        "Please revisit {==this sentence==}{>>Needs a source.<<}{#c1}.",
        "Add {++one concrete example++}{#s1}.",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "suggestions:",
        "  s1:",
        "    by: AI",
        '    at: "2026-04-28T12:05:00.000Z"',
        "",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.summary).toMatchObject({
      comments: 1,
      suggestions: 1,
    });
  });

  it("does not validate CriticMarkup-looking text inside YAML endmatter bodies", () => {
    const result = validateRoughdraftMarkdown(
      [
        "Please revisit {==this sentence==}{>>Needs a source.<<}{#c1}.",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "  c2:",
        "    body: Contains {++not a live suggestion++} in the reply.",
        "    by: AI",
        '    at: "2026-04-28T12:05:00.000Z"',
        "    re: c1",
        "",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toMatchObject({
      comments: 2,
      suggestions: 0,
    });
  });

  it("reports the RFM 0.2 format version", () => {
    expect(validateRoughdraftMarkdown("").version).toBe("0.2");
  });

  it("reports a missing YAML endmatter entry for compact references", () => {
    expect(codes("{>>Needs metadata<<}{#c1}\n")).toContain(
      "missing-endmatter-entry",
    );
  });

  it("accepts body-only endmatter comments as document-level feedback", () => {
    const result = validateRoughdraftMarkdown(
      [
        "{>>Root<<}{#c1}",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "  c2:",
        "    body: Reply without parent",
        "    by: AI",
        '    at: "2026-04-28T12:01:00.000Z"',
        "",
      ].join("\n"),
    );

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({ comments: 2 });
  });

  it("ignores review markers inside fenced code blocks and inline code spans", () => {
    const result = validateRoughdraftMarkdown(
      [
        "```md",
        "This is {>>not a comment<<}.",
        "This is {++not a suggestion++}.",
        "```",
        "Literal `{>>not a comment<<}` text.",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toMatchObject({
      comments: 0,
      suggestions: 0,
    });
  });

  it("does not treat fenced YAML examples as invalid review endmatter", () => {
    const result = validateRoughdraftMarkdown(
      [
        "Doc",
        "",
        "```yaml",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "```",
        "",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toMatchObject({
      comments: 0,
      suggestions: 0,
    });
  });

  it("does not treat ordinary final comments sections as review endmatter without compact references", () => {
    const result = validateRoughdraftMarkdown(
      [
        "Release notes",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: docs",
        '    at: "not review metadata"',
        "",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toMatchObject({
      comments: 0,
      suggestions: 0,
    });
  });

  it("accepts document-level comments backed only by YAML endmatter", () => {
    const result = validateRoughdraftMarkdown(
      [
        "# Draft",
        "",
        "---",
        "comments:",
        "  c1:",
        "    body: Please address the risk section.",
        "    by: user",
        '    at: "2026-05-24T12:00:00.000Z"',
        "",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.summary).toMatchObject({
      comments: 1,
      suggestions: 0,
    });
  });

  it("reports missing canonical metadata attributes", () => {
    expect(codes("{>>Needs metadata<<}\n")).toEqual([
      "missing-metadata-id",
      "missing-metadata-by",
      "missing-metadata-at",
    ]);
  });

  it("reports invalid timestamps", () => {
    expect(
      codes('{>>Bad time<<}{id="c1" by="user" at="yesterday"}\n'),
    ).toContain("invalid-metadata-at");
  });

  it("reports unclosed review markers", () => {
    expect(codes("{++unfinished\n")).toEqual(["unclosed-addition"]);
    expect(codes("{--unfinished\n")).toEqual(["unclosed-deletion"]);
    expect(codes("{~~old text\n")).toEqual(["unclosed-substitution"]);
  });

  it("reports duplicate ids across comments and suggestions", () => {
    expect(
      codes(
        [
          '{>>First<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}',
          '{++Second++}{id="c1" by="user" at="2026-04-28T12:01:00.000Z"}',
        ].join("\n"),
      ),
    ).toContain("duplicate-id");
  });

  it("reports self replies as errors and missing reply targets as warnings", () => {
    const result = validateRoughdraftMarkdown(
      [
        '{>>Self<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z" re="c1"}',
        '{>>Missing parent<<}{id="c2" by="user" at="2026-04-28T12:01:00.000Z" re="missing"}',
      ].join("\n"),
    );

    expect(result.errors.map((diagnostic) => diagnostic.code)).toContain(
      "self-reply",
    );
    expect(result.warnings.map((diagnostic) => diagnostic.code)).toContain(
      "missing-reply-target",
    );
    expect(result.ok).toBe(false);
  });

  it("accepts legacy metadata with a warning", () => {
    const result = validateRoughdraftMarkdown(
      "{>>Legacy<<}{@id:c1; by:AI; at:2026-04-28T12:00:00.000Z@}\n",
    );

    expect(result.ok).toBe(true);
    expect(result.warnings.map((diagnostic) => diagnostic.code)).toEqual([
      "legacy-metadata",
    ]);
    expect(result.summary.legacyMetadata).toBe(1);
  });

  it("reports CRLF source locations with one-based line and column", () => {
    const result = validateRoughdraftMarkdown(
      "First line\r\n{>>Needs metadata<<}\r\n",
    );

    expect(result.errors[0]).toMatchObject({
      line: 2,
      column: 1,
    });
  });
});

describe("extractRoughdraftReviewIndex", () => {
  it("extracts comments, anchored comments, replies, and suggestions", () => {
    const index = extractRoughdraftReviewIndex(
      [
        'Please revisit {==this sentence==}{>>Needs a source.<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}.',
        '{>>I added one.<<}{id="c2" by="AI" at="2026-04-28T12:02:00.000Z" re="c1"}',
        'Add {++one concrete example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z"}.',
        'Use {~~rough~>specific~~}{id="s2" by="user" at="2026-04-28T12:07:00.000Z"} wording.',
      ].join("\n"),
    );

    expect(index.summary).toMatchObject({
      comments: 1,
      replies: 1,
      suggestions: 2,
      unresolved: 4,
    });
    expect(index.items.map((item) => [item.id, item.kind])).toEqual([
      ["c1", "comment"],
      ["c2", "reply"],
      ["s1", "suggestion"],
      ["s2", "suggestion"],
    ]);
    expect(index.items[0]).toMatchObject({
      anchorText: "this sentence",
      author: "user",
      line: 1,
      column: 35,
      text: "Needs a source.",
    });
    expect(index.items[3]).toMatchObject({
      suggestionKind: "substitution",
      originalText: "rough",
      replacementText: "specific",
    });
  });

  it("extracts equivalent review items from YAML endmatter metadata", () => {
    const index = extractRoughdraftReviewIndex(
      [
        "Please revisit {==this sentence==}{>>Needs a source.<<}{#c1}.",
        "Add {++one concrete example++}{#s1}.",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "  c2:",
        "    body: I added one.",
        "    by: AI",
        '    at: "2026-04-28T12:02:00.000Z"',
        "    re: c1",
        "suggestions:",
        "  s1:",
        "    by: AI",
        '    at: "2026-04-28T12:05:00.000Z"',
        "    status: resolved",
        "",
      ].join("\n"),
    );

    expect(index.summary).toMatchObject({
      comments: 1,
      replies: 1,
      suggestions: 1,
      unresolved: 2,
    });
    expect(index.items.map((item) => [item.id, item.kind])).toEqual([
      ["c1", "comment"],
      ["s1", "suggestion"],
      ["c2", "reply"],
    ]);
    expect(index.items[0]).toMatchObject({
      anchorText: "this sentence",
      author: "user",
      text: "Needs a source.",
    });
    expect(index.items[2]).toMatchObject({
      parentId: "c1",
      author: "AI",
      text: "I added one.",
    });
  });

  it("extracts document-level comments backed only by YAML endmatter", () => {
    const index = extractRoughdraftReviewIndex(
      [
        "# Draft",
        "",
        "---",
        "comments:",
        "  c1:",
        "    body: Please address the risk section.",
        "    by: user",
        '    at: "2026-05-24T12:00:00.000Z"',
        "",
      ].join("\n"),
    );

    expect(index.summary).toMatchObject({
      comments: 1,
      replies: 0,
      suggestions: 0,
      unresolved: 1,
    });
    expect(index.items[0]).toMatchObject({
      id: "c1",
      kind: "comment",
      parentId: null,
      author: "user",
      createdAt: "2026-05-24T12:00:00.000Z",
      text: "Please address the risk section.",
    });
  });

  it("does not extract CriticMarkup-looking text inside YAML endmatter bodies", () => {
    const index = extractRoughdraftReviewIndex(
      [
        "Please revisit {==this sentence==}{>>Needs a source.<<}{#c1}.",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "  c2:",
        "    body: Contains {++not a live suggestion++} in the reply.",
        "    by: AI",
        '    at: "2026-04-28T12:05:00.000Z"',
        "    re: c1",
        "",
      ].join("\n"),
    );

    expect(index.version).toBe("0.2");
    expect(index.summary).toMatchObject({
      comments: 1,
      replies: 1,
      suggestions: 0,
    });
    expect(index.items.map((item) => [item.id, item.kind])).toEqual([
      ["c1", "comment"],
      ["c2", "reply"],
    ]);
    expect(index.items[1]).toMatchObject({
      text: "Contains {++not a live suggestion++} in the reply.",
    });
  });

  it("preserves literal CriticMarkup inside inline code and fenced code blocks", () => {
    const index = extractRoughdraftReviewIndex(
      [
        "```md",
        '{>>not a comment<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}',
        "```",
        'Literal `{++not a suggestion++}{id="s1" by="AI" at="2026-04-28T12:01:00.000Z"}` text.',
      ].join("\n"),
    );

    expect(index.items).toEqual([]);
    expect(index.summary).toMatchObject({
      comments: 0,
      replies: 0,
      suggestions: 0,
      unresolved: 0,
    });
  });

  it("uses only the final YAML block as Roughdraft endmatter", () => {
    const index = extractRoughdraftReviewIndex(
      [
        "Intro",
        "",
        "---",
        "",
        "Please revisit {==this sentence==}{>>Needs a source.<<}{#c1}.",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "",
      ].join("\n"),
    );

    expect(index.items).toHaveLength(1);
    expect(index.items[0]).toMatchObject({
      id: "c1",
      author: "user",
    });
  });
});

describe("RFM mutation helpers", () => {
  it("appends a reply without rewriting unrelated Markdown", () => {
    const markdown =
      '# Plan\n\nKeep {==this claim==}{>>Needs proof<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"} as written.\n';

    const updated = appendRoughdraftReply(markdown, {
      parentId: "c1",
      id: "c2",
      author: "AI",
      at: "2026-04-28T12:10:00.000Z",
      message: "Added a citation in the next paragraph.",
    });

    expect(updated).toBe(
      '# Plan\n\nKeep {==this claim==}{>>Needs proof<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}{>>Added a citation in the next paragraph.<<}{id="c2" by="AI" at="2026-04-28T12:10:00.000Z" re="c1"} as written.\n',
    );
  });

  it("appends a reply to YAML endmatter without adding inline reply markup", () => {
    const markdown = [
      "# Plan",
      "",
      "Keep {==this claim==}{>>Needs proof<<}{#c1} as written.",
      "",
      "---",
      "workflow:",
      "  owner: editorial",
      "comments:",
      "  c1:",
      "    by: user",
      '    at: "2026-04-28T12:00:00.000Z"',
      "",
    ].join("\n");

    const updated = appendRoughdraftReply(markdown, {
      parentId: "c1",
      id: "c2",
      author: "AI",
      at: "2026-04-28T12:10:00.000Z",
      message: "Added a citation in the next paragraph.",
    });

    expect(updated).not.toContain("{>>Added a citation");
    expect(updated).toContain("workflow:\n  owner: editorial");
    expect(updated).toContain("body: Added a citation in the next paragraph.");
    expect(extractRoughdraftReviewIndex(updated).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "c2",
          kind: "reply",
          parentId: "c1",
        }),
      ]),
    );
  });

  it("appends a document-level comment to YAML endmatter with the next comment id", () => {
    const output = appendRoughdraftDocumentComment(
      [
        "# Draft",
        "",
        "Needs {==support==}{>>Add a source<<}{#c1}.",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "workflow:",
        "  owner: editorial",
        "",
      ].join("\n"),
      {
        message: "Please address the risk section.",
        author: "user",
        at: "2026-05-24T12:00:00.000Z",
      },
    );

    expect(output).toContain("workflow:\n  owner: editorial");
    expect(output).toContain("  c2:");
    expect(output).toContain("    body: Please address the risk section.");
    expect(output).toContain("    by: user");
    expect(output).toContain("    at: 2026-05-24T12:00:00.000Z");
  });

  it("rejects reply text that would close CriticMarkup early", () => {
    const markdown =
      '{>>Needs proof<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}\n';

    expect(() =>
      appendRoughdraftReply(markdown, {
        parentId: "c1",
        id: "c2",
        author: "AI",
        at: "2026-04-28T12:10:00.000Z",
        message: "This closes early <<} and corrupts the thread.",
      }),
    ).toThrow(/CriticMarkup close delimiter/);
  });

  it("marks a target resolved without changing unrelated markup", () => {
    const markdown =
      'Add {++one example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z"} and keep {>>open question<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z"}.\n';

    const updated = markRoughdraftResolved(markdown, {
      targetId: "s1",
      summary: "Accepted in draft.",
    });

    expect(updated).toBe(
      'Add {++one example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z" status="resolved" resolved="Accepted in draft."} and keep {>>open question<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z"}.\n',
    );
  });

  it("marks an endmatter-backed target resolved in YAML", () => {
    const markdown = [
      "Add {++one example++}{#s1}.",
      "",
      "---",
      "workflow:",
      "  owner: editorial",
      "suggestions:",
      "  s1:",
      "    by: AI",
      '    at: "2026-04-28T12:05:00.000Z"',
      "",
    ].join("\n");

    const updated = markRoughdraftResolved(markdown, {
      targetId: "s1",
      summary: "Accepted in draft.",
    });

    expect(updated).toContain("status: resolved");
    expect(updated).toContain("resolved: Accepted in draft.");
    expect(updated).toContain("workflow:\n  owner: editorial");
    expect(extractRoughdraftReviewIndex(updated).items[0]).toMatchObject({
      id: "s1",
      status: "resolved",
    });
  });
});

describe("comment reactions", () => {
  it("extracts an inline comment reaction", () => {
    const markdown =
      'Keep {>>open question<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z" reaction="up"}.\n';

    const comment = extractRoughdraftReviewIndex(markdown).items.find(
      (item) => item.id === "c1",
    );

    expect(comment?.reaction).toBe("up");
  });

  it("extracts an endmatter-backed comment reaction", () => {
    const markdown = [
      "Keep {>>open question<<}{#c1}.",
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: user",
      '    at: "2026-04-28T12:06:00.000Z"',
      "    reaction: clarify",
      "",
    ].join("\n");

    const comment = extractRoughdraftReviewIndex(markdown).items.find(
      (item) => item.id === "c1",
    );

    expect(comment?.reaction).toBe("clarify");
  });

  it("defaults reaction to null when absent and ignores invalid values", () => {
    const markdown =
      'Keep {>>q1<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z"} and {>>q2<<}{id="c2" by="user" at="2026-04-28T12:07:00.000Z" reaction="meh"}.\n';

    const index = extractRoughdraftReviewIndex(markdown);
    expect(index.items.find((item) => item.id === "c1")?.reaction).toBeNull();
    expect(index.items.find((item) => item.id === "c2")?.reaction).toBeNull();
  });

  it("tallies reactions in the review index summary", () => {
    const markdown =
      'Keep {>>q1<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z" reaction="up"} and {>>q2<<}{id="c2" by="user" at="2026-04-28T12:07:00.000Z" reaction="up"} and {>>q3<<}{id="c3" by="user" at="2026-04-28T12:08:00.000Z" reaction="clarify"} and {>>q4<<}{id="c4" by="user" at="2026-04-28T12:09:00.000Z"}.\n';

    expect(extractRoughdraftReviewIndex(markdown).summary.reactions).toEqual({
      up: 2,
      down: 0,
      clarify: 1,
    });
  });

  it("sets a reaction on an inline comment without changing unrelated markup", () => {
    const markdown =
      'Add {++one example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z"} and keep {>>open question<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z"}.\n';

    const updated = setRoughdraftReaction(markdown, {
      targetId: "c1",
      reaction: "down",
    });

    expect(updated).toBe(
      'Add {++one example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z"} and keep {>>open question<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z" reaction="down"}.\n',
    );
  });

  it("sets a reaction on an endmatter-backed comment in YAML", () => {
    const markdown = [
      "Keep {>>open question<<}{#c1}.",
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: user",
      '    at: "2026-04-28T12:06:00.000Z"',
      "",
    ].join("\n");

    const updated = setRoughdraftReaction(markdown, {
      targetId: "c1",
      reaction: "up",
    });

    expect(updated).toContain("reaction: up");
    expect(extractRoughdraftReviewIndex(updated).items[0]).toMatchObject({
      id: "c1",
      reaction: "up",
    });
  });

  it("clears a reaction when passed null", () => {
    const markdown =
      'Keep {>>open question<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z" reaction="up"}.\n';

    const updated = setRoughdraftReaction(markdown, {
      targetId: "c1",
      reaction: null,
    });

    expect(updated).not.toContain("reaction=");
    expect(extractRoughdraftReviewIndex(updated).items[0]?.reaction).toBeNull();
  });

  it("rejects reactions on suggestions", () => {
    const markdown =
      'Add {++one example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z"}.\n';

    expect(() =>
      setRoughdraftReaction(markdown, { targetId: "s1", reaction: "up" }),
    ).toThrow();
  });

  it("rejects an unknown reaction value", () => {
    const markdown =
      'Keep {>>open question<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z"}.\n';

    expect(() =>
      setRoughdraftReaction(markdown, {
        targetId: "c1",
        // @ts-expect-error invalid reaction
        reaction: "love",
      }),
    ).toThrow();
  });
});

describe("endmatter replies to inline-attribute parents", () => {
  const inlineParent =
    'Text {==anchor==}{>>Please fix<<}{id="c1" by="user" at="2026-10-07T08:22:07.186Z"} more.';
  const replyEntry = [
    "  c2:",
    "    body: Done.",
    "    by: Claude",
    '    at: "2026-10-07T09:00:00.000Z"',
    "    re: c1",
  ];
  const replyOnly = [
    "# Doc",
    "",
    inlineParent,
    "",
    "---",
    "comments:",
    ...replyEntry,
    "",
  ].join("\n");
  const stubParentAndReply = [
    "# Doc",
    "",
    inlineParent,
    "",
    "---",
    "comments:",
    "  c1:",
    "    by: user",
    '    at: "2026-10-07T08:22:07.186Z"',
    ...replyEntry,
    "",
  ].join("\n");

  it.each([
    ["endmatter holding only the reply", replyOnly],
    ["endmatter holding a parent stub and the reply", stubParentAndReply],
  ])("reads an endmatter reply to an inline-attribute comment (%s)", (_label, markdown) => {
    expect(validateRoughdraftMarkdown(markdown).summary.comments).toBe(2);
    expect(extractRoughdraftReviewIndex(markdown).items).toContainEqual(
      expect.objectContaining({
        id: "c2",
        kind: "reply",
        parentId: "c1",
        text: "Done.",
      }),
    );
  });

  it("does not treat a final horizontal rule followed by prose as endmatter", () => {
    const index = extractRoughdraftReviewIndex(
      ["# Doc", "", inlineParent, "", "---", "", "Closing remarks.", ""].join(
        "\n",
      ),
    );

    expect(index.items.map((item) => item.id)).toEqual(["c1"]);
  });

  it("does not treat final YAML without review keys as endmatter", () => {
    const markdown = [
      "# Doc",
      "",
      "Plain text.",
      "",
      "---",
      "title: x",
      "",
    ].join("\n");

    expect(extractRoughdraftReviewIndex(markdown).items).toHaveLength(0);
    expect(validateRoughdraftMarkdown(markdown).summary.comments).toBe(0);
  });

  it("does not treat a final comments list as review endmatter", () => {
    const markdown = [
      "# Doc",
      "",
      "Plain text.",
      "",
      "---",
      "comments:",
      "  - one",
      "  - two",
      "",
    ].join("\n");

    expect(extractRoughdraftReviewIndex(markdown).items).toHaveLength(0);
    expect(validateRoughdraftMarkdown(markdown).summary.comments).toBe(0);
  });
});

describe("review metadata that would otherwise be lost", () => {
  const inlineParent =
    'Text {==anchor==}{>>Please fix<<}{id="c1" by="user" at="2026-10-07T08:22:07.186Z"} more.';

  it("warns when a final review block is ignored because its reply is incomplete", () => {
    const result = validateRoughdraftMarkdown(
      [
        inlineParent,
        "",
        "---",
        "comments:",
        "  c2:",
        "    body: Done.",
        "    re: c1",
        "",
      ].join("\n"),
    );

    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "ignored-endmatter",
    ]);
    expect(result.summary.comments).toBe(1);
  });

  it("warns when a final review block holding a reply is not valid YAML", () => {
    const result = validateRoughdraftMarkdown(
      [
        inlineParent,
        "",
        "---",
        "comments:",
        "  c2:",
        "    body: Done: see intro",
        "   re: c1",
        "",
      ].join("\n"),
    );

    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "ignored-endmatter",
    ]);
  });

  it("counts inline and endmatter replies separately from root comments", () => {
    const result = validateRoughdraftMarkdown(
      [
        `${inlineParent}{>>Inline reply<<}{id="c2" by="AI" at="2026-10-07T09:00:00.000Z" re="c1"}`,
        "",
        "---",
        "comments:",
        "  c3:",
        "    body: Endmatter reply",
        "    by: Claude",
        '    at: "2026-10-07T09:05:00.000Z"',
        "    re: c1",
        "",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({ comments: 3, replies: 2 });
  });

  it("does not read a frontmatter block as endmatter", () => {
    const result = validateRoughdraftMarkdown(
      [
        "---",
        "title: Draft",
        "---",
        "",
        "Text {>>Needs a source<<}{#c1} more.",
        "",
      ].join("\n"),
    );

    expect(result.errors.map((error) => error.code)).toEqual([
      "missing-endmatter-entry",
    ]);
  });
});

describe("replying to inline comments", () => {
  const thread =
    'Text {==anchor==}{>>Please fix<<}{id="c1" by="user" at="2026-10-07T08:22:07.186Z"}{>>First reply<<}{id="c2" by="AI" at="2026-10-07T09:00:00.000Z" re="c1"} more.\n';

  it("adds a new inline reply after the existing replies", () => {
    const updated = appendRoughdraftReply(thread, {
      parentId: "c1",
      message: "Second reply",
      author: "Claude",
      at: "2026-10-07T10:00:00.000Z",
    });

    expect(
      extractRoughdraftReviewIndex(updated).items.map((item) => item.text),
    ).toEqual(["Please fix", "First reply", "Second reply"]);
    expect(updated).toContain(
      '{>>Second reply<<}{id="c3" by="Claude" at="2026-10-07T10:00:00.000Z" re="c1"} more.',
    );
  });

  it("does not reuse an id that exists only as an endmatter key", () => {
    const markdown = [
      'Text {>>Please fix<<}{id="c1" by="user" at="2026-10-07T08:22:07.186Z"}',
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: user",
      '    at: "2026-10-07T08:22:07.186Z"',
      "  c4:",
      "    body: Overall note",
      "    by: user",
      '    at: "2026-10-07T08:30:00.000Z"',
      "  c7:",
      "    by: user",
      '    at: "2026-10-07T08:31:00.000Z"',
      "",
    ].join("\n");

    expect(nextRoughdraftCommentId(markdown)).toBe("c8");
  });
});

// The app saves a multi-paragraph root comment as an empty inline marker plus
// an endmatter `body`, because blank lines cannot live inside `{>>…<<}`. The
// endmatter body is that comment's text, not a second comment with the same id.
describe("endmatter bodies for inline comment markers", () => {
  const foldedBody = [
    "# Draft",
    "",
    "Intro {==anchor text==}{>><<}{#c1} more.",
    "",
    "---",
    "comments:",
    "  c1:",
    "    by: user",
    "    at: 2026-10-21T06:59:17.559Z",
    "    body: >-",
    "      First paragraph line one",
    "      continues here.",
    "",
    "",
    "      Second paragraph.",
    "",
  ].join("\n");

  const literalBody = [
    "# Draft",
    "",
    "Intro {==anchor text==}{>><<}{#c1} more.",
    "",
    "---",
    "comments:",
    "  c1:",
    "    by: user",
    "    at: 2026-10-21T06:59:17.559Z",
    "    body: |-",
    "      See the source:",
    "",
    "      https://example.com/report?page=2#methods",
    "",
  ].join("\n");

  it("reads a folded multi-paragraph body as the anchored comment's text", () => {
    const index = extractRoughdraftReviewIndex(foldedBody);

    expect(index.items).toHaveLength(1);
    expect(index.items[0]).toMatchObject({
      id: "c1",
      kind: "comment",
      parentId: null,
      author: "user",
      anchorText: "anchor text",
      line: 3,
      // Folded scalar: line breaks join with a space; the two blank lines
      // the app writes between paragraphs decode to "\n\n".
      text: "First paragraph line one continues here.\n\nSecond paragraph.",
    });
  });

  it("reads a literal multi-paragraph body as the anchored comment's text", () => {
    const index = extractRoughdraftReviewIndex(literalBody);

    expect(index.items).toHaveLength(1);
    expect(index.items[0]).toMatchObject({
      id: "c1",
      kind: "comment",
      anchorText: "anchor text",
      line: 3,
      text: "See the source:\n\nhttps://example.com/report?page=2#methods",
    });
  });

  it.each([
    ["folded", foldedBody],
    ["literal", literalBody],
  ])("validates a %s endmatter body without a duplicate id", (_, markdown) => {
    const result = validateRoughdraftMarkdown(markdown);

    expect(codes(markdown)).not.toContain("duplicate-id");
    expect(result.ok).toBe(true);
    expect(result.summary.comments).toBe(1);
  });

  it("keeps one item per id across a root body and an endmatter reply thread", () => {
    const markdown = [
      "Intro {==anchor text==}{>><<}{#c1} more.",
      "",
      "Later {==a==}{>>Short<<}{#c6} end.",
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: user",
      "    at: 2026-10-21T06:59:17.559Z",
      "    body: >-",
      "      Root first paragraph.",
      "",
      "",
      "      Root second paragraph.",
      "  c6:",
      "    by: user",
      "    at: 2026-10-21T07:00:00.000Z",
      "  c7:",
      "    body: Fixed it.",
      "    by: Claude",
      "    at: 2026-10-21T07:05:00.000Z",
      "    re: c6",
      "  c8:",
      "    body: >-",
      "      Thanks. One more",
      "      thing.",
      "",
      "",
      "      Second point.",
      "    by: user",
      "    at: 2026-10-21T07:10:00.000Z",
      "    re: c7",
      "",
    ].join("\n");

    const index = extractRoughdraftReviewIndex(markdown);
    const byId = new Map(index.items.map((item) => [item.id, item]));

    expect(index.items.map((item) => item.id).sort()).toEqual([
      "c1",
      "c6",
      "c7",
      "c8",
    ]);
    expect(byId.get("c1")).toMatchObject({
      kind: "comment",
      anchorText: "anchor text",
      line: 1,
      text: "Root first paragraph.\n\nRoot second paragraph.",
    });
    expect(byId.get("c6")).toMatchObject({ kind: "comment", text: "Short" });
    expect(byId.get("c7")).toMatchObject({ kind: "reply", parentId: "c6" });
    expect(byId.get("c8")).toMatchObject({
      kind: "reply",
      parentId: "c7",
      text: "Thanks. One more thing.\n\nSecond point.",
    });

    const result = validateRoughdraftMarkdown(markdown);
    expect(result.ok).toBe(true);
    expect(codes(markdown)).not.toContain("duplicate-id");
    expect(result.summary.replies).toBe(2);
  });

  it("treats an endmatter body equal to the inline text as the same comment", () => {
    const markdown = [
      "Intro {==anchor==}{>>Same<<}{#c2} more.",
      "",
      "---",
      "comments:",
      "  c2:",
      "    body: Same",
      "    by: user",
      "    at: 2026-10-21T07:00:00.000Z",
      "",
    ].join("\n");

    expect(extractRoughdraftReviewIndex(markdown).items).toMatchObject([
      { id: "c2", kind: "comment", anchorText: "anchor", text: "Same" },
    ]);
    expect(codes(markdown)).not.toContain("duplicate-id");
    expect(validateRoughdraftMarkdown(markdown).ok).toBe(true);
  });

  it("keeps inline text over a conflicting endmatter body and warns", () => {
    const markdown = [
      "Intro {==anchor==}{>>Inline wins<<}{#c3} more.",
      "",
      "---",
      "comments:",
      "  c3:",
      "    body: Stale body",
      "    by: user",
      "    at: 2026-10-21T07:00:00.000Z",
      "    re: c1",
      "",
    ].join("\n");

    // Matches the app: a `re` beside a body that differs from the inline text
    // is left over from an earlier comment that used this id, so it is ignored.
    expect(extractRoughdraftReviewIndex(markdown).items).toMatchObject([
      { id: "c3", kind: "comment", parentId: null, text: "Inline wins" },
    ]);

    const result = validateRoughdraftMarkdown(markdown);
    expect(result.ok).toBe(true);
    expect(result.errors.map((error) => error.code)).not.toContain(
      "duplicate-id",
    );
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "conflicting-comment-body",
    );
  });

  it("warns about an empty inline marker whose endmatter entry has no body", () => {
    const markdown = [
      "Intro {==x==}{>><<}{#c9} more.",
      "",
      "---",
      "comments:",
      "  c9:",
      "    by: user",
      "    at: 2026-10-21T07:00:00.000Z",
      "",
    ].join("\n");

    const result = validateRoughdraftMarkdown(markdown);
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "empty-comment",
    );
    expect(result.errors.map((error) => error.code)).not.toContain(
      "empty-comment",
    );
  });
});
