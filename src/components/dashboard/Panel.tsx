import React from "react";

export const TH =
  "whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400";
export const TD = "whitespace-nowrap px-4 py-5 text-sm text-gray-700 dark:text-gray-300";

// Each panel carries everything its dedicated screen shows, because these are
// meant to replace those screens rather than summarise them. Fixed height, so
// the grid stays even; the body scrolls both ways when a list is longer or a
// row wider than the box.
export default function Panel({
  title,
  count,
  empty,
  loading,
  headerRight,
  columns,
  wide,
  tabs,
  activeTab,
  onTab,
  fill,
  footer,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  loading: boolean;
  headerRight?: React.ReactNode;
  columns: string[];
  wide?: boolean;
  // Two views in one box. Given tabs, the header shows them (each with its
  // own count) in place of the title, and the caller swaps columns, rows
  // and the header's controls with the active one.
  tabs?: { key: string; label: string; count: number }[];
  activeTab?: string;
  onTab?: (key: string) => void;
  // On a screen of its own the box takes the height it is given instead
  // of the dashboard's fixed one, and can carry a footer — pagination.
  fill?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-col rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 ${
        fill ? "min-h-0 flex-1" : "h-80"
      } ${wide ? "xl:col-span-2" : ""}`}
    >
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        {tabs ? (
          <div className="-my-3 flex min-w-0 items-stretch gap-1">
            {tabs.map((t) => {
              const on = t.key === activeTab;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => onTab?.(t.key)}
                  className={`-mb-px flex items-center gap-2 border-b-2 px-2 py-3 text-sm font-medium transition ${
                    on
                      ? "border-brand-500 text-brand-500"
                      : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white/90"
                  }`}
                >
                  {t.label}
                  {!loading && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        on
                          ? "bg-brand-500/10 text-brand-500"
                          : "bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300"
                      }`}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-sm font-medium text-gray-800 dark:text-white/90">{title}</h2>
          {/* The count belongs to the label, not to the far edge — on a wide
              card the two were half a screen apart. */}
          {!loading && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">
              {count}
            </span>
          )}
        </div>
        )}
        {headerRight && <div className="flex flex-shrink-0 items-center gap-3">{headerRight}</div>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">Loading...</p>
        ) : count === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{empty}</p>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-white dark:bg-gray-800">
              <tr className="border-b border-gray-100 dark:border-gray-800">
                {columns.map((c, i) => (
                  <th key={`${c}-${i}`} className={TH}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">{children}</tbody>
          </table>
        )}
      </div>
      {footer && (
        <div className="flex-shrink-0 border-t border-gray-100 px-4 dark:border-gray-800">{footer}</div>
      )}
    </div>
  );
}

