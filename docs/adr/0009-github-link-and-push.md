# 0009: GitHub link, commit-and-push and updates from GitHub

## Context

Many reviewed files live in git repositories hosted on GitHub. Reviewers want to hand someone the file's GitHub page, to publish their edits there, and to read the latest version when a colleague has pushed one, without leaving Roughdraft for a terminal. ADR 0001 says Roughdraft is not a git client; this decision makes a narrow, explicit exception.

## Decision

**Link.** When the active local file is inside a git repository whose `origin` remote is on `github.com`, the document toolbar shows a link to the file's GitHub page on the checked-out branch (under its origin name when it tracks one; origin's default branch or the commit when HEAD is detached). When GitHub lacks the file—never committed, committed but not pushed, or the branch not pushed—or git ignores it, the link is shown crossed out and says why instead of leading to a 404. In the desktop app the link opens in the default browser.

**Checking GitHub.** Opening a file and refocusing the window fetch the checked-out branch from `origin`, at most once every 15 seconds per branch. Saving compares with the last fetch without the network. The file is `behind` when GitHub has changes to it that this copy lacks, `changed` when this copy has changes GitHub lacks, and `diverged` when both do; GitHub commits that touch only other files leave the file in sync.

**Updating from GitHub.** When GitHub has a newer version, a banner under the toolbar says who changed the file and when, links to the changes on GitHub, and offers the update; "Not now" hides it until GitHub's branch moves again. After an update, the passages it changed are marked in the rich-text view.

- **Automatically**, without asking, only when this copy has no changes of its own to the file, the branch can fast-forward, and the check followed opening the file or refocusing the window; never while typing or after a save. A fast-forward that git refuses, for example because uncommitted changes to another file would be overwritten, falls back to the banner.
- **On request**, the update fast-forwards, or merges when the branch has its own commits, carrying uncommitted edits across with git's autostash. Before changing anything it merges in memory, both the commits and any uncommitted edits to files GitHub also changed; if anything would clash it refuses and changes nothing, so conflict markers never reach a file.

**Commit and push.** When GitHub lacks the file or has an older version of it, a button commits that file alone and pushes the current branch to `origin`. It acts only when clicked: autosave never commits or pushes. Pending edits are saved first, and an unresolved disk change or conflict blocks it. The commit includes only this file's changes, leaving anything else that is staged uncommitted, with the message `docs: update <repo-relative path>`. If GitHub has commits this copy lacks, they are brought in first in the same checked way as an update; if they clash, the commit is kept and nothing is pushed. The push sends the whole branch, so the button names how many earlier unpushed commits go with it; a branch without an upstream gets `origin` as its upstream.

Roughdraft never rebases, force-pushes, discards changes or leaves a merge half done. The server runs `git` itself, without a shell, using the user's own git configuration, credentials and hooks.

## Consequences

Roughdraft can keep one reviewed file in step with GitHub, but it is still not a git client: no history, branches, staging or conflict resolution, and no other hosts. Clashing changes must be resolved in a terminal or another tool. An update moves the whole branch, so other files in the repository change too. Opening a file can start a network fetch; offline or failed fetches leave the last known state in place. Credential prompts cannot be answered from Roughdraft; a fetch or push that needs one fails and says so.

Like the other local-file endpoints, the link, push and update endpoints accept any absolute `.md` path and are not covered by the remote-document token.
