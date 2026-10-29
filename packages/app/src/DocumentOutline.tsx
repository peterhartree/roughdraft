import { ChevronsLeft, Pin, Search } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";
import {
  buildDocumentOutline,
  type DocumentHeading,
  type DocumentOutlineItem,
  filterDocumentOutline,
  getActiveOutlineItemIndex,
  getDocumentOutlineMarginLayout,
  isDocumentOutlinePaletteShortcut,
  MIN_DOCUMENT_OUTLINE_ITEMS,
  readDocumentOutlineCollapsed,
  writeDocumentOutlineCollapsed,
} from "./document-outline";
import { cn } from "./lib/utils";

const EDITOR_SELECTOR = ".document-rich-text-layout .tiptap";
const HEADING_SELECTOR = [1, 2, 3, 4, 5, 6]
  .map((level) => `:scope > h${level}`)
  .join(", ");
const HEADER_SELECTOR = '[data-testid="document-page-header"]';
const CONTENT_CARD_SELECTOR = '[data-testid="document-content-card"]';
/** Gap between the sticky header and the outline, and the jump landing line. */
const OUTLINE_TOP_OFFSET = 16;
const PINNED_OUTLINE_TEXT_GAP = 24;
const PINNED_OUTLINE_EDGE_GAP = 40;
const TICKS_TEXT_GAP = 44;
const TICK_POPOVER_OPEN_DELAY_MS = 60;
const TICK_POPOVER_CLOSE_DELAY_MS = 260;
const SHORTCUT_LABEL = "⌘⇧O";

interface HeadingSnapshot {
  elements: HTMLElement[];
  headings: DocumentHeading[];
}

interface MarginGeometry {
  mode: "pinned" | "ticks";
  /** Offsets relative to the outline layer, which spans the scroll content. */
  pinnedLeft: number;
  pinnedWidth: number;
  ticksLeft: number;
  headerHeight: number;
  maxHeight: number;
}

const EMPTY_SNAPSHOT: HeadingSnapshot = { elements: [], headings: [] };

function sameSnapshot(a: HeadingSnapshot, b: HeadingSnapshot) {
  return (
    a.elements.length === b.elements.length &&
    a.elements.every((element, index) => element === b.elements[index]) &&
    a.headings.every(
      (heading, index) =>
        heading.level === b.headings[index].level &&
        heading.text === b.headings[index].text,
    )
  );
}

function readHeadings(scroller: HTMLElement): HeadingSnapshot {
  const editor = scroller.querySelector<HTMLElement>(EDITOR_SELECTOR);
  if (!editor) return EMPTY_SNAPSHOT;
  const elements = [...editor.querySelectorAll<HTMLElement>(HEADING_SELECTOR)];
  return {
    elements,
    headings: elements.map((element) => ({
      level: Number(element.tagName.slice(1)),
      text: element.textContent ?? "",
    })),
  };
}

/** Moves focus between the outline's buttons with the arrow keys. */
function handleListKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "[data-outline-item]",
    ),
  ];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "ArrowDown"
      ? Math.min(index + 1, buttons.length - 1)
      : Math.max(index - 1, 0);
  event.preventDefault();
  buttons[next]?.focus();
}

