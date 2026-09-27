import { useEffect, useMemo, useRef, useState } from "react";

export type SearchOption = {
  value: string;
  label: string;
  // Shown but not choosable, with the reason beside it. Hiding an entry
  // leaves the reader wondering where it went; this answers that.
  disabled?: boolean;
  hint?: string;
};

// A list of thousands can't be scrolled through, and rendering it all is slow.
// Type to narrow; this is how many matches are drawn at once.
const MAX_VISIBLE = 50;

/**
 * Type-to-search picker.
 *
 * Replaces a plain <select> where the list can be long — a project may have
 * thousands of identifiers — and where some entries need to be visible but
 * not selectable.
 */
export default function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "Search...",
  emptyText = "No matches",
  id,
  // Filters sit in a toolbar, where a full-height form control is too tall.
  compact = false,
  // Somewhere that can add what is missing — capture screens, where the
  // paper often arrives before its number has been entered anywhere. Given
  // one, a typed value that matches nothing offers to create it.
  onCreate,
  createLabel = (query: string) => `Create "${query}"`,
}: {
  options: SearchOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  id?: string;
  compact?: boolean;
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) || null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    return filtered.slice(0, MAX_VISIBLE);
  }, [options, query]);

  const hiddenCount = useMemo(() => {
    const q = query.trim().toLowerCase();
    const total = q ? options.filter((o) => o.label.toLowerCase().includes(q)).length : options.length;
    return Math.max(0, total - matches.length);
  }, [options, query, matches.length]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Only when it is genuinely new: an exact match is already in the list.
  const creatable =
    !!onCreate &&
    query.trim().length > 0 &&
    !options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase());

  const create = () => {
    if (!onCreate) return;
    onCreate(query.trim());
    setQuery("");
    setIsOpen(false);
  };

  const choose = (option: SearchOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setQuery("");
    setIsOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setIsOpen(true);
      setHighlight((current) => {
        const step = e.key === "ArrowDown" ? 1 : -1;
        // Skip past entries that can't be chosen, so the keyboard never lands
        // on one.
        for (let i = 1; i <= matches.length; i++) {
          const next = (current + step * i + matches.length * i) % matches.length;
          if (!matches[next]?.disabled) return next;
        }
        return current;
      });
    } else if (e.key === "Enter") {
      if (isOpen && matches[highlight]) {
        e.preventDefault();
        choose(matches[highlight]);
      } else if (isOpen && creatable) {
        e.preventDefault();
        create();
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        type="text"
        autoComplete="off"
        // Shows what's chosen until you start typing, so the field doesn't
        // look empty after a selection.
        value={isOpen ? query : selected?.label ?? ""}
        placeholder={selected ? selected.label : placeholder}
        onFocus={() => {
          setIsOpen(true);
          setQuery("");
          setHighlight(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
        className={`${compact ? "h-9 px-3 text-xs" : "h-11 px-4 py-2.5 text-sm"} w-full rounded-lg border border-gray-300 bg-transparent text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30`}
      />

      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-theme-lg dark:border-gray-700 dark:bg-gray-900">
          {matches.length === 0 && !creatable ? (
            <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{emptyText}</p>
          ) : (
            <ul>
              {matches.map((option, index) => (
                <li key={option.value}>
                  <button
                    type="button"
                    disabled={option.disabled}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(option)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                      option.disabled
                        ? "cursor-not-allowed text-gray-400 dark:text-gray-600"
                        : index === highlight
                        ? "bg-brand-50 text-gray-800 dark:bg-brand-500/10 dark:text-white/90"
                        : "text-gray-800 dark:text-white/90"
                    }`}
                  >
                    <span className="truncate">{option.label}</span>
                    {option.hint && (
                      <span className="flex-shrink-0 text-xs text-gray-400 dark:text-gray-500">
                        {option.hint}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {creatable && (
            <button
              type="button"
              onClick={create}
              className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2 text-left text-sm font-medium text-brand-500 hover:bg-brand-50 dark:border-gray-800 dark:hover:bg-brand-500/10"
            >
              {createLabel(query.trim())}
            </button>
          )}

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
