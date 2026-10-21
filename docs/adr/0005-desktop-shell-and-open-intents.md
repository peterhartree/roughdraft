# 0005: Desktop shell and open intents

## Context

Roughdraft's browser launch does not have its own macOS application identity, so foregrounding a review requires finding a Chrome window. A cold desktop launch also creates a timing boundary: the CLI can request a document before the renderer's open-request event stream is connected.

## Decision

The personal fork packages the existing loopback-served React app in a thin Electron shell. Electron owns native windows, their stable identities and positions, app activation, managed-server target validation, renderer isolation, navigation restrictions, external-link handoff, and explicit local-file open entry points. It does not own document state or expose a privileged API to page code. A sandboxed preload handles user-initiated file drops and forwards only a resolved `.md` path to the trusted main process.

The desktop main process routes typed document-open intents. Native File menu actions, macOS document-open events and window file drops call it directly. CLI and browser handoff intents arrive through one server event stream, prioritised over legacy renderer connections. Browser-only deployments retain renderer event streams. The newest undelivered intent is retained during startup.

Each native window contains the existing local-file sidebar and editor. File > New Window (Command+Shift+N) creates an empty workspace; Command+N still creates a Markdown file. An open targets the window whose sidebar already contains that file, otherwise the originating window for menus and drops, or the most recently focused window for external opens. Main canonicalises paths for ownership while preserving each renderer's path spelling. Claims are synchronous, and sidebar snapshots release closed entries. This prevents duplicate editors across desktop windows; version-checked saves remain the data-integrity boundary.

The sandboxed preload exposes a narrow window/session interface: identity, document ownership, targeted opens, readiness and close preparation. IPC accepts only registered windows' main frames at the validated local origin. Window identity survives renderer reloads. Startup waits for restored sessions before routing external opens, with a bounded fallback for unavailable renderers.

Window metadata is saved atomically in Electron's user-data directory. Explicit window closure removes that workspace from the next restored set; closing the final window retains it for Dock reopening. App quit first asks every renderer to flush its pending save and check for conflicts. No window closes if any cannot prepare safely. Input is held during this check, and restored if closure is cancelled. Successful quit saves the whole window set and flushes Chromium storage.

## Consequences

Roughdraft has a stable macOS app identity while Markdown, CriticMarkup, autosave, conflict handling, and remote sessions remain in their existing packages. Cold opens survive renderer startup timing, and repeated requests have explicit last-request-wins behaviour.

The Electron runtime becomes a maintained dependency and must stay current. The renderer remains sandboxed with Node integration disabled, a restrictive Content Security Policy, loopback-only initial navigation, denied permissions, and no in-app navigation to external origins.

## What this explicitly does not mean

The shell is not a document database, vault, editor implementation, global shortcut daemon, or remote-content browser. The pending intent slot is not tab state. Chrome-style tabs, moving documents between windows and simultaneous editors for the same file require separate decisions.
