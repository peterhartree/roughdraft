import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { cn } from "./lib/utils";

const CONFIRM_WINDOW_MS = 4000;

/**
 * Two-step delete: the first click arms the button in place, the second
 * moves the file to the Trash. Waiting, pressing Escape or moving focus away
 * disarms it.
 */
export function MoveToTrashButton({
  onConfirm,
}: {
  onConfirm: () => Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "armed" | "pending">("idle");

  useEffect(() => {
    if (state !== "armed") return;
    const timer = window.setTimeout(() => setState("idle"), CONFIRM_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const armed = state === "armed";
  const pending = state === "pending";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-testid="document-move-to-trash-button"
            data-state={state}
            disabled={pending}
            aria-label={armed ? "Confirm: move to Trash" : "Move to Trash"}
            className={cn(
              "inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-full text-stone-400 outline-none transition focus-visible:ring-2 focus-visible:ring-stone-300/70 dark:text-slate-400 dark:focus-visible:ring-slate-600/70",
              armed
                ? "bg-red-50 px-2 text-[0.72rem] font-medium text-red-700 hover:bg-red-100 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-950"
                : "w-6 hover:bg-[#EEE9E1] hover:text-stone-600 dark:hover:bg-slate-800 dark:hover:text-slate-200",
            )}
            onClick={() => {
              if (state === "idle") {
                setState("armed");
                return;
              }
              if (state !== "armed") return;
              setState("pending");
              void onConfirm().finally(() => setState("idle"));
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && armed) {
                event.preventDefault();
                event.stopPropagation();
                setState("idle");
              }
            }}
            onBlur={() => {
              if (armed) setState("idle");
            }}
          >
            {pending ? (
              <Loader2
                className="size-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Trash2 className="size-3.5" aria-hidden="true" />
            )}
            {armed ? <span>Move to Trash?</span> : null}
          </button>
        }
      />
      <TooltipContent>
        {armed ? "Click again to move this file to the Trash" : "Move to Trash"}
      </TooltipContent>
    </Tooltip>
  );
}
