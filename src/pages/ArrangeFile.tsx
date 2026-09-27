import { useEffect, useMemo, useRef, useState } from "react";
import PageMeta from "../components/common/PageMeta";
import Toast from "../components/common/Toast";
import { Modal } from "../components/ui/modal";
import Button from "../components/ui/button/Button";
import CheckSelect from "../components/form/CheckSelect";
import { Dropdown } from "../components/ui/dropdown/Dropdown";
import { useProject } from "../context/ProjectContext";
import { useAuth } from "../context/AuthContext";
import { authService } from "../services/authService";
import { assignmentLabel } from "../services/assignmentService";
import { uploadService } from "../services/uploadService";
import {
  documentService,
  IdentifierLock,
  Identifier,
  Attribute,
  FilePage,
  ArrangeRecord,
  ProjectDetails,
} from "../services/documentService";

/**
 * Putting a whole file in order.
 *
 * Different from the Batch tab on Digitize, and worth being clear about the
 * difference: a batch is one pile of paper somebody scanned, and rearranging
 * it cannot move it relative to work captured before or after. A file is
 * every page ever captured against the folio, and pages scanned next month
 * may belong in the middle of what was scanned today. This screen is the only
 * place that order can be changed.
 *
 * Administrators only, refused while the file is being worked on, and
 * recorded — all three enforced by the server, because this screen is not the
 * only way in. See smartdoc_context/document-sequencing.md.
 */
