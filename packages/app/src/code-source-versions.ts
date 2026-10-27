import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface CodeSourceVersions {
  /** The source with every pending suggestion accepted. */
  proposed: string;
  /** The source with every pending suggestion rejected. */
  original: string;
  hasSuggestions: boolean;
  /** Comments or suggestions anchored in the source. */
  hasReview: boolean;
}

// Inside code blocks the editor keeps suggestions as literal CriticMarkup
// (only comment anchors become marks), so read the syntax as well as marks.
const literalCriticMarkupPattern =
  /\{\+\+([\s\S]*?)\+\+\}|\{--([\s\S]*?)--\}|\{~~([\s\S]*?)~>([\s\S]*?)~~\}|\{==([\s\S]*?)==\}|\{>>[\s\S]*?<<\}|\{(?:#[\w-]+|[a-z]+="[^"]*"(?:\s+[a-z]+="[^"]*")*)\}/g;

function resolveLiteralCriticMarkup(
  text: string,
  version: "proposed" | "original",
): { text: string; hasSuggestions: boolean; hasReview: boolean } {
  let hasSuggestions = false;
  let hasReview = false;

  const resolved = text.replace(
    literalCriticMarkupPattern,
    (
      match,
      addition?: string,
      deletion?: string,
      oldText?: string,
      newText?: string,
      highlighted?: string,
    ) => {
      if (addition !== undefined) {
        hasSuggestions = true;
        return version === "proposed" ? addition : "";
      }
      if (deletion !== undefined) {
        hasSuggestions = true;
        return version === "proposed" ? "" : deletion;
      }
      if (oldText !== undefined) {
        hasSuggestions = true;
        return version === "proposed" ? (newText ?? "") : oldText;
      }
      if (highlighted !== undefined) return highlighted;
      if (match.startsWith("{>>")) hasReview = true;
      return "";
    },
  );

  return {
    text: resolved,
    hasSuggestions,
    hasReview: hasReview || hasSuggestions,
  };
}

export function codeSourceVersions(node: ProseMirrorNode): CodeSourceVersions {
  let proposed = "";
  let original = "";
  let hasSuggestions = false;
  let hasReview = false;

  node.forEach((child) => {
    const text = child.text ?? "";
    const kind = child.marks.find((mark) => mark.type.name === "criticChange")
      ?.attrs.kind as string | undefined;
    if (kind) hasSuggestions = true;
    if (kind || child.marks.some((mark) => mark.type.name === "commentRef")) {
      hasReview = true;
    }

    if (kind !== "deletion" && kind !== "substitution-old") proposed += text;
    if (kind !== "addition" && kind !== "substitution-new") original += text;
  });

  const literalProposed = resolveLiteralCriticMarkup(proposed, "proposed");
  const literalOriginal = resolveLiteralCriticMarkup(original, "original");

  return {
    proposed: literalProposed.text,
    original: literalOriginal.text,
    hasSuggestions: hasSuggestions || literalProposed.hasSuggestions,
    hasReview: hasReview || literalProposed.hasReview,
  };
}
