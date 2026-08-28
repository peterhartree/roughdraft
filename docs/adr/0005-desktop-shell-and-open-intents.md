# 0005: Desktop shell and open intents

## Context

Roughdraft's browser launch does not have its own macOS application identity, so foregrounding a review requires finding a Chrome window. A cold desktop launch also creates a timing boundary: the CLI can request a document before the renderer's open-request event stream is connected.

## Decision

The personal fork packages the existing loopback-served React app in a thin Electron shell. Electron owns one native window, app activation, managed-server target validation, renderer isolation, navigation restrictions, external-link handoff, and explicit local-file open entry points. It does not own document state or expose a privileged API to page code. A sandboxed preload handles user-initiated file drops and forwards only a resolved `.md` path to the trusted main process.

The CLI, native File menu, macOS document-open events, and window file drops send the same typed document-open intent to the existing Express server. The server delivers it to the current renderer when connected or retains only the newest undelivered intent until a renderer connects. The renderer opens that intent in the current window.

## Consequences

Roughdraft has a stable macOS app identity while Markdown, CriticMarkup, autosave, conflict handling, and remote sessions remain in their existing packages. Cold opens survive renderer startup timing, and repeated requests have explicit last-request-wins behaviour.

The Electron runtime becomes a maintained dependency and must stay current. The renderer remains sandboxed with Node integration disabled, a restrictive Content Security Policy, loopback-only initial navigation, denied permissions, and no in-app navigation to external origins.

## What this explicitly does not mean

The shell is not a document database, vault, editor implementation, global shortcut daemon, or remote-content browser. The pending intent slot is not tab state. A future tabs release requires a separate decision for per-tab identity, dirty/conflict state, close behaviour, and session persistence.