export default function ArrangeFile() {
  const { project } = useProject();
  const { user } = useAuth();

  const [projectDetails, setProjectDetails] = useState<ProjectDetails | null>(null);
  const [identifiers, setIdentifiers] = useState<Identifier[]>([]);
  // Two different things, deliberately: what has been picked, and what is on
  // screen. A project will hold thousands of folios, and reading one is a
  // page of thumbnails and a signed link for each — not something a mis-click
  // in a list should start.
  const [identifierId, setIdentifierId] = useState("");
  const [chosen, setChosen] = useState<Identifier | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  // Loading another file throws away an order that has not been saved, so it
  // asks first.
  const [confirmLoad, setConfirmLoad] = useState(false);
  const [isMovesOpen, setIsMovesOpen] = useState(false);

  const [pages, setPages] = useState<FilePage[]>([]);
  // The order the database has, taken when the file is read. Reset goes back
  // to this, and it is what says whether anything is unsaved.
  const [savedOrder, setSavedOrder] = useState<number[]>([]);
  const [previews, setPreviews] = useState<Map<number, string>>(new Map());
  const [history, setHistory] = useState<ArrangeRecord[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(
    null,
  );

  // Typing a page's new place, for when dragging it there would mean crossing
  // a screenful of tiles. The same pair of ways as the Batch tab.
  const [moveId, setMoveId] = useState<number | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const [tileSize, setTileSize] = useState(() => {
    const stored = Number(localStorage.getItem("smartdoc.arrangeTileSize"));
    return Number.isFinite(stored) && stored >= 80 ? stored : 150;
  });
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isGroupMenuOpen, setIsGroupMenuOpen] = useState(false);
  // The line explaining how to move a page. Worth saying once; after that it
  // is a sentence in the way of the work, so it can be dismissed for good.
  const [showHint, setShowHint] = useState(
    () => localStorage.getItem("smartdoc.arrangeHint") !== "hidden",
  );
  // What the grid is split by. The batch by default: a batch that landed in
  // the wrong part of a file moves as a block, so that is the division worth
  // seeing first.
  const [groupBy, setGroupBy] = useState(
    () => localStorage.getItem("smartdoc.arrangeGroupBy") || "assignment",
  );
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  // Runs folded away. A long file is mostly batches somebody has already
  // satisfied themselves about, and folding those leaves the part being
  // worked on next to the part it has to fit against.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Narrowing what is on screen by what was captured: "show me the pages
  // where GR Number is 12". null for a field means every value of it,
  // including pages that have none. Display only — the order is not touched,
  // and Save still sends the whole file.
  const [fieldFilters, setFieldFilters] = useState<Map<number, string[] | null>>(new Map());
  // Which fields are on the filter row. A project can have a dozen
  // attributes and somebody filters by two of them; showing all of them
  // every time cost a row of the screen and made the two hard to find.
  // Remembered per project — the fields one person filters by are the same
  // ones tomorrow.
  const [filterFields, setFilterFields] = useState<number[]>([]);
  const [isAddFilterOpen, setIsAddFilterOpen] = useState(false);
  // One page, larger, beside the grid: a thumbnail is enough to spot a page
  // you know and never enough to tell two forms apart.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [fullUrls, setFullUrls] = useState<Map<number, string>>(new Map());
  const [showPane, setShowPane] = useState(() => {
    const stored = localStorage.getItem("smartdoc.arrangePane");
    return stored === null ? true : stored === "1";
  });

  // Whether this screen holds the lock on the loaded file. Sequencing is
  // explicit: a file opens read-only and is taken deliberately, because
  // renumbering pages under somebody else is the one thing this screen must
  // never do. Released just as deliberately — a lock left behind blocks the
  // file for everybody until an administrator clears it.
  const [holdingLock, setHoldingLock] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);

  const identifier = identifiers.find((row) => String(row.identifier_id) === identifierId) || null;
  const label = projectDetails?.identifier_label || "Identifier";

  const currentOrder = pages.map((p) => p.image_id);
  const orderChanged =
    savedOrder.length === currentOrder.length &&
    savedOrder.some((id, index) => id !== currentOrder[index]);

  // Signing is per page and the answer is short-lived, so the same file read
  // twice signs twice. Kept in a ref so a reload does not re-sign what is
  // already on screen.
  const signedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!project?.project_id) return;
    let cancelled = false;

    (async () => {
      try {
        const token = await authService.ensureValidToken();
        const [details, list, fields] = await Promise.all([
          documentService.getProjectById(project.project_id, token),
          documentService.getIdentifiers(project.project_id, token),
          documentService.getAttributes(project.project_id, token),
        ]);
        if (cancelled) return;
        setProjectDetails(details);
        const rows = list.data || [];
        setIdentifiers(rows);
        setAttributes(fields.data || []);

        // The lock lives in the database, not in this screen. Somebody who
        // opened a file, went to look at something else and came back must
        // find it open — otherwise the file appears locked by a stranger
        // who is in fact themselves, and nothing offers to close it.
        const mine = rows.find(
          (row) =>
            Number(row.open) === IdentifierLock.SEQUENCING &&
            user?.user_id != null &&
            String(row.open_by) === String(user.user_id),
        );
        if (mine) {
          setHoldingLock(true);
          setChosen(mine);
          setIdentifierId(String(mine.identifier_id));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load the project");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [project?.project_id, user?.user_id]);

  /**
   * Give the file back.
   *
   * Explicit on purpose, like taking it: a lock left behind blocks the
   * folio for everybody until an administrator clears it.
   */
  const releaseLock = async ({ quiet = false } = {}) => {
    if (!identifier) return;
    setLockBusy(true);
    try {
      const token = await authService.ensureValidToken();
      const updated = await documentService.closeSequencing(identifier.identifier_id, token);
      setIdentifiers((prev) =>
        prev.map((row) => (row.identifier_id === updated.identifier_id ? updated : row)),
      );
      setHoldingLock(false);
    } catch (err) {
      if (!quiet) setError(err instanceof Error ? err.message : "Could not close this file");
    } finally {
      setLockBusy(false);
    }
  };

  // A file this person already holds. Theirs to go back to, not a refusal.
  const heldByMe = (row: Identifier) =>
    Number(row.open) === IdentifierLock.SEQUENCING &&
    user?.user_id != null &&
    String(row.open_by) === String(user.user_id);

  // What the picker will let somebody choose: a free file, or the one they
  // are already holding. While holding one, nothing else — one at a time.
  const selectableInPicker = (row: Identifier) => {
    if (heldByMe(row)) return true;
    if (holdingLock) return false;
    return Number(row.open) === IdentifierLock.FREE;
  };

  // Kept per project: an attribute id means nothing in another project.
  const filterFieldsKey = project?.project_id
    ? `smartdoc.arrangeFilterFields.${project.project_id}`
    : null;

  useEffect(() => {
    if (!filterFieldsKey) return;
    try {
      const stored = localStorage.getItem(filterFieldsKey);
      setFilterFields(stored ? JSON.parse(stored) : []);
    } catch {
      setFilterFields([]);
    }
  }, [filterFieldsKey]);

  const rememberFilterFields = (ids: number[]) => {
    setFilterFields(ids);
    try {
      if (filterFieldsKey) localStorage.setItem(filterFieldsKey, JSON.stringify(ids));
    } catch {
      // A browser refusing storage still filters; it just forgets.
    }
  };

  const addFilterField = (attributeId: number) => {
    setIsAddFilterOpen(false);
    if (filterFields.includes(attributeId)) return;
    rememberFilterFields([...filterFields, attributeId]);
  };

  // Removing a field drops its filter too: leaving one behind would narrow
  // the grid by something no longer on screen.
  const removeFilterField = (attributeId: number) => {
    rememberFilterFields(filterFields.filter((id) => id !== attributeId));
    setFieldFilters((prev) => {
      const next = new Map(prev);
      next.delete(attributeId);
      return next;
    });
  };

  const loadFile = async (row: Identifier) => {
    if (!project?.project_id) return;
    // A different file: whatever was held belongs to the one being left.
    if (identifier && row.identifier_id !== identifier.identifier_id && holdingLock) {
      await releaseLock({ quiet: true });
    }
    setLoading(true);
    setError(null);
    try {
      const token = await authService.ensureValidToken();
      const all = await documentService.getFilePages(
        project.project_id,
        row.identifier_value,
        token,
      );

      // Retired pages keep the number of the page that replaced them and are
      // not part of the file any more. Showing them here would invite
      // someone to put history back in the middle of live work.
      const active = all.filter((p) => Boolean(p.is_active));
      setPages(active);
      setSavedOrder(active.map((p) => p.image_id));

      documentService
        .getArrangeHistory(row.identifier_id, token)
        .then(setHistory)
        .catch(() => setHistory([]));

      if (signedFor.current !== String(row.identifier_id)) {
        signedFor.current = String(row.identifier_id);
        setPreviews(new Map());
        const keys = active.map((p) => `thumb/${p.image_path}`);
        const urls = await uploadService.getDownloadUrls(keys, token);
        const next = new Map<number, string>();
        active.forEach((p) => {
          const url = urls.get(`thumb/${p.image_path}`);
          if (url) next.set(p.image_id, url);
        });
        setPreviews(next);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read the file");
      setPages([]);
      setSavedOrder([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedId(null);
    setFullUrls(new Map());
    setCollapsed(new Set());
    setFieldFilters(new Map());
    if (!identifier) {
      setPages([]);
      setSavedOrder([]);
      setHistory([]);
      signedFor.current = null;
      return;
    }
    loadFile(identifier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifierId]);

  // Moving a page only changes the screen. Nothing is written until Save —
  // dragging is easy to get wrong by a place or two, and a file is long.
  const movePage = (from: number, to: number) => {
    if (from === to) return;
    setPages((prev) => {
      const ordered = [...prev];
      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved);
      return ordered;
    });
  };

  /**
   * Open a file for sequencing: take the lock, then read it.
   *
   * One action rather than two. Loading and then asking to edit left the
   * button ambiguous — which file was it about, the one on screen or the
   * one just picked? — and left files loaded but unlocked, which is a file
   * somebody can be handed for capture while it is being read here.
   *
   * The lock comes first: if somebody else has it there is nothing to read
   * and nothing to explain afterwards.
   */
  const openForSequencing = async (row: Identifier) => {
    if (!row) return;
    // Opening another file drops an order nobody has saved. Ask first.
    if (orderChanged) {
      setConfirmLoad(true);
      return;
    }
    setLockBusy(true);
    setError(null);
    try {
      const token = await authService.ensureValidToken();
      const updated = await documentService.openForSequencing(row.identifier_id, token);
      setIdentifiers((prev) =>
        prev.map((r) => (r.identifier_id === updated.identifier_id ? updated : r)),
      );
      setHoldingLock(true);
      setIdentifierId(String(row.identifier_id));
    } catch (err) {
      // The server names who holds it and why.
      setError(err instanceof Error ? err.message : "Could not open this file for sequencing");
    } finally {
      setLockBusy(false);
    }
  };

  /**
   * Which pages actually moved.
   *
   * Moving one page shifts every page after it, so comparing positions
   * one by one calls half the file "moved". The pages that stayed are the
   * longest run that is still in its old order — everything outside that run
   * is what somebody actually picked up and put somewhere else.
   */
  const moves = useMemo(() => {
    if (!orderChanged) return [];
    const wasAt = new Map(savedOrder.map((id, index) => [id, index]));
    const sequence = pages.map((page) => wasAt.get(page.image_id) ?? -1);

    // Longest increasing subsequence, by index, over the old positions.
    const tails: number[] = [];
    const tailIndex: number[] = [];
    const previous = new Array(sequence.length).fill(-1);
    sequence.forEach((value, index) => {
      let low = 0;
      let high = tails.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (tails[mid] < value) low = mid + 1;
        else high = mid;
      }
      tails[low] = value;
      tailIndex[low] = index;
      previous[index] = low > 0 ? tailIndex[low - 1] : -1;
    });

    const stayed = new Set<number>();
    let cursor = tailIndex[tails.length - 1] ?? -1;
    while (cursor >= 0) {
      stayed.add(cursor);
      cursor = previous[cursor];
    }

    return pages
      .map((page, index) => ({ page, index }))
      .filter(({ index }) => !stayed.has(index))
      .map(({ page, index }) => ({
        image_id: page.image_id,
        from: (wasAt.get(page.image_id) ?? 0) + 1,
        to: index + 1,
      }));
  }, [pages, savedOrder, orderChanged]);

  const resetOrder = () => {
    const byId = new Map(pages.map((p) => [p.image_id, p]));
    setPages(savedOrder.map((id) => byId.get(id)).filter((p): p is FilePage => !!p));
  };

  const saveOrder = async () => {
    if (!identifier) return;
    setSaving(true);
    try {
      const token = await authService.ensureValidToken();
      const ids = pages.map((p) => p.image_id);
      const result = await documentService.arrangeFile(identifier.identifier_id, ids, token);
      setSavedOrder(ids);
      setToast({
        message:
          result.moved === 1 ? "Saved — 1 page moved" : `Saved — ${result.moved} pages moved`,
        type: "success",
      });
      documentService
        .getArrangeHistory(identifier.identifier_id, token)
        .then(setHistory)
        .catch(() => undefined);
    } catch (err) {
      // The server explains its refusals in plain language — a file being
      // worked on, an account that is not an administrator here — so they
      // are shown as they come.
      setToast({
        message: err instanceof Error ? err.message : "Could not save the order",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const changeTileSize = (next: number) => {
    setTileSize(next);
    try {
      localStorage.setItem("smartdoc.arrangeTileSize", String(next));
    } catch {
      // A browser that refuses storage still gets a working slider.
    }
  };

  /**
   * The file, split wherever the thing being grouped by changes.
   *
   * Runs, not groups: if pages from one batch end up either side of another,
   * that is what the file says and the screen shows it, rather than quietly
   * gathering them back together. The order is the point of this screen, so
   * nothing here may reorder anything.
   *
   * The batch is the default because a batch that landed in the wrong part
   * of a file moves as a block. Any captured field can be grouped on
   * instead — a date, a reference number — which is how somebody spots that
   * one folio's worth of paper arrived in two batches.
   */
  const runValue = (page: FilePage): { key: string; label: string } => {
    if (groupBy === "assignment") {
      return {
        key: String(page.assignment_id ?? 0),
        label: page.assignment_id
          ? assignmentLabel({
              assignment_id: page.assignment_id,
              assignment_code: page.assignment?.assignment_code,
            })
          : "No batch",
      };
    }

    const attributeId = groupBy.replace("attr:", "");
    const value = (page.image_attributes || []).find(
      (a) => String(a.attribute_id) === attributeId,
    )?.attribute_value;
    const name =
      attributes.find((a) => String(a.attribute_id) === attributeId)?.attribute_name || "Field";
    return {
      key: value ? `v:${value}` : "v:",
      label: value ? `${name}: ${value}` : `No ${name.toLowerCase()}`,
    };
  };

  const valueOf = (page: FilePage, attributeId: number) =>
    (page.image_attributes || []).find((a) => Number(a.attribute_id) === attributeId)
      ?.attribute_value ?? "";

  // Every value of a field that this file actually holds, so the filter
  // offers what is there rather than every value the project has ever seen.
  const valuesInFile = (attributeId: number) => {
    const seen = new Set<string>();
    pages.forEach((page) => seen.add(valueOf(page, attributeId)));
    return Array.from(seen)
      .sort()
      .map((value) => ({ value, label: value || "(none)" }));
  };

  const filtering = Array.from(fieldFilters.values()).some((chosen) => chosen !== null);

  // The page's place in the whole file travels with it: a filtered grid still
  // says "page 34", and moving one still means moving it in the file.
  const visible = useMemo(() => {
    const rows = pages.map((page, index) => ({ page, index }));
    if (!filtering) return rows;
    return rows.filter(({ page }) =>
      Array.from(fieldFilters.entries()).every(([attributeId, chosen]) =>
        chosen === null ? true : chosen.includes(valueOf(page, attributeId)),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, fieldFilters, filtering]);

  const runs = useMemo(() => {
    const out: {
      key: string;
      label: string;
      start: number;
      pages: { page: FilePage; index: number }[];
    }[] = [];
    visible.forEach((row) => {
      const { key, label } = runValue(row.page);
      const last = out[out.length - 1];
      const follows =
        last && last.pages[last.pages.length - 1].index + 1 === row.index && last.key === key;
      if (follows) {
        last.pages.push(row);
        return;
      }
      out.push({ key, label, start: row.index, pages: [row] });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, groupBy, attributes]);

  const selected = pages.find((p) => p.image_id === selectedId) || null;
  const selectedIndex = pages.findIndex((p) => p.image_id === selectedId);

  // The full picture is only signed for the page being looked at — signing
  // every page of a long file up front would be hundreds of links nobody
  // opens, and they expire.
  useEffect(() => {
    if (!selected || fullUrls.has(selected.image_id)) return;
    let cancelled = false;

    (async () => {
      try {
        const token = await authService.ensureValidToken();
        const url = await uploadService.getDownloadUrl(selected.image_path, token);
        if (!cancelled && url) {
          setFullUrls((prev) => new Map(prev).set(selected.image_id, url));
        }
      } catch {
        // The thumbnail stays; the pane simply shows it instead.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selected, fullUrls]);

  const togglePane = () => {
    setShowPane((open) => {
      try {
        localStorage.setItem("smartdoc.arrangePane", open ? "0" : "1");
      } catch {
        // A browser refusing storage still gets a working toggle.
      }
      return !open;
    });
  };

  // The field's own name, exactly as the project spells it — "GR Number",
  // not "gr number". Lower-casing it and capitalising in CSS turned every
  // acronym into a word.
  const groupLabel =
    groupBy === "assignment"
      ? "Assignment"
      : attributes.find((f) => `attr:${f.attribute_id}` === groupBy)?.attribute_name ?? "Field";
  // Held by a capture or verification batch: the order cannot be changed
  // at all, and no button here can free it — that lock is released by the
  // assignment's own workflow. The server refuses; the screen says so first.
  const beingCaptured = Number(identifier?.open) === IdentifierLock.CAPTURE;
  // Nothing can be moved until this screen has taken the lock. Dragging is
  // what stops, rather than the whole page: a file is worth reading in
  // order without holding it.
  const readOnly = !holdingLock;
  /**
   * Searching for a folio, with wildcards.
   *
   * Plain text matches anywhere in the value, which is what people expect of
   * a search box. `*` stands for any run of characters and `?` for exactly
   * one, so `500*311` finds what somebody half-remembers, and `?0-2026`
   * finds a whole year's worth.
   */
  const pickerMatches = useMemo(() => {
    const query = pickerQuery.trim();
    if (!query) return identifiers.slice(0, 100);

    const escaped = query.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const pattern = escaped.includes("*") || escaped.includes("?")
      ? `^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`
      : escaped;

    let test: RegExp;
    try {
      test = new RegExp(pattern, "i");
    } catch {
      return [];
    }

    return identifiers.filter((row) => test.test(row.identifier_value)).slice(0, 100);
  }, [identifiers, pickerQuery]);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      <PageMeta title="Sequencing | SmartDoc" description="Put a whole file in page order" />

      {/* Header: what is being arranged, and what can be done about it. The
          same shape as the other screens — the picker and the state on the
          left, the actions hard right. */}
      <div className="relative z-20 w-full flex-shrink-0 border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Choosing and loading are two steps. Picking the wrong folio
                out of a list of thousands should cost nothing — reading one
                is a grid of thumbnails and a signed link per page. */}
            {/* Closed to choosing while a file is held: one file at a
                time, and opening the picker to a list where everything is
                greyed is a worse way of saying so than not opening it. */}
            <button
              type="button"
              disabled={holdingLock}
              title={
                holdingLock
                  ? `Close ${identifier?.identifier_value ?? "this one"} before opening another`
                  : undefined
              }
              onClick={() => {
                setPickerQuery("");
                setIsPickerOpen(true);
              }}
              className="flex h-9 min-w-64 items-center justify-between gap-2 rounded-lg border border-gray-300 px-3 text-sm text-gray-800 transition hover:border-brand-500 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-700 dark:text-white/90 dark:disabled:border-gray-800 dark:disabled:bg-white/[0.03]"
            >
              <span className="truncate">
                {identifier
                  ? identifier.identifier_value
                  : chosen
                  ? chosen.identifier_value
                  : `Choose a ${label.toLowerCase()}`}
              </span>
              <svg viewBox="0 0 20 20" fill="currentColor" className="size-4 shrink-0 opacity-60">
                <path d="M8.5 3a5.5 5.5 0 014.38 8.82l3.65 3.65-1.06 1.06-3.65-3.65A5.5 5.5 0 118.5 3Zm0 1.5a4 4 0 100 8 4 4 0 000-8Z" />
              </svg>
            </button>

            {/* Always here, whether or not a file has been picked: a
                control that appears once something else is done is one
                people hunt for, and a toolbar that grows and shrinks as
                files load is one nothing can be aimed at. Disabled until
                there is a file to open. */}
            {(() => {
                // One button, two jobs: open what has been picked, or read
                // again what is already open. It stays put either way —
                // a control that disappears once used is one people hunt
                // for the next time they want it.
                const pending = !chosen || String(chosen.identifier_id) !== identifierId;
                // One button, two states and nothing else: Open takes the
                // file, Close gives it back. Rereading a file is what
                // Open does, so there is no third word — and a button whose
                // wording depends on which of three things is true is a
                // button nobody trusts.
                const blocked = pending && holdingLock;
                const closing = holdingLock;

                return (
                  <button
                    type="button"
                    disabled={!chosen || loading || lockBusy || blocked || (closing && orderChanged)}
                    onClick={() =>
                      closing ? releaseLock() : chosen && openForSequencing(chosen)
                    }
                    title={
                      blocked
                        ? `Close ${identifier?.identifier_value ?? "the open file"} first`
                        : closing
                          ? orderChanged
                            ? "Save or reset the order first"
                            : "Give the file back so it can be captured or sequenced by somebody else"
                          : chosen
                            ? `Open ${chosen.identifier_value}`
                            : `Choose a ${label.toLowerCase()} first`
                    }
                    // The xs size the rest of the app uses for a control on
                    // a toolbar — h-8, px-3, text-xs — written out rather
                    // than <Button> because this one carries three states
                    // with their own colours.
                    className={`flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition disabled:opacity-50 ${
                      closing
                        ? "border border-gray-300 text-gray-700 hover:border-error-500 hover:bg-error-50 hover:text-error-600 dark:border-gray-700 dark:text-gray-200 dark:hover:border-error-500 dark:hover:bg-error-500/10 dark:hover:text-error-500"
                        : "bg-brand-500 text-white hover:bg-brand-600"
                    }`}
                  >
                    {/* The icon carries the state, so the word does not
                        have to change under the cursor: a padlock shut for
                        Open, open for Close, and a spinner in its place
                        while either is happening. */}
                    {loading || lockBusy ? (
                      <span className="block size-3.5 shrink-0 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    ) : closing ? (
                      /* An open padlock: press it to let the file go. */
                      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5 shrink-0">
                        <path d="M12 2a5 5 0 0 0-5 5H9a3 3 0 1 1 6 0v2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Z" />
                      </svg>
                    ) : (
                      /* A padlock shut: pressing it takes the file. */
                      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5 shrink-0">
                        <path d="M12 2a5 5 0 0 0-5 5v2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 7V7a3 3 0 1 1 6 0v2H9Z" />
                      </svg>
                    )}
                    <span className="truncate">{closing ? "Close" : "Open"}</span>
                  </button>
                );
            })()}

            {/* The count, beside the button that opened the file. The
                "Open for editing" pill stays on the right, with the other
                things that describe the state of the screen. */}
            {identifier && !loading && (
              <span className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                {pages.length === 1 ? "1 page" : `${pages.length} pages`}
                {history.length > 0 && (
                  <>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <button
                      type="button"
                      onClick={() => setIsHistoryOpen(true)}
                      className="text-brand-500 hover:underline"
                    >
                      History
                    </button>
                  </>
                )}
              </span>
            )}

          </div>

          <div className="flex items-center gap-3">
            {holdingLock && !loading && (
              <span className="rounded-full bg-success-500/15 px-2 py-0.5 text-xs font-medium text-success-600 dark:text-success-500">
                Open for editing
              </span>
            )}

            {/* The view controls, always on the row. They are the
                project's, not the file's — a toolbar that assembles itself
                as a file loads is one nothing can be aimed at. */}
            <>
                {/* Always shown, disabled until there is something to
                    save: it is the point of the screen, and a button that
                    appears only once an order has been changed is one
                    nobody knows is coming. */}
                <Button
                  size="xs"
                  disabled={!holdingLock || !orderChanged || saving}
                  onClick={saveOrder}
                  startIcon={
                    saving ? (
                      <span className="block size-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    ) : (
                      /* A floppy disk: the order as it stands is written
                         down. */
                      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
                        <path d="M5 3h11l3 3v15H5V3Zm2 2v5h8V5H7Zm5 8a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
                      </svg>
                    )
                  }
                >
                  Save
                </Button>
            </>
          </div>
        </div>

        {/* Narrowing by what was captured, and how the grid is split — the
            two questions about what you are looking at, on one line. The
            fields are chosen rather than all shown: a project can have a
            dozen attributes, somebody filters by two, and a row of twelve
            pickers hid the two. */}
        <span className="mt-3 flex min-h-9 flex-wrap items-center gap-2">
          {/* What the grid is split by. An icon with a menu rather than
              a labelled box: it sits with the other view controls, all
              of which are icons, and the current choice is on the
              headings a few pixels below. */}
          <div className="relative">
            <button
              type="button"
              title={`Grouped by ${groupLabel}`}
              onClick={() => setIsGroupMenuOpen((open) => !open)}
              className={`dropdown-toggle flex h-8 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium ${
                groupBy === "assignment"
                  ? "border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.05]"
                  : "border-brand-500 bg-brand-50 text-brand-500 dark:bg-brand-500/10"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-4 shrink-0">
                <path d="M3 5h8v6H3V5Zm2 2v2h4V7H5Zm8-2h8v6h-8V5Zm2 2v2h4V7h-4ZM3 13h8v6H3v-6Zm2 2v2h4v-2H5Zm8-2h8v6h-8v-6Zm2 2v2h4v-2h-4Z" />
              </svg>
              <span className="max-w-28 truncate">{groupLabel}</span>
              <svg viewBox="0 0 20 20" fill="currentColor" className="size-3 shrink-0 opacity-60">
                <path d="M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z" />
              </svg>
            </button>
            <Dropdown
              isOpen={isGroupMenuOpen}
              onClose={() => setIsGroupMenuOpen(false)}
              // Opens rightwards from this button. Dropdown anchors to the
              // right by default, which put the menu off the left edge of
              // the screen now that this control starts the row — the `!`
              // is to beat that default rather than hope class order does.
              className="!left-0 !right-auto w-52 p-2"
            >
              <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                Group by
              </p>
              {[
                { value: "assignment", label: "Assignment" },
                ...attributes.map((field) => ({
                  value: `attr:${field.attribute_id}`,
                  label: field.attribute_name,
                })),
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setGroupBy(option.value);
                    setIsGroupMenuOpen(false);
                    try {
                      localStorage.setItem("smartdoc.arrangeGroupBy", option.value);
                    } catch {
                      // A browser refusing storage still gets a working menu.
                    }
                  }}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${
                    groupBy === option.value
                      ? "bg-brand-50 font-medium text-brand-500 dark:bg-brand-500/10"
                      : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.05]"
                  }`}
                >
                  {option.label}
                  {groupBy === option.value && (
                    <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5">
                      <path d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" />
                    </svg>
                  )}
                </button>
              ))}
            </Dropdown>
          </div>


          {filterFields.map((attributeId) => {
            const field = attributes.find((f) => f.attribute_id === attributeId);
            if (!field) return null;
            return (
              <span key={attributeId} className="flex w-44 items-center gap-1">
                <span className="min-w-0 flex-1">
                  <CheckSelect
                    // Empty while a file is being read: the values belong to
                    // the file, and offering the last one's would be a lie.
                    options={loading ? [] : valuesInFile(attributeId)}
                    values={fieldFilters.get(attributeId) ?? null}
                    onChange={(chosen) =>
                      setFieldFilters((prev) => {
                        const next = new Map(prev);
                        if (chosen === null) next.delete(attributeId);
                        else next.set(attributeId, chosen);
                        return next;
                      })
                    }
                    noun={field.attribute_name}
                    emptyText="Nothing matches that"
                    compact
                  />
                </span>
                <button
                  type="button"
                  title={`Remove the ${field.attribute_name} filter`}
                  onClick={() => removeFilterField(attributeId)}
                  className="flex size-5 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-error-500 dark:hover:bg-white/[0.05]"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="size-3">
                    <path d="M4.3 4.3a1 1 0 011.4 0L10 8.6l4.3-4.3a1 1 0 111.4 1.4L11.4 10l4.3 4.3a1 1 0 01-1.4 1.4L10 11.4l-4.3 4.3a1 1 0 01-1.4-1.4L8.6 10 4.3 5.7a1 1 0 010-1.4z" />
                  </svg>
                </button>
              </span>
            );
          })}

          {/* Adding one. Only the fields not already on the row, so the
              menu shortens as they are used. */}
          {attributes.some((f) => !filterFields.includes(f.attribute_id)) && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsAddFilterOpen((open) => !open)}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 text-xs font-medium text-gray-500 transition hover:border-brand-500 hover:text-brand-500 dark:border-gray-600 dark:text-gray-400"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
                  <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
                </svg>
                Add filter
              </button>
              <Dropdown
                isOpen={isAddFilterOpen}
                onClose={() => setIsAddFilterOpen(false)}
                className="w-52 p-2"
              >
                <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  Filter by
                </p>
                {attributes
                  .filter((f) => !filterFields.includes(f.attribute_id))
                  .map((field) => (
                    <button
                      key={field.attribute_id}
                      type="button"
                      onClick={() => addFilterField(field.attribute_id)}
                      className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.05]"
                    >
                      {field.attribute_name}
                    </button>
                  ))}
              </Dropdown>
            </div>
          )}

            {filtering && (
              <button
                type="button"
                onClick={() => setFieldFilters(new Map())}
                className="text-xs text-gray-500 hover:underline dark:text-gray-400"
              >
                Reset filters
              </button>
            )}

            {/* How the grid is shown, on the row that is already here — a
                line of its own for a slider and two icons was most of a
                screenful of nothing. */}
            {identifier && !loading && (
              <span className="ml-auto flex items-center gap-3">
                {orderChanged && (
                  <span className="relative flex items-center gap-2 rounded-lg border border-warning-500/40 bg-warning-500/10 px-2 py-1">
                    {/* What is about to be saved, rather than only that
                        something is. Behind a click: it is a list, and most
                        of the time the count is enough. */}
                    <span className="text-xs text-gray-700 dark:text-gray-200">
                      Order not saved
                    </span>
                    {moves.length > 0 && (
                      <>
                        <span className="text-gray-300 dark:text-gray-600">|</span>
                        <button
                          type="button"
                          onClick={() => setIsMovesOpen((open) => !open)}
                          className="dropdown-toggle text-xs font-medium text-brand-500 hover:underline"
                        >
                          Trail
                        </button>
                      </>
                    )}
                    <Dropdown
                      isOpen={isMovesOpen}
                      onClose={() => setIsMovesOpen(false)}
                      className="right-auto! left-0 top-8 w-auto min-w-40 p-0"
                    >
                      {/* Where each moved page came from and where it is
                          now — the two columns people read, and nothing
                          else. */}
                      <div className="flex items-center justify-between gap-6 border-b border-gray-100 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:border-gray-800">
                        <span>From</span>
                        <span>To</span>
                      </div>
                      <ul className="max-h-56 overflow-y-auto py-1">
                        {moves.slice(0, 30).map((move) => (
                          <li
                            key={move.image_id}
                            className="flex items-center justify-between gap-6 px-3 py-1 text-sm tabular-nums text-gray-600 dark:text-gray-300"
                          >
                            <span>{move.from}</span>
                            <svg
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              className="size-3 shrink-0 text-gray-300 dark:text-gray-600"
                            >
                              <path d="M13 5.6 14.4 4.2 22.2 12l-7.8 7.8L13 18.4l5.4-5.4H2v-2h16.4L13 5.6Z" />
                            </svg>
                            <span className="font-semibold text-gray-800 dark:text-white/90">
                              {move.to}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="border-t border-gray-100 px-3 py-1.5 text-[11px] text-gray-400 dark:border-gray-800">
                        {moves.length > 30
                          ? `30 of ${moves.length} moves`
                          : moves.length === 1
                          ? "1 page moved"
                          : `${moves.length} pages moved`}
                      </p>
                    </Dropdown>

                    <button
                      type="button"
                      onClick={resetOrder}
                      disabled={saving}
                      className="flex h-6 items-center rounded-md border border-gray-300 px-2 text-xs font-medium text-gray-700 transition hover:border-error-500 hover:text-error-500 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200"
                    >
                      Reset
                    </button>
                  </span>
                )}

                {runs.length > 1 && (
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsed(new Set(runs.map((run) => `${run.key}-${run.start}`)))
                      }
                      className="text-xs text-brand-500 hover:underline"
                    >
                      Collapse all
                    </button>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <button
                      type="button"
                      onClick={() => setCollapsed(new Set())}
                      className="text-xs text-brand-500 hover:underline"
                    >
                      Expand all
                    </button>
                  </span>
                )}

                <input
                  type="range"
                  min={90}
                  max={260}
                  step={10}
                  value={tileSize}
                  onChange={(e) => changeTileSize(Number(e.target.value))}
                  title="Tile size"
                  className="h-1 w-28 cursor-pointer accent-brand-500"
                />
                <button
                  type="button"
                  title={showPane ? "Hide the preview" : "Show the preview"}
                  onClick={togglePane}
                  className={`hidden size-8 items-center justify-center rounded-lg xl:flex ${
                    showPane
                      ? "bg-brand-50 text-brand-500 dark:bg-brand-500/10"
                      : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="size-4">
                    <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth={2} />
                    <path d="M15 4v16" strokeWidth={2} />
                  </svg>
                </button>
              </span>
            )}
        </span>


        {beingCaptured && (
          <p className="mt-2 text-xs text-warning-600 dark:text-warning-500">
            This {label.toLowerCase()} is being captured or verified. The order can be changed once
            that batch is verified — renumbering now would move the pages underneath whoever is
            working on them. Nobody can release it from here; it ends with the batch.
          </p>
        )}

        {error && <Toast message={error} type="error" onClose={() => setError(null)} />}
      </div>

      {/* The file on the left, one page of it on the right */}
      <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {!identifier ? (
          // Nothing to say: the picker and the Open button are on the row
          // above, which is the whole instruction.
          <span />
        ) : loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Reading the file...</p>
        ) : pages.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            This {label.toLowerCase()} has no pages yet.
          </p>
        ) : (
          <>
            {(showHint || filtering) && (
              <div className="mb-3">
              <p className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <span>
                {filtering ? (
                  <>
                    Showing {visible.length} of {pages.length} pages. Dragging is off while the
                    view is narrowed — the gaps would not mean what they look like — but clicking
                    a page's number still sends it anywhere in the file.
                  </>
                ) : (
                  <>
                    Drag a page to change its place in the file, or click its number to send it
                    straight to another place. Pages from every batch ever captured are here, in
                    file order.
                  </>
                )}
                </span>
                {/* Only the standing advice is dismissed — a line about what
                    the filters are doing to the grid is not advice. */}
                {!filtering && (
                  <button
                    type="button"
                    title="Hide this"
                    onClick={() => {
                      setShowHint(false);
                      try {
                        localStorage.setItem("smartdoc.arrangeHint", "hidden");
                      } catch {
                        // A browser refusing storage just means it comes back.
                      }
                    }}
                    className="mt-px text-gray-400 transition hover:text-error-500"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="size-3">
                      <path d="M4.3 4.3a1 1 0 011.4 0L10 8.6l4.3-4.3a1 1 0 111.4 1.4L11.4 10l4.3 4.3a1 1 0 01-1.4 1.4L10 11.4l-4.3 4.3a1 1 0 01-1.4-1.4L8.6 10 4.3 5.7a1 1 0 010-1.4z" />
                    </svg>
                  </button>
                )}
              </p>
              </div>
            )}

            {runs.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No page in this file matches those filters.
              </p>
            )}

            <div className="space-y-3">
              {runs.map((run) => (
                <section
                  key={`${run.key}-${run.start}`}
                  className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
                >
                  {/* Where one run ends and the next begins — most of what
                      somebody checking an order needs to see, so it is a bar
                      rather than a line of small print. */}
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        const key = `${run.key}-${run.start}`;
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    className="flex w-full items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-left transition hover:bg-gray-100 dark:border-gray-700 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
                  >
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className={`size-4 flex-shrink-0 text-gray-400 transition-transform ${
                        collapsed.has(`${run.key}-${run.start}`) ? "-rotate-90" : ""
                      }`}
                    >
                      <path d="M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z" />
                    </svg>
                    <span className="truncate text-sm font-semibold text-gray-800 dark:text-white/90">
                      {run.label}
                    </span>
                    <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">
                      {run.pages.length === 1 ? "1 page" : `${run.pages.length} pages`}
                    </span>
                    <span className="ml-auto text-[11px] text-gray-400 dark:text-gray-500">
                      {run.pages.length === 1
                        ? `page ${run.start + 1}`
                        : `pages ${run.start + 1}–${run.start + run.pages.length}`}
                    </span>
                  </button>

                  {!collapsed.has(`${run.key}-${run.start}`) && (
                  <div
                    className="grid gap-2 p-3"
                    style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))` }}
                  >
                    {run.pages.map(({ page, index }) => (
                <div
                        key={page.image_id}
                        onClick={() => setSelectedId(page.image_id)}
                        draggable={!saving && !filtering && !readOnly}
                        onDragStart={(e) => {
                          setDragFrom(index);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", String(page.image_id));
                        }}
                        onDragOver={(e) => {
                          if (dragFrom === null) return;
                          e.preventDefault();
                          setDragOver(index);
                        }}
                        onDragEnd={() => {
                          setDragFrom(null);
                          setDragOver(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragFrom !== null) movePage(dragFrom, index);
                          setDragFrom(null);
                          setDragOver(null);
                        }}
                        className={`group relative aspect-square overflow-hidden rounded-sm bg-gray-100 dark:bg-gray-900 ${filtering ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"} ${
                          dragOver === index && dragFrom !== index ? "ring-2 ring-brand-500" : ""
                        } ${dragFrom === index ? "opacity-40" : ""} ${
                          page.image_id === selectedId
                            ? "outline outline-2 outline-offset-1 outline-brand-500"
                            : ""
                        }`}
                      >
                        {previews.get(page.image_id) ? (
                          <img
                            src={previews.get(page.image_id)}
                            alt=""
                            loading="lazy"
                            draggable={false}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="flex h-full items-center justify-center text-[10px] text-gray-400">
                            No preview
                          </span>
                        )}

                        {/* Its place in the file, counted from the list rather than
                            read off the row — the stored number is spaced (1000,
                            2000) so a page can be slipped in later. */}
                        <span
                          role="button"
                          tabIndex={-1}
                          title="Click to move this page to another place"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMoveId(page.image_id);
                            setMoveTo(String(index + 1));
                          }}
                          className="absolute left-1 top-1 cursor-pointer rounded bg-gray-900/70 px-1.5 text-[10px] font-semibold text-white hover:bg-brand-500"
                        >
                          {index + 1}
                        </span>

                        {/* Which batch this page came from: a file is made of
                            several, and knowing where a run starts is half of
                            knowing whether it is in the right place. */}
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-gray-900/90 to-transparent px-1.5 pb-1 pt-5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                          {page.image_path.split("/").pop()}
                        </span>
                      </div>
                    ))}
                  </div>
                  )}
                </section>
              ))}
            </div>
          </>
        )}
      </div>

      {/* The pane: one page, larger. Hidden on narrow screens, where the
          grid needs the whole width. */}
      {showPane && identifier && (
        <aside className="hidden w-96 min-h-0 flex-shrink-0 flex-col border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 xl:flex">
          {!selected ? (
            <p className="p-4 text-sm text-gray-500 dark:text-gray-400">
              Select a page to see it here
            </p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                  Page {selectedIndex + 1} of {pages.length}
                </span>
                {/* Walking the file one page at a time is how somebody checks
                    an order, and it saves aiming at small tiles. */}
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    title="Previous page"
                    disabled={selectedIndex <= 0}
                    onClick={() => setSelectedId(pages[selectedIndex - 1]?.image_id ?? null)}
                    className="flex size-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                      <path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    title="Next page"
                    disabled={selectedIndex < 0 || selectedIndex >= pages.length - 1}
                    onClick={() => setSelectedId(pages[selectedIndex + 1]?.image_id ?? null)}
                    className="flex size-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                      <path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z" />
                    </svg>
                  </button>
                </span>
              </div>

              <div className="flex min-h-0 flex-1 items-center justify-center bg-gray-100 p-3 dark:bg-gray-900">
                {/* The full picture when it has been signed, the thumbnail
                    until then — a blank pane while a link is fetched reads as
                    a page that failed to load. */}
                <img
                  src={fullUrls.get(selected.image_id) || previews.get(selected.image_id)}
                  alt=""
                  className="max-h-full max-w-full object-contain"
                />
              </div>

              <div className="flex-shrink-0 space-y-1 border-t border-gray-100 px-3 py-2 dark:border-gray-800">
                <p className="truncate text-xs text-gray-700 dark:text-gray-300">
                  {selected.image_path.split("/").pop()}
                </p>
                {selected.image_categories?.[0]?.category?.category_name && (
                  <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                    {selected.image_categories[0].category?.category_name}
                  </p>
                )}
                {selected.assignment_id && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Captured in{" "}
                    <span className="font-mono">
                      {assignmentLabel({
                        assignment_id: selected.assignment_id,
                        assignment_code: selected.assignment?.assignment_code,
                      })}
                    </span>
                  </p>
                )}
              </div>
            </div>
          )}
        </aside>
      )}
      </div>

      {/* Typing a place, for a page that belongs a long way from here. */}
      {moveId !== null &&
        (() => {
          const from = pages.findIndex((p) => p.image_id === moveId);
          if (from < 0) return null;
          const target = Number(moveTo);
          const valid = Number.isInteger(target) && target >= 1 && target <= pages.length;
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
            <Modal isOpen onClose={close} className="max-w-xs p-5">
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
                max={pages.length}
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") move();
                  if (e.key === "Escape") close();
                }}
                className="mt-4 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-800 focus:border-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              />
              <p className="mt-1 text-xs text-gray-400">1 to {pages.length}</p>
              <div className="mt-5 flex justify-end gap-2">
                <Button size="xs" variant="outline" onClick={close}>
                  Cancel
                </Button>
                <Button size="xs" disabled={!valid} onClick={move}>
                  Move
                </Button>
              </div>
            </Modal>
          );
        })()}

      {/* Loading another file drops an order nobody has saved. */}
      <Modal isOpen={confirmLoad} onClose={() => setConfirmLoad(false)} className="max-w-sm p-6">
        <h3 className="mb-2 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          Open {chosen?.identifier_value}?
        </h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          The order you changed on {identifier?.identifier_value} has not been saved. Opening
          another {label.toLowerCase()} loses it.
        </p>
        <div className="flex justify-end gap-2">
          <Button size="xs" variant="outline" onClick={() => setConfirmLoad(false)}>
            Stay
          </Button>
          <Button
            size="xs"
            onClick={async () => {
              setConfirmLoad(false);
              // The order being dropped is the one on screen, so put the
              // file back as it was saved before opening another.
              setPages(pages.slice().sort((a, b) => savedOrder.indexOf(a.image_id) - savedOrder.indexOf(b.image_id)));
              if (holdingLock) await releaseLock({ quiet: true });
              if (chosen) openForSequencing(chosen);
            }}
          >
            Open it
          </Button>
        </div>
      </Modal>

      {/* Finding a folio. A dialog rather than a dropdown: with thousands of
          them the list is the screen, and wildcards are how somebody finds
          the one they half-remember. */}
      <Modal isOpen={isPickerOpen} onClose={() => setIsPickerOpen(false)} className="max-w-lg p-6">
        <h3 className="mb-2 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          Find a {label.toLowerCase()}
        </h3>


        <input
          autoFocus
          value={pickerQuery}
          onChange={(e) => setPickerQuery(e.target.value)}
          placeholder="Search"
          className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-800 focus:border-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
        />

        {/* A fixed height: the dialog jumped about as results narrowed, and
            the list moved out from under the pointer. */}
        <div className="mt-3 h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
          {pickerMatches.length === 0 ? (
            <p className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
              Nothing matches that.
            </p>
          ) : (
            pickerMatches.map((row) => (
              <button
                key={row.identifier_id}
                type="button"
                // Being worked on means the order cannot be changed at all,
                // so choosing it leads nowhere. Shown rather than hidden,
                // with the reason — otherwise somebody searches for a folio
                // they know exists and concludes it is gone.
                disabled={!selectableInPicker(row)}
                onClick={() => {
                  setChosen(row);
                  setIsPickerOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 text-left text-sm last:border-b-0 dark:border-gray-800 ${
                  !selectableInPicker(row)
                    ? "cursor-not-allowed text-gray-400 dark:text-gray-600"
                    : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.03]"
                }`}
              >
                <span className="truncate">{row.identifier_value}</span>
                {heldByMe(row) ? (
                  <span className="shrink-0 text-xs font-medium text-success-600 dark:text-success-500">
                    Open by you
                  </span>
                ) : (
                  Number(row.open) !== IdentifierLock.FREE && (
                    <span className="shrink-0 text-xs text-warning-600 dark:text-warning-500">
                      {Number(row.open) === IdentifierLock.SEQUENCING
                        ? "Open for sequencing"
                        : "Being captured"}
                    </span>
                  )
                )}
              </button>
            ))
          )}
        </div>

        <p className="mt-2 text-xs text-gray-400">
          {pickerMatches.length === 100
            ? "First 100 shown — narrow the search to see the rest."
            : `${pickerMatches.length} shown`}
        </p>

        <div className="mt-5 flex justify-end">
          <Button size="xs" variant="outline" onClick={() => setIsPickerOpen(false)}>
            Cancel
          </Button>
        </div>
      </Modal>

      {/* Who changed this file, and when. Rearranging can quietly undo a
          verifier's check, so it is written down. */}
      <Modal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        className="max-w-md p-6"
      >
        <h3 className="mb-4 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          Arrange history
        </h3>
        <ul className="max-h-80 space-y-3 overflow-y-auto">
          {history.map((row) => (
            <li key={row.identifier_arrange_id} className="text-sm">
              <p className="text-gray-800 dark:text-white/90">
                {row.user?.username || `User ${row.user_id}`} moved{" "}
                {row.moved_count === 1 ? "1 page" : `${row.moved_count} pages`}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {new Date(row.arranged_at).toLocaleString()}
              </p>
              {row.notes && (
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{row.notes}</p>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end">
          <Button size="xs" variant="outline" onClick={() => setIsHistoryOpen(false)}>
            Close
          </Button>
        </div>
      </Modal>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
