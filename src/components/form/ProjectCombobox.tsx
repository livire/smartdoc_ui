import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "../../icons";
import { Project } from "../../services/userManagementService";

// Type-to-filter project picker used by the customer-level setup screens
// (Identifiers, Attributes) to scope their project-scoped lists. Same
// portal/click-outside mechanics as the filter dropdowns on MyAssignments,
// but single-select and typeable — the input doubles as the filter box.
export default function ProjectCombobox({
  projects,
  selectedProjectId,
  onSelect,
  disabled,
  placeholder,
}: {
  projects: Project[];
  selectedProjectId: string;
  onSelect: (projectId: string) => void;
  disabled: boolean;
  placeholder: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selectedProject = projects.find((p) => String(p.project_id) === selectedProjectId) || null;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(target) &&
        panelRef.current &&
        !panelRef.current.contains(target)
      ) {
        setIsOpen(false);
        setQuery("");
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const openPanel = () => {
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setIsOpen(true);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.project_name.toLowerCase().includes(q));
  }, [projects, query]);

  const select = (p: Project) => {
    onSelect(String(p.project_id));
    setQuery("");
    setIsOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative w-[350px] shrink-0">
      <input
        type="text"
        disabled={disabled}
        // While open the input is the filter box; when closed it falls back to
        // showing what's actually selected.
        value={isOpen ? query : selectedProject?.project_name || ""}
        placeholder={placeholder}
        onFocus={openPanel}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!isOpen) openPanel();
        }}
        className="h-9 w-full rounded-lg border border-gray-300 bg-transparent py-2 pl-3 pr-9 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
      />
      <ChevronDownIcon
        className={`pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-gray-500 transition-transform ${
          isOpen ? "rotate-180" : ""
        }`}
      />
      {isOpen &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, width: Math.max(coords.width, 224) }}
            className="z-99999 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900"
          >
            {filtered.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-gray-500 dark:text-gray-400">No projects match</p>
            ) : (
              filtered.map((p) => {
                const isSelected = String(p.project_id) === selectedProjectId;
                return (
                  <button
                    key={p.project_id}
                    type="button"
                    onClick={() => select(p)}
                    className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-white/[0.03] ${
                      isSelected
                        ? "font-medium text-gray-800 dark:text-white/90"
                        : "text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    {p.project_name}
                  </button>
                );
              })
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
