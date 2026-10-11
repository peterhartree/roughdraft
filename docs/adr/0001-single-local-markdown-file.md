# 0001: Single Local Markdown File

## Context

Roughdraft's core workflow is opening one ordinary Markdown file from the local filesystem so a human and coding agents can review it together.

## Decision

Roughdraft treats a Markdown file path as the primary unit of work. The server resolves that file within local-file boundaries and the app edits the file directly.

## Consequences

The CLI and app should optimize for quick open, review, edit, save, and close flows. Features that require a project database, global index, or vault model need a separate decision.

## What This Explicitly Does Not Mean

This does not make Roughdraft a vault manager, note database, git client, desktop shell, or multi-document workspace.

ADR 0009 makes one narrow exception to "not a git client": linking a file to GitHub and, on request, committing and pushing that file.

## Clarification (2026-04-30): Remote Document Mode

The "single markdown file" unit of work is preserved when the file lives on a different machine than the Roughdraft server. Remote document mode (see `docs/plans/2026-04-30-001-feat-remote-document-mode-plan.md`) lets a CLI on a remote host register one markdown file with a hosted Roughdraft over HTTP/SSE; the server holds the bytes in memory for the duration of the session and never browses or indexes a remote filesystem. The user-facing invariant is the same: open one file, edit it, save it, close it.

The "local-file boundary" wording above should be read as the **resolved file boundary** — Roughdraft still resolves and operates on a single markdown file. Whether the bytes originate from local disk or from a CLI-owned session does not change the unit of work.

This clarification does not extend Roughdraft into a vault manager, note database, or multi-document workspace.
