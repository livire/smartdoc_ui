import { ReactNode, useState } from "react";

/**
 * A small dark bubble on hover, and on click for a touch screen.
 *
 * Our own rather than the browser's `title`, which waits about a second
 * before it appears and often does not appear at all — on an icon button
 * that is the difference between a label and no label.
 *
 * Wraps whatever it is given and positions the bubble under it; the
 * wrapper is inline so it sits in a row of controls without disturbing it.
 */
export default function Tip({
  text,
  children,
  className = "",
}: {
  text: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((on) => !on)}
    >
      {children}
      {open && (
        <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 max-w-xs -translate-x-1/2 rounded-lg bg-gray-800 px-2.5 py-1.5 text-left text-xs font-normal leading-snug text-white shadow-theme-md dark:bg-gray-700">
          {text}
        </span>
      )}
    </span>
  );
}
