import { ChevronRight, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { formatOpenFileParentPath, getPathLeaf } from "./app-navigation";
import { Button } from "./components/ui/button";
import type { RecentDocument } from "./recent-documents";

const lastViewedFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatLastViewed(lastViewedAt: number) {
  return lastViewedFormatter.format(lastViewedAt);
}

export function RecentDocumentsPage({
  documents,
  error,
  onOpen,
  updateNotice,
}: {
  documents: RecentDocument[];
  error: string | null;
  onOpen: (path: string) => void;
  updateNotice?: ReactNode;
}) {
  return (
    <main
      className="min-h-screen bg-[#FCFCFC] px-6 py-8 text-slate-950 dark:bg-background dark:text-slate-50 sm:px-10 sm:py-10"
      data-testid="recent-documents"
    >
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex items-start justify-between gap-6">
          <p className="font-die-grotesk-a text-xl font-bold text-stone-500 dark:text-stone-500">
            roughdraft.md
          </p>
          {updateNotice}
        </div>

        <section
          className="mt-20 sm:mt-28"
          aria-labelledby="recent-documents-heading"
        >
          <div className="border-b border-slate-200 pb-7 dark:border-slate-700">
            <p className="font-sans text-xs font-semibold tracking-[0.14em] text-stone-500 uppercase">
              Your workspace
            </p>
            <h1
              className="font-die-grotesk-b mt-3 text-[clamp(2.75rem,7vw,4.75rem)] leading-[0.9] font-bold tracking-[-0.02em]"
              id="recent-documents-heading"
            >
              Recent documents
            </h1>
            <p className="mt-5 max-w-xl text-base leading-6 text-stone-600 dark:text-stone-400">
              Pick up where you left off. Opening a document adds it back to the
              sidebar.
            </p>
            {error ? (
              <p
                className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/50 dark:text-red-300"
                data-testid="recent-documents-error"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </div>

          {documents.length > 0 ? (
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {documents.map((document) => (
                <Button
                  className="group h-auto w-full cursor-pointer justify-start rounded-none px-0 py-5 text-left hover:bg-transparent"
                  data-file-path={document.path}
                  data-testid="recent-document-item"
                  key={document.path}
                  type="button"
                  variant="ghost"
                  onClick={() => onOpen(document.path)}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-stone-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-stone-400">
                      <FileText className="size-4.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-semibold text-slate-950 dark:text-slate-50">
                        {getPathLeaf(document.path) ?? document.path}
                      </span>
                      <span className="mt-1 block truncate text-xs font-normal text-stone-500 dark:text-stone-400">
                        {formatOpenFileParentPath(document.path)}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-xs font-normal text-stone-500 sm:block">
                      {formatLastViewed(document.lastViewedAt)}
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-stone-400 transition-transform group-hover:translate-x-0.5 group-hover:text-stone-700 dark:group-hover:text-stone-200"
                      aria-hidden="true"
                    />
                  </span>
                </Button>
              ))}
            </div>
          ) : (
            <div
              className="border-b border-slate-200 py-8 dark:border-slate-700"
              data-testid="recent-documents-empty"
            >
              <p className="text-base font-semibold">No recent documents yet</p>
              <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
                Files you open in Roughdraft will appear here.
              </p>
            </div>
          )}

          <p className="mt-6 text-xs leading-5 text-stone-500">
            To open another file, run{" "}
            <code className="font-mono">roughdraft open /path/to/file.md</code>.
          </p>
        </section>
      </div>
    </main>
  );
}
