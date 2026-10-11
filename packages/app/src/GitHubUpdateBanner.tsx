import {
  CircleCheck,
  CloudDownload,
  ExternalLink,
  GitCompareArrows,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "./components/ui/button";
import type { GitHubBannerCopy } from "./github-file";
import { cn } from "./lib/utils";

const TONE_CLASS = {
  info: "border-blue-300 bg-blue-50 text-blue-950 shadow-[0_10px_30px_rgba(30,58,138,0.10)] dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100",
  warning:
    "border-amber-300 bg-amber-50 text-amber-950 shadow-[0_10px_30px_rgba(120,53,15,0.12)] dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100",
} as const;

const DETAIL_CLASS = {
  info: "text-blue-900/80 dark:text-blue-200",
  warning: "text-amber-900 dark:text-amber-200",
} as const;

const SECONDARY_BUTTON_CLASS =
  "h-8 rounded-[7px] bg-white/60 px-2 text-xs text-inherit hover:bg-white dark:bg-white/10 dark:hover:bg-white/20";

/**
 * Says that GitHub has a newer version of the open file, with the update as
 * the main action; or, just after an update, says what came in.
 */
export function GitHubUpdateBanner(
  props:
    | {
        kind: "newer";
        copy: GitHubBannerCopy;
        compareUrl: string;
        pending: boolean;
        error: string | null;
        onUpdate: () => void;
        onDismiss: () => void;
      }
    | {
        kind: "updated";
        title: string;
        detail: string;
        compareUrl: string | null;
        onDismiss: () => void;
      },
) {
  const tone = props.kind === "newer" ? props.copy.tone : "info";
  const Icon =
    props.kind === "updated"
      ? CircleCheck
      : tone === "warning"
        ? GitCompareArrows
        : CloudDownload;
  const title = props.kind === "newer" ? props.copy.title : props.title;
  const detail = props.kind === "newer" ? props.copy.detail : props.detail;
  const compareUrl = props.compareUrl;

  return (
    <div
      data-testid="document-github-banner"
      data-kind={props.kind === "newer" ? tone : "updated"}
      role="status"
      className={cn(
        "mt-1.5 flex flex-col gap-2.5 rounded-[8px] border px-3 py-2.5 text-left sm:flex-row sm:items-center sm:justify-between",
        TONE_CLASS[tone],
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon
          className={cn(
            "mt-0.5 size-4 shrink-0",
            tone === "warning"
              ? "text-amber-700 dark:text-amber-400"
              : "text-blue-600 dark:text-blue-400",
          )}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <div className="text-[0.8rem] font-semibold leading-5 tracking-normal [overflow-wrap:anywhere]">
            {title}
          </div>
          <div
            className={cn(
              "text-xs leading-5 font-normal tracking-normal",
              DETAIL_CLASS[tone],
            )}
          >
            {detail}
          </div>
          {props.kind === "newer" && props.error ? (
            <div
              data-testid="document-github-banner-error"
              role="alert"
              className="mt-1 text-xs leading-5 font-medium tracking-normal text-red-700 dark:text-red-300"
            >
              {props.error}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
        {compareUrl ? (
          <a
            href={compareUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="document-github-banner-compare"
            className={cn(
              "inline-flex items-center gap-1 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
              SECONDARY_BUTTON_CLASS,
            )}
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            See changes
          </a>
        ) : null}
        {props.kind === "newer" ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="document-github-banner-dismiss"
              className={SECONDARY_BUTTON_CLASS}
              onClick={props.onDismiss}
            >
              Not now
            </Button>
            <Button
              type="button"
              size="sm"
              data-testid="document-github-banner-update"
              disabled={props.pending}
              className={cn(
                "h-8 rounded-[7px] px-2.5 text-xs font-semibold text-white",
                tone === "warning"
                  ? "bg-amber-800 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500"
                  : "bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500",
              )}
              onClick={props.onUpdate}
            >
              {props.pending ? (
                <Loader2
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <CloudDownload className="size-3.5" aria-hidden="true" />
              )}
              {props.pending ? "Updating…" : props.copy.action}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-testid="document-github-banner-dismiss"
            className="size-8 rounded-[7px] text-inherit hover:bg-white/60 dark:hover:bg-white/10"
            aria-label="Dismiss"
            onClick={props.onDismiss}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
