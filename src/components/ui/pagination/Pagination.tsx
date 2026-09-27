import { useMemo } from "react";
import { AngleLeftIcon, AngleRightIcon } from "../../../icons";

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];

// Client-side pagination footer for the list screens. The list endpoints
// (e.g. GET /category/project/:id) return the whole set with no limit/offset,
// so paging happens over the already-fetched array — this component only deals
// in counts and page numbers, never in fetching.
export default function Pagination({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  itemLabel = "items",
}: {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  itemLabel?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const firstItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, totalItems);

  // First page, last page, and a window either side of the current one —
  // everything else collapses into an ellipsis.
  const pages = useMemo(() => {
    const result: (number | "ellipsis")[] = [];
    for (let page = 1; page <= totalPages; page++) {
      const isEdge = page === 1 || page === totalPages;
      const isNearCurrent = page >= currentPage - 1 && page <= currentPage + 1;
      if (isEdge || isNearCurrent) {
        result.push(page);
      } else if (result[result.length - 1] !== "ellipsis") {
        result.push("ellipsis");
      }
    }
    return result;
  }, [totalPages, currentPage]);

  if (totalItems === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-white px-6 py-3 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Showing <span className="font-medium text-gray-700 dark:text-gray-300">{firstItem}</span>–
          <span className="font-medium text-gray-700 dark:text-gray-300">{lastItem}</span> of{" "}
          <span className="font-medium text-gray-700 dark:text-gray-300">{totalItems}</span> {itemLabel}
        </p>
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label="Rows per page"
            className="h-8 rounded-lg border border-gray-300 bg-transparent px-2 text-xs text-gray-700 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:focus:border-brand-800"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size} className="dark:bg-gray-900">
                {size} / page
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          title="Previous page"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed dark:text-gray-400 dark:hover:bg-white/[0.05]"
        >
          <AngleLeftIcon className="size-4" />
        </button>

        {pages.map((page, index) =>
          page === "ellipsis" ? (
            <span
              key={`ellipsis-${index}`}
              className="px-1 text-xs text-gray-400 dark:text-gray-500"
            >
              …
            </span>
          ) : (
            <button
              key={page}
              type="button"
              onClick={() => onPageChange(page)}
              className={`h-8 min-w-8 rounded-lg px-2 text-xs font-medium ${
                page === currentPage
                  ? "bg-brand-500 text-white"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]"
              }`}
            >
              {page}
            </button>
          )
        )}

        <button
          type="button"
          title="Next page"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed dark:text-gray-400 dark:hover:bg-white/[0.05]"
        >
          <AngleRightIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
