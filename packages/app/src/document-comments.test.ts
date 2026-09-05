import { describe, expect, it } from "vitest";
import { criticMarkdownToRenderedHtml } from "./critic-markup";
import {
  buildCommentThreadRailItems,
  type CommentGroupAnchor,
  resolveAnchoredRailLayouts,
} from "./document-comments";

const DOCUMENT_WITH_ENDMATTER_REPLY = `# Draft

{==anchored text==}{>>Original comment.<<}{#c1}

---
comments:
  c1:
    by: user
    at: "2026-04-28T12:00:00.000Z"
  c2:
    body: A reply that lives only in the endmatter.
    by: AI
    at: "2026-04-28T12:05:00.000Z"
    re: c1
`;

function anchorGroupFor(commentIds: string[]): CommentGroupAnchor {
  return {
    key: commentIds.join(","),
    commentIds,
    anchorTop: 0,
    anchorBottom: 20,
  };
}

describe("buildCommentThreadRailItems", () => {
  it("renders a reply that exists only in the YAML endmatter", () => {
    const { comments } = criticMarkdownToRenderedHtml(
      DOCUMENT_WITH_ENDMATTER_REPLY,
    );

    // The anchor only knows about the inline marker, which is exactly the
    // situation the app writes itself when replying through the rail.
    const items = buildCommentThreadRailItems(
      [anchorGroupFor(["c1"])],
      comments,
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.rootCommentId).toBe("c1");
    expect(items[0]?.commentIds).toEqual(["c1", "c2"]);
  });

  it("does not duplicate a reply that is already anchored inline", () => {
    const { comments } = criticMarkdownToRenderedHtml(
      DOCUMENT_WITH_ENDMATTER_REPLY,
    );

    const items = buildCommentThreadRailItems(
      [anchorGroupFor(["c1", "c2"])],
      comments,
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.commentIds).toEqual(["c1", "c2"]);
  });
});

describe("resolveAnchoredRailLayouts", () => {
  it("keeps the active item pinned to its anchor even when items above overflow above the rail", () => {
    // Three comments anchored close together (heights of 120 need far more
    // room than the 20px between anchors), with the third (bottommost) item
    // active. A newly created comment near lots of existing comments is
    // exactly this shape: its own card should sit at its own anchor, not get
    // pushed down below the text it is attached to.
    const items = [
      { key: "a", anchorTop: 10, anchorBottom: 15 },
      { key: "b", anchorTop: 20, anchorBottom: 25 },
      { key: "c", anchorTop: 30, anchorBottom: 35 },
    ];
    const heights = { a: 120, b: 120, c: 120 };

    const layouts = resolveAnchoredRailLayouts(items, heights, "c");

    const active = layouts.find((layout) => layout.key === "c");
    expect(active?.railTop).toBe(30);

    // Items above the active item are allowed to overflow above the rail
    // (negative railTop) rather than shifting the active item down.
    const above = layouts.filter((layout) => layout.key !== "c");
    for (const layout of above) {
      expect(layout.railTop).toBeLessThan(0);
    }

    // Stack stays ordered and non-overlapping.
    const sorted = [...layouts].sort(
      (left, right) => left.railTop - right.railTop,
    );
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const current = sorted[index];
      const next = sorted[index + 1];
      expect(current && next && current.railBottom + 16 <= next.railTop).toBe(
        true,
      );
    }
  });
});
