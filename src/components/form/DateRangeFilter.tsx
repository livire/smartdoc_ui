import { useEffect, useRef, useState } from "react";

export type DateRange = {
  // YYYY-MM-DD, or "" for open-ended.
  from: string;
  to: string;
  // The named span this came from, when it came from one — kept so the button
  // can say "Last week" rather than reciting two dates.
  preset?: string;
};

const PRESETS = [
  { days: 1, label: "Last 24 hours" },
  { days: 3, label: "Last 3 days" },
  { days: 7, label: "Last week" },
  { days: 30, label: "Last month" },
  { days: 90, label: "Last 3 months" },
];

// YYYY-MM-DD in local time — `toISOString` would shift the day for anyone
// east or west of UTC.
export const asInputDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

const asShown = (value: string) => {
  if (!value) return "";
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
};

/**
 * One control for "when": the handful of spans people actually ask for, and
 * exact dates for everything else.
 *
 * Three boxes side by side — a span dropdown and two date fields — took a
 * third of the toolbar to answer a question that is usually "last week".
 * This says the answer on the button and keeps the rest behind a click.
 */
export default function DateRangeFilter({
  value,
  onChange,
  label = "Any date",
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
  label?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isOpen]);

  const chosen = value.preset
    ? PRESETS.find((p) => String(p.days) === value.preset)?.label ?? label
    : value.from || value.to
    ? `${asShown(value.from) || "Any"} – ${asShown(value.to) || "Any"}`
    : label;

  const isSet = Boolean(value.preset || value.from || value.to);

  const pick = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    onChange({ from: asInputDate(from), to: asInputDate(to), preset: String(days) });
    setIsOpen(false);
  };

  const dateBox =
    "h-9 w-full rounded-lg border border-gray-300 bg-transparent px-2 text-xs text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:[color-scheme:dark]";

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        // A minimum width so the button keeps its place as the label changes
        // from "Any date" to a pair of dates — otherwise the toolbar shuffles
        // every time the filter is set.
        className={`flex h-9 min-w-56 items-center gap-2 rounded-lg border px-3 text-xs transition ${
          isSet
            ? "border-brand-300 text-brand-500 dark:border-brand-500/40"
            : "border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.05]"
        }`}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5 shrink-0">
          <path d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zm12 8v10H5V10z" />
        </svg>
        {chosen}
      </button>

      {isOpen && (
        <div className="absolute left-0 z-50 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-theme-lg dark:border-gray-700 dark:bg-gray-900">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => pick(p.days)}
                className={`rounded-full px-2.5 py-1 text-xs transition ${
                  value.preset === String(p.days)
                    ? "bg-brand-500 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-200 dark:hover:bg-white/[0.1]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">From</span>
              <input
                type="date"
                value={value.from}
                // Typing a date means this is no longer one of the spans.
                onChange={(e) => onChange({ ...value, from: e.target.value, preset: undefined })}
                className={dateBox}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">To</span>
              <input
                type="date"
                value={value.to}
                onChange={(e) => onChange({ ...value, to: e.target.value, preset: undefined })}
                className={dateBox}
              />
            </label>
          </div>

          <div className="mt-3 flex justify-between">
            <button
              type="button"
              onClick={() => {
                onChange({ from: "", to: "" });
                setIsOpen(false);
              }}
              className="text-xs text-gray-500 hover:underline dark:text-gray-400"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-xs font-medium text-brand-500 hover:underline"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
