import { useEffect, useMemo, useRef, useState } from "react";

export type CheckOption = {
  value: string;
  label: string;
};

// A project can hold thousands of identifiers. Type to narrow; this is how
// many matches are drawn at once.
const MAX_VISIBLE = 50;

/**
 * Tick-as-many-as-you-like filter.
 *
 * The single-choice picker (`SearchSelect`) answers "show me this one". Most
 * filtering is not that: a supervisor wants the two people on a shift, or
 * every status that is not finished. With one choice each question had to be
 * asked again for every answer.
 *
 * Select all and Clear are here because with a long list neither is worth
 * doing by hand — and Clear is how you undo a filter you no longer want,
 * which was otherwise a matter of unticking things one at a time.
 */
export default function CheckSelect({
  options,
  values,
  onChange,
  noun,
  emptyText = "No matches",
  id,
  // Filters sit in a toolbar, where a full-height form control is too tall.
  compact = false,
  // Shown but not usable — a filter whose values are not known yet, because
  // nothing has been loaded for it to filter.
  disabled = false,
  // Whether "nothing selected" is a state this filter may be in. On a
  // status filter it is — narrowing to nothing is somebody saying "show me
  // none of these". On a filter over a file's own values it is not: an
  // empty grid is never what anybody wanted, so Clear means "stop
  // filtering" and unticking the last value goes back to all.
  allowNone = true,
}: {
  options: CheckOption[];
  // `null` means everything, which is not the same as a list that happens to
  // hold every value today: the options arrive from the server after the
  // screen draws, and people are added while it is open. Saying "all" keeps
  // meaning all when the list grows.
  values: string[] | null;
  onChange: (values: string[] | null) => void;
  // What this filter is about, in the plural: "users", "statuses". The
  // button reads "All users" / "3 users" / "No users" — the name stays on it
  // whatever is ticked, because a row of buttons saying "None" tells nobody
  // which filter is hiding everything.
  noun: string;
  emptyText?: string;
  id?: string;
  compact?: boolean;
  disabled?: boolean;
  allowNone?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const everything = values === null;
  const chosen = useMemo(
    () => new Set(everything ? options.map((o) => o.value) : values ?? []),
    [everything, options, values],
  );

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const visible = matched.slice(0, MAX_VISIBLE);
  const hiddenCount = matched.length - visible.length;

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Unticking one of "all" leaves a list: everything except that one.
  const toggle = (value: string) => {
    const next = new Set(chosen);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    // Unticking the last one means "I am no longer filtering by this", not
    // "show me nothing" — unless nothing is a state this filter allows.
    if (next.size === 0 && !allowNone) {
      onChange(null);
      return;
    }
    onChange(next.size === options.length ? null : Array.from(next));
  };

  // Select all applies to what is on screen: with a search typed in, "all"
  // means the ones you narrowed to. With nothing typed it is everything, and
  // goes back to meaning "all", including whatever arrives later.
  const selectAll = () => {
    if (matched.length === options.length) {
      onChange(null);
      return;
    }
    const next = new Set(chosen);
    matched.forEach((o) => next.add(o.value));
    onChange(next.size === options.length ? null : Array.from(next));
  };

  const count = chosen.size;
  // Names, not a tally: "6 statuses" says nothing about which six. The first
  // one is spelled out and the rest counted, which fits a toolbar button and
  // still tells you what you are looking at.
  const first = options.find((o) => chosen.has(o.value))?.label;
  const label =
    everything || (options.length > 0 && count === options.length)
      ? `All ${noun}`
      : count === 0
      ? `No ${noun}`
      : count === 1
      ? first ?? `1 ${noun}`
      : `${first} +${count - 1}`;

  // Filtering only means something while something is left out.
  const narrowed = !everything && count !== options.length;

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => {
          setIsOpen((open) => !open);
          setQuery("");
        }}
        className={`${
          compact ? "h-9 px-3 text-xs" : "h-11 px-4 text-sm"
        } flex w-full items-center justify-between gap-2 rounded-lg border bg-transparent text-left shadow-theme-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
          narrowed
            ? "border-brand-500 text-gray-800 dark:text-white/90"
            : "border-gray-300 text-gray-500 dark:border-gray-700 dark:text-gray-400"
        }`}
      >
        <span className="truncate">{label}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5 flex-shrink-0 opacity-60">
          <path d="M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full min-w-56 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-theme-lg dark:border-gray-700 dark:bg-gray-900">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="h-9 w-full border-b border-gray-100 bg-transparent px-3 text-xs text-gray-800 placeholder:text-gray-400 focus:outline-hidden dark:border-gray-800 dark:text-white/90"
          />

          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5 dark:border-gray-800">
            <button
              type="button"
              onClick={selectAll}
              disabled={matched.length === 0}
              className="text-xs font-medium text-brand-500 hover:underline disabled:opacity-40"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => onChange(allowNone ? [] : null)}
              disabled={allowNone ? count === 0 : everything}
              className="text-xs font-medium text-gray-500 hover:text-error-500 hover:underline disabled:opacity-40 dark:text-gray-400"
            >
              Clear
            </button>
          </div>

          <div className="max-h-56 overflow-y-auto">
            {visible.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{emptyText}</p>
            ) : (
              <ul>
                {visible.map((option) => (
                  <li key={option.value}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 dark:text-white/90 dark:hover:bg-white/[0.03]">
                      <input
                        type="checkbox"
                        checked={chosen.has(option.value)}
                        onChange={() => toggle(option.value)}
                        className="size-3.5 rounded border-gray-300 text-brand-500 focus:ring-brand-500/20 dark:border-gray-600"
                      />
                      <span className="truncate">{option.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {hiddenCount > 0 && (
            <p className="border-t border-gray-100 px-3 py-1.5 text-xs text-gray-400 dark:border-gray-800">
              {hiddenCount} more — keep typing to narrow
            </p>
          )}
        </div>
      )}
    </div>
  );
}
