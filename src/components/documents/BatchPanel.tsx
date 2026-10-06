import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Badge from "../ui/badge/Badge";
import { authService } from "../../services/authService";
import { uploadService } from "../../services/uploadService";
import { documentService, Category } from "../../services/documentService";
import ImageEditor, { ImageEditorHandle, Edit } from "./ImageEditor";
import { imageTextService, ImageText } from "../../services/imageTextService";
import { draftStore } from "../../services/draftStore";
import { useProject } from "../../context/ProjectContext";
import { verificationService, ImageDecision } from "../../services/verificationService";
import type { Review, ReviewImage } from "../../services/verificationService";

// What the pipeline has done to a document. Verification is deliberately not
// here — that happens after the batch is closed, so at capture time it would
// always read as "not done" and mean nothing.
function StateChips({
  item,
  editable = false,
  onOpen,
  pendingCategoryName = null,
  className = "",
  autoStages = null,
}: {
  item: ReviewImage;
  // Clicking a chip opens the document full size, where the category can be
  // picked from the list beside it. Manual enhancement is not built yet.
  editable?: boolean;
  onOpen?: () => void;
  // A category picked but not yet saved. Shown in the chip in place of the
  // saved one, in red, so an unsaved pick can't be mistaken for a stored one.
  pendingCategoryName?: string | null;
  className?: string;
  // Which stages this project runs, from the API. Null until the review has
  // loaded, and then the tooltip can say whether a grey chip is a stage that
  // is switched off or one that has not run yet.
  autoStages?: Review["auto_stages"] | null;
}) {
  const states: [string, boolean][] = [
    ["Enhanced", Boolean(item.enhanced)],
    ["Categorised", Boolean(item.categorised)],
    ["OCR", Boolean(item.read)],
  ];

  return (
    <span className={`flex flex-wrap items-center gap-2 ${className}`}>
      {states.map(([label, done]) => {
        const unsaved = label === "Categorised" && Boolean(pendingCategoryName);
        // Once a document has a category, the category's own name says more
        // than the word "Categorised" ever did. Without one it says
        // "Category", in red — a document the pipeline gave up on and one it
        // has not reached yet look the same from here, because the answer is
        // the same either way: somebody picks a category. Asking the
        // pipeline again is one button on the tab row.
        // The word stays the same whether the stage has run or not — the
        // colour is what says which, and "Not enhanced" beside a grey chip
        // said it twice. Categorised is the exception: once a document has
        // one, the category's own name tells you more than the word ever
        // did, and without one "Category" is what somebody still has to
        // pick.
        const text = unsaved
          ? pendingCategoryName!
          : label === "Categorised"
          ? (done && categoryOf(item)) || (done ? label : "Category")
          : label;

        // Three states, three colours — because red has to keep meaning
        // "something is wrong". A project with categorisation switched off
        // has no category on any page, which is normal; painting every one
        // of them red teaches people to ignore red.
        //
        //   green  — stored: the category's own name, or "Enhanced"
        //   amber  — picked but not saved yet
        //   red    — the stage ran and gave up on this document
        //   grey   — nothing has been done yet, and nothing is wrong
        //
        // `enhance_failed` / `analyze_failed` are only true for a stage the
        // project actually runs (see verificationService), so "off" and
        // "failed" cannot be confused here.
        const failed =
          label === "Categorised"
            ? item.analyze_failed
            : label === "OCR"
              ? item.ocr_failed
              : item.enhance_failed;

        // Whether this project runs the stage at all. A stage that is off is
        // grey forever and that is correct — but the tooltip has to say so,
        // or grey means both "off" and "not yet" with nothing to tell them
        // apart.
        const runsStage =
          autoStages === null
            ? true
            : label === "Categorised"
              ? autoStages.categorise
              : label === "OCR"
                ? autoStages.ocr
                : autoStages.enhance;
        const colour =
          done && !unsaved
            ? "border-success-500/40 bg-success-500/15 text-success-600 dark:text-success-500"
            : unsaved
              ? "border-warning-500/40 bg-warning-500/15 text-warning-600 dark:text-warning-500"
              : failed
                ? "border-error-500/40 bg-error-500/15 text-error-600 dark:text-error-500"
                : "border-gray-300 bg-gray-100 text-gray-500 dark:border-gray-600 dark:bg-white/[0.06] dark:text-gray-400";
        // A category name can be a sentence, so the chip grows to fit and
        // stops at a cap, cutting the rest with an ellipsis. The full name is
        // on hover.
        const shape =
          "inline-block max-w-32 truncate rounded-full border px-2 py-0.5 text-xs font-medium align-middle";

        // The chip is the button — a separate pencil beside it was one more
        // small target to hit for something the label already names.
        return editable ? (
          <button
            key={label}
            type="button"
            // The name first, then what clicking does — a truncated category
            // is the thing someone hovers to read.
            title={
              // Say which of the three a grey or red chip is, so the
              // colour never has to be guessed at.
              failed
                ? `${
                    label === "Categorised"
                      ? "Categorisation"
                      : label === "OCR"
                        ? "Reading the text"
                        : "Enhancement"
                  } failed on this document — ask again from the tab row, or do it by hand`
                : !runsStage
                ? `${
                    label === "Categorised"
                      ? "Categorisation"
                      : label === "OCR"
                        ? "Reading the text"
                        : "Enhancement"
                  } is switched off for this project — nothing is waiting on it. Click to open full size`
                : label === "Categorised"
                ? `${text} — click to open full size and pick a category`
                : label === "OCR"
                  ? `${item.read ? "The text has been read off this page" : "This page has not been read"} — click to open full size`
                  : `${item.enhanced ? "Enhanced" : "Not enhanced yet"} — click to open full size`
            }
            onClick={(e) => {
              e.stopPropagation();
              onOpen?.();
            }}
            className={`${shape} transition hover:ring-1 hover:ring-current ${colour}`}
          >
            {text}
          </button>
        ) : (
          <span
            key={label}
            title={
              !runsStage
                ? `${text} — switched off for this project`
                : text
            }
            className={`${shape} ${colour}`}
          >
            {text}
          </span>
        );
      })}
    </span>
  );
}

// The document's category row, if it has one. Kept as the row rather than
// just the name because changing a category means updating that row.
type ImageCategoryRow = {
  image_category_id: number;
  category_id: number;
  category?: { category_name?: string };
};

const imageCategoryRow = (item: ReviewImage): ImageCategoryRow | null => {
  const raw = item.image as unknown as { image_categories?: ImageCategoryRow[] };
  return raw.image_categories?.[0] ?? null;
};

// The category the pipeline (or a person) settled on, if any.
const categoryOf = (item: ReviewImage) =>
  imageCategoryRow(item)?.category?.category_name || null;

/**
 * What is actually in this batch — for the person capturing it.
 *
 * Until now a document disappeared the moment it uploaded: nothing said what
 * had been stored, what state it was in, or what a verifier had said about it.
 * On a corrections round that was the whole problem — the rejections and their
 * reasons existed, with nowhere to be seen.
 */
type BatchPanelProps = {
  assignmentId: number;
  // Controlled from the tab bar, where the slider lives — the panel just
  // draws at whatever size it's told.
  tileSize: number;
  // Also from the tab bar: whether the detail pane is showing. Off gives the
  // whole width to the grid.
  showPane: boolean;
  // Bumped by the Refresh button in the tab bar. A counter rather than a
  // callback, so the button doesn't need a handle on this component.
  refreshSignal?: number;
  // Reported up so the count can sit in the header, where the eye already is.
  // Both numbers: "1 of 28" says how much of the batch came back, which a
  // bare count doesn't.
  onRejectedCount?: (rejected: number, total: number) => void;
  // So the refresh button itself can spin, rather than a line of text
  // appearing above the grid and shifting it.
  onRefreshing?: (busy: boolean) => void;
  // The loaded batch, handed up so the screen doesn't fetch it a second time
  // for its own purposes.
  onLoaded?: (review: Review) => void;
  // How many documents are holding unsaved changes, so the strip offering to
  // save them can live on the tab row with the other batch controls.
  onDraftsChange?: (state: { count: number; saving: { done: number; total: number } | null }) => void;
  // Whether the pages have been dragged into an order that is not stored yet,
  // so the offer to save or reset it sits on the tab row with everything else.
  onOrderChange?: (state: { changed: boolean; saving: boolean }) => void;
  // Documents a pipeline stage gave up on, for the same reason: the offer to
  // ask again belongs with the rest of the batch controls, not above the grid.
  onFailuresChange?: (state: {
    count: number;
    // Which stage gave up, so the header can say "3 not enhanced" rather
    // than "3 not processed".
    enhance: number;
    analyze: number;
    retrying: boolean;
  }) => void;
  // Said out loud when a save finishes, on whichever tab the person is
  // looking at — the screen owns the toast.
  onToast?: (message: string, type: "success" | "error") => void;
};

export type BatchPanelHandle = {
  saveAllDrafts: () => Promise<void>;
  discardAllDrafts: () => Promise<void>;
  saveOrder: () => Promise<void>;
  resetOrder: () => void;
  retryAllFailed: () => Promise<void>;
  ignoreFailures: () => void;
};

