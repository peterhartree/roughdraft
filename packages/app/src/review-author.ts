interface ReviewAuthor {
  authorType: "user" | "ai";
  authorId: string | null;
}

/**
 * Reads a review `by` label. Comments the app writes for the person
 * reviewing are labelled `user`; every other label belongs to an agent and
 * is kept, so `Claude` stays `Claude` rather than becoming `AI`.
 */
export function reviewAuthorFromBy(
  by: string | null | undefined,
): ReviewAuthor {
  const label = by?.trim() || "user";
  if (label.toLowerCase() === "user") {
    return { authorType: "user", authorId: label };
  }

  return {
    authorType: "ai",
    authorId: label.toUpperCase() === "AI" ? null : label,
  };
}

export function reviewAuthorToBy(author: Partial<ReviewAuthor>): string {
  return author.authorType === "ai"
    ? agentLabel(author.authorId)
    : author.authorId || "user";
}

/**
 * The display and `by` label for an AI author. Editor marks fill a missing
 * author id with `user`, which never names an agent, so it reads as `AI`.
 */
export function agentLabel(authorId: string | null | undefined): string {
  const label = authorId?.trim();
  return label && label.toLowerCase() !== "user" ? label : "AI";
}
