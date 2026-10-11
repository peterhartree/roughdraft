import { Check, CloudUpload, Link, Loader2, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
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
  commitAndPushLabel,
  type GitHubFileStatus,
  gitHubLinkLabel,
  gitHubLinkWorks,
} from "./github-file";
import { cn } from "./lib/utils";

const ICON_BUTTON_CLASS =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-stone-400 outline-none transition hover:bg-[#EEE9E1] hover:text-stone-600 focus-visible:ring-2 focus-visible:ring-stone-300/70 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 dark:focus-visible:ring-slate-600/70";

const PUSHED_CONFIRMATION_MS = 2000;

/**
 * The GitHub link, which shows a broken link when GitHub lacks the file, and,
 * when GitHub lacks the latest version, a button that commits the file and
 * pushes it.
 */
export function GitHubFileButtons({
  status,
  onCommitAndPush,
}: {
  status: GitHubFileStatus;
  onCommitAndPush: () => Promise<CommitAndPushResult>;
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
                <Link className="size-3.5" aria-hidden="true" />
              </a>
            ) : (
              <button
                type="button"
                data-testid="document-github-link"
                data-sync={status.sync}
                aria-disabled="true"
                className={cn(
                  ICON_BUTTON_CLASS,
                  "cursor-default text-stone-300 hover:bg-transparent hover:text-stone-400 dark:text-slate-600 dark:hover:bg-transparent dark:hover:text-slate-500",
                )}
                aria-label={label}
              >
                <Unlink className="size-3.5" aria-hidden="true" />
              </button>
            )
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <CommitAndPushButton status={status} onCommitAndPush={onCommitAndPush} />
    </>
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