const BatchPanel = forwardRef<BatchPanelHandle, BatchPanelProps>(function BatchPanel({
  assignmentId,
  tileSize,
  showPane,
  refreshSignal = 0,
  onRejectedCount,
  onRefreshing,
  onLoaded,
  onDraftsChange,
  onOrderChange,
  onFailuresChange,
  onToast,
}, ref) {
  const { project } = useProject();
  const [review, setReview] = useState<Review | null>(null);
  // The project's categories, for picking one by hand in the viewer.
  const [categories, setCategories] = useState<Category[]>([]);
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState("");
  // The category picker in the viewer is a dropdown now rather than a tall
  // list: the column it shares with the picture tools has room for one
  // control, not for a column of options.
  const [categoryOpen, setCategoryOpen] = useState(false);
  // What the page says, when it has been read. Null means not read, which
  // most pages are not; an empty string means read and blank, which is a
  // different answer and the panel says so.
  const [openText, setOpenText] = useState<ImageText | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  // The correction being typed. Null means nobody is editing — an empty
  // string is a real edit, "this page has nothing on it", so the two
  // cannot share a value.
  const [textDraft, setTextDraft] = useState<string | null>(null);
  const [savingText, setSavingText] = useState(false);
  // What just happened to the category, said in words. Clears itself — it is
  // an acknowledgement, not a state of the document.
  const [categoryNotice, setCategoryNotice] = useState<{ text: string; good: boolean } | null>(null);
  const [noticeFading, setNoticeFading] = useState(false);
  // Every document in this batch with unsaved changes. The heavy part — the
  // edited picture — lives in IndexedDB, not here (see `draftStore`); this
  // map holds only what the screen needs to draw: whether there is an edit,
  // the picked category, and a small preview.
  const [drafts, setDrafts] = useState<
    Map<
      number,
      { categoryId: number | null; hasImage: boolean; preview: string | null; edit: Edit | null }
    >
  >(new Map());
  // Drafts belong to the batch, so they are read back whenever it changes —
  // including after a reload, which is why someone whose browser crashed
  // mid-batch still has their work.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const saved = await draftStore.listByAssignment(assignmentId);
        if (cancelled) return;
        const map = new Map<
          number,
          { categoryId: number | null; hasImage: boolean; preview: string | null; edit: Edit | null }
        >();
        saved.forEach((draft) => {
          map.set(draft.imageId, {
            categoryId: draft.categoryId,
            hasImage: Boolean(draft.full),
            edit: draft.edit ?? null,
            // Only the thumbnail is held open; the full picture stays on disk
            // until it is saved.
            preview: draft.thumb ? URL.createObjectURL(draft.thumb) : null,
          });
        });
        setDrafts(map);
      } catch {
        // No local store (a private window, say) means no drafts, not a
        // broken batch.
      }
    })();

    return () => {
      cancelled = true;
      setDrafts((prev) => {
        prev.forEach((draft) => draft.preview && URL.revokeObjectURL(draft.preview));
        return new Map();
      });
    };
  }, [assignmentId]);

  // The one Apply at the foot of the viewer drives the editor from outside it.
  const editorRef = useRef<ImageEditorHandle>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);
  // What to do once the person has answered the "leave without applying?"
  // question — close the viewer, or step to another document.
  const afterLeave = useRef<(() => void) | null>(null);
  // Moving to the next document is not leaving: nothing is lost by applying
  // first, so it asks a smaller question than the way out does.
  const [confirmStep, setConfirmStep] = useState<null | (() => void)>(null);
  // The document being written right now, so its tile can show it is busy the
  // way the Add documents tab does.
  const [savingImageId, setSavingImageId] = useState<number | null>(null);
  // Re-shooting a page the verifier sent back.
  const [replacing, setReplacing] = useState(false);
  // Asks the batch to reload without the tab bar's refresh button — a
  // replacement arrives through the pipeline a moment later.
  const [selfRefresh, setSelfRefresh] = useState(0);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const replaceTargetRef = useRef<ReviewImage | null>(null);

  // Picked but not yet saved, tied to the document it was picked for — the
  // choice is made in the full-size viewer and saved back on the pane, so it
  // has to survive the viewer closing.
  const [pendingCategory, setPendingCategory] = useState<
    { imageId: number; categoryId: number } | null
  >(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Map<number, string>>(new Map());
  const previewsRef = useRef(previews);
  previewsRef.current = previews;

  // How many tiles are signed at a time. Big enough that scrolling rarely
  // waits, small enough that opening a 500-document batch doesn't sign 500
  // URLs nobody looks at.
  const PAGE_SIZE = 40;
  const [signedUpTo, setSignedUpTo] = useState(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // One request for a whole page of keys, rather than one per document.
  const signPage = async (items: ReviewImage[], token: string) => {
    const wanted = items.filter((item) => !previewsRef.current.has(item.image.image_id));
    if (wanted.length === 0) return;

    const keys = wanted.map((item) => `thumb/${item.image.image_path}`);
    try {
      const urls = await uploadService.getDownloadUrls(keys, token);
      setPreviews((prev) => {
        const next = new Map(prev);
        wanted.forEach((item) => {
          const url = urls.get(`thumb/${item.image.image_path}`);
          if (url) next.set(item.image.image_id, url);
        });
        return next;
      });
      setSignedUpTo((n) => Math.max(n, items.length));
    } catch {
      // Leaves those tiles without a preview; the rest of the grid still works.
    }
  };
  // Two different things: what's SELECTED shows in the side pane, what's
  // OPEN fills the screen. Clicking a tile selects; clicking the pane opens.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [openItem, setOpenItem] = useState<ReviewImage | null>(null);

  // Read by the keyboard handler, which is registered once and would otherwise
  // close over the first render's values.
  const reviewRef = useRef<Review | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  // Measured rather than calculated: the grid is auto-fill, so how many
  // columns exist depends on the panel's width and the current tile size.
  const gridRef = useRef<HTMLDivElement | null>(null);
  // Each tile, so moving the selection can scroll it into view. Stepping with
  // the arrows or the pane's buttons otherwise walked off the bottom of the
  // grid and left the selected document out of sight.
  const tileRefs = useRef<Map<number, HTMLElement>>(new Map());

  // Pane width, dragged by the divider and remembered per browser. Clamped so
  // it can't be dragged shut or squeeze the grid out of existence.
  const MIN_PANE = 240;
  const MAX_PANE = 720;
  const [paneWidth, setPaneWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("smartdoc.batchPaneWidth"));
      return saved >= MIN_PANE && saved <= MAX_PANE ? saved : 320;
    } catch {
      return 320;
    }
  });
  // The full-size image is fetched only when a document is opened — the grid
  // never loads it.
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  // Documents whose thumbnail wouldn't load — one write can fail while the
  // document itself is fine. Presigning a missing key still succeeds, so the
  // only place this shows up is the image failing to load.
  const [thumbFailed, setThumbFailed] = useState<Set<number>>(new Set());

  // Left/right walk the grid. Held here rather than on each tile so it works
  // wherever focus happens to be in the panel.
  useEffect(() => {
    const columnCount = () => {
      const grid = gridRef.current;
      if (!grid) return 1;
      // "120px 120px 120px" — one entry per column, whatever auto-fill chose.
      const columns = getComputedStyle(grid).gridTemplateColumns;
      return Math.max(1, columns.split(" ").filter(Boolean).length);
    };

    const onKey = (e: KeyboardEvent) => {
      const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
      if (!keys.includes(e.key)) return;

      // Don't steal the arrows from someone typing a comment.
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }

      const list = reviewRef.current?.images ?? [];
      if (list.length === 0) return;

      const index = list.findIndex((i) => i.image.image_id === selectedIdRef.current);

      // Nothing selected yet: forwards keys start at the beginning, backwards
      // at the end.
      if (index === -1) {
        const first = e.key === "ArrowRight" || e.key === "ArrowDown" ? 0 : list.length - 1;
        setSelectedId(list[first].image.image_id);
        e.preventDefault();
        return;
      }

      // Up and down move a whole row, which is what the eye expects in a grid.
      const step =
        e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : columnCount() * (e.key === "ArrowUp" ? -1 : 1);

      const target = Math.min(Math.max(index + step, 0), list.length - 1);
      setSelectedId(list[target].image.image_id);
      e.preventDefault();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Sign the next page when the end of the grid comes into view. What is
  // never scrolled to is never signed and never fetched.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !review) return;

    const observer = new IntersectionObserver(async (entries) => {
      if (!entries[0].isIntersecting) return;
      if (signedUpTo >= review.images.length) return;

      const token = await authService.ensureValidToken();
      await signPage(review.images.slice(0, signedUpTo + PAGE_SIZE), token);
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review, signedUpTo]);

  // Dragging is tracked on the document, not the handle: the pointer routinely
  // leaves a 4px strip mid-drag, and listeners on the handle would stop firing.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = paneWidth;

    const onMove = (move: MouseEvent) => {
      // Dragging left widens the pane, since it grows from the right edge.
      const next = Math.min(MAX_PANE, Math.max(MIN_PANE, startWidth + (startX - move.clientX)));
      setPaneWidth(next);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      setPaneWidth((width) => {
        try {
          localStorage.setItem("smartdoc.batchPaneWidth", String(width));
        } catch {
          // A browser that refuses storage still resizes, it just forgets.
        }
        return width;
      });
    };

    // Without this the drag selects the text it passes over.
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const fallBackToOriginal = async (item: ReviewImage) => {
    if (thumbFailed.has(item.image.image_id)) return;
    setThumbFailed((prev) => new Set(prev).add(item.image.image_id));
    try {
      const token = await authService.ensureValidToken();
      const url = await uploadService.getDownloadUrl(item.image.image_path, token);
      setPreviews((prev) => new Map(prev).set(item.image.image_id, url));
    } catch {
      // Nothing more to try; the tile shows "No preview".
    }
  };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


  // The full image is fetched for whatever is selected — the pane shows it,
  // and opening it full screen then costs nothing. The grid itself never
  // touches these.
  useEffect(() => {
    if (!selectedId) {
      setFullUrl(null);
      return;
    }

    const item = review?.images.find((i) => i.image.image_id === selectedId);
    if (!item) return;

    let cancelled = false;
    setFullUrl(null);
    (async () => {
      try {
        const token = await authService.ensureValidToken();
        const url = await uploadService.getDownloadUrl(item.image.image_path, token);
        if (!cancelled) setFullUrl(url);
      } catch {
        if (!cancelled) setFullUrl(null);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, review]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // First visit shows a spinner; a refresh leaves the grid up.
      const first = previewsRef.current.size === 0;
      if (first) setLoading(true);
      // Not `loading`: the grid keeps showing what it has while the new list
      // arrives, so tiles don't blink out and back.
      else onRefreshing?.(true);
      setError(null);

      try {
        const token = await authService.ensureValidToken();
        const result = await verificationService.getReview(assignmentId, token);
        if (cancelled) return;
        setReview(result);
        // What the database says the order is, for Reset to go back to.
        setSavedOrder(result.images.map((row) => row.image.image_id));
        onLoaded?.(result);
        onRejectedCount?.(
          result.images.filter((i) => i.decision === ImageDecision.REJECTED).length,
          result.images.length
        );
        // Something is always selected, so the pane is never blank while
        // documents exist.
        setSelectedId((prev) =>
          prev && result.images.some((i) => i.image.image_id === prev)
            ? prev
            : result.images[0]?.image.image_id ?? null
        );

        // Only the first page is signed here; the rest follow as they are
        // scrolled to (see the observer below). Signing every document up
        // front meant a request per tile before the grid could settle.
        await signPage(result.images.slice(0, PAGE_SIZE), token);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load this batch");
      } finally {
        if (!cancelled) {
          setLoading(false);
          onRefreshing?.(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [assignmentId, refreshSignal, selfRefresh]);

  const message = loading
    ? null
    : error
    ? error
    : !review || review.images.length === 0
    ? "Nothing uploaded against this assignment yet"
    : null;

  reviewRef.current = review;
  selectedIdRef.current = selectedId;

  /** Write (or update) the draft for one document. */
  const rememberDraft = async (
    imageId: number,
    patch: { categoryId?: number | null; full?: Blob; thumb?: Blob; edit?: Edit },
  ) => {
    const existing = await draftStore.get(imageId);
    const draft = {
      imageId,
      assignmentId,
      categoryId: patch.categoryId !== undefined ? patch.categoryId : existing?.categoryId ?? null,
      full: patch.full ?? existing?.full ?? null,
      thumb: patch.thumb ?? existing?.thumb ?? null,
      edit: patch.edit ?? existing?.edit ?? null,
      updatedAt: Date.now(),
    };
    await draftStore.put(draft);

    setDrafts((prev) => {
      const next = new Map(prev);
      const old = next.get(imageId);
      // The old preview is replaced, so its handle goes with it.
      if (old?.preview && patch.thumb) URL.revokeObjectURL(old.preview);
      next.set(imageId, {
        categoryId: draft.categoryId,
        hasImage: Boolean(draft.full),
        edit: draft.edit,
        preview: patch.thumb
          ? URL.createObjectURL(patch.thumb)
          : old?.preview ?? (draft.thumb ? URL.createObjectURL(draft.thumb) : null),
      });
      return next;
    });
  };

  const forgetDraft = async (imageId: number) => {
    await draftStore.remove(imageId);
    setDrafts((prev) => {
      const next = new Map(prev);
      const old = next.get(imageId);
      if (old?.preview) URL.revokeObjectURL(old.preview);
      next.delete(imageId);
      return next;
    });
  };

  // Dragging a page to a new place in the batch. `dragFrom` is the page being
  // carried, `dragOver` the gap it would drop into — kept apart so the tile
  // under the pointer can show where it would land.
  // Typing a page's new place, for when dragging it there would mean
  // crossing a whole screenful of tiles.
  const [moveId, setMoveId] = useState<number | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

  // The order as the database has it, taken when the batch is read. Dragging
  // changes the screen; this is what Reset goes back to, and what tells us
  // whether anything is unsaved.
  const [savedOrder, setSavedOrder] = useState<number[]>([]);

  const currentOrder = (review?.images ?? []).map((row) => row.image.image_id);
  const orderChanged =
    savedOrder.length === currentOrder.length &&
    savedOrder.some((id, index) => id !== currentOrder[index]);

  /**
   * Move a page on screen. Nothing is written until Save.
   *
   * Dragging is fiddly and easy to get wrong by a place or two, so the batch
   * is rearranged as much as someone likes and then committed once — with
   * Reset to put it back if the result is worse than what they started with.
   */
  const movePage = (from: number, to: number) => {
    if (!review || from === to) return;
    const ordered = [...review.images];
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    setReview({ ...review, images: ordered });
  };

  const saveOrder = async () => {
    if (!review) return;
    setSavingOrder(true);
    try {
      const token = await authService.ensureValidToken();
      const ids = review.images.map((row) => row.image.image_id);
      await uploadService.reorderBatch(assignmentId, ids, token);
      setSavedOrder(ids);
      onToast?.("Order saved", "success");
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : "Could not save the order", "error");
      setSelfRefresh((n) => n + 1);
    } finally {
      setSavingOrder(false);
    }
  };

  const resetOrder = () => {
    if (!review) return;
    const byId = new Map(review.images.map((row) => [row.image.image_id, row]));
    setReview({
      ...review,
      images: savedOrder.map((id) => byId.get(id)).filter((row): row is ReviewImage => !!row),
    });
  };

  /**
   * Get a preview for one document, whatever the batch has signed so far.
   *
   * The grid signs a page at a time, so a document added at the end of a long
   * batch has no URL until someone scrolls to it — which is why a replacement
   * arrived as an empty tile. Its thumbnail is written by the enhance service
   * a moment later, so this falls back to the full-size picture and tries the
   * thumbnail again shortly.
   */
  const signOne = async (item: ReviewImage, attempt = 0) => {
    try {
      const token = await authService.ensureValidToken();
      const key = `thumb/${item.image.image_path}`;
      const urls = await uploadService.getDownloadUrls([key], token);
      const thumb = urls.get(key);

      const url = thumb ?? (await uploadService.getDownloadUrl(item.image.image_path, token));
      setPreviews((prev) => new Map(prev).set(item.image.image_id, url));

      // The thumbnail may not exist yet; ask again while the pipeline works.
      if (attempt < 3) {
        window.setTimeout(() => signOne(item, attempt + 1), 4000 * (attempt + 1));
      }
    } catch {
      // The tile shows "No preview" until the next refresh.
    }
  };

  const [retrying, setRetrying] = useState(false);

  // Failures someone has waved away. Enhancing and categorising can both be
  // done by hand, so a document the pipeline gave up on is not necessarily a
  // problem — and a tag that cannot be dismissed just becomes noise on a
  // batch nobody intends to retry.
  const [ignoredFailures, setIgnoredFailures] = useState<Set<number>>(new Set());

  // Documents a stage gave up on, minus the ones already waved away.
  const failedItems = (review?.images ?? []).filter(
    (item) =>
      (item.enhance_failed || item.analyze_failed) &&
      !ignoredFailures.has(item.image.image_id),
  );

  /**
   * Ask a pipeline stage to try this document again.
   *
   * Enhance and analyze record a failure and stop rather than dead-lettering,
   * so nothing retries by itself. This is the other half of that: once the
   * cause is fixed — a service restarted, credit topped up — a person can put
   * the document back on the queue instead of doing the work by hand.
   */
  const retryStage = async (
    item: ReviewImage,
    stage: "enhance" | "analyze" | "ocr",
    quiet = false,
  ) => {
    if (!project?.project_id || !review) return;

    setRetrying(true);
    try {
      const token = await authService.ensureValidToken();
      await uploadService.retryStage(
        stage,
        {
          imageId: item.image.image_id,
          objectKey: item.image.image_path,
          projectId: project.project_id,
          identifierId: review.assignment.identifier_id,
        },
        token,
      );
      if (!quiet) {
        onToast?.("Asked again — it should update shortly", "success");
        window.setTimeout(() => setSelfRefresh((n) => n + 1), 4000);
      }
    } catch (err) {
      onToast?.(
        err instanceof Error ? err.message : "Could not ask for another go",
        "error",
      );
    } finally {
      setRetrying(false);
    }
  };

  /**
   * Ask again for every document a stage gave up on.
   *
   * One button rather than one per document: whatever broke — a service
   * down, a key expired — broke it for all of them, so they are fixed
   * together too.
   */
  const retryAllFailed = async () => {
    for (const item of failedItems) {
      // eslint-disable-next-line no-await-in-loop
      await retryStage(item, item.enhance_failed ? "enhance" : "analyze", true);
    }
    onToast?.("Asked again — they should update shortly", "success");
    window.setTimeout(() => setSelfRefresh((n) => n + 1), 4000);
  };

  /**
   * Put a fresh photograph in place of one that was sent back.
   *
   * The new file is uploaded like any other document — same identifier, same
   * assignment — and the rejected one is then retired, which is what stops a
   * batch carrying a rejection it can never be completed with. The old page
   * stays in the database with its comment thread; it just leaves the batch.
   */
  const replaceRejected = async (item: ReviewImage, file: File) => {
    if (!project?.project_id || !review) return;

    setReplacing(true);
    try {
      const token = await authService.ensureValidToken();

      const urls = await uploadService.requestUploadUrls(
        project.project_id,
        review.assignment.identifier_id,
        [file],
        token,
      );
      const target = urls.uploads[0];
      await uploadService.uploadFileToS3(target.signedUrl, file);

      // The replacement inherits what was captured with the original, so the
      // attributes typed at capture are not lost with the page.
      const attributes = (
        (item.image as unknown as {
          image_attributes?: { attribute_id: number; attribute_value: string }[];
        }).image_attributes ?? []
      ).map((a) => ({ attribute_id: a.attribute_id, attribute_value: a.attribute_value }));

      await uploadService.confirmUpload(
        target.objectKey,
        target.originalname,
        project.project_id,
        review.assignment.identifier_id,
        target.size,
        token,
        String(assignmentId),
        attributes,
      );

      // The new page is created by smartdoc_db_service off the queue, a
      // moment after the upload, so wait for it to appear — matched on the
      // key we just wrote, not on "the newest row", which would be a guess.
      let fresh: ReviewImage | null = null;
      for (let attempt = 0; attempt < 8 && !fresh; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        const current = await verificationService.getReview(assignmentId, token);
        fresh = current.images.find((i) => i.image.image_path === target.objectKey) ?? null;
      }

      if (!fresh) {
        // Uploaded, but not through the pipeline yet. The rejected page stays
        // where it is rather than being retired against nothing.
        onToast?.(
          "Uploaded, but it hasn't come through yet — refresh in a moment to finish replacing",
          "error",
        );
        return;
      }

      const updated = await verificationService.supersedeImage(
        assignmentId,
        item.image.image_id,
        fresh.image.image_id,
        token,
      );
      setReview(updated);
      setSelectedId(fresh.image.image_id);
      signOne(fresh);

      onToast?.("Document replaced — it will appear once processed", "success");
      // The new page arrives through the pipeline, so ask again shortly.
      window.setTimeout(() => setSelfRefresh((n) => n + 1), 2000);
    } catch (err) {
      onToast?.(
        err instanceof Error ? err.message : "Failed to replace the document",
        "error",
      );
    } finally {
      setReplacing(false);
      replaceTargetRef.current = null;
    }
  };

  // Loaded once per project: a few rows, and the viewer needs them the
  // instant a document is opened.
  useEffect(() => {
    if (!project?.project_id) return;
    let cancelled = false;

    (async () => {
      try {
        const token = await authService.ensureValidToken();
        const response = await documentService.getCategories(project.project_id, token);
        if (!cancelled) setCategories(response.data.filter((c) => c.is_active === 1));
      } catch {
        // The viewer then shows nothing to pick from; the rest still works.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [project?.project_id]);

  // A different document starts with a clean search box — the last one's
  // typing has nothing to do with this one.
  useEffect(() => {
    setCategoryQuery("");
    setCategoryError(null);
  }, [openItem?.image.image_id]);

  // Shows, then fades out on its own. Long enough to read, short enough that
  // it is gone before it becomes part of the furniture.
  useEffect(() => {
    if (!categoryNotice) return;
    setNoticeFading(false);
    const fade = window.setTimeout(() => setNoticeFading(true), 1200);
    const gone = window.setTimeout(() => setCategoryNotice(null), 1800);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(gone);
    };
  }, [categoryNotice]);

  // Moving to another document drops an unsaved pick — it belonged to the
  // one you were looking at.
  useEffect(() => {
    setPendingCategory(null);
    setCategoryError(null);
    setCategoryNotice(null);
  }, [selectedId]);

  /**
   * Put a category on the open document.
   *
   * The row is updated when one already exists rather than added to — the
   * API reads a document's category back with an unordered `findOne`, so a
   * second row would make which one wins a coin toss.
   */
  const saveChanges = async (item: ReviewImage): Promise<boolean> => {
    const existing = imageCategoryRow(item);
    // Read once, at the moment of saving — this is the only time the
    // full-size picture comes off disk and into memory.
    const draft = await draftStore.get(item.image.image_id);
    if (!draft) return false;

    const editToSave = draft.full && draft.thumb ? { full: draft.full, thumb: draft.thumb } : null;
    const categoryToSave =
      draft.categoryId !== null && existing?.category_id !== draft.categoryId
        ? draft.categoryId
        : null;

    if (!editToSave && categoryToSave === null) {
      await forgetDraft(item.image.image_id);
      return true;
    }

    setSavingCategory(true);
    setSavingImageId(item.image.image_id);
    setCategoryError(null);
    try {
      const token = await authService.ensureValidToken();

      // The edited picture goes first: it replaces the stored document and
      // its thumbnail under the same key, so nothing else in the system has
      // to learn a new name for it.
      if (editToSave) {
        const { signedUrl, thumbSignedUrl } = await uploadService.getReplaceUrls(
          item.image.image_path,
          editToSave.full.type,
          token,
        );
        await uploadService.putSignedBlob(signedUrl, editToSave.full);
        await uploadService.putSignedBlob(thumbSignedUrl, editToSave.thumb);
        // Says the document has been worked on by hand. image_status 2 =
        // PROCESSED, the same row smartdoc_enhance_service writes.
        await documentService.markImageProcessed(item.image.image_id, token);
      }

      if (categoryToSave !== null) {
        await documentService.setImageCategory(
          item.image.image_id,
          categoryToSave,
          existing?.image_category_id ?? null,
          token,
        );
      }

      const picked = categories.find((c) => c.category_id === categoryToSave);
      // Patched in place rather than re-fetching the batch: one document
      // changed, and a reload would drop every signed URL on the way.
      setReview((prev) =>
        prev
          ? {
              ...prev,
              images: prev.images.map((row) =>
                row.image.image_id === item.image.image_id
                  ? {
                      ...row,
                      categorised: categoryToSave !== null ? true : row.categorised,
                      enhanced: editToSave ? true : row.enhanced,
                      image:
                        categoryToSave !== null
                          ? {
                              ...row.image,
                              image_categories: [
                                {
                                  image_category_id: existing?.image_category_id ?? 0,
                                  category_id: categoryToSave,
                                  category: picked
                                    ? { category_name: picked.category_name }
                                    : undefined,
                                },
                              ],
                            }
                          : row.image,
                    }
                  : row,
              ),
            }
          : prev,
      );
      // The grid should show the edited picture straight away; the stored
      // thumbnail behind it now matches.
      if (editToSave) {
        const shown = URL.createObjectURL(editToSave.thumb);
        setPreviews((prev) => {
          const next = new Map(prev);
          next.set(item.image.image_id, shown);
          return next;
        });
        setFullUrl(null);
      }

      await forgetDraft(item.image.image_id);
      setPendingCategory(null);
      setCategoryNotice({ text: "Changes saved", good: true });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save the changes";
      setCategoryError(message);
      onToast?.(message, "error");
      return false;
    } finally {
      setSavingCategory(false);
      setSavingImageId(null);
    }
  };

  // Saving the lot, one after another rather than at once: each one reads a
  // full-size picture off disk and pushes it to storage, and twenty of those
  // in parallel would stall the tab and the bucket alike.
  const [savingAll, setSavingAll] = useState<{ done: number; total: number } | null>(null);

  const saveAllDrafts = async () => {
    const list = (review?.images ?? []).filter((row) => drafts.has(row.image.image_id));
    if (list.length === 0) return;

    setSavingAll({ done: 0, total: list.length });
    try {
      let saved = 0;
      for (let i = 0; i < list.length; i += 1) {
        if (await saveChanges(list[i])) saved += 1;
        setSavingAll({ done: i + 1, total: list.length });
      }
      if (saved > 0) {
        onToast?.(
          saved === 1 ? "1 document saved" : `${saved} documents saved`,
          "success",
        );
      }
    } finally {
      setSavingAll(null);
    }
  };

  const discardAllDrafts = async () => {
    await Promise.all([...drafts.keys()].map((imageId) => forgetDraft(imageId)));
  };

  useEffect(() => {
    onDraftsChange?.({ count: drafts.size, saving: savingAll });
  }, [drafts.size, savingAll, onDraftsChange]);

  const ignoreFailures = () =>
    setIgnoredFailures((prev) => {
      const next = new Set(prev);
      failedItems.forEach((item) => next.add(item.image.image_id));
      return next;
    });

  useImperativeHandle(ref, () => ({
    saveAllDrafts,
    discardAllDrafts,
    saveOrder,
    resetOrder,
    retryAllFailed,
    ignoreFailures,
  }));

  useEffect(() => {
    onOrderChange?.({ changed: orderChanged, saving: savingOrder });
  }, [orderChanged, savingOrder, onOrderChange]);

  const failedEnhance = failedItems.filter((item) => item.enhance_failed).length;
  const failedAnalyze = failedItems.filter((item) => !item.enhance_failed && item.analyze_failed).length;

  useEffect(() => {
    onFailuresChange?.({
      count: failedItems.length,
      enhance: failedEnhance,
      analyze: failedAnalyze,
      retrying,
    });
  }, [failedItems.length, failedEnhance, failedAnalyze, retrying, onFailuresChange]);

  // The editor is remade per document, and is not mounted at all for a locked
  // one; its flag has to start clean either way.
  useEffect(() => {
    setEditorDirty(false);
  }, [openItem?.image.image_id]);

  // A question that was asked about one document must not still be on screen
  // for the next one.
  useEffect(() => {
    setConfirmBack(false);
    setConfirmStep(null);
  }, [openItem?.image.image_id]);

  useEffect(() => {
    if (!openItem) return;

    const onKey = (event: KeyboardEvent) => {
      // Left and right step through the batch, as they do in the grid behind.
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const target = event.target as HTMLElement | null;
        if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
        event.stopImmediatePropagation();
        event.preventDefault();
        stepTo(event.key === "ArrowRight" ? 1 : -1);
        return;
      }

      if (event.key !== "Escape") return;
      // One press, one action: without this the press also reaches the other
      // Escape handlers on the screen, and the viewer closed underneath its
      // own dialog.
      event.stopImmediatePropagation();
      event.preventDefault();

      // In order: a crop rectangle goes first, then the dialog, then the
      // viewer itself.
      if (editorRef.current?.clearSelection()) return;
      if (confirmBack) setConfirmBack(false);
      else if (unapplied) setConfirmBack(true);
      else closeViewer();
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // Both halves of the draft: the category picked on the left, and whatever
  // the tools on the right are set to.
  const applyOpenChanges = async () => {
    if (!openItem) return;
    const imageId = openItem.image.image_id;

    setApplying(true);
    try {
      if (pendingCategory?.imageId === imageId) {
        await rememberDraft(imageId, { categoryId: pendingCategory.categoryId });
        setPendingCategory(null);
      }
      await editorRef.current?.apply();
    } finally {
      setApplying(false);
    }
  };

  // Closing the viewer drops anything that was never applied — a pick left
  // behind would otherwise come back the next time this document is opened,
  // looking like a draft nobody made.
  const closeViewer = () => {
    setPendingCategory(null);
    setConfirmBack(false);
    setOpenItem(null);
  };

  // Step to the document before or after this one, without going back to the
  // grid. Anything unapplied is asked about first, exactly as leaving is.
  // Keep the selected document on screen. `block: "nearest"` scrolls only
  // when it is actually out of view, so clicking a tile that is already
  // visible does not jump the grid.
  useEffect(() => {
    if (selectedId === null) return;
    tileRefs.current
      .get(selectedId)
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const stepTo = (delta: number) => {
    if (!openRow) return;
    const list = review?.images ?? [];
    const index = list.findIndex((i) => i.image.image_id === openRow.image.image_id);
    const next = list[index + delta];
    if (!next) return;

    const go = () => {
      setPendingCategory(null);
      setConfirmBack(false);
      setSelectedId(next.image.image_id);
      setOpenItem(next);
    };

    if (unapplied) {
      setConfirmStep(() => go);
      return;
    }
    go();
  };

  const images = review?.images ?? [];
  const selected = images.find((i) => i.image.image_id === selectedId) || null;
  // Re-read from the batch rather than trusting the snapshot taken when the
  // document was opened — picking a category updates the batch, and the
  // viewer has to show the new one.
  const openRow = openItem
    ? images.find((i) => i.image.image_id === openItem.image.image_id) || openItem
    : null;

  // What the viewer's list shows: whatever matches the search, with the
  // document's SAVED category first so it never has to be hunted for. An
  // unsaved pick deliberately stays where it is — the list reordering itself
  // under the pointer as you click is disorienting.
  const currentCategoryId = openRow ? imageCategoryRow(openRow)?.category_id ?? null : null;

  // The page's text, fetched when one is opened. Not part of the batch
  // payload on purpose: a batch of pages' full text is megabytes travelling
  // so that a chip can say yes or no, and the chip already knows.
  useEffect(() => {
    if (!openRow) {
      setOpenText(null);
      setTextDraft(null);
      return;
    }

    let cancelled = false;
    setTextLoading(true);
    setOpenText(null);
    setTextDraft(null);

    imageTextService
      .getLatest(openRow.image.image_id)
      .then((text) => {
        if (!cancelled) setOpenText(text);
      })
      .catch(() => {
        // Not being able to read the text costs the panel a line, not the
        // person their document.
        if (!cancelled) setOpenText(null);
      })
      .finally(() => {
        if (!cancelled) setTextLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [openRow?.image.image_id]);
  // What the viewer's list shows as chosen: the unsaved pick if there is one,
  // the saved category otherwise.
  // What a replacement stands in for: the page it replaced, and why that one
  // was sent back. Read from the retired list, which is why the review still
  // carries pages that have left the batch.
  const replacedBy = (item: ReviewImage) => {
    const originalId = item.image.replaces_image_id;
    if (!originalId) return null;
    const original = review?.retired_images?.find((r) => r.image.image_id === originalId);
    return {
      originalId,
      reason: original?.comments?.[original.comments.length - 1]?.comment ?? null,
    };
  };

  // Answered by the API, which is also what refuses to close the assignment.
  // Working it out here from the project's settings meant the screen could
  // show a batch as ready that the server then rejected.
  const stillProcessing = (item: ReviewImage) => Boolean(item.pipeline_pending);

  // Counted after the rule it uses is defined — reading it earlier crashed
  // the whole panel, which on this screen is a blank page.
  const processingCount = images.filter((item) => stillProcessing(item)).length;


  // A page the verifier accepted is not re-reviewed on a later round
  // (verification-redesign.md §12.7), so changing it here would publish a
  // picture nobody has looked at, under a verdict that refers to the old one.
  // The way to change it is to have the batch sent back.
  const locked = (item: ReviewImage | null) =>
    item !== null && item.decision === ImageDecision.VERIFIED;

  const openDraft = openRow ? drafts.get(openRow.image.image_id) ?? null : null;
  const pendingForOpen =
    (openRow && pendingCategory?.imageId === openRow.image.image_id
      ? pendingCategory.categoryId
      : null) ?? openDraft?.categoryId ?? null;
  const shownCategoryId = pendingForOpen ?? currentCategoryId;

  // Picked or set up in the viewer but not yet applied. Leaving with this
  // still outstanding loses it, so Back asks first.
  const unappliedCategory =
    openRow !== null &&
    pendingCategory?.imageId === openRow.image.image_id &&
    pendingCategory.categoryId !== (openDraft?.categoryId ?? currentCategoryId);
  // A locked document has no editor and no category list, so nothing can be
  // outstanding on it — without this the flag left over from the last
  // document asked the question again on the way out.
  const unapplied = !locked(openRow) && (unappliedCategory || editorDirty);

  // The same question for the pane, which is where it gets saved.
  const selectedDraft = selected ? drafts.get(selected.image.image_id) ?? null : null;
  const pendingForSelected = selectedDraft?.categoryId ?? null;
  const pendingIsChange =
    pendingForSelected !== null &&
    selected !== null &&
    pendingForSelected !== (imageCategoryRow(selected)?.category_id ?? null);
  const pendingName =
    categories.find((c) => c.category_id === pendingForSelected)?.category_name ?? "";
  const editForSelected = selectedDraft?.hasImage ? selectedDraft : null;
  const hasUnsaved = selectedDraft !== null;
  const query = categoryQuery.trim().toLowerCase();
  const listedCategories = categories
    .filter((c) => !query || c.category_name.toLowerCase().includes(query))
    .sort((a, b) => {
      if (a.category_id === currentCategoryId) return -1;
      if (b.category_id === currentCategoryId) return 1;
      return 0;
    });
  // Defensive: the API already separates batch comments from per-image ones,
  // and the pane must not start showing batch remarks if that ever slips.
  const imageNotes = (selected?.comments ?? []).filter(
    (c) => c.image_id === selected?.image.image_id
  );

  return (
    // Grid on the left, one document on the right. Clicking a tile selects it
    // into the pane; only clicking the pane's image opens it full screen.
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      {/* Loading, empty and failed states live INSIDE the frame — returning
          early took the size control with them. */}
      {message && (
        <p className={`text-sm ${error ? "text-red-500" : "text-gray-500 dark:text-gray-400"}`}>
          {message}
        </p>
      )}

      {/* Notes about the batch rather than any one page. */}
      {review && review.batch_comments.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <h4 className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
            Notes on the batch
          </h4>
          <ul className="space-y-1.5">
            {/* Newest first: on a corrections round the last thing said is
                the thing being answered. */}
            {[...review.batch_comments]
              .sort(
                (a, b) =>
                  new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
              )
              .map((c) => (
                <li key={c.assignment_comment_id} className="text-sm text-gray-700 dark:text-gray-300">
                  {c.comment}
                  <span className="ml-2 text-[11px] text-gray-500 dark:text-gray-400">
                    {c.created_by_username || "Unknown"}
                    {c.created_at ? ` · ${new Date(c.created_at).toLocaleString()}` : ""}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* Said once, above the grid: nothing else on a tile suggests it can be
          dragged. The offer to save or reset the new order lives on the tab
          row, next to the one for unsaved documents. */}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Drag a page to change its place in the batch, or click its number to
        send it straight to another place.
      </p>

      {processingCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
          <span className="text-sm text-gray-700 dark:text-gray-200">
            {processingCount === 1
              ? "1 document is still being enhanced or categorised."
              : `${processingCount} documents are still being enhanced or categorised.`}{" "}
            The assignment cannot be closed until they finish.
          </span>
          {processingCount < images.length && (
          <button
            type="button"
            onClick={() => {
              const first = images.find((i) => stillProcessing(i));
              if (first) setSelectedId(first.image.image_id);
            }}
            className="ml-auto flex h-7 items-center rounded-lg border border-gray-300 px-2.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.05]"
          >
            Show me
          </button>
          )}
        </div>
      )}

      {/* Tiles rather than cards: at a hundred documents a batch is something
          you scan, not read. Detail lives in the tile you open. The spacing
          matches the Add documents grid so the two tabs feel like one screen. */}
      <div
        ref={gridRef}
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))` }}
      >
        {images.map((item) => {
          // A draft edit shows in the grid too, so the batch reads the way it
          // will once saved.
          const draft = drafts.get(item.image.image_id);
          const isSaving = savingImageId === item.image.image_id;
          // A draft shows in the grid too, so the batch reads the way it will
          // once saved.
          const url = draft?.preview || previews.get(item.image.image_id);
          const isRejected = item.decision === ImageDecision.REJECTED;
          const isAccepted = item.decision === ImageDecision.VERIFIED;
          return (
            <button
              key={item.image.image_id}
              ref={(element) => {
                if (element) tileRefs.current.set(item.image.image_id, element);
                else tileRefs.current.delete(item.image.image_id);
              }}
              type="button"
              onClick={() => setSelectedId(item.image.image_id)}
              // Single click selects into the pane, double opens it full size
              // with the tools — the same pair the pane's own picture uses.
              onDoubleClick={() => {
                setSelectedId(item.image.image_id);
                setOpenItem(item);
              }}
              draggable={!savingOrder}
              onDragStart={(e) => {
                setDragFrom(images.indexOf(item));
                // Firefox will not start a drag without something to carry.
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(item.image.image_id));
              }}
              onDragOver={(e) => {
                if (dragFrom === null) return;
                e.preventDefault();
                setDragOver(images.indexOf(item));
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const to = images.indexOf(item);
                if (dragFrom !== null) movePage(dragFrom, to);
                setDragFrom(null);
                setDragOver(null);
              }}
              className={`group relative aspect-square cursor-grab overflow-hidden rounded-sm bg-gray-100 active:cursor-grabbing dark:bg-gray-900 ${
                dragOver === images.indexOf(item) && dragFrom !== images.indexOf(item)
                  ? "ring-2 ring-brand-500"
                  : ""
              } ${dragFrom === images.indexOf(item) ? "opacity-40" : ""} ${
                isRejected ? "ring-2 ring-error-500" : ""
              } ${
                item.image.image_id === selectedId
                  ? "outline outline-2 outline-offset-1 outline-brand-500"
                  : ""
              }`}
            >
              {url ? (
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  onError={() => fallBackToOriginal(item)}
                  className={`h-full w-full object-cover transition-transform duration-150 group-hover:scale-[1.03] ${
                    isSaving ? "opacity-50" : ""
                  }`}
                />
              ) : (
                <span className="flex h-full items-center justify-center text-[10px] text-gray-400">
                  No preview
                </span>
              )}

              {/* A dot, matching the verify screen: green accepted, red sent
                  back. Nothing at all while a batch is still being captured —
                  no decision has been made yet. */}
              {/* Being written to storage right now — the same spinner over a
                  dimmed picture that the Add documents tab uses. */}
              {isSaving && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="block size-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                </span>
              )}

              {/* Still with the pipeline. A dot, not a labelled pill: right
                  after an upload every tile is in this state, and 29 spinning
                  badges say nothing the line above the grid doesn't. When the
                  whole batch is processing there is nothing to single out, so
                  the marks are dropped altogether. */}
              {stillProcessing(item) && processingCount < images.length && (
                <span
                  title="Still being enhanced or categorised"
                  className="absolute right-1 top-1 size-2 rounded-full bg-gray-900/70 ring-2 ring-white/70 dark:bg-white/70 dark:ring-gray-900/70"
                />
              )}

              {/* Shot to replace a page that was sent back — otherwise a
                  corrections round leaves no trace on the batch at all. */}
              {item.image.replaces_image_id && (
                <span
                  title={
                    replacedBy(item)?.reason
                      ? `Replaces a page sent back: ${replacedBy(item)!.reason}`
                      : "Replaces a page that was sent back"
                  }
                  className="absolute left-1 bottom-1 rounded-full bg-brand-500 px-1.5 text-[10px] font-medium text-white"
                >
                  Replacement
                </span>
              )}

              {/* Unsaved work, so a batch half-edited is obvious at a glance. */}
              {draft && !isSaving && (
                <span
                  title="Unsaved changes"
                  className="absolute bottom-1 right-1 rounded-full bg-warning-500 px-1.5 text-[10px] font-medium text-white"
                >
                  Draft
                </span>
              )}

              {(isRejected || isAccepted) && (
                <span
                  title={isRejected ? "Sent back" : "Accepted"}
                  className={`absolute right-1 top-1 size-2 rounded-full ${
                    isRejected ? "bg-error-500" : "bg-success-500"
                  }`}
                />
              )}

              {item.comments.length > 0 && (
                <span className="absolute left-1 top-1 rounded bg-gray-900/70 px-1 text-[10px] text-white">
                  {item.comments.length}
                </span>
              )}

              {/* Its place in the batch, counted from the list rather than
                  read off the row — the stored number is spaced (1000, 2000)
                  so a page can be slipped in later, and nobody wants to see
                  that. Always on: the order is the thing being checked. */}
              <span
                role="button"
                tabIndex={-1}
                title="Click to move this page to another place"
                onClick={(e) => {
                  e.stopPropagation();
                  setMoveId(item.image.image_id);
                  setMoveTo(String(images.indexOf(item) + 1));
                }}
                className="absolute left-1 top-1 cursor-pointer rounded bg-gray-900/70 px-1.5 text-[10px] font-semibold text-white hover:bg-brand-500"
              >
                {images.indexOf(item) + 1}
              </span>

              {/* Everything about the document, on hover only — permanent
                  labels under every tile would drown the grid. */}
              <span className="pointer-events-none absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-gray-900/90 via-gray-900/70 to-transparent px-1.5 pb-1.5 pt-6 text-left opacity-0 transition-opacity group-hover:opacity-100">
                <span className="block truncate text-[10px] text-white">
                  {item.image.image_path.split("/").pop()}
                </span>
                {categoryOf(item) && (
                  <span className="block truncate text-[10px] text-white/70">
                    {categoryOf(item)}
                  </span>
                )}
                <span className="flex flex-wrap gap-1">
                  {[
                    ["E", Boolean(item.enhanced), "Enhanced"],
                    ["C", Boolean(item.categorised), "Categorised"],
                    ["O", Boolean(item.read), "Read"],
                  ].map(([short, done, label]) => (
                    <span
                      key={String(label)}
                      title={done ? String(label) : `Not ${String(label).toLowerCase()}`}
                      // Grey, not red, when a stage has not run. Most
                      // projects have OCR off and many have categorisation
                      // off, so red here would mark every page of a
                      // perfectly healthy batch as a problem — and red has
                      // to keep meaning that something is wrong.
                      className={`flex size-3.5 items-center justify-center rounded-sm text-[9px] font-semibold text-white ${
                        done ? "bg-success-500" : "bg-gray-500/80"
                      }`}
                    >
                      {short}
                    </span>
                  ))}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Watched by the observer above: crossing it asks for the next page
          of signed URLs. */}
      <div ref={sentinelRef} className="h-4" />

      </div>

      </div>

      {moveId !== null && (() => {
        const from = images.findIndex((row) => row.image.image_id === moveId);
        if (from < 0) return null;
        const target = Number(moveTo);
        const valid = Number.isInteger(target) && target >= 1 && target <= images.length;
        const close = () => {
          setMoveId(null);
          setMoveTo("");
        };
        const move = () => {
          if (!valid) return;
          movePage(from, target - 1);
          close();
        };
        return (
          <div
            onClick={close}
            className="fixed inset-0 z-[99999] flex items-center justify-center bg-gray-900/50 p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-theme-lg dark:bg-gray-800"
            >
              <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
                Move page {from + 1}
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Type where it should go. The pages in between shuffle along.
              </p>
              <input
                autoFocus
                type="number"
                min={1}
                max={images.length}
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") move();
                  if (e.key === "Escape") close();
                }}
                className="mt-4 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-800 focus:border-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              />
              <p className="mt-1 text-xs text-gray-400">1 to {images.length}</p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={close}
                  className="h-9 rounded-lg px-3 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={move}
                  disabled={!valid}
                  className="h-9 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                >
                  Move
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* The pane: one document, larger, with everything known about it.
          Hidden on narrow screens, where the grid needs the whole width, and
          hidden anywhere the toggle in the tab bar is off. */}
      {/* Drag handle. Sits between the grid and the pane, and widens the pane
          as it moves left. */}
      {showPane && (
        <div
          onMouseDown={startResize}
          title="Drag to resize"
          className="hidden w-1 flex-shrink-0 cursor-col-resize bg-gray-200 transition-colors hover:bg-brand-400 dark:bg-gray-700 xl:block"
        />
      )}

      <aside
        style={{ width: paneWidth }}
        className={`relative min-h-0 flex-shrink-0 flex-col border-l border-gray-200 dark:border-gray-700 ${
          showPane ? "hidden xl:flex" : "hidden"
        }`}
      >
        {!selected ? (
          <p className="p-4 text-sm text-gray-500 dark:text-gray-400">
            Select a document to see it here
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* State leads: it's what the pane is for. The verifier's verdict
                sits on the same line, hard right — it outranks everything
                else on a returned batch. */}
            <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <StateChips
                  item={selected}
                  editable={!locked(selected)}
                  onOpen={() => setOpenItem(selected)}
                  pendingCategoryName={pendingIsChange ? pendingName : null}
                  autoStages={review?.auto_stages ?? null}
                />
                {/* A stage that gave up already says so on its own chip
                    above (a red "Category"), and asking again is one
                    button on the tab row — whatever stopped this document
                    stopped the others too. Nothing more belongs here. */}
                {selected.image.replaces_image_id && (
                  <span
                    title={
                      replacedBy(selected)?.reason
                        ? `Replaces a page sent back: ${replacedBy(selected)!.reason}`
                        : undefined
                    }
                    className="rounded-full border border-brand-500/40 bg-brand-500/15 px-2 py-0.5 text-xs font-medium text-brand-500"
                  >
                    Replacement
                  </span>
                )}

                {/* Anything picked or edited but not yet written. */}
                {hasUnsaved && (
                  <span className="rounded-full border border-warning-500/40 bg-warning-500/15 px-2 py-0.5 text-xs font-medium text-warning-600 dark:text-warning-500">
                    Draft
                  </span>
                )}
              </span>
              {/* The verdict stays on the header; the buttons that act on the
                  document sit under it, where there is room. */}
              <span className="flex flex-shrink-0 items-center gap-2">
              {selected.decision === ImageDecision.REJECTED && (
                <Badge size="sm" color="error">
                  Rejected
                </Badge>
              )}
              {selected.decision === ImageDecision.VERIFIED && (
                <span className="flex flex-shrink-0 items-center gap-1.5">
                  {/* A padlock rather than a second word: the badge beside it
                      already says accepted, and what this adds is that it
                      cannot be changed. */}
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="size-3.5 text-success-600 dark:text-success-500"
                  >
                    <title>Accepted — cannot be changed</title>
                    <path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V6a3 3 0 0 1 3-3z" />
                  </svg>
                  <Badge size="sm" color="success">
                    Accepted
                  </Badge>
                </span>
              )}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setOpenItem(selected)}
              title="Open full size"
              style={{ height: Math.round(paneWidth * 0.85), maxHeight: "45vh" }}
              className="flex flex-shrink-0 items-center justify-center overflow-hidden bg-gray-50 dark:bg-gray-900"
            >
              {editForSelected?.preview ? (
                <img
                  src={editForSelected.preview}
                  alt=""
                  className="max-h-full max-w-full object-contain"
                />
              ) : fullUrl || previews.get(selected.image.image_id) ? (
                <img
                  // The thumbnail is already in memory, so it shows at once;
                  // the full image replaces it when its URL arrives.
                  src={fullUrl || previews.get(selected.image.image_id)}
                  alt=""
                  className="h-full w-full cursor-zoom-in object-contain"
                />
              ) : (
                <span className="text-xs text-gray-400">Preview unavailable</span>
              )}
            </button>

            <div className="relative flex flex-shrink-0 flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-3 py-2 dark:border-gray-800">
                {selected.decision === ImageDecision.REJECTED && (
                  <button
                    type="button"
                    title="Take this page again and drop the rejected one"
                    disabled={replacing}
                    onClick={() => {
                      replaceTargetRef.current = selected;
                      replaceInputRef.current?.click();
                    }}
                    className="flex h-7 items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.05]"
                  >
                    {replacing ? (
                      <span className="block size-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    ) : (
                      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
                        <path d="M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6a5.9 5.9 0 0 1 4.22 1.78L13 11h7V4z" />
                      </svg>
                    )}
                    {replacing ? "Replacing..." : "Replace"}
                  </button>
                )}

              {/* Always on the header, and always live: they simply have
                  nothing to do until a category has been picked. */}
              <span className="flex flex-shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  title={hasUnsaved ? "Save the changes to this document" : "No changes to save"}
                  onClick={() => {
                    if (savingCategory || locked(selected)) return;
                    if (!hasUnsaved) {
                      setCategoryNotice({ text: "No changes to save", good: false });
                      return;
                    }
                    saveChanges(selected).then((ok) => {
                      if (ok) onToast?.("Document saved", "success");
                    });
                  }}
                  className="flex h-7 items-center gap-1.5 rounded-lg bg-brand-500 px-2.5 text-xs font-medium text-white transition hover:bg-brand-600"
                >
                  {savingCategory ? (
                    <span className="block size-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  ) : (
                    <svg className="size-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  )}
                  {savingCategory ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  title={hasUnsaved ? "Discard the changes to this document" : "Nothing to discard"}
                  onClick={() => {
                    if (savingCategory) return;
                    setCategoryError(null);
                    setCategoryNotice({
                      text: hasUnsaved ? "Changes discarded" : "No changes to discard",
                      good: hasUnsaved,
                    });
                    setPendingCategory(null);
                    if (selected) forgetDraft(selected.image.image_id);
                  }}
                  className="flex h-7 items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 text-xs font-medium text-gray-700 transition hover:border-error-500 hover:text-error-500 dark:border-gray-700 dark:text-gray-200"
                >
                  {/* An undo arrow, not a bin: this throws away the change,
                      not the document. */}
                  <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5 shrink-0">
                    <path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" />
                  </svg>
                  Discard
                </button>
              </span>
            </div>

            {/* Everything else scrolls, so a long comment thread can't push
                the image off the top of the pane. The border separates what
                the document IS from what is said about it. */}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto border-t border-gray-200 p-3 dark:border-gray-700">

              {/* Always labelled, so the pane reads the same whether or not a
                  document has been commented on. N/A sits on the label's line;
                  real notes wrap underneath it. */}
              {/* This document's own notes only. A batch-wide remark ("the
                  scanner has a streak") belongs above the grid, not attached
                  to whichever page happens to be selected. */}
              {imageNotes.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-gray-500 dark:text-gray-400">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5 shrink-0">
                      <title>Notes</title>
                      <path d="M4 4h16v2H4zm0 5h16v2H4zm0 5h10v2H4z" />
                    </svg>
                  </p>
                  <ul className="space-y-1.5 rounded-lg bg-gray-50 p-2.5 dark:bg-white/[0.03]">
                    {imageNotes.map((c) => (
                      <li key={c.assignment_comment_id} className="text-sm text-gray-700 dark:text-gray-300">
                        {c.comment}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  <span className="mr-1 inline-flex align-middle">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5 shrink-0">
                      <title>Notes</title>
                      <path d="M4 4h16v2H4zm0 5h16v2H4zm0 5h10v2H4z" />
                    </svg>
                  </span>
                  <span className="text-gray-400 dark:text-gray-500">N/A</span>
                </p>
              )}
            </div>
          </div>
        )}
        {/* At the foot of the pane, clear of everything: above the buttons it
            was being clipped by the top of the panel. */}
        {(categoryError || categoryNotice) && !savingCategory && (
          <span
            className={`pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md px-2.5 py-1 text-xs shadow-theme-sm transition-opacity duration-500 ${
              noticeFading && !categoryError ? "opacity-0" : "opacity-100"
            } ${
              categoryError || !categoryNotice?.good
                ? "bg-error-500/15 text-error-600 dark:text-error-500"
                : "bg-success-500/15 text-success-600 dark:text-success-500"
            }`}
          >
            {categoryError || categoryNotice?.text}
          </span>
        )}
      </aside>

      {/* Picks the replacement for a page that was sent back. */}
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          const target = replaceTargetRef.current;
          event.target.value = "";
          if (file && target) replaceRejected(target, file);
        }}
      />

      {/* One document, full size, with everything known about it. */}
      {/* Full size: the image on a dark backdrop and nothing else. Details
          are in the pane behind it, where they were a moment ago. */}
      {openRow && (
        <div
          className="fixed inset-0 z-99999 flex bg-gray-900/95"
          // Clicking the dark margin is a way out like any other, so it asks
          // the same question rather than quietly dropping the work.
          onClick={() => (unapplied ? setConfirmBack(true) : closeViewer())}
        >
          {/* The category picker and the picture tools share one column,
              because they are the two things somebody does to a page and
              looking from one side of the screen to the other to do them
              was the old arrangement's cost. It is passed into the editor
              rather than drawn beside it so there is one column, not two.

              Read-only pages get no picker: an accepted page is skipped on
              later rounds, so changing it would never be looked at. */}

          {/* Keyed on the document: a different one starts from scratch,
              while a late-arriving full-size URL or a fresh draft does not
              wipe the adjustments being made. */}
          {locked(openRow) ? (
            // Read-only: accepted pages are skipped on later rounds, so a
            // change here would never be looked at again.
            <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6">
              {fullUrl ? (
                <img src={fullUrl} alt="" className="max-h-[80vh] max-w-full object-contain" />
              ) : (
                <span className="text-sm text-white/70">Loading the document...</span>
              )}
              <p className="max-w-md text-center text-sm text-white/60">
                This document has been accepted, so it cannot be changed. Ask for the batch to be
                sent back if it needs redoing.
              </p>
            </div>
          ) : fullUrl ? (
          <ImageEditor
            ref={editorRef}
            onDirtyChange={setEditorDirty}
            key={openRow.image.image_id}
            src={fullUrl!}
            initialEdit={openDraft?.edit ?? null}
            onRevert={() => forgetDraft(openRow.image.image_id)}
            // The right belongs to the page's text, so the tools take the
            // left and the category picker sits above them.
            toolsSide="left"
            header={
              <div className="relative">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/50">
                  Category
                </p>

                {/* The control says what the page IS; opening it is how
                    that gets changed. A drafted pick is amber and labelled,
                    so it is never mistaken for the one on record. */}
                <button
                  type="button"
                  onClick={() => setCategoryOpen((open) => !open)}
                  className={`flex h-9 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm transition ${
                    unappliedCategory
                      ? "border-warning-500/50 bg-warning-500/15 text-warning-400"
                      : "border-white/15 bg-white/5 text-white hover:bg-white/10"
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {shownCategoryId !== null
                      ? categories.find((c) => c.category_id === shownCategoryId)?.category_name ??
                        "Not set"
                      : <span className="text-white/40">Not set</span>}
                  </span>
                  <span className="flex flex-shrink-0 items-center gap-1.5">
                    {unappliedCategory && <span className="text-[10px] uppercase">draft</span>}
                    <svg viewBox="0 0 20 20" fill="currentColor" className="size-4 text-white/50">
                      <path
                        fillRule="evenodd"
                        d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                </button>

                {categoryOpen && (
                  <div className="absolute inset-x-0 top-full z-30 mt-1 rounded-lg border border-white/15 bg-gray-900 shadow-xl">
                    {/* A project can have dozens; typing beats scrolling. */}
                    <div className="p-2">
                      <input
                        type="text"
                        autoFocus
                        value={categoryQuery}
                        onChange={(e) => setCategoryQuery(e.target.value)}
                        placeholder="Search categories"
                        className="h-8 w-full rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-white/40 focus:border-brand-400 focus:outline-hidden"
                      />
                    </div>

                    <div className="max-h-64 overflow-y-auto p-1 pt-0">
                      {categories.length === 0 ? (
                        <p className="px-2 py-1.5 text-sm text-white/50">
                          This project has no categories yet.
                        </p>
                      ) : listedCategories.length === 0 ? (
                        <p className="px-2 py-1.5 text-sm text-white/50">
                          No category matches "{categoryQuery.trim()}".
                        </p>
                      ) : (
                        listedCategories.map((category) => {
                          const current = shownCategoryId === category.category_id;
                          return (
                            <button
                              key={category.category_id}
                              type="button"
                              disabled={savingCategory}
                              onClick={() => {
                                setPendingCategory({
                                  imageId: openRow.image.image_id,
                                  categoryId: category.category_id,
                                });
                                setCategoryOpen(false);
                                setCategoryQuery("");
                              }}
                              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                current
                                  ? "bg-brand-500/25 text-white"
                                  : "text-white/70 hover:bg-white/10 hover:text-white"
                              }`}
                            >
                              <span
                                className={`flex size-4 flex-shrink-0 items-center justify-center rounded-full border ${
                                  current ? "border-brand-400 bg-brand-500" : "border-white/30"
                                }`}
                              >
                                {current && (
                                  <svg viewBox="0 0 20 20" fill="currentColor" className="size-3 text-white">
                                    <path
                                      fillRule="evenodd"
                                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                )}
                              </span>
                              <span className="min-w-0 break-words">{category.category_name}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {(savingCategory || categoryError) && (
                  <p className={`mt-1.5 text-xs ${categoryError ? "text-error-400" : "text-white/60"}`}>
                    {categoryError || "Saving..."}
                  </p>
                )}
              </div>
            }
            footer={
              <>
                {/* Apply keeps you here to carry on; OK is the way out with
                    everything kept, so that is the one in colour. */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={applying}
                    onClick={() => (unapplied ? setConfirmBack(true) : closeViewer())}
                    className="h-9 rounded-lg border border-white/15 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={applying}
                    title={
                      editorDirty || unappliedCategory
                        ? "Keep the category and the edit as a draft"
                        : "Nothing picked or edited yet"
                    }
                    onClick={() => applyOpenChanges()}
                    className="flex h-9 items-center justify-center gap-2 rounded-lg border border-white/15 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
                  >
                    {applying && (
                      <span className="block size-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    )}
                    {applying ? "Applying..." : "Apply"}
                  </button>
                </div>

                <button
                  type="button"
                  disabled={applying}
                  onClick={async () => {
                    await applyOpenChanges();
                    closeViewer();
                  }}
                  className="h-9 w-full rounded-lg bg-brand-500 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
                >
                  OK
                </button>
              </>
                        }
            onApply={({ full, thumb, preview, edit }) => {
              // The picture goes to disk; the handle the editor made for its
              // own preview is not needed once the draft has its own.
              URL.revokeObjectURL(preview);
              rememberDraft(openRow.image.image_id, { full, thumb, edit });
            }}
          />
          ) : (
            // Editing the thumbnail would save a 400px page over the real
            // one, so the tools wait for the document itself.
            <div className="flex min-w-0 flex-1 items-center justify-center">
              <span className="flex items-center gap-2 text-sm text-white/70">
                <span className="block size-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                Loading the full-size document...
              </span>
            </div>
          )}

          {/* The page's text, down the right. Its own column rather than a
              tab behind the picture: the reason to read it is to check it
              against what is on the page, and that needs both at once. */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-80 flex-shrink-0 flex-col border-l border-white/10 bg-gray-900/80"
          >
            <div className="flex flex-shrink-0 items-baseline justify-between gap-2 px-4 pb-3 pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-white/50">Text</p>
              {openText && (
                <span className="truncate text-[11px] text-white/40">
                  {/* Who produced this text. A correction has no model, and
                      says so rather than naming an engine that did not
                      write it. */}
                  {openText.model_id === null
                    ? "Edited by hand"
                    : `${openText.model_catalogue?.display_name ?? "Read"}${
                        openText.confidence !== null && openText.confidence !== undefined
                          ? ` · ${Math.round(Number(openText.confidence))}%`
                          : ""
                      }`}
                </span>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              {textLoading ? (
                <p className="text-sm text-white/50">Loading...</p>
              ) : textDraft !== null ? (
                // Being corrected. The same shape as the text it replaces,
                // so nothing jumps when the editing starts.
                <textarea
                  autoFocus
                  value={textDraft}
                  onChange={(e) => setTextDraft(e.target.value)}
                  spellCheck={false}
                  className="h-full min-h-64 w-full resize-none rounded-lg border border-white/15 bg-white/5 p-2 text-sm leading-relaxed text-white/90 focus:border-brand-400 focus:outline-hidden"
                />
              ) : !openText ? (
                // Not read is the ordinary case: most projects have OCR off.
                // It is not a failure and does not say so.
                <p className="text-sm text-white/50">
                  This page has not been read yet.
                </p>
              ) : openText.ocr_text.trim() === "" ? (
                // Read, and there was nothing. A different answer from the
                // one above, and worth saying plainly — a blank page and an
                // unread one look the same otherwise.
                <p className="text-sm text-white/50">
                  This page was read and no text was found on it.
                </p>
              ) : (
                // Pre-wrap: the line breaks are the page's own, and they are
                // most of what makes the text recognisable as the document.
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/80">
                  {openText.ocr_text}
                </p>
              )}
            </div>

            <div className="flex-shrink-0 space-y-2 border-t border-white/10 px-4 py-3">
              {textDraft !== null ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={savingText}
                    onClick={() => setTextDraft(null)}
                    className="h-8 rounded-lg border border-white/15 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={savingText}
                    onClick={async () => {
                      setSavingText(true);
                      try {
                        await imageTextService.edit(
                          openRow.image.image_id,
                          textDraft,
                          // The language the engine read it in, kept so a
                          // correction does not quietly relabel the page.
                          // Hand-typed text on a page nothing has read is
                          // English, which is the only pack installed.
                          openText?.language ?? "eng",
                        );
                        const fresh = await imageTextService.getLatest(openRow.image.image_id);
                        setOpenText(fresh);
                        setTextDraft(null);
                        onToast?.("Text saved", "success");
                      } catch (err) {
                        onToast?.(
                          err instanceof Error ? err.message : "Could not save the text",
                          "error",
                        );
                      } finally {
                        setSavingText(false);
                      }
                    }}
                    className="h-8 rounded-lg bg-brand-500 text-xs font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
                  >
                    {savingText ? "Saving..." : "Save"}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {/* Reading it again is the pipeline's job, asked for one
                      page at a time. It comes back through the queue, so
                      the panel is refreshed a moment later rather than at
                      once. */}
                  <button
                    type="button"
                    disabled={retrying || textLoading}
                    title="Send this page to be read again"
                    onClick={async () => {
                      await retryStage(openRow, "ocr");
                      window.setTimeout(async () => {
                        const fresh = await imageTextService.getLatest(openRow.image.image_id);
                        setOpenText(fresh);
                      }, 4000);
                    }}
                    className="h-8 rounded-lg border border-white/15 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
                  >
                    {retrying ? "Asking..." : "Read again"}
                  </button>
                  <button
                    type="button"
                    disabled={textLoading}
                    onClick={() => setTextDraft(openText?.ocr_text ?? "")}
                    className="h-8 rounded-lg border border-white/15 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
                  >
                    Edit
                  </button>
                </div>
              )}

              {openText && openText.ocr_text.trim() !== "" && textDraft === null && (
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(openText.ocr_text)}
                  className="h-8 w-full rounded-lg text-xs font-medium text-white/50 transition hover:bg-white/10 hover:text-white"
                >
                  Copy the text
                </button>
              )}
            </div>
          </div>

          {confirmStep && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-0 z-20 flex items-center justify-center bg-gray-900/70"
            >
              <div className="w-full max-w-sm rounded-2xl bg-gray-900 p-6 ring-1 ring-white/10">
                <h3 className="text-base font-semibold text-white">Apply before moving on?</h3>
                <p className="mt-1 text-sm text-white/60">
                  {unappliedCategory && editorDirty
                    ? "The category you picked and the changes to the picture have not been applied yet."
                    : unappliedCategory
                    ? "The category you picked has not been applied yet."
                    : "The changes to the picture have not been applied yet."}
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmStep(null)}
                    className="h-9 rounded-lg px-3 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={applying}
                    onClick={async () => {
                      const go = confirmStep;
                      await applyOpenChanges();
                      setConfirmStep(null);
                      go();
                    }}
                    className="h-9 rounded-lg bg-brand-500 px-3 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {applying ? "Applying..." : "Apply"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {confirmBack && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-0 z-20 flex items-center justify-center bg-gray-900/70"
            >
              <div className="w-full max-w-sm rounded-2xl bg-gray-900 p-6 ring-1 ring-white/10">
                <h3 className="text-base font-semibold text-white">Leave without applying?</h3>
                <p className="mt-1 text-sm text-white/60">
                  {unappliedCategory && editorDirty
                    ? "The category you picked and the changes to the picture have not been applied yet."
                    : unappliedCategory
                    ? "The category you picked has not been applied yet."
                    : "The changes to the picture have not been applied yet."}
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      afterLeave.current = null;
                      setConfirmBack(false);
                    }}
                    className="h-9 rounded-lg px-3 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    Stay
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const go = afterLeave.current;
                      afterLeave.current = null;
                      if (go) go();
                      else closeViewer();
                    }}
                    className="h-9 rounded-lg border border-white/20 px-3 text-sm font-medium text-white/80 hover:border-error-500 hover:text-error-400"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    disabled={applying}
                    onClick={async () => {
                      await applyOpenChanges();
                      const go = afterLeave.current;
                      afterLeave.current = null;
                      if (go) go();
                      else closeViewer();
                    }}
                    className="h-9 rounded-lg bg-brand-500 px-3 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {applying ? "Applying..." : "Apply and leave"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step through the batch without going back to the grid — the
              thing you want after fixing one page is the next one. Grouped
              with the count at the foot, rather than floating over the
              picture. */}
          {(() => {
            const list = review?.images ?? [];
            const index = list.findIndex((i) => i.image.image_id === openRow.image.image_id);
            const step =
              "flex size-8 items-center justify-center rounded-full text-white transition hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent";
            return (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/10 px-2 py-1"
              >
                <button
                  type="button"
                  title="Previous document"
                  disabled={index <= 0}
                  onClick={() => stepTo(-1)}
                  className={step}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
                    <path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" />
                  </svg>
                </button>

                <span className="px-2 text-xs text-white/80">
                  {index + 1} of {list.length}
                </span>

                <button
                  type="button"
                  title="Next document"
                  disabled={index === -1 || index >= list.length - 1}
                  onClick={() => stepTo(1)}
                  className={step}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
                    <path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z" />
                  </svg>
                </button>
              </div>
            );
          })()}

          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute right-4 top-4 flex items-center gap-2"
          >
            <button
              type="button"
              title="Close"
              onClick={() => (unapplied ? setConfirmBack(true) : closeViewer())}
              className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
                <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
        </div>
      )}

    </div>
  );
});

export default BatchPanel;
