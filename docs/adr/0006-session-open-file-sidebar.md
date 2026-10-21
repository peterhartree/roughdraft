# 0006: Persisted open-file sidebar

## Context

Roughdraft can receive document-open intents while its desktop renderer is already reviewing another file. Replacing the current document makes parallel agent output hard to notice and removes the user's ability to move between recently opened review files.

## Decision

The local-file renderer keeps a locally persisted list of Markdown files explicitly opened through its initial URL or later open intents. The list itself does not discover or index neighbouring files; browsing them is a separate sidebar section (see 0007).

The list is ordered by the time each file was opened, most recently opened first. A file's open time is stamped when it enters the list and refreshed when a later open intent targets it; selecting an already-open file in the sidebar or switcher does not reorder the list. Sessions stored before open times existed restore in their stored order. An incoming open intent immediately becomes the active document. When activation is blocked—a pending switch, or an unsaved, conflicted or unsavable current file—the intent stays queued unread until selected. The active path, ordered list and unread state are stored in browser-local storage. Desktop sessions use a separate key per stable native window; the first desktop session migrates the legacy shared key once. New windows start empty. Plain browser use retains its existing session key. On a normal app launch at the root URL, Roughdraft reopens the most recently active available file and restores the sidebar. If that file is unavailable, it tries the other stored files in order and removes unavailable entries. An explicit file URL still wins over the stored active path.

The active file retains its existing direct-to-disk editing, autosave, conflict and watcher lifecycle; switching files flushes pending edits first. `Command+1` through `Command+9` select visible positions. `Command+P` opens a filename switcher. Roughdraft does not claim `Command+Left` or `Command+Right`, preserving native text-editing navigation.

Each local file also keeps its editor selection and document scroll position. Switching by sidebar, numbered shortcut or filename switcher restores that position and returns keyboard focus to the editor. These per-file view states survive normal app restarts, but expire once the file has not been viewed for more than 12 hours; expired or incompatible editor-mode state resets to the normal opening position.

## Consequences

One renderer can move among multiple explicit file paths, including paths in different directories, without becoming a project browser or vault. Each restored desktop window retains its local-file session across normal app restarts for the same local app origin. Native bounds and the restored window set are governed by ADR 0005. Recent documents and pinned browsing preferences remain shared, and refresh across windows. Corrupt stored state is discarded, and storage failures do not block editing. Remote document sessions remain single-document because each session has a separate transport and save lifecycle.

Manually reordering entries, persisting editor mode or per-file draft/conflict state, combining remote sessions, or restoring across a changed local origin would require separate decisions.
