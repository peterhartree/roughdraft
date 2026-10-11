import { Check, CloudDownload, CloudUpload, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { GitHubMark } from "./components/GitHubMark";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";
import {
  type CommitAndPushResult,
  canCommitAndPush,
  canUpdateFromGitHub,
  commitAndPushLabel,
  type GitHubFileStatus,
  gitHubLinkLabel,
  gitHubLinkWorks,
  updateFromGitHubLabel,
} from "./github-file";
import { cn } from "./lib/utils";

const ICON_BUTTON_CLASS =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-stone-400 outline-none transition hover:bg-[#EEE9E1] hover:text-stone-600 focus-visible:ring-2 focus-visible:ring-stone-300/70 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 dark:focus-visible:ring-slate-600/70";

const PUSHED_CONFIRMATION_MS = 2000;

/**
 * The GitHub link, crossed out when GitHub lacks the file; beside it, a
 * button that pulls GitHub's newer version when there is one, or else one
 * that commits and pushes this copy when GitHub lacks its latest version.
 */
export function GitHubFileButtons({
  status,
  onCommitAndPush,
  onUpdate,
  updatePending,
}: {
  status: GitHubFileStatus;
  onCommitAndPush: () => Promise<CommitAndPushResult>;
  onUpdate: () => void;
  updatePending: boolean;
}) {
  const label = gitHubLinkLabel(status);
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            gitHubLinkWorks(status) ? (
              <a
                href={status.url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="document-github-link"
                data-sync={status.sync}
                className={ICON_BUTTON_CLASS}
                aria-label={label}
              >
                <GitHubMark className="size-3.5" />
              </a>
            ) : (
              <button
                type="button"
                data-testid="document-github-link"
                data-sync={status.sync}
                aria-disabled="true"
                className={cn(
                  ICON_BUTTON_CLASS,
                  "cursor-default hover:bg-transparent hover:text-stone-400 dark:hover:bg-transparent dark:hover:text-slate-400",
                )}
                aria-label={label}
              >
                <GitHubMark className="size-3.5" crossed />
              </button>
            )
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      {canUpdateFromGitHub(status) || updatePending ? (
        <UpdateFromGitHubButton
          status={status}
          onUpdate={onUpdate}
          pending={updatePending}
        />
      ) : (
        <CommitAndPushButton
          status={status}
          onCommitAndPush={onCommitAndPush}
        />
      )}
    </>
  );
}

function UpdateFromGitHubButton({
  status,
  onUpdate,
  pending,
}: {
  status: GitHubFileStatus;
  onUpdate: () => void;
  pending: boolean;
}) {
  const label = pending
    ? "Updating from GitHub…"
    : updateFromGitHubLabel(status);
  const commits = status.remote?.commits ?? 0;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-testid="document-github-update-button"
            data-state={pending ? "pending" : "idle"}
            disabled={pending}
            className={cn(
              ICON_BUTTON_CLASS,
              "relative bg-blue-100 text-blue-700 hover:bg-blue-200 hover:text-blue-800 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900 dark:hover:text-blue-200",
            )}
            aria-label={label}
            onClick={onUpdate}
          >
            {pending ? (
              <Loader2
                className="size-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <CloudDownload className="size-3.5" aria-hidden="true" />
            )}
            {!pending && commits > 0 ? (
              <span
                aria-hidden="true"
                className="absolute -top-1 -right-1.5 grid h-3.5 min-w-3.5 place-items-center rounded-full border-2 border-[#FCFCFC] bg-blue-600 px-0.5 text-[0.55rem] leading-none font-bold text-white dark:border-background dark:bg-blue-500"
              >
                {commits}
              </span>
            ) : null}
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function CommitAndPushButton({
  status,
  onCommitAndPush,
}: {
  status: GitHubFileStatus;
  onCommitAndPush: () => Promise<CommitAndPushResult>;
}) {
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state !== "done") return;
    const timer = window.setTimeout(
      () => setState("idle"),
      PUSHED_CONFIRMATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [state]);

  if (state === "idle" && !error && !canCommitAndPush(status)) return null;

  const pending = state === "pending";
  const label = pending
    ? "Pushing to GitHub…"
    : state === "done"
      ? "Pushed to GitHub"
      : commitAndPushLabel(status);

  const push = async () => {
    if (state !== "idle" || !canCommitAndPush(status)) return;
    setError(null);
    setState("pending");
    const result = await onCommitAndPush();
    if (result.ok) {
      setState("done");
    } else {
      setState("idle");
      setError(result.error);
    }
  };

  return (
    <Popover
      open={error !== null}
      onOpenChange={(open) => {
        // The button pushes rather than opening the popover; the popover
        // only reports a failed push, and closes when dismissed.
        if (!open) setError(null);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  data-testid="document-github-push-button"
                  data-state={error ? "error" : state}
                  disabled={pending}
                  className={cn(
                    ICON_BUTTON_CLASS,
                    error &&
                      "text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300",
                  )}
                  aria-label={label}
                  onClick={() => void push()}
                >
                  {pending ? (
                    <Loader2
                      className="size-3.5 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : state === "done" ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : (
                    <CloudUpload className="size-3.5" aria-hidden="true" />
                  )}
                </button>
              }
            />
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        data-testid="document-github-push-error"
        role="alert"
        align="start"
        sideOffset={6}
        className="w-72 p-3 text-[0.75rem] leading-snug"
      >
        {error}
      </PopoverContent>
    </Popover>
  );
}
