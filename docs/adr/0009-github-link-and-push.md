# 0009: GitHub link and commit-and-push

## Context

Many reviewed files live in git repositories hosted on GitHub. Reviewers want to hand someone the file's GitHub page, and to publish their edits there, without leaving Roughdraft for a terminal. ADR 0001 says Roughdraft is not a git client; this decision makes a narrow, explicit exception.

## Decision

**Link.** When the active local file is inside a git repository whose `origin` remote is on `github.com`, the document toolbar shows a link to the file's GitHub page on the checked-out branch (under its origin name when it tracks one; origin's default branch or the commit when HEAD is detached). When GitHub lacks the file—never committed, committed but not pushed, or the branch not pushed—or git ignores it, the link is shown broken and says why instead of leading to a 404. In the desktop app the link opens in the default browser.

**Commit and push.** When GitHub lacks the file or has an older version of it, a button commits that file alone and pushes the current branch to `origin`. It acts only when clicked: autosave never commits or pushes. Pending edits are saved first, and an unresolved disk change or conflict blocks it. The commit includes only this file's changes, leaving anything else that is staged uncommitted, with the message `docs: update <repo-relative path>`. The push sends the whole branch, so the button names how many earlier unpushed commits go with it; a branch without an upstream gets `origin` as its upstream. Roughdraft never fetches, pulls, merges, rebases or force-pushes: a rejected push keeps the commit and asks the reviewer to pull.

The server runs `git` itself, without a shell, using the user's own git configuration, credentials and hooks. Sync state compares the file with origin's remote-tracking branch as of the last fetch.

## Consequences

Roughdraft can publish one reviewed file to GitHub, but it is still not a git client: no history, diffs, branches, staging, fetching, pulling, merging or conflict resolution, and no other hosts. Sync state can be stale until something else fetches. Credential prompts cannot be answered from Roughdraft; a push that needs one fails and says so.

Like the other local-file endpoints, the link and push endpoints accept any absolute `.md` path and are not covered by the remote-document token.
