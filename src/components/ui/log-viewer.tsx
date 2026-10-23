import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Tooltip } from "@base-ui/react/tooltip";
import NumberFlow from "@number-flow/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { ArrowDown, Search, X } from "../../lib/icons";
import { useControllableState } from "../../lib/use-controllable-state";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogLine = {
  /** Stable, unique arrival identity; enrichment keeps the same id. */
  id: string | number;
  time: number | Date | string;
  level: LogLevel;
  message: string;
  source?: string;
  /** Optional domain row; message/source remain its plain-text search index. */
  render?: (context: { wrap: boolean; highlight: (text: string) => ReactNode }) => ReactNode;
};

const LEVELS: LogLevel[] = ["error", "warn", "info", "debug"];
const LEVEL_TAG: Record<LogLevel, string> = { error: "ERR", warn: "WRN", info: "INF", debug: "DBG" };
const LEVEL_TEXT: Record<LogLevel, string> = { error: "text-danger", warn: "text-warn", info: "text-text-normal", debug: "text-text-muted" };
const LEVEL_DOT: Record<LogLevel, string> = { error: "bg-danger", warn: "bg-warn", info: "bg-text-normal", debug: "bg-text-muted" };
const snappy = { type: "spring", stiffness: 520, damping: 38, mass: 0.7 } as const;
const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** HH:MM:SS.mmm in the reader's own time zone. */
// eslint-disable-next-line react-refresh/only-export-components -- Public registry formatting utility.
export function formatLogTime(time: LogLine["time"]) {
  const date = time instanceof Date ? time : new Date(time);
  if (Number.isNaN(date.getTime())) return "--:--:--.---";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function Marked({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const out: ReactNode[] = [];
  let at = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, at)) {
    if (i > at) out.push(text.slice(at, i));
    out.push(<mark key={i} className="rounded-[2px] bg-primary/20 text-text-bright">{text.slice(i, i + q.length)}</mark>);
    at = i + q.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

export type LogViewerProps = Omit<ComponentProps<"div">, "children"> & {
  /** Oldest first. */
  lines: LogLine[];
  streaming?: boolean;
  follow?: boolean;
  defaultFollow?: boolean;
  onFollowChange?: (follow: boolean) => void;
  wrap?: boolean;
  defaultWrap?: boolean;
  onWrapChange?: (wrap: boolean) => void;
  levels?: LogLevel[];
  defaultLevels?: LogLevel[];
  onLevelsChange?: (levels: LogLevel[]) => void;
  query?: string;
  defaultQuery?: string;
  onQueryChange?: (query: string) => void;
  height?: number | string;
  loading?: boolean;
  loadingMessage?: string;
  emptyMessage?: string;
  emptyHint?: string;
  label?: string;
  formatTime?: (time: LogLine["time"]) => string;
  /** Replace severity controls with a domain filter; all arrivals still count. */
  filter?: {
    controls: ReactNode;
    accepts: (line: LogLine) => boolean;
    onClear: () => void;
    emptyMessage: string;
  };
  messages?: {
    filterPlaceholder?: string;
    filterLabel?: string;
    wrap?: string;
    unwrap?: string;
    noMatches?: (query: string) => string;
    newItems?: (count: number) => string;
  };
  /** Dense chrome for an embedded desktop tool. */
  compact?: boolean;
};

export function LogViewer({ lines, streaming = false, follow: followProp, defaultFollow = true, onFollowChange,
  wrap: wrapProp, defaultWrap = false, onWrapChange, levels: levelsProp, defaultLevels = LEVELS, onLevelsChange,
  query: queryProp, defaultQuery = "", onQueryChange, height = 320, loading = false, loadingMessage, emptyMessage, emptyHint, label: labelProp,
  formatTime = formatLogTime, filter, messages, compact = false, className, ...rest }: LogViewerProps) {
  const { t } = useTranslation();
  const label = labelProp ?? t("logViewer.label");
  const reduce = useReducedMotion();
  const [follow, setFollow] = useControllableState({ value: followProp, defaultValue: defaultFollow, onChange: onFollowChange });
  const [wrap, setWrap] = useControllableState({ value: wrapProp, defaultValue: defaultWrap, onChange: onWrapChange });
  const [levels, setLevels] = useControllableState<LogLevel[]>({ value: levelsProp, defaultValue: defaultLevels, onChange: onLevelsChange });
  const [query, setQuery] = useControllableState({ value: queryProp, defaultValue: defaultQuery, onChange: onQueryChange });
  const scroller = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastTop = useRef(0);
  const [tip] = useState(() => Tooltip.createHandle<string>());
  const [initial] = useState(() => new Set(lines.map(line => line.id)));
  const [arrivals, setArrivals] = useState(() => ({
    input: lines, ids: new Set(lines.map(line => line.id)), total: 0,
    following: follow, pausedTotal: 0,
  }));
  // Count identities before filtering. Keep only the current buffer's IDs, but
  // retain the cumulative count so eviction cannot erase unseen arrivals.
  if (arrivals.input !== lines || arrivals.following !== follow) {
    const added = lines.reduce((count, line) => count + Number(!arrivals.ids.has(line.id)), 0);
    setArrivals({
      input: lines, ids: new Set(lines.map(line => line.id)),
      total: lines.length ? arrivals.total + added : 0,
      following: follow,
      pausedTotal: !lines.length ? 0 : arrivals.following && !follow ? arrivals.total : arrivals.pausedTotal,
    });
  }

  const q = query.trim().toLowerCase();
  const matching = useMemo(() => q ? lines.filter(line => line.message.toLowerCase().includes(q) || line.source?.toLowerCase().includes(q)) : lines, [lines, q]);
  const counts = useMemo(() => {
    const result: Record<LogLevel, number> = { error: 0, warn: 0, info: 0, debug: 0 };
    for (const line of matching) result[line.level]++;
    return result;
  }, [matching]);
  const shown = useMemo(() => matching.filter(line => filter ? filter.accepts(line) : levels.includes(line.level)), [matching, levels, filter]);
  const filtered = !!q || levels.length < LEVELS.length;
  const newCount = follow ? 0 : arrivals.total - arrivals.pausedTotal;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !follow) return;
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  }, [shown, follow, wrap, height]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const sync = () => {
      if (follow) el.scrollTop = el.scrollHeight;
      // Browser clamping on resize is not a user scroll or a request to resume.
      lastTop.current = el.scrollTop;
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [follow]);

  const pause = () => setFollow(false);
  const resume = () => setFollow(true);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const up = el.scrollTop < lastTop.current - 1;
    const down = el.scrollTop > lastTop.current + 1;
    lastTop.current = el.scrollTop;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    if (follow && up && !atEnd) pause();
    else if (!follow && down && atEnd) resume();
  };
  const clearFilters = () => { setQuery(""); setLevels(LEVELS); filter?.onClear(); };
  const live = streaming && follow;
  const button = cn(control, compact ? "h-6 text-[11px]" : "h-8 text-[12px]");
  const iconButton = cn(control, "justify-center", compact ? "size-6" : "size-8");
  const newItems = messages?.newItems?.(newCount);

  return (
    <Tooltip.Provider delay={500}>
      <div data-slot="log-viewer" data-state={loading ? "loading" : live ? "live" : follow ? "following" : "paused"}
        aria-busy={loading || undefined}
        className={cn("flex min-w-0 flex-col overflow-hidden bg-bg-raised text-text-bright", compact ? "font-mono" : "rounded-xl border border-border shadow-lg", className)} {...rest}>
        <div className={cn("flex shrink-0 items-center gap-1 border-b border-border-subtle", compact ? "h-8 ps-2 pe-1" : "h-10 ps-2.5 pe-1.5")}>
          <Search size={14} className="shrink-0 text-text-normal" />
          <input ref={searchRef} type="search" value={query} onChange={event => setQuery(event.target.value)}
            onKeyDown={event => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }}
            placeholder={messages?.filterPlaceholder ?? t("logViewer.filterPlaceholder")} aria-label={messages?.filterLabel ?? t("logViewer.filterLabel", { label })}
            enterKeyHint="search" spellCheck={false} autoComplete="off"
            className={cn("min-w-0 flex-1 rounded-sm bg-transparent ps-1.5 text-text-bright placeholder:text-text-normal [&::-webkit-search-cancel-button]:hidden", compact ? "h-6 text-[11px]" : "h-8 text-base sm:text-[12.5px]")} />
          <span className={cn("grid shrink-0 place-items-center", compact ? "size-6" : "size-8")}>
            {query && <IconButton label={t("logViewer.clearFilter")} tip={tip} className={iconButton} onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X size={14} /></IconButton>}
          </span>
          <Tooltip.Trigger handle={tip} payload={wrap ? messages?.unwrap ?? t("logViewer.unwrap") : messages?.wrap ?? t("logViewer.wrap")}
            render={<Toggle pressed={wrap} onPressedChange={setWrap} aria-label={messages?.wrap ?? t("logViewer.wrap")} className={cn(iconButton, "data-pressed:bg-text-normal/10 data-pressed:text-text-bright")} />}>
            <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2.75 4h10.5M2.75 8h8.75a1.75 1.75 0 0 1 0 3.5H8.5M2.75 12h3M10 10l-1.5 1.5L10 13" />
            </svg>
          </Tooltip.Trigger>
          <Toggle pressed={follow} onPressedChange={pressed => pressed ? resume() : pause()}
            className={cn(button, "gap-1.5 px-2 data-pressed:text-text-bright", !compact && "data-pressed:bg-text-normal/10")}>
            <span aria-hidden className="relative grid size-2 place-items-center">
              {live && <span className="absolute inset-0 animate-ping rounded-full bg-green motion-reduce:animate-none motion-reduce:hidden" />}
              <span className={cn("size-1.5 rounded-full", live ? "bg-green" : follow ? "bg-text-normal" : "bg-text-muted")} />
            </span>
            {t("logViewer.follow")}
          </Toggle>
        </div>

        {filter ? filter.controls : <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-1.5">
          <ToggleGroup multiple value={levels} onValueChange={setLevels} aria-label={t("logViewer.levels")}
            className="flex min-w-0 items-center gap-0.5 overflow-x-auto px-0.5 py-1 [scrollbar-width:none]">
            {LEVELS.map(level => (
              <Toggle key={level} value={level} data-empty={counts[level] === 0 || undefined}
                aria-label={t("logViewer.levelCount", { level: t(`logViewer.level.${level}`), count: counts[level] })}
                className={cn(button, "group/chip gap-1.5 px-1.5 data-pressed:bg-text-normal/8 data-pressed:text-text-bright")}>
                <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full opacity-40 group-data-pressed/chip:opacity-100", LEVEL_DOT[level])} />
                {t(`logViewer.level.${level}`)}
                <span aria-hidden className="min-w-[3ch] text-end font-mono text-[11px] tabular-nums text-text-normal">
                  <NumberFlow value={counts[level]} animated={!reduce} willChange />
                </span>
              </Toggle>
            ))}
          </ToggleGroup>
          <span className="ml-auto hidden shrink-0 pr-1.5 font-mono text-[11px] tabular-nums text-text-normal sm:block">
            {filtered ? t("logViewer.filteredCount", { shown: shown.length, total: lines.length }) : t("logViewer.lineCount", { count: lines.length })}
          </span>
        </div>}

        <div className={cn("relative min-h-0", height === "100%" && "flex-1")}>
          <div ref={scroller} role="log" aria-label={label} aria-live="off" tabIndex={0} onScroll={onScroll}
            onKeyDown={event => {
              if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); searchRef.current?.focus(); }
              if (event.key === "End" && !event.altKey && !event.shiftKey) { event.preventDefault(); resume(); }
            }}
            className={cn("overflow-auto overscroll-contain font-mono leading-5 focus-visible:-outline-offset-2", compact ? "py-1 text-[11px]" : "py-1.5 text-[12px]")} style={{ height, overflowAnchor: "none" }}>
            {loading ? (
              <div className="flex flex-col gap-[7px] px-3 py-1.5">
                <span className={cn(loadingMessage ? "pb-2 text-center font-sans text-text-normal" : "sr-only")}>{loadingMessage ?? t("logViewer.loading")}</span>
                {[72, 54, 88, 40, 66, 58, 80].map((width, index) => (
                  <div key={index} aria-hidden className="flex items-center gap-3 motion-safe:animate-pulse">
                    <span className="h-2.5 w-[84px] shrink-0 rounded-sm bg-text-normal/10" />
                    <span className="h-2.5 rounded-sm bg-text-normal/10" style={{ width: `${width - 30}%` }} />
                  </div>
                ))}
              </div>
            ) : !lines.length ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center font-sans text-[12.5px] text-text-normal">
                {streaming && <span aria-hidden className="size-1.5 rounded-full bg-text-normal motion-safe:animate-pulse" />}
                <p className="text-text-bright">{emptyMessage ?? t(streaming ? "logViewer.waiting" : "logViewer.empty")}</p>
                {emptyHint && <p className="max-w-sm text-[11px] leading-relaxed">{emptyHint}</p>}
              </div>
            ) : !shown.length ? (
              <div className="flex h-full flex-col items-center justify-center gap-2.5 px-6 text-center font-sans">
                <p className="text-[12px] text-text-normal [overflow-wrap:anywhere]">{q ? messages?.noMatches?.(query.trim()) ?? t("logViewer.noMatches", { query: query.trim() }) : filter?.emptyMessage ?? t("logViewer.noLevels")}</p>
                <button type="button" onClick={clearFilters} className={cn(button, "border border-border bg-bg-raised px-2.5 text-text-bright")}>
                  {t("logViewer.clearFilters")}
                </button>
              </div>
            ) : (
              <ol className={cn("flex flex-col", !wrap && "w-max min-w-full")}>
                {shown.map(line => (
                  <li key={line.id} data-level={line.level}
                    className={cn(line.render ? !compact && "border-b border-border-subtle last:border-b-0" : "grid grid-cols-[auto_auto_1fr] gap-x-3 px-3 hover:bg-text-normal/5",
                      line.level === "error" && "border-l-2 border-danger bg-danger/8",
                      line.level === "warn" && "border-l-2 border-warn",
                      !initial.has(line.id) && "motion-safe:transition-opacity motion-safe:duration-200 motion-safe:starting:opacity-0")}>
                    {line.render ? line.render({ wrap, highlight: text => <Marked text={text} query={query} /> }) : <>
                    <time className="select-none tabular-nums text-text-normal" suppressHydrationWarning>{formatTime(line.time)}</time>
                    <span className={cn("select-none", LEVEL_TEXT[line.level])}>
                      <span aria-hidden>{LEVEL_TAG[line.level]}</span><span className="sr-only">{t(`logViewer.level.${line.level}`)}</span>
                    </span>
                    <span className={cn("min-w-0", wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-pre", line.level === "error" ? "text-text-bright" : "text-text-normal")}>
                      {line.source && <span className="text-text-normal"><Marked text={line.source} query={query} />{" "}</span>}
                      <Marked text={line.message} query={query} />
                    </span>
                    </>}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <AnimatePresence initial={false}>
            {!follow && lines.length > 0 && !loading && (
              <motion.button key="jump" type="button" onClick={() => { resume(); scroller.current?.focus({ preventScroll: true }); }}
                aria-label={newCount > 0 ? newItems ?? t("logViewer.newLines", { count: newCount }) : t("logViewer.jump")}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97, transition: { duration: 0.14 } }}
                transition={reduce ? { duration: 0.15 } : snappy}
                className={cn("absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-text-bright ps-2.5 pe-3 font-medium text-bg-base shadow-lg hover:bg-text-bright/90", compact ? "h-6 text-[11px]" : "h-8 text-[12px]")}>
                <ArrowDown size={13} />
                {newCount > 0 ? newItems ?? <span aria-hidden className="flex items-center gap-1 tabular-nums"><NumberFlow value={newCount} animated={!reduce} willChange />{t("logViewer.newLineLabel", { count: newCount })}</span> : t("logViewer.jump")}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
      <Tooltip.Root handle={tip}>
        {({ payload }) => (
          <Tooltip.Portal>
            <Tooltip.Positioner side="top" sideOffset={6} collisionPadding={8} className="z-50">
              <Tooltip.Popup className="flex min-h-6 items-center rounded-md border border-border bg-bg-raised px-2 py-1 text-[12px] leading-4 text-text-bright shadow-lg motion-safe:transition-opacity data-starting-style:opacity-0 data-ending-style:opacity-0">
                {payload}
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        )}
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

const control = "relative flex shrink-0 items-center rounded-sm font-medium text-text-normal hover:bg-text-normal/8 hover:text-text-bright motion-safe:transition-colors cursor-pointer";

function IconButton({ label, tip, className, onClick, children }: { label: string; tip: ReturnType<typeof Tooltip.createHandle<string>>; className: string; onClick: () => void; children: ReactNode }) {
  return <Tooltip.Trigger handle={tip} payload={label} render={<button type="button" aria-label={label} onClick={onClick} className={className} />}>{children}</Tooltip.Trigger>;
}
