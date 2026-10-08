/**
 * A row of tabs.
 *
 * Draws the row only — every panel stays mounted and the inactive ones are
 * hidden, which is the point. Unmounting a tab would throw away whatever was
 * typed in it, so switching away from a half-edited form and back would lose
 * the edits; it would also re-fetch on every switch.
 */
export interface Tab {
  id: string;
  label: string;
}

export default function Tabs({
  tabs,
  active,
  onChange,
  className = "",
}: {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`flex gap-1 border-b border-gray-200 dark:border-gray-700 ${className}`}
    >
      {tabs.map((tab) => {
        const on = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              on
                ? "border-brand-500 text-brand-500"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
