import { criticMarkdownToRenderedHtml } from "./critic-markup";

export function markdownToPlainText(markdown: string) {
  const template = document.createElement("template");
  template.innerHTML = markdownToCleanRichHtml(markdown);
  return (template.content.textContent ?? "").trimEnd();
}

function unwrapElement(element: HTMLElement) {
  element.replaceWith(...element.childNodes);
}

export function markdownToCleanRichHtml(markdown: string) {
  const template = document.createElement("template");
  template.innerHTML = criticMarkdownToRenderedHtml(markdown).html;

  for (const element of Array.from(
    template.content.querySelectorAll<HTMLElement>(
      "[data-comment-anchorless='true']",
    ),
  )) {
    element.remove();
  }

  for (const element of Array.from(
    template.content.querySelectorAll<HTMLElement>("[data-comment-ids]"),
  )) {
    unwrapElement(element);
  }

  for (const element of Array.from(
    template.content.querySelectorAll<HTMLElement>(
      "[data-critic-change-kind='addition'], [data-critic-change-kind='substitution-new']",
    ),
  )) {
    element.remove();
  }

  for (const element of Array.from(
    template.content.querySelectorAll<HTMLElement>("[data-critic-change-kind]"),
  )) {
    unwrapElement(element);
  }

  return template.innerHTML;
}

// Writes HTML alongside plain text, so apps that accept formatting on paste
// (Slack, Google Docs, email) keep it. `plainText` overrides the text flavour.
export async function writeRichTextToClipboard(
  markdown: string,
  plainText = markdownToPlainText(markdown),
) {
  const clipboardWithRichText = navigator.clipboard as Clipboard & {
    write?: Clipboard["write"];
  };
  const html = markdownToCleanRichHtml(markdown);

  if (clipboardWithRichText.write && typeof ClipboardItem !== "undefined") {
    await clipboardWithRichText.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plainText], { type: "text/plain" }),
      }),
    ]);
    return;
  }

  await navigator.clipboard.writeText(plainText);
}