function OutlineList({
  items,
  activeIndex,
  variant,
  onSelect,
  testId,
}: {
  items: DocumentOutlineItem[];
  activeIndex: number;
  variant: "pinned" | "popover";
  onSelect: (item: DocumentOutlineItem) => void;
  testId: string;
}) {
  return (
    <ol
      data-testid={testId}
      className={cn(
        "m-0 list-none p-0",
        variant === "pinned" &&
          "border-l border-stone-200 dark:border-slate-700",
      )}
      onKeyDown={handleListKeyDown}
    >
      {items.map((item, index) => {
        const active = index === activeIndex;
        return (
          <li key={`${item.headingIndex}:${item.text}`}>
            <button
              type="button"
              data-outline-item
              data-testid="document-outline-item"
              aria-current={active ? "location" : undefined}
              onClick={() => onSelect(item)}
              style={{ paddingLeft: `${0.75 + item.depth * 0.75}rem` }}
              className={cn(
                "block w-full text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-stone-300/70 dark:focus-visible:ring-slate-600/70",
                variant === "pinned"
                  ? "-ml-px border-l-2 border-transparent py-1 pr-2 text-[0.78rem] leading-snug text-stone-500 hover:text-stone-800 dark:text-slate-400 dark:hover:text-slate-200"
                  : "truncate rounded-md py-1.5 pr-2.5 text-[0.8rem] leading-snug text-stone-500 hover:bg-stone-50 hover:text-stone-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-100",
                item.depth > 0 && "text-[0.75rem]",
                active &&
                  (variant === "pinned"
                    ? "border-stone-800 font-medium text-stone-900 dark:border-slate-200 dark:text-slate-100"
                    : "bg-stone-100 font-medium text-stone-900 dark:bg-slate-800 dark:text-slate-100"),
              )}
            >
              {item.text}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function OutlineHeaderButton({
  label,
  testId,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  testId: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-testid={testId}
            aria-label={label}
            disabled={disabled}
            className="text-stone-400 hover:text-stone-700 dark:text-slate-500 dark:hover:text-slate-200"
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function OutlineHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 pb-1.5 pl-3 text-[0.68rem] font-semibold tracking-[0.08em] text-stone-400 uppercase dark:text-slate-500">
      <span className="flex-1">Outline</span>
      {children}
    </div>
  );
}

function GoToHeadingPalette({
  items,
  activeIndex,
  open,
  onOpenChange,
  onSelect,
}: {
  items: DocumentOutlineItem[];
  activeIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: DocumentOutlineItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const matches = useMemo(
    () => filterDocumentOutline(items, query),
    [items, query],
  );
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(Math.max(activeIndex, 0));
  }, [activeIndex, open]);

  useEffect(() => {
    setSelectedIndex((current) =>
      Math.min(current, Math.max(matches.length - 1, 0)),
    );
  }, [matches.length]);

  useEffect(() => {
    if (matches.length === 0) return;
    listRef.current?.children[selectedIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [selectedIndex, matches]);

  const filtering = query.trim() !== "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="document-outline-palette"
        className="top-[28%] gap-3 p-3 sm:max-w-lg"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Go to heading</DialogTitle>
          <DialogDescription>
            Search this document's headings and jump to one.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setSelectedIndex((current) =>
                matches.length === 0
                  ? 0
                  : (current + step + matches.length) % matches.length,
              );
              return;
            }
            if (event.key === "Enter") {
              const item = matches[selectedIndex];
              if (!item) return;
              event.preventDefault();
              onSelect(item);
            }
          }}
          placeholder="Go to heading..."
          aria-label="Search headings"
          data-testid="document-outline-palette-input"
        />
        <div className="max-h-80 overflow-y-auto">
          {matches.length > 0 ? (
            <ol ref={listRef} className="grid list-none gap-0.5 p-0">
              {matches.map((item, index) => (
                <li key={`${item.headingIndex}:${item.text}`}>
                  <Button
                    type="button"
                    variant="ghost"
                    data-testid="document-outline-palette-option"
                    data-selected={index === selectedIndex}
                    aria-current={
                      items.indexOf(item) === activeIndex
                        ? "location"
                        : undefined
                    }
                    style={{
                      paddingLeft: `${0.5 + (filtering ? 0 : item.depth) * 0.875}rem`,
                    }}
                    className={cn(
                      "h-auto w-full justify-start gap-3 py-1.5 pr-2 text-left text-sm font-normal",
                      index === selectedIndex && "bg-muted",
                    )}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => onSelect(item)}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.text}</span>
                    {filtering && item.parentText ? (
                      <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                        {item.parentText}
                      </span>
                    ) : null}
                  </Button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No headings match.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The document outline: a pinned list in the left margin when it fits, short
 * ticks that expand on hover when it does not, and a Command+Shift+O palette.
 * It reads headings from the rich-text editor's DOM, so it follows edits and
 * external reloads without its own copy of the document.
 */
export function DocumentOutline({
  scrollContainerRef,
  enabled,
}: {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
}) {
  const [snapshot, setSnapshot] = useState<HeadingSnapshot>(EMPTY_SNAPSHOT);
  const [geometry, setGeometry] = useState<MarginGeometry | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [collapsed, setCollapsed] = useState(readDocumentOutlineCollapsed);
  const [tickPopoverOpen, setTickPopoverOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [flash, setFlash] = useState<{
    key: number;
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [pointerOnOutline, setPointerOnOutline] = useState(false);
  const [focusInOutline, setFocusInOutline] = useState(false);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const outlineRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const tickPopoverTimerRef = useRef<number | null>(null);
  const tickPopoverPinnedOpenRef = useRef(false);

  const items = useMemo(
    () => buildDocumentOutline(snapshot.headings),
    [snapshot.headings],
  );
  const itemElements = useMemo(
    () => items.map((item) => snapshot.elements[item.headingIndex]),
    [items, snapshot.elements],
  );
  const marginVisible = enabled && items.length >= MIN_DOCUMENT_OUTLINE_ITEMS;

  // Collect headings now and whenever the editor's content changes.
  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!enabled || !scroller) {
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }
    let frame = 0;
    const collect = () => {
      frame = 0;
      const next = readHeadings(scroller);
      setSnapshot((current) => (sameSnapshot(current, next) ? current : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(collect);
    };
    collect();
    const observer = new MutationObserver(schedule);
    observer.observe(scroller, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled, scrollContainerRef]);

  const headerHeight = useCallback(() => {
    const header =
      scrollContainerRef.current?.querySelector<HTMLElement>(HEADER_SELECTOR);
    return header?.offsetHeight ?? 0;
  }, [scrollContainerRef]);

  // Measure where the margin sits relative to the text column.
  const measure = useCallback(() => {
    const scroller = scrollContainerRef.current;
    const layer = layerRef.current;
    const firstHeading = itemElements[0];
    if (!scroller || !layer || !firstHeading) {
      setGeometry(null);
      return;
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const layerLeft = layer.getBoundingClientRect().left;
    const textLeft = firstHeading.getBoundingClientRect().left;
    const layout = getDocumentOutlineMarginLayout(textLeft - scrollerRect.left);
    const pinnedWidth = layout.mode === "pinned" ? layout.width : 0;
    // Pinned, the outline keeps to the page's left edge, so the room between
    // it and the text grows with the window; it moves in towards the text
    // only when the page edge is too close.
    const pageLeft =
      scroller.querySelector(CONTENT_CARD_SELECTOR)?.getBoundingClientRect()
        .left ?? scrollerRect.left;
    const pinnedLeft = Math.min(
      pageLeft + PINNED_OUTLINE_EDGE_GAP,
      textLeft - PINNED_OUTLINE_TEXT_GAP - pinnedWidth,
    );
    const height = headerHeight();
    const next: MarginGeometry = {
      mode: layout.mode,
      pinnedWidth,
      pinnedLeft: pinnedLeft - layerLeft,
      ticksLeft: textLeft - layerLeft - TICKS_TEXT_GAP,
      headerHeight: height,
      maxHeight: Math.max(
        120,
        scroller.clientHeight - height - OUTLINE_TOP_OFFSET * 2,
      ),
    };
    setGeometry((current) =>
      current &&
      (Object.keys(next) as (keyof MarginGeometry)[]).every(
        (key) => Math.abs(Number(current[key]) - Number(next[key])) < 0.5,
      ) &&
      current.mode === next.mode
        ? current
        : next,
    );
  }, [headerHeight, itemElements, scrollContainerRef]);

  useLayoutEffect(() => {
    if (!marginVisible) return;
    measure();
    const scroller = scrollContainerRef.current;
    if (!scroller) return;
    const resizeObserver = new ResizeObserver(() => measure());
    resizeObserver.observe(scroller);
    const editor = scroller.querySelector(EDITOR_SELECTOR);
    if (editor) resizeObserver.observe(editor);
    // The review rail slides the document across with a transform, which
    // resize observers do not see; remeasure once it settles.
    scroller.addEventListener("transitionend", measure);
    window.addEventListener("resize", measure);
    return () => {
      resizeObserver.disconnect();
      scroller.removeEventListener("transitionend", measure);
      window.removeEventListener("resize", measure);
    };
  }, [marginVisible, measure, scrollContainerRef]);

  // Track the section being read.
  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!enabled || !scroller || itemElements.length === 0) {
      setActiveIndex(-1);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const scrollerRect = scroller.getBoundingClientRect();
      const atBottom =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      const readingLine = atBottom
        ? scrollerRect.bottom - 1
        : scrollerRect.top + headerHeight() + OUTLINE_TOP_OFFSET * 2;
      setActiveIndex(
        getActiveOutlineItemIndex(
          itemElements.map((element) => element.getBoundingClientRect().top),
          readingLine,
        ),
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", schedule, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled, headerHeight, itemElements, scrollContainerRef]);

  // Wide blocks pass over the outline, so they, not the outline, receive
  // the pointer where they overlap it. Track the pointer against the
  // outline's own box instead, and bring the outline forward while it is
  // there.
  useEffect(() => {
    if (!marginVisible) {
      setPointerOnOutline(false);
      return;
    }
    const update = (event: PointerEvent) => {
      const boxes = [
        outlineRef.current,
        document.getElementById("document-outline-popover"),
      ].flatMap((element) =>
        element ? [element.getBoundingClientRect()] : [],
      );
      setPointerOnOutline(
        boxes.some(
          (box) =>
            event.clientX >= box.left &&
            event.clientX <= box.right &&
            event.clientY >= box.top &&
            event.clientY <= box.bottom,
        ),
      );
    };
    const leave = () => setPointerOnOutline(false);
    window.addEventListener("pointermove", update, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", update);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [marginVisible]);

  const closeTickPopover = useCallback(() => {
    if (tickPopoverTimerRef.current !== null) {
      window.clearTimeout(tickPopoverTimerRef.current);
      tickPopoverTimerRef.current = null;
    }
    tickPopoverPinnedOpenRef.current = false;
    setTickPopoverOpen(false);
  }, []);

  const jumpTo = useCallback(
    (item: DocumentOutlineItem) => {
      const scroller = scrollContainerRef.current;
      const element = snapshot.elements[item.headingIndex];
      const anchor = anchorRef.current;
      if (!scroller || !element?.isConnected) return;
      const scrollerRect = scroller.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const top =
        elementRect.top -
        scrollerRect.top +
        scroller.scrollTop -
        headerHeight() -
        OUTLINE_TOP_OFFSET;
      scroller.scrollTo({
        top: Math.max(0, top),
        behavior: "instant",
      });
      if (anchor) {
        const anchorRect = anchor.getBoundingClientRect();
        setFlash((current) => ({
          key: (current?.key ?? 0) + 1,
          top: elementRect.top - anchorRect.top,
          left: elementRect.left - anchorRect.left,
          width: elementRect.width,
          height: elementRect.height,
        }));
      }
      closeTickPopover();
    },
    [closeTickPopover, headerHeight, scrollContainerRef, snapshot.elements],
  );

  const selectFromPalette = useCallback(
    (item: DocumentOutlineItem) => {
      setPaletteOpen(false);
      // Let the dialog hand focus back before scrolling, so restoring focus
      // to the editor cannot pull the view back to the caret.
      requestAnimationFrame(() => requestAnimationFrame(() => jumpTo(item)));
    },
    [jumpTo],
  );

  useEffect(() => {
    if (!enabled || items.length === 0) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isDocumentOutlinePaletteShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        closeTickPopover();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key === "Escape" && tickPopoverOpen) closeTickPopover();
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [closeTickPopover, enabled, items.length, tickPopoverOpen]);

  useEffect(() => {
    if (!tickPopoverOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (layerRef.current?.contains(event.target as Node)) return;
      closeTickPopover();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [closeTickPopover, tickPopoverOpen]);

  useEffect(() => {
    if (!flash) return;
    const timeout = window.setTimeout(() => setFlash(null), 1200);
    return () => window.clearTimeout(timeout);
  }, [flash]);

  useEffect(() => () => closeTickPopover(), [closeTickPopover]);

  const scheduleTickPopover = (open: boolean) => {
    if (tickPopoverTimerRef.current !== null) {
      window.clearTimeout(tickPopoverTimerRef.current);
    }
    if (!open && tickPopoverPinnedOpenRef.current) return;
    tickPopoverTimerRef.current = window.setTimeout(
      () => {
        tickPopoverTimerRef.current = null;
        setTickPopoverOpen(open);
      },
      open ? TICK_POPOVER_OPEN_DELAY_MS : TICK_POPOVER_CLOSE_DELAY_MS,
    );
  };

  const setCollapsedPreference = (next: boolean) => {
    setCollapsed(next);
    writeDocumentOutlineCollapsed(next);
  };

  const roomToPin = geometry?.mode === "pinned";
  const showPinned = marginVisible && roomToPin && !collapsed;
  const showTicks = marginVisible && geometry !== null && !showPinned;
  const outlineForward = pointerOnOutline || focusInOutline || tickPopoverOpen;

  return (
    <>
      <div ref={anchorRef} className="relative h-0" aria-hidden="true">
        {flash ? (
          <div
            key={flash.key}
            data-testid="document-outline-flash"
            className="document-outline-flash pointer-events-none absolute rounded-md"
            style={{
              top: flash.top - 4,
              left: flash.left - 8,
              width: flash.width + 16,
              height: flash.height + 8,
            }}
          />
        ) : null}
      </div>
      {marginVisible ? (
        <div
          ref={layerRef}
          data-testid="document-outline-layer"
          // Behind wide blocks (style.css) until the pointer or focus is on it.
          className={cn("sticky h-0", outlineForward ? "z-30" : "z-[1]")}
          // Keyboard focus only: a clicked item keeps focus after the jump.
          onFocus={(event) =>
            setFocusInOutline(event.target.matches(":focus-visible"))
          }
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setFocusInOutline(false);
          }}
          style={{
            top: (geometry?.headerHeight ?? 0) + OUTLINE_TOP_OFFSET,
          }}
        >
          {showPinned && geometry ? (
            <nav
              ref={outlineRef}
              data-testid="document-outline"
              aria-label="Document outline"
              className={cn(
                "group/outline absolute top-0 overflow-y-auto overscroll-contain rounded-md pb-2",
                outlineForward &&
                  "bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_10px_30px_rgb(0_0_0/0.12)] dark:bg-card dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_10px_30px_rgb(0_0_0/0.45)]",
              )}
              style={{
                left: geometry.pinnedLeft,
                width: geometry.pinnedWidth,
                maxHeight: geometry.maxHeight,
              }}
            >
              <OutlineHeading>
                <span className="flex items-center opacity-0 transition-opacity group-focus-within/outline:opacity-100 group-hover/outline:opacity-100">
                  <OutlineHeaderButton
                    label={`Go to heading (${SHORTCUT_LABEL})`}
                    testId="document-outline-search"
                    onClick={() => setPaletteOpen(true)}
                  >
                    <Search className="size-3" aria-hidden="true" />
                  </OutlineHeaderButton>
                  <OutlineHeaderButton
                    label="Collapse outline"
                    testId="document-outline-collapse"
                    onClick={() => setCollapsedPreference(true)}
                  >
                    <ChevronsLeft className="size-3" aria-hidden="true" />
                  </OutlineHeaderButton>
                </span>
              </OutlineHeading>
              <OutlineList
                items={items}
                activeIndex={activeIndex}
                variant="pinned"
                onSelect={jumpTo}
                testId="document-outline-list"
              />
            </nav>
          ) : null}
          {showTicks && geometry ? (
            <div
              ref={(element) => {
                outlineRef.current = element;
              }}
              className={cn(
                "absolute top-0 rounded-md",
                outlineForward && "bg-white dark:bg-card",
              )}
              style={{ left: geometry.ticksLeft }}
              onMouseEnter={() => scheduleTickPopover(true)}
              onMouseLeave={() => scheduleTickPopover(false)}
            >
              <button
                type="button"
                data-testid="document-outline-ticks"
                aria-label="Show document outline"
                aria-expanded={tickPopoverOpen}
                aria-controls="document-outline-popover"
                className={cn(
                  "block rounded-md px-1.5 py-2 outline-none transition-colors hover:bg-stone-100/70 focus-visible:ring-2 focus-visible:ring-stone-300/70 dark:hover:bg-slate-800/60 dark:focus-visible:ring-slate-600/70",
                )}
                onClick={() => {
                  tickPopoverPinnedOpenRef.current = true;
                  setTickPopoverOpen(true);
                  requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLButtonElement>(
                        '#document-outline-popover [aria-current="location"], #document-outline-popover [data-outline-item]',
                      )
                      ?.focus(),
                  );
                }}
              >
                {items.map((item, index) => (
                  <span
                    key={`${item.headingIndex}:${item.text}`}
                    className="relative block h-[9px] w-5"
                  >
                    <span
                      className={cn(
                        "absolute top-[3.5px] h-0.5 rounded-full bg-stone-300 transition-[width,background-color] dark:bg-slate-600",
                        item.depth === 0 ? "left-0 w-4" : "left-1.5 w-2.5",
                        item.depth > 1 && "left-2.5 w-1.5",
                        index === activeIndex &&
                          (item.depth === 0 ? "w-5" : "w-3.5"),
                        index === activeIndex &&
                          "bg-stone-700 dark:bg-slate-200",
                      )}
                    />
                  </span>
                ))}
              </button>
              {tickPopoverOpen ? (
                <nav
                  id="document-outline-popover"
                  data-testid="document-outline-popover"
                  aria-label="Document outline"
                  className="absolute -top-2 -left-1.5 w-72 overflow-y-auto overscroll-contain rounded-lg bg-popover p-1.5 pt-2.5 text-popover-foreground shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_10px_30px_rgb(0_0_0/0.12)] animate-in fade-in-0 duration-100 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_10px_30px_rgb(0_0_0/0.45)]"
                  style={{ maxHeight: geometry.maxHeight }}
                >
                  <OutlineHeading>
                    <OutlineHeaderButton
                      label={`Go to heading (${SHORTCUT_LABEL})`}
                      testId="document-outline-search"
                      onClick={() => {
                        closeTickPopover();
                        setPaletteOpen(true);
                      }}
                    >
                      <Search className="size-3" aria-hidden="true" />
                    </OutlineHeaderButton>
                    {roomToPin ? (
                      <OutlineHeaderButton
                        label="Pin outline in margin"
                        testId="document-outline-pin"
                        onClick={() => {
                          closeTickPopover();
                          setCollapsedPreference(false);
                        }}
                      >
                        <Pin className="size-3" aria-hidden="true" />
                      </OutlineHeaderButton>
                    ) : null}
                  </OutlineHeading>
                  <OutlineList
                    items={items}
                    activeIndex={activeIndex}
                    variant="popover"
                    onSelect={jumpTo}
                    testId="document-outline-popover-list"
                  />
                </nav>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {enabled && items.length > 0 ? (
        <GoToHeadingPalette
          items={items}
          activeIndex={activeIndex}
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onSelect={selectFromPalette}
        />
      ) : null}
    </>
  );
}
