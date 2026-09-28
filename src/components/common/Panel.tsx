import { ReactNode, useState } from "react";

/**
 * A titled panel that folds away.
 *
 * Open or shut is remembered per panel in the browser, so somebody who
 * works in one part of a screen every day does not fold the rest open
 * again each morning. The key is the caller's, so two screens can use the
 * same title without sharing a state.
 *
 * Deliberately not animated to a measured height: a panel that slides is a
 * panel that jumps when its content loads.
 */
export default function CollapsiblePanel({
  title,
  subtitle,
  storageKey,
  defaultOpen = true,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  storageKey: string;
  defaultOpen?: boolean;
  // Something to show in the header, beside the chevron — a button, a
  // count. Clicks there do not fold the panel.
  right?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(`smartdoc.panel.${storageKey}`);
      return stored === null ? defaultOpen : stored === "1";
    } catch {
      return defaultOpen;
    }
  });

  const toggle = () => {
    setOpen((was) => {
      const next = !was;
      try {
        localStorage.setItem(`smartdoc.panel.${storageKey}`, next ? "1" : "0");
      } catch {
        // A browser refusing storage still folds; it just forgets.
      }
      return next;
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      {/* The header is tinted, the body is not: a row of panels then reads
          as a row of headings with their contents under them, rather than
          as several identical white boxes. */}
      <div className="flex items-center gap-3 bg-gray-50 px-3 py-2 dark:bg-white/[0.03]">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className={`size-4 flex-shrink-0 text-gray-400 transition-transform ${open ? "" : "-rotate-90"}`}
          >
            <path d="M12 15.4 5.6 9l1.4-1.4 5 5 5-5L18.4 9 12 15.4Z" />
          </svg>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-gray-800 dark:text-white/90">
              {title}
            </span>
            {subtitle && (
              <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                {subtitle}
              </span>
            )}
          </span>
        </button>
        {right && <span className="flex flex-shrink-0 items-center gap-2">{right}</span>}
      </div>

      {open && <div className="border-t border-gray-100 p-3 dark:border-gray-800">{children}</div>}
    </div>
  );
}
