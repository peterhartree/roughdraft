import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "./components/ui/button";
import { cn } from "./lib/utils";
import {
  fetchUpdateProgress,
  startUpdate,
  type UpdateProgress,
  type UpdateStatus,
} from "./update-status";

interface UpdateNoticeProps {
  updateStatus: UpdateStatus;
  /** A smaller version for the sidebar. */
  compact?: boolean;
}

const progressPollMs = 1500;

export function UpdateNotice({ updateStatus, compact }: UpdateNoticeProps) {
  const [progress, setProgress] = useState<UpdateProgress>({ state: "idle" });

  // Pick up an update already running, for example one started in another
  // window.
  useEffect(() => {
    let cancelled = false;
    void fetchUpdateProgress().then((current) => {
      if (!cancelled && current?.state === "running") setProgress(current);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (progress.state !== "running") return;
    const timer = window.setInterval(() => {
      void fetchUpdateProgress().then((current) => {
        // No answer means the update has stopped the server to reinstall.
        if (current && current.state !== "idle") setProgress(current);
      });
    }, progressPollMs);
    return () => window.clearInterval(timer);
  }, [progress.state]);

  const handleUpdate = useCallback(async () => {
    setProgress({ state: "running", message: "Starting the update…" });
    setProgress(await startUpdate());
  }, []);

  if (progress.state === "done") return null;

  const running = progress.state === "running";

  return (
    <div
      className={cn(
        "rounded-2xl border border-amber-200 bg-amber-50/95 text-slate-900 dark:border-amber-700 dark:bg-amber-950/95 dark:text-slate-100",
        compact
          ? "mx-2 mb-2 rounded-lg p-2.5"
          : "p-4 shadow-[0_14px_34px_rgba(120,53,15,0.12)] backdrop-blur dark:shadow-[0_14px_34px_rgba(0,0,0,0.4)]",
      )}
      data-testid="update-notice"
    >
      <div
        className={cn(
          "font-semibold text-amber-700 uppercase dark:text-amber-400",
          compact
            ? "text-[0.62rem] tracking-[0.14em]"
            : "text-[0.68rem] tracking-[0.18em]",
        )}
      >
        Update available
      </div>
      <p
        className={cn(
          "mt-1 text-slate-700 dark:text-slate-300",
          compact ? "text-xs leading-5" : "text-sm leading-6",
        )}
      >
        Version {updateStatus.latestVersion} is out. You have{" "}
        {updateStatus.currentVersion}.
      </p>

      {running ? (
        <p
          className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-slate-600 dark:text-slate-300"
          role="status"
          data-testid="update-notice-progress"
        >
          <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin" />
          <span>
            {progress.message ?? "Updating…"} Roughdraft will close and reopen
            when it's ready.
          </span>
        </p>
      ) : null}

      {progress.state === "failed" ? (
        <p
          className="mt-2 text-xs leading-5 whitespace-pre-line text-red-700 dark:text-red-300"
          role="alert"
          data-testid="update-notice-error"
        >
          {progress.message ?? "The update failed."} Details are in
          ~/.roughdraft/update.log.
        </p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          data-testid="update-notice-button"
          size="sm"
          disabled={running}
          className="h-7 rounded-lg bg-slate-950 px-3 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          onClick={() => void handleUpdate()}
        >
          {running
            ? "Updating…"
            : progress.state === "failed"
              ? "Try again"
              : "Update"}
        </Button>
        {updateStatus.releaseUrl ? (
          <a
            href={updateStatus.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-xs text-slate-600 underline-offset-2 hover:underline dark:text-slate-300"
            data-testid="update-notice-release-link"
          >
            What's new
            <ArrowUpRight className="size-3" />
          </a>
        ) : null}
      </div>
    </div>
  );
}
