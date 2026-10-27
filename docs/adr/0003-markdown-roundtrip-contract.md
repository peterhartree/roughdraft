# 0003: Markdown Round-Trip Contract

## Context

Roughdraft renders Markdown through rich text and code editing surfaces. Accidental rewrites make reviews noisy and can damage documents.

## Decision

Roughdraft should preserve user-authored Markdown unless an edit requires a minimal, understandable serialization change. Frontmatter, local links, image paths, tables, task lists, code fences, inline code, raw supported HTML blocks, and CriticMarkup need explicit tests.

The rich-text editor serialises the whole document, so saving keeps the source text of every line the user did not edit (`preserveUneditedMarkdown`). The editor's output is compared, line by line, with its output for the unedited source, and only the changed lines replace source text. The result is saved only if it parses back to the same document; otherwise the editor's output is saved as it is. Edited lines still go through the serialiser, which therefore keeps thematic-break markers, soft line breaks, bare URLs and link paths as written.

Block-level raw HTML (a `<div>`, a sized `<img>`, an `<svg>` up to its closing tag, `<details>`, comments) has no rich-text node. Each such block is kept whole as a read-only, sanitised preview, so the editor can neither flatten it to its text nor rewrite it as Markdown. Markdown set off by blank lines between an opening and a closing tag stays editable.

A code fence keeps its whole info string, not only the language: ```` ```html live ```` and ```` ```ts title="a.ts" ```` save as written. The language picks the fence's view (a Mermaid diagram, a live HTML widget), and the rest only needs to survive.

## Consequences

Round-trip tests are part of the product contract. New Markdown support should add fixture coverage before broad parser refactors.

## What This Explicitly Does Not Mean

Roughdraft does not promise to preserve every byte of unsupported Markdown syntax, and it should not normalize documents just to make implementation easier.
