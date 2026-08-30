import { describe, expect, it } from "vitest";
import {
  criticMarkdownToEditorState,
  type CriticComment,
} from "../src/critic-markup";
import {
  buildCommentThreadRailItems,
  getCommentAnchorMeasurements,
  getRootThreadIdForCommentId,
  groupCommentAnchorMeasurements,
  normalizeCommentMeasurement,
  resolveAnchoredRailLayouts,
  resolveCommentRailLayouts,
  resolveCommentThreadRailLayouts,
} from "../src/document-comments";

function createCommentsMap(comments: CriticComment[]) {
  return new Map(comments.map((comment) => [comment.id, comment]));
}

describe("document comment layout helpers", () => {
  it("maps DOM anchor boxes to positions relative to the editor", () => {
    const measurements = getCommentAnchorMeasurements(
      [
        {
          dataset: {
            commentIds: JSON.stringify(["cmt-1"]),
          },
          getBoundingClientRect: () => ({
            top: 180,
            bottom: 212,
          }),
        },
      ],
      120,
    );

    expect(measurements).toEqual([
      {
        commentIds: ["cmt-1"],
        anchorTop: 60,
        anchorBottom: 92,
      },
    ]);
  });

  it("normalizes anchor positions with a scale factor", () => {
    const measurements = getCommentAnchorMeasurements(
      [
        {
          dataset: {
            commentIds: JSON.stringify(["cmt-zoom"]),
          },
          getBoundingClientRect: () => ({
            top: 220,
            bottom: 284,
          }),
        },
      ],
      100,
      2,
    );

    expect(measurements).toEqual([
      {
        commentIds: ["cmt-zoom"],
        anchorTop: 60,
        anchorBottom: 92,
      },
    ]);
    expect(normalizeCommentMeasurement(120, 0.5)).toBe(240);
  });

  it("groups multiple DOM spans that belong to the same anchored comments", () => {
    const grouped = groupCommentAnchorMeasurements([
      {
        commentIds: ["cmt-2", "cmt-3"],
        anchorTop: 40,
        anchorBottom: 54,
      },
      {
        commentIds: ["cmt-3", "cmt-2"],
        anchorTop: 58,
        anchorBottom: 74,
      },
      {
        commentIds: ["cmt-4"],
        anchorTop: 140,
        anchorBottom: 156,
      },
    ]);

    expect(grouped).toEqual([
      {
        key: "cmt-2::cmt-3",
        commentIds: ["cmt-2", "cmt-3"],
        anchorTop: 40,
        anchorBottom: 74,
      },
      {
        key: "cmt-4",
        commentIds: ["cmt-4"],
        anchorTop: 140,
        anchorBottom: 156,
      },
    ]);
  });

  it("pushes overlapping cards down the rail while keeping later gaps intact", () => {
    const layouts = resolveCommentRailLayouts(
      [
        {
          key: "cmt-5",
          commentIds: ["cmt-5"],
          anchorTop: 20,
          anchorBottom: 34,
        },
        {
          key: "cmt-6",
          commentIds: ["cmt-6"],
          anchorTop: 48,
          anchorBottom: 62,
        },
        {
          key: "cmt-7",
          commentIds: ["cmt-7"],
          anchorTop: 220,
          anchorBottom: 236,
        },
      ],
      {
        "cmt-5": 100,
        "cmt-6": 90,
        "cmt-7": 80,
      },
      16,
    );

    expect(
      layouts.map(({ key, railTop, railBottom }) => ({
        key,
        railTop,
        railBottom,
      })),
    ).toEqual([
      {
        key: "cmt-5",
        railTop: 20,
        railBottom: 120,
      },
      {
        key: "cmt-6",
        railTop: 136,
        railBottom: 226,
      },
      {
        key: "cmt-7",
        railTop: 242,
        railBottom: 322,
      },
    ]);
  });

  it("expands a shared anchor into one rail item per root thread", () => {
    const comments = createCommentsMap([
      {
        id: "c1",
        content: "First root",
        createdAt: "2026-04-24T00:00:00.000Z",
      },
      {
        id: "c2",
        content: "Second root",
        createdAt: "2026-04-24T00:00:01.000Z",
      },
      {
        id: "c3",
        content: "Reply",
        createdAt: "2026-04-24T00:00:02.000Z",
        parentCommentId: "c2",
      },
    ]);

    const items = buildCommentThreadRailItems(
      [
        {
          key: "c1::c2::c3",
          commentIds: ["c1", "c2", "c3"],
          anchorTop: 200,
          anchorBottom: 214,
        },
      ],
      comments,
    );

    expect(items).toEqual([
      {
        key: "c1",
        anchorGroupKey: "c1::c2::c3",
        rootCommentId: "c1",
        commentIds: ["c1"],
        anchorTop: 200,
        anchorBottom: 214,
      },
      {
        key: "c2",
        anchorGroupKey: "c1::c2::c3",
        rootCommentId: "c2",
        commentIds: ["c2", "c3"],
        anchorTop: 200,
        anchorBottom: 214,
      },
    ]);
  });

  it("includes endmatter-only replies in the rail thread for their root", () => {
    const input = [
      "Please revisit {==anchored==}{>>Original.<<}{#c1}.",
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: user",
      '    at: "2026-05-24T10:00:00.000Z"',
      "  c2:",
      "    body: Reply from endmatter.",
      "    by: AI",
      '    at: "2026-05-24T10:01:00.000Z"',
      "    re: c1",
      "",
    ].join("\n");

    const { comments } = criticMarkdownToEditorState(input);

    expect(comments.get("c2")).toMatchObject({
      id: "c2",
      content: "Reply from endmatter.",
      parentCommentId: "c1",
    });

    const items = buildCommentThreadRailItems(
      [
        {
          key: "c1",
          commentIds: ["c1"],
          anchorTop: 100,
          anchorBottom: 114,
        },
      ],
      comments,
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.commentIds).toEqual(["c1", "c2"]);
  });

  it("aligns the selected secondary root thread to the shared anchor", () => {
    const layouts = resolveCommentThreadRailLayouts(
      [
        {
          key: "c1",
          anchorGroupKey: "shared",
          rootCommentId: "c1",
          commentIds: ["c1"],
          anchorTop: 200,
          anchorBottom: 214,
        },
        {
          key: "c2",
          anchorGroupKey: "shared",
          rootCommentId: "c2",
          commentIds: ["c2"],
          anchorTop: 200,
          anchorBottom: 214,
        },
      ],
      {
        c1: 90,
        c2: 120,
      },
      "c2",
      16,
    );

    expect(
      layouts.map(({ key, railTop, railBottom }) => ({
        key,
        railTop,
        railBottom,
      })),
    ).toEqual([
      {
        key: "c1",
        railTop: 94,
        railBottom: 184,
      },
      {
        key: "c2",
        railTop: 200,
        railBottom: 320,
      },
    ]);
  });

  it("resolves reply selection to the parent root thread", () => {
    const comments = createCommentsMap([
      {
        id: "c1",
        content: "First root",
        createdAt: "2026-04-24T00:00:00.000Z",
      },
      {
        id: "c2",
        content: "Second root",
        createdAt: "2026-04-24T00:00:01.000Z",
      },
      {
        id: "c3",
        content: "Reply",
        createdAt: "2026-04-24T00:00:02.000Z",
        parentCommentId: "c2",
      },
    ]);

    expect(getRootThreadIdForCommentId("c3", comments)).toBe("c2");

    const layouts = resolveCommentThreadRailLayouts(
      buildCommentThreadRailItems(
        [
          {
            key: "c1::c2::c3",
            commentIds: ["c1", "c2", "c3"],
            anchorTop: 200,
            anchorBottom: 214,
          },
        ],
        comments,
      ),
      {
        c1: 90,
        c2: 120,
      },
      getRootThreadIdForCommentId("c3", comments),
      16,
    );

    expect(layouts.find((layout) => layout.key === "c2")?.railTop).toBe(200);
  });

  it("pushes neighboring threads outward from the active thread with the requested gap", () => {
    const layouts = resolveCommentThreadRailLayouts(
      [
        {
          key: "c1",
          anchorGroupKey: "g1",
          rootCommentId: "c1",
          commentIds: ["c1"],
          anchorTop: 120,
          anchorBottom: 134,
        },
        {
          key: "c2",
          anchorGroupKey: "g2",
          rootCommentId: "c2",
          commentIds: ["c2"],
          anchorTop: 180,
          anchorBottom: 194,
        },
        {
          key: "c3",
          anchorGroupKey: "g3",
          rootCommentId: "c3",
          commentIds: ["c3"],
          anchorTop: 220,
          anchorBottom: 234,
        },
      ],
      {
        c1: 70,
        c2: 110,
        c3: 80,
      },
      "c2",
      24,
    );

    expect(
      layouts.map(({ key, railTop, railBottom }) => ({
        key,
        railTop,
        railBottom,
      })),
    ).toEqual([
      {
        key: "c1",
        railTop: 86,
        railBottom: 156,
      },
      {
        key: "c2",
        railTop: 180,
        railBottom: 290,
      },
      {
        key: "c3",
        railTop: 314,
        railBottom: 394,
      },
    ]);
  });

  it("pins any selected rail item to its anchor", () => {
    const layouts = resolveAnchoredRailLayouts(
      [
        {
          key: "comment-1",
          anchorTop: 100,
          anchorBottom: 114,
          type: "comment",
        },
        {
          key: "suggestion-1",
          anchorTop: 140,
          anchorBottom: 154,
          type: "suggestion",
        },
        {
          key: "comment-2",
          anchorTop: 190,
          anchorBottom: 204,
          type: "comment",
        },
      ],
      {
        "comment-1": 90,
        "suggestion-1": 120,
        "comment-2": 70,
      },
      "suggestion-1",
      16,
    );

    expect(
      layouts.map(({ key, railTop, railBottom }) => ({
        key,
        railTop,
        railBottom,
      })),
    ).toEqual([
      {
        key: "comment-1",
        railTop: 34,
        railBottom: 124,
      },
      {
        key: "suggestion-1",
        railTop: 140,
        railBottom: 260,
      },
      {
        key: "comment-2",
        railTop: 276,
        railBottom: 346,
      },
    ]);
  });

  it("keeps active-neighboring threads visible when active alignment would go negative", () => {
    const layouts = resolveCommentThreadRailLayouts(
      [
        {
          key: "c1",
          anchorGroupKey: "shared",
          rootCommentId: "c1",
          commentIds: ["c1"],
          anchorTop: 80,
          anchorBottom: 94,
        },
        {
          key: "c2",
          anchorGroupKey: "shared",
          rootCommentId: "c2",
          commentIds: ["c2"],
          anchorTop: 80,
          anchorBottom: 94,
        },
      ],
      {
        c1: 100,
        c2: 120,
      },
      "c2",
      16,
    );

    expect(
      layouts.map(({ key, railTop, railBottom }) => ({
        key,
        railTop,
        railBottom,
      })),
    ).toEqual([
      {
        key: "c1",
        railTop: 0,
        railBottom: 100,
      },
      {
        key: "c2",
        railTop: 116,
        railBottom: 236,
      },
    ]);
  });
});
