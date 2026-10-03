import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import PageMeta from "../components/common/PageMeta";
import Toast from "../components/common/Toast";
import { Modal } from "../components/ui/modal";
import Button from "../components/ui/button/Button";
import TextArea from "../components/form/input/TextArea";
import { useProject } from "../context/ProjectContext";
import { useCustomer, storedCustomerUrl } from "../context/CustomerContext";
import { authService } from "../services/authService";
import { useAuth } from "../context/AuthContext";
import { assignmentStageService } from "../services/assignmentStageService";
import { assignmentLabel } from "../services/assignmentService";
import { documentService } from "../services/documentService";
import { verificationService, ImageDecision } from "../services/verificationService";
import type { Review, ReviewImage } from "../services/verificationService";
import { uploadService } from "../services/uploadService";

const MIN_PANE = 320;
const MAX_PANE = 900;

// Small icons for the header buttons, drawn here rather than pulled in as
// components — each is one path and used once.
const icon = (path: string) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
    <path d={path} />
  </svg>
);

const ICON_DISCARD = "M9 3h6l1 2h4v2H4V5h4zM6 9h12v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zm3 2v9h2v-9zm4 0v9h2v-9z";
const ICON_SAVE = "M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10z";
const ICON_SEND_BACK = "M11 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z";
const ICON_COMPLETE = "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z";
const ICON_RELEASE = "M16 13v-2H7V8l-5 4 5 4v-3zM20 3h-8v2h8v14h-8v2h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z";
const ICON_CLAIM = "M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 7 7v2a9 9 0 0 0 0-18z";

export default function VerifyBatch() {
  const navigate = useNavigate();
  const { assignmentId } = useParams();
  const { project } = useProject();
  const { customer } = useCustomer();

  // Reachable two ways, like Digitize: /verify/:assignmentId from a list, and
  // a bare /verify from the menu, which resolves whatever batch is held.
  const [resolvedId, setResolvedId] = useState<number | null>(
    assignmentId ? Number(assignmentId) : null
  );
  const [resolving, setResolving] = useState(!assignmentId);
  const id = resolvedId ?? 0;

  const [review, setReview] = useState<Review | null>(null);
  const [identifierValue, setIdentifierValue] = useState<string | null>(null);
  // Whether the folio's own name has been looked up yet. The header waits
  // for it: the id stands in for the name, so showing it first meant "#0",
  // then "#8", then "Circulars" in the time it took to load.
  const [identifierLoaded, setIdentifierLoaded] = useState(false);
  // Tiles draw from stored thumbnails; the full scan is fetched only for the
  // document being looked at.
  const [previews, setPreviews] = useState<Map<number, string>>(new Map());
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [finishing, setFinishing] = useState(false);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [openFull, setOpenFull] = useState(false);

  // Rejecting needs a reason, so it goes through a dialog. Accepting is one
  // click — there is nothing to say about a page that is fine.
  // Verdicts are made here and written on Save, not one API call per click:
  // a verifier going through eighty pages should not be sending eighty
  // requests, and changing their mind should cost nothing.
  //
  // null in the map means "no decision" — different from a document simply
  // not being in the map, which means "unchanged from what is stored".
  const [pending, setPending] = useState<
    Map<number, { decision: number | null; comment?: string; notes?: string[] }>
  >(new Map());
  const [savingDecisions, setSavingDecisions] = useState<{ done: number; total: number } | null>(null);
  // The document being written right now, so its tile shows it the way the
  // Digitize tabs do while a document uploads.
  const [savingImageId, setSavingImageId] = useState<number | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Overriding a verdict that is already on record. Held here so the
  // confirmation knows what it is about to change.
  const [overriding, setOverriding] = useState<ReviewImage | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const [rejecting, setRejecting] = useState<ReviewImage | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [returning, setReturning] = useState(false);
  const [returnNote, setReturnNote] = useState("");
  // Asked for when signing off, not left standing on the screen.
  const [batchComment, setBatchComment] = useState("");
  const [completing, setCompleting] = useState(false);
  const { user } = useAuth();
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [addingNote, setAddingNote] = useState(false);
  // Thumbnail size, remembered per browser and shared with the Batch tab's
  // slider — the same person looks at both grids the same way.
  const [tileSize, setTileSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("smartdoc.batchTileSize"));
      return saved >= 80 && saved <= 320 ? saved : 120;
    } catch {
      return 120;
    }
  });

  const changeTileSize = (next: number) => {
    setTileSize(next);
    try {
      localStorage.setItem("smartdoc.batchTileSize", String(next));
    } catch {
      // A browser that refuses storage still gets a working slider.
    }
  };
  const [imageNote, setImageNote] = useState("");

  const gridRef = useRef<HTMLDivElement | null>(null);
  // Each tile, so moving the selection can scroll it into view. Stepping with
  // the arrows or the pane's buttons otherwise walked off the bottom of the
  // grid and left the selected document out of sight.
  const tileRefs = useRef<Map<number, HTMLElement>>(new Map());
  const reviewRef = useRef<Review | null>(null);
  const selectedIdRef = useRef<number | null>(null);

  const [paneWidth, setPaneWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("smartdoc.verifyPaneWidth"));
      return saved >= MIN_PANE && saved <= MAX_PANE ? saved : 420;
    } catch {
      return 420;
    }
  });

  const images = review?.images ?? [];
  const selected = images.find((i) => i.image.image_id === selectedId) || null;
  // What this page was categorised as. Comes with the review — the same join
  // the Batch tab reads.
  const categoryOf = (item: ReviewImage | null) => {
    const raw = item?.image as unknown as {
      image_categories?: { category?: { category_name?: string } }[];
    };
    return raw?.image_categories?.[0]?.category?.category_name || null;
  };

  // The attribute values captured with the batch — scan date, GR number and
  // whatever else that project asks for. Read-only here: this screen judges
  // the pictures, and the values were typed once at capture.
  const capturedAttributes = (() => {
    const source =
      review?.images.find((i) => i.image.image_id === selectedId) ?? review?.images[0];
    const raw = source?.image as unknown as {
      image_attributes?: {
        attribute_id: number;
        attribute_value: string;
        attribute?: { attribute_name?: string };
      }[];
    };
    return (raw?.image_attributes ?? []).filter((a) => a.attribute_value?.trim());
  })();

  const summary = review?.summary;
  // A batch can be open here without being claimed — after a send-back the
  // next verify stage is pre-assigned to whoever reviewed the round before.
  const claimed = Boolean(review?.active_verify_stage_id);

  reviewRef.current = review;
  selectedIdRef.current = selectedId;

  const resolveHeldBatch = async () => {
    if (!project) return;
    setResolving(true);
    try {
      const token = await authService.ensureValidToken();
      const mine = await assignmentStageService.getMyWork(project.project_id, token);
      const held = mine.find((m) => m.my_stage.stage_type === 2);
      setResolvedId(held ? held.assignment_id : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to find your verification");
    } finally {
      setResolving(false);
      setLoading(false);
    }
  };

  const loadBatch = async () => {
    setLoading(true);
    setError(null);
    setIdentifierLoaded(false);
    try {
      const token = await authService.ensureValidToken();
      const result = await verificationService.getReview(id, token);
      setReview(result);
      setSelectedId((prev) =>
        prev && result.images.some((i) => i.image.image_id === prev)
          ? prev
          : result.images[0]?.image.image_id ?? null
      );

      try {
        const identifier = await documentService.getIdentifierById(
          result.assignment.identifier_id,
          token
        );
        setIdentifierValue(identifier?.identifier_value ?? null);
      } catch {
        setIdentifierValue(null);
      } finally {
        setIdentifierLoaded(true);
      }

      // Only sign what isn't already held, so re-reading after a decision
      // costs nothing.
      const known = previews;
      const missing = result.images.filter((item) => !known.has(item.image.image_id));
      if (missing.length > 0) {
        const links = await Promise.all(
          missing.map(async (item) => {
            try {
              const url = await uploadService.getDownloadUrl(
                `thumb/${item.image.image_path}`,
                token
              );
              return [item.image.image_id, url] as const;
            } catch {
              return [item.image.image_id, ""] as const;
            }
          })
        );
        setPreviews((prev) => {
          const next = new Map(prev);
          links.forEach(([imageId, url]) => url && next.set(imageId, url));
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the batch");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (assignmentId) setResolvedId(Number(assignmentId));
    else resolveHeldBatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, project]);

  useEffect(() => {
    if (resolvedId) loadBatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedId]);

  // The full scan, for whatever is selected.
  useEffect(() => {
    if (!selected) {
      setFullUrl(null);
      return;
    }

    let cancelled = false;
    setFullUrl(null);
    setImageNote("");
    (async () => {
      try {
        const token = await authService.ensureValidToken();
        const url = await uploadService.getDownloadUrl(selected.image.image_path, token);
        if (!cancelled) setFullUrl(url);
      } catch {
        if (!cancelled) setFullUrl(null);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Arrow keys walk the grid; up and down move a whole row, measured from the
  // grid so it stays right as the pane is resized.
  useEffect(() => {
    const columnCount = () => {
      const grid = gridRef.current;
      if (!grid) return 1;
      return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenFull(false);
        return;
      }

      const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
      if (!keys.includes(e.key)) return;

      const target = e.target as HTMLElement;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) {
        return;
      }

      const list = reviewRef.current?.images ?? [];
      if (list.length === 0) return;

      const index = list.findIndex((i) => i.image.image_id === selectedIdRef.current);
      if (index === -1) {
        const first = e.key === "ArrowRight" || e.key === "ArrowDown" ? 0 : list.length - 1;
        setSelectedId(list[first].image.image_id);
        e.preventDefault();
        return;
      }

      const step =
        e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : columnCount() * (e.key === "ArrowUp" ? -1 : 1);
      setSelectedId(list[Math.min(Math.max(index + step, 0), list.length - 1)].image.image_id);
      e.preventDefault();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = paneWidth;

    const onMove = (move: MouseEvent) => {
      // The pane is on the right, so dragging left widens it.
      setPaneWidth(Math.min(MAX_PANE, Math.max(MIN_PANE, startWidth + (startX - move.clientX))));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      setPaneWidth((width) => {
        try {
          localStorage.setItem("smartdoc.verifyPaneWidth", String(width));
        } catch {
          // A browser that refuses storage still resizes, it just forgets.
        }
        return width;
      });
    };

    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // What a document reads as on screen: the unsaved verdict if there is one,
  // otherwise what is stored.
  const decisionOf = (item: ReviewImage) =>
    pending.has(item.image.image_id) ? pending.get(item.image.image_id)!.decision : item.decision;

  // A staged entry only matters if it says something different from what is
  // stored — a verdict that changed, or notes waiting to be written.
  const hasChange = (item: ReviewImage) => {
    const entry = pending.get(item.image.image_id);
    if (!entry) return false;
    return entry.decision !== item.decision || (entry.notes?.length ?? 0) > 0;
  };

  const unsavedCount = (review?.images ?? []).filter((i) => hasChange(i)).length;

  // A verdict that is already on record. It can still be changed to the
  // other verdict — a mis-click should not cost the uploader a round trip —
  // but never back to "not looked at", and never without being asked first.
  // The change is staged like any other, so it costs one call at Save rather
  // than one per second thought.
  const isSaved = (item: ReviewImage) => item.decision !== null;

  const unstage = (item: ReviewImage) =>
    setPending((prev) => {
      const next = new Map(prev);
      const entry = next.get(item.image.image_id);
      // Only the verdict goes back to what is stored; notes typed for this
      // page are a separate thing and stay staged.
      if (entry?.notes?.length) next.set(item.image.image_id, { ...entry, decision: item.decision });
      else next.delete(item.image.image_id);
      return next;
    });

  const stage = (item: ReviewImage, decision: number | null, comment?: string) => {
    setPending((prev) => {
      const next = new Map(prev);
      // Back to what is stored — nothing to save for this one.
      if (decision === item.decision && !comment) next.delete(item.image.image_id);
      else next.set(item.image.image_id, { decision, comment });
      return next;
    });

    // Taking a verdict back off is a second look at THIS page, not a move to
    // the next one — jumping away would be the opposite of what was asked.
    if (decision === null) return;

    // Move to the next undecided document, so a run of accepts doesn't need a
    // click between each one.
    const list = review?.images ?? [];
    const from = list.findIndex((i) => i.image.image_id === item.image.image_id);
    const next = list.slice(from + 1).find((i) => decisionOf(i) === null) || list[from + 1];
    if (next) setSelectedId(next.image.image_id);
  };

  // What Accept and Reject do for a given document — used by the buttons on
  // each thumbnail, so the rules live in one place rather than in the markup.
  // Step through the batch from the pane, so a verifier can work without
  // going back to the grid between pages.
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
    const list = review?.images ?? [];
    const index = list.findIndex((i) => i.image.image_id === selectedId);
    const next = list[index + delta];
    if (next) setSelectedId(next.image.image_id);
  };

  const pressAccept = (item: ReviewImage) => {
    if (!claimed) return;
    if (isSaved(item)) {
      // Already accepted on record: nothing to do. Otherwise ask before
      // overriding what is stored.
      if (item.decision !== ImageDecision.VERIFIED) {
        setOverriding(item);
        setOverrideReason("");
      }
      return;
    }
    if (decisionOf(item) === ImageDecision.VERIFIED) unstage(item);
    else stage(item, ImageDecision.VERIFIED);
  };

  const pressReject = (item: ReviewImage) => {
    if (!claimed) return;
    if (isSaved(item)) {
      // The warning rides on top of the reason dialog rather than stacking a
      // second box in front of it.
      if (item.decision !== ImageDecision.REJECTED) {
        setRejecting(item);
        setRejectReason("");
      }
      return;
    }
    if (decisionOf(item) === ImageDecision.REJECTED) {
      unstage(item);
      return;
    }
    setRejecting(item);
    setRejectReason("");
  };

  const cancelPending = () => {
    setPending(new Map());
    setConfirmCancel(false);
  };

  // One press, one pass: each document the API can only be told about on its
  // own, so they go one after another with a count rather than in a burst.
  const savePending = async () => {
    const list = (review?.images ?? []).filter((i) => hasChange(i));
    if (list.length === 0) return;

    setSavingDecisions({ done: 0, total: list.length });
    try {
      const token = await authService.ensureValidToken();
      let latest = review;

      // Every verdict in one request. A staged change back to undecided is
      // dropped rather than written, and a saved one cannot be cleared.
      const verdicts = list
        .filter((item) => {
          const change = pending.get(item.image.image_id)!;
          return change.decision !== null && change.decision !== item.decision;
        })
        .map((item) => {
          const change = pending.get(item.image.image_id)!;
          return {
            image_id: item.image.image_id,
            accept: change.decision === ImageDecision.VERIFIED,
            comment: change.comment,
          };
        });

      if (verdicts.length > 0) {
        setSavingImageId(verdicts[0].image_id);
        latest = await verificationService.decideImages(id, verdicts, token);
        setSavingDecisions({ done: verdicts.length, total: list.length });
      }

      // Then the notes typed on each page, in the order they were written.
      // These stay one at a time: each is its own row with its own text, and
      // there are rarely more than a handful.
      for (let i = 0; i < list.length; i += 1) {
        const item = list[i];
        const change = pending.get(item.image.image_id)!;
        for (const note of change.notes ?? []) {
          setSavingImageId(item.image.image_id);
          await verificationService.addComment(id, note, token, item.image.image_id);
        }
        setSavingDecisions({ done: i + 1, total: list.length });
      }

      // Notes come back only on a fresh read, so ask for one when any were
      // written; a verdict alone hands back the whole batch already.
      if (list.some((i) => (pending.get(i.image.image_id)?.notes?.length ?? 0) > 0)) {
        await loadBatch();
      } else if (latest) {
        setReview(latest);
      }
      setPending(new Map());
      setToast({
        message: list.length === 1 ? "1 document saved" : `${list.length} documents saved`,
        type: "success",
      });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to save the decisions",
        type: "error",
      });
      await loadBatch();
    } finally {
      setSavingDecisions(null);
      setSavingImageId(null);
    }
  };

  // Written on Save with everything else, not the moment it is typed —
  // going through eighty pages should not be eighty requests, and a note
  // typed by mistake should cost nothing to take back.
  const addImageNote = () => {
    if (!selected || !imageNote.trim()) return;
    const text = imageNote.trim();

    setPending((prev) => {
      const next = new Map(prev);
      const entry = next.get(selected.image.image_id) ?? { decision: selected.decision };
      next.set(selected.image.image_id, {
        ...entry,
        notes: [...(entry.notes ?? []), text],
      });
      return next;
    });
    setImageNote("");
  };

  // Signing off, with a note for the batch if there is one to leave. The
  // note is a comment rather than something carried on the transition —
  // COMPLETE_VERIFY does not record notes, and a remark about the batch
  // belongs in the thread anyway.
  const completeBatch = async () => {
    setFinishing(true);
    try {
      if (batchComment.trim()) {
        const token = await authService.ensureValidToken();
        await verificationService.addComment(id, batchComment.trim(), token);
      }
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to add the note",
        type: "error",
      });
      setFinishing(false);
      return;
    }
    setFinishing(false);
    setCompleting(false);
    await finish("COMPLETE_VERIFY");
  };

  const claim = async () => {
    setFinishing(true);
    try {
      const token = await authService.ensureValidToken();
      await assignmentStageService.transition(id, "CLAIM_VERIFY", token);
      await loadBatch();
      setToast({ message: "Batch claimed — you can start verifying", type: "success" });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to claim this batch",
        type: "error",
      });
    } finally {
      setFinishing(false);
    }
  };

  const finish = async (
    event: "COMPLETE_VERIFY" | "RETURN" | "RELEASE_VERIFY",
    note?: string
  ) => {
    setFinishing(true);
    try {
      const token = await authService.ensureValidToken();
      await assignmentStageService.transition(id, event, token, note);
      setToast({
        message:
          event === "COMPLETE_VERIFY"
            ? "Batch verified"
            : event === "RELEASE_VERIFY"
            ? "Returned to the queue for anyone to pick up"
            : "Batch sent back for correction",
        type: "success",
      });
      navigate(`/${customer?.customer_url ?? storedCustomerUrl() ?? ""}`);
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to finish the verification",
        type: "error",
      });
    } finally {
      setFinishing(false);
      setReturning(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 w-full bg-gray-50 dark:bg-gray-900 overflow-hidden min-w-0 min-h-0">
      <PageMeta title="Verify batch | SmartDoc" description="Verify a batch of documents" />

      {/* Header: what this is, and the two ways out */}
      <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex min-w-0 items-center gap-3">
          {/* The batch, then the file it belongs to — the same line as on
              Digitize. A file can be captured more than once, so the code is
              what identifies the work being verified. */}
          {/* Same size and weight as the line on Digitize — it is the same
              line, and the two screens sit either side of one batch. */}
          {review?.assignment && identifierLoaded && (
            <div className="truncate text-xs text-gray-700 dark:text-gray-300">
              <span className="font-mono">{assignmentLabel(review.assignment)}</span>
              <span className="px-1.5 text-gray-300 dark:text-gray-600">|</span>
              <span className="font-medium">
                {identifierValue || `#${review.assignment.identifier_id}`}
              </span>
            </div>
          )}
          {/* Behind a click, as on Digitize: notes can be a paragraph, and
              the history under them is long by the second round. */}
          <button
            type="button"
            onClick={() => setIsNotesOpen(true)}
            className="flex flex-shrink-0 items-center gap-1 text-xs text-brand-500 hover:underline"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
              <path d="M4 4h16v2H4zm0 5h16v2H4zm0 5h10v2H4z" />
            </svg>
            Notes and History
          </button>
        </div>

        {/* This row finishes with the batch. Recording verdicts — Save,
            Discard — and how big the tiles are sit on the row below, with
            the grid they act on. */}
        <div className="flex flex-shrink-0 items-center gap-3">
          {claimed ? (
            <>
              <Button
                size="xs"
                variant="outline"
                disabled={finishing || !review}
                startIcon={icon(ICON_SEND_BACK)}
                onClick={() => setReturning(true)}
              >
                Send back
              </Button>
              {/* Live, and it says why when it can't go through: a greyed-out
                  button with no explanation is the reason "everything is
                  decided but Complete is dead" was a puzzle. */}
              <Button
                size="xs"
                disabled={finishing}
                startIcon={icon(ICON_COMPLETE)}
                onClick={() => {
                  // Everything standing in the way, in one message. Naming
                  // only the first was misleading: an unsaved decision reads
                  // like the only problem when twenty-eight pages have not
                  // been looked at.
                  const blocking = [
                    unsavedCount > 0
                      ? unsavedCount === 1
                        ? "1 decision has not been saved"
                        : `${unsavedCount} decisions have not been saved`
                      : null,
                    summary && summary.undecided > 0
                      ? `${summary.undecided} of ${summary.total} documents still need a decision`
                      : null,
                    summary && summary.rejected > 0
                      ? `${summary.rejected} document(s) were rejected, so this batch goes back rather than through`
                      : null,
                  ].filter((line): line is string => line !== null);

                  if (blocking.length > 0) {
                    setToast({ message: `${blocking.join(". ")}.`, type: "error" });
                    return;
                  }

                  setCompleting(true);
                }}
              >
                {finishing ? "Working..." : "Mark Complete"}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="xs"
                variant="outline"
                disabled={finishing || !review}
                startIcon={icon(ICON_RELEASE)}
                onClick={() => finish("RELEASE_VERIFY")}
              >
                Not mine
              </Button>
              <Button
                size="xs"
                disabled={finishing || !review}
                startIcon={icon(ICON_CLAIM)}
                onClick={claim}
              >
                {finishing ? "Claiming..." : "Claim to verify"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Claimed or not, this row exists whenever there is a batch: Save and
          Discard live here now, and they must not disappear with a batch
          that happens to have no captured attributes. */}
      {(capturedAttributes.length > 0 || review) && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-gray-200 bg-white px-6 py-3 dark:border-gray-700 dark:bg-gray-800">
          {capturedAttributes.map((a) => (
            <span key={a.attribute_id} className="text-xs">
              <span className="text-gray-500 dark:text-gray-400">
                {a.attribute?.attribute_name || `#${a.attribute_id}`}:
              </span>{" "}
              <span className="font-medium text-gray-800 dark:text-white/90">
                {a.attribute_value}
              </span>
            </span>
          ))}

          {claimed && (
            <span className="ml-auto flex items-center gap-3">
              {/* What Save has put on record. Counted from what has actually
                  been saved — a staged verdict has not verified anything
                  yet — so it belongs beside the button that does the
                  saving. "Processed", not "Verified": a rejected document
                  has been ruled on but not verified. */}
              {summary && (
                <span
                  className={`text-xs font-medium ${
                    summary.undecided > 0
                      ? "text-error-500"
                      : "text-success-600 dark:text-success-500"
                  }`}
                >
                  Processed {summary.total - summary.undecided}/{summary.total}
                </span>
              )}

              {/* Decisions are written here, once, rather than on every
                  click. Discard throws the unsaved ones away — it was
                  called Cancel, which beside "Send back" and "Mark Complete"
                  read as cancelling the batch itself. */}
              <Button
                size="xs"
                variant="outline"
                disabled={savingDecisions !== null}
                startIcon={icon(ICON_DISCARD)}
                onClick={() => (unsavedCount > 0 ? setConfirmCancel(true) : undefined)}
              >
                Discard
              </Button>

              {/* The label changes as it works, so the button is given a
                  width up front — otherwise what sits beside it shuffles
                  along every time the count ticks. */}
              <span className="inline-flex w-24 justify-center">
                <Button
                  size="xs"
                  className="w-full justify-center"
                  disabled={savingDecisions !== null}
                  startIcon={savingDecisions ? undefined : icon(ICON_SAVE)}
                  onClick={savePending}
                >
                  {savingDecisions
                    ? `${savingDecisions.done + 1}/${savingDecisions.total}...`
                    : unsavedCount > 0
                    ? `Save ${unsavedCount}`
                    : "Save"}
                </Button>
              </span>
            </span>
          )}

          {/* Same control as the Batch tab, and the same remembered size. */}
          <span className={`flex items-center gap-2 ${claimed ? "" : "ml-auto"}`}>
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-3 text-gray-400">
              <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
            </svg>
            <input
              type="range"
              min={80}
              max={320}
              step={20}
              value={tileSize}
              onChange={(e) => changeTileSize(Number(e.target.value))}
              title="Thumbnail size"
              className="h-1 w-32 cursor-pointer appearance-none rounded-full bg-gray-200 accent-brand-500 dark:bg-gray-700"
            />
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-4 text-gray-400">
              <path d="M4 4h16v16H4z" />
            </svg>
          </span>
        </div>
      )}

      {review && !claimed && (
        <p className="flex-shrink-0 border-b border-gray-200 bg-white px-6 py-2 text-xs text-warning-600 dark:border-gray-700 dark:bg-gray-800">
          This batch is assigned to you but not claimed yet. Claim it to accept or reject documents.
        </p>
      )}

      {claimed && summary && !summary.can_complete && summary.undecided === 0 && (
        <p className="flex-shrink-0 border-b border-gray-200 bg-white px-6 py-2 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          This batch has rejected documents, so it goes back for correction rather than through.
        </p>
      )}

      {error && <Toast message={error} type="error" onClose={() => setError(null)} />}

      {/* The work: one document on the left, the batch on the right */}
      <div className="flex min-h-0 flex-1">
        {/* The batch */}
        <div className="relative min-h-0 flex-1 overflow-auto p-4">
          {images.length === 0 && !loading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">This batch has no documents</p>
          ) : (
            <>
              <div
                ref={gridRef}
                // Same spacing as the Digitize grid, so the two screens read
                // as one system.
                className="grid gap-4"
                style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))` }}
              >
                {images.map((item) => {
                  const url = previews.get(item.image.image_id);
                  const shown = decisionOf(item);
                  const isRejected = shown === ImageDecision.REJECTED;
                  const isAccepted = shown === ImageDecision.VERIFIED;
                  const isUnsaved = pending.has(item.image.image_id);
                  const isSaving = savingImageId === item.image.image_id;
                  return (
                    // A div, not a button: it now holds buttons of its own,
                    // and a button inside a button is invalid.
                    <div
                      key={item.image.image_id}
                      ref={(element) => {
                        if (element) tileRefs.current.set(item.image.image_id, element);
                        else tileRefs.current.delete(item.image.image_id);
                      }}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(item.image.image_id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") setSelectedId(item.image.image_id);
                      }}
                      className={`group relative aspect-square cursor-pointer overflow-hidden rounded-sm bg-gray-100 dark:bg-gray-900 ${
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
                          className={`h-full w-full object-cover ${isSaving ? "opacity-50" : ""}`}
                        />
                      ) : (
                        <span className="flex h-full items-center justify-center text-[10px] text-gray-400">
                          No preview
                        </span>
                      )}

                      {/* Being written right now — the same dimmed picture and
                          spinner the Digitize tabs use while a document
                          uploads. */}
                      {isSaving && (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <span className="block size-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                        </span>
                      )}

                      {/* One dot, three meanings: amber while undecided, green
                          once accepted. A rejected page keeps the red ring —
                          it's the one that still needs work. */}
                      {!isRejected && (
                        <span
                          title={isAccepted ? "Accepted" : "Not decided yet"}
                          className={`absolute right-1 top-1 size-2 rounded-full ${
                            isAccepted ? "bg-success-500" : "bg-warning-500"
                          }`}
                        />
                      )}
                      {/* The verdict, pressed where the document is — on
                          hover only, so the grid stays clean while you scan
                          it. */}
                      {claimed && (
                        <span className="absolute inset-x-1 bottom-1 flex justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            title="Accept"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedId(item.image.image_id);
                              pressAccept(item);
                            }}
                            className={`flex size-6 items-center justify-center rounded-md border shadow-theme-xs transition ${
                              isAccepted
                                ? "border-success-500 bg-success-500 text-white"
                                : "border-success-500 bg-white/90 text-success-600 hover:bg-success-50 dark:bg-gray-900/90 dark:text-success-500"
                            }`}
                          >
                            <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
                              <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            title="Reject"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedId(item.image.image_id);
                              pressReject(item);
                            }}
                            className={`flex size-6 items-center justify-center rounded-md border shadow-theme-xs transition ${
                              isRejected
                                ? "border-error-500 bg-error-500 text-white"
                                : "border-error-500 bg-white/90 text-error-500 hover:bg-error-50 dark:bg-gray-900/90"
                            }`}
                          >
                            <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
                              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                            </svg>
                          </button>
                        </span>
                      )}

                      {/* An unsaved verdict, so a batch part-way through is
                          obvious without opening each page. */}
                      {isUnsaved && !isSaving && (
                        <span className="absolute bottom-1 right-1 rounded-full bg-warning-500 px-1.5 text-[10px] font-medium text-white">
                          Draft
                        </span>
                      )}
                      {/* Counted from the list: the stored number is spaced,
                          so it is never shown as-is. */}
                      <span className="absolute left-1 top-1 rounded bg-gray-900/70 px-1.5 text-[10px] font-semibold text-white">
                        {images.indexOf(item) + 1}
                      </span>

                      {item.comments.length > 0 && (
                        <span className="absolute left-1 top-1 rounded bg-gray-900/70 px-1 text-[10px] text-white">
                          {item.comments.length}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div
          onMouseDown={startResize}
          title="Drag to resize"
          className="hidden w-1 flex-shrink-0 cursor-col-resize bg-gray-200 transition-colors hover:bg-brand-400 dark:bg-gray-700 xl:block"
        />

        <aside
          style={{ width: paneWidth }}
          className="hidden min-h-0 flex-shrink-0 flex-col overflow-hidden border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 xl:flex"
        >
          {!selected ? (
            <p className="p-4 text-sm text-gray-500 dark:text-gray-400">
              {loading || resolving ? "" : "Select a document"}
            </p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <button
                type="button"
                onDoubleClick={() => setOpenFull(true)}
                title="Double-click for full size"
                style={{ height: Math.round(paneWidth * 0.9), maxHeight: "55vh" }}
                // Room at the top for the labels, so the picture starts below
                // them instead of underneath them.
                className="relative flex flex-shrink-0 items-center justify-center overflow-hidden bg-gray-50 pt-11 dark:bg-gray-900"
              >
                {/* What the page was categorised as, over the picture it
                    describes — the thing a verifier checks it against. */}
                <span
                  title={categoryOf(selected) ? "Category" : "Not categorised"}
                  className={`absolute left-3 top-3 max-w-[70%] truncate rounded-full px-2.5 py-1 text-[10px] font-medium text-white ${
                    categoryOf(selected) ? "bg-brand-500" : "bg-brand-500/50"
                  }`}
                >
                  {categoryOf(selected) || "Not categorised"}
                </span>

                {/* What the document currently is, top right — opposite the
                    category, and clear of the picture below. */}
                <span className="absolute right-3 top-3 flex items-center gap-1.5">
                  {decisionOf(selected) !== null && (
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-medium text-white ${
                        decisionOf(selected) === ImageDecision.VERIFIED
                          ? "bg-success-500"
                          : "bg-error-500"
                      }`}
                    >
                      {decisionOf(selected) === ImageDecision.VERIFIED ? "Accepted" : "Rejected"}
                    </span>
                  )}
                  {pending.has(selected.image.image_id) && (
                    <span className="rounded-full bg-warning-500 px-2.5 py-1 text-[10px] font-medium text-white">
                      Draft
                    </span>
                  )}
                </span>

                {fullUrl || previews.get(selected.image.image_id) ? (
                  <img
                    src={fullUrl || previews.get(selected.image.image_id)}
                    alt=""
                    className="max-h-full w-full cursor-zoom-in object-contain"
                  />
                ) : (
                  <span className="text-xs text-gray-400">Preview unavailable</span>
                )}
              </button>

              {/* Under the document being judged: the verdict on the left,
                  the way to the next page on the right. Everything needed to
                  work through a batch without touching the grid. */}
              {(() => {
                const list = review?.images ?? [];
                const index = list.findIndex((i) => i.image.image_id === selectedId);
                const verdict =
                  "flex size-8 items-center justify-center rounded-lg border transition disabled:opacity-40 disabled:cursor-not-allowed";
                const step =
                  "flex size-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-gray-400 dark:hover:bg-white/[0.05]";

                return (
                  <div className="relative flex flex-shrink-0 items-center justify-end gap-2 border-t border-gray-100 px-3 py-2 dark:border-gray-800">
                    {/* Stepping through the batch sits in the middle, the
                        verdict on the right — one is about where you are, the
                        other about what you decide. */}
                    <span className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1">
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
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {index + 1}/{list.length}
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

                    </span>

                    <button
                      type="button"
                      title={
                        isSaved(selected)
                          ? selected.decision === ImageDecision.VERIFIED
                            ? "Accepted and saved"
                            : "Rejected and saved — changing it asks first"
                          : decisionOf(selected) === ImageDecision.VERIFIED
                          ? "Accepted — press again to undo"
                          : "Accept"
                      }
                      disabled={!claimed}
                      onClick={() => pressAccept(selected)}
                      className={`${verdict} ${
                        decisionOf(selected) === ImageDecision.VERIFIED
                          ? "border-success-500 bg-success-500 text-white"
                          : "border-success-500 text-success-600 hover:bg-success-50 dark:text-success-500 dark:hover:bg-success-500/10"
                      }`}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                        <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      title={
                        isSaved(selected)
                          ? selected.decision === ImageDecision.REJECTED
                            ? "Rejected and saved"
                            : "Accepted and saved — changing it asks first"
                          : decisionOf(selected) === ImageDecision.REJECTED
                          ? "Rejected — press again to undo"
                          : "Reject"
                      }
                      disabled={!claimed}
                      onClick={() => pressReject(selected)}
                      className={`${verdict} ${
                        decisionOf(selected) === ImageDecision.REJECTED
                          ? "border-error-500 bg-error-500 text-white"
                          : "border-error-500 text-error-500 hover:bg-error-50 dark:hover:bg-error-500/10"
                      }`}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                        <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                      </svg>
                    </button>
                  </div>
                );
              })()}

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto border-t border-gray-200 p-3 dark:border-gray-700">
                <div className="-mx-3 flex items-center justify-between gap-2 border-y border-gray-100 bg-gray-50 px-3 py-1.5 dark:border-gray-800 dark:bg-white/[0.03]">
                  <span className="text-gray-500 dark:text-gray-400">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5 shrink-0">
                      <title>Notes</title>
                      <path d="M4 4h16v2H4zm0 5h16v2H4zm0 5h10v2H4z" />
                    </svg>
                  </span>
                  {claimed && (
                    <button
                      type="button"
                      title="Add a note about this document"
                      onClick={() => {
                        setImageNote("");
                        setAddingNote(true);
                      }}
                      className="flex size-6 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-brand-500 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                        <path d="M12 4v16m8-8H4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                </div>

                {selected.comments.length > 0 ||
                pending.get(selected.image.image_id)?.comment ||
                (pending.get(selected.image.image_id)?.notes?.length ?? 0) > 0 ? (
                  <div className="space-y-1">
                    <ul className="space-y-2.5">
                      {/* The reason typed for a rejection that has not been
                          saved yet. Same list as the rest — it is a note like
                          any other, it just isn't on record until Save. */}
                      {[
                        pending.get(selected.image.image_id)?.comment,
                        ...(pending.get(selected.image.image_id)?.notes ?? []),
                      ]
                        .filter((text): text is string => Boolean(text))
                        .map((text, index) => (
                        <li key={`draft-${index}`} className="space-y-0.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="min-w-0 text-sm text-gray-700 dark:text-gray-300">
                              {text}
                            </p>
                            <span className="mt-0.5 shrink-0 rounded-full bg-warning-500 px-1.5 text-[10px] font-medium text-white">
                              Draft
                            </span>
                          </div>
                          {/* The same line the saved notes carry, so it reads
                              as one list. It will be written under this name,
                              at whatever time Save happens. */}
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            {user?.preferred_username || "You"} · {new Date().toLocaleString()}
                          </p>
                        </li>
                        ))}

                      {/* Newest first: the last thing said about a page is the
                          thing being answered. */}
                      {[...selected.comments]
                        .sort(
                          (a, b) =>
                            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
                        )
                        .map((c) => (
                          <li key={c.assignment_comment_id} className="space-y-0.5">
                            <p className="text-sm text-gray-700 dark:text-gray-300">{c.comment}</p>
                            {/* Who said it and when. A rejection reason and a
                                plain note are the same kind of row in the
                                database, so this is what tells them apart —
                                the verifier's name against a page that came
                                back is the rejection. */}
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              {c.created_by_username || "Unknown"}
                              {c.created_at ? ` · ${new Date(c.created_at).toLocaleString()}` : ""}
                            </p>
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Full size: the image on a dark backdrop and nothing else */}
      {openFull && selected && (
        <div
          className="fixed inset-0 z-99999 flex items-center justify-center bg-gray-900/95"
          onClick={() => setOpenFull(false)}
        >
          {fullUrl || previews.get(selected.image.image_id) ? (
            <img
              src={fullUrl || previews.get(selected.image.image_id)}
              alt=""
              className="max-h-screen max-w-full cursor-zoom-out object-contain"
            />
          ) : (
            <span className="text-sm text-white/70">Preview unavailable</span>
          )}
        </div>
      )}

      {/* Reject dialog — the reason is required, not optional */}
      <Modal isOpen={!!rejecting} onClose={() => setRejecting(null)} className="max-w-lg p-6">
        <h3 className="mb-4 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          Reject document
        </h3>
        {/* One box, not two: the warning rides above the reason it already
            has to ask for. */}
        {rejecting?.decision === ImageDecision.VERIFIED && (
          <p className="mb-4 rounded-lg border border-warning-500/40 bg-warning-500/10 p-3 text-sm text-warning-600 dark:text-warning-500">
            This document is already accepted, and that decision is on record. Rejecting it
            replaces the verdict; the change is written when you press Save.
          </p>
        )}
        <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
          Reason <span className="text-error-500">*</span>
        </label>
        <TextArea
          rows={3}
          value={rejectReason}
          onChange={(value) => setRejectReason(value)}
        />
        {/* Required here and in smartdoc_api: a rejected page with no reason
            tells the person redoing it nothing. */}
        {!rejectReason.trim() && (
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            A reason is required before a document can be rejected.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button size="xs" type="button" variant="outline" onClick={() => setRejecting(null)}>
            Cancel
          </Button>
          <Button
            size="xs"
            type="button"
            disabled={!rejectReason.trim()}
            onClick={() => {
              const item = rejecting;
              setRejecting(null);
              if (item) stage(item, ImageDecision.REJECTED, rejectReason.trim());
            }}
          >
            Reject document
          </Button>
        </div>
      </Modal>

      {/* Send-back dialog */}
      <Modal isOpen={returning} onClose={() => setReturning(false)} className="max-w-lg p-6">
        <h3 className="mb-4 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          Send batch back for correction
        </h3>
        <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
          Reason <span className="text-error-500">*</span>
        </label>
        <TextArea
          rows={3}
          value={returnNote}
          onChange={(value) => setReturnNote(value)}
        />
        {/* Required: a batch sent back with no reason gives the uploader a
            pile of pages and no idea what was wrong with them. */}
        {!returnNote.trim() && (
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            A reason is required before a batch can go back.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button size="xs" type="button" variant="outline" onClick={() => setReturning(false)} disabled={finishing}>
            Cancel
          </Button>
          <Button
            size="xs"
            type="button"
            disabled={finishing || !returnNote.trim()}
            onClick={() => finish("RETURN", returnNote.trim())}
          >
            {finishing ? "Sending..." : "Send back"}
          </Button>
        </div>
      </Modal>

      {/* Overriding a decision that is already on record */}
      <Modal isOpen={!!overriding} onClose={() => setOverriding(null)} className="max-w-sm p-6">
        <h3 className="mb-2 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          Change a saved decision?
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          This document is already rejected, and that decision is on record. Accepting it replaces
          the verdict; the change is written when you press Save and stays in the history.
        </p>
        <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
          Reason <span className="text-error-500">*</span>
        </label>
        <TextArea rows={3} value={overrideReason} onChange={(value) => setOverrideReason(value)} />
        {/* Required even to accept: overturning a recorded verdict is the one
            change nobody can work out the reason for afterwards. */}
        {!overrideReason.trim() && (
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            A reason is required to change a saved decision.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button size="xs" type="button" variant="outline" onClick={() => setOverriding(null)}>
            Keep it
          </Button>
          <Button
            size="xs"
            type="button"
            disabled={!overrideReason.trim()}
            onClick={() => {
              const item = overriding;
              setOverriding(null);
              if (item) stage(item, ImageDecision.VERIFIED, overrideReason.trim());
            }}
          >
            Change to accepted
          </Button>
        </div>
      </Modal>

      {/* A note about one document, asked for rather than sitting in a box on
          the pane. */}
      <Modal isOpen={addingNote} onClose={() => setAddingNote(false)} className="max-w-lg p-6">
        <h3 className="mb-4 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          Add a note
        </h3>
        <TextArea rows={3} value={imageNote} onChange={(value) => setImageNote(value)} />
        <div className="mt-5 flex justify-end gap-2">
          <Button size="xs" type="button" variant="outline" onClick={() => setAddingNote(false)}>
            Cancel
          </Button>
          <Button
            size="xs"
            type="button"
            disabled={!imageNote.trim()}
            onClick={() => {
              addImageNote();
              setAddingNote(false);
            }}
          >
            Add note
          </Button>
        </div>
      </Modal>

      {/* Throwing away unsaved verdicts */}
      <Modal isOpen={confirmCancel} onClose={() => setConfirmCancel(false)} className="max-w-sm p-6">
        <h3 className="mb-2 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          Discard unsaved decisions?
        </h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          {unsavedCount === 1
            ? "One document goes back to the decision on record."
            : `${unsavedCount} documents go back to the decisions on record.`}
        </p>
        <div className="flex justify-end gap-2">
          <Button size="xs" type="button" variant="outline" onClick={() => setConfirmCancel(false)}>
            Keep them
          </Button>
          <Button size="xs" type="button" onClick={cancelPending}>
            Discard
          </Button>
        </div>
      </Modal>

      {/* Notes and history: what was said about this batch, and what happened
          to it, in one place. */}
      <Modal isOpen={isNotesOpen} onClose={() => setIsNotesOpen(false)} className="max-w-2xl p-6">
        <h3 className="mb-4 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          Notes and History
        </h3>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
              Assignment notes
            </p>
            <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-700 dark:bg-white/[0.03] dark:text-gray-300">
              {review?.assignment.assignment_notes || "N/A"}
            </p>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
              Notes on the batch
            </p>
            {!review || review.batch_comments.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">Nothing yet</p>
            ) : (
              <ul className="space-y-2">
                {review.batch_comments.map((c) => (
                  <li
                    key={c.assignment_comment_id}
                    className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700"
                  >
                    <p className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {c.created_by_username || "Unknown"}
                      </span>
                      <span>{c.created_at ? new Date(c.created_at).toLocaleString() : ""}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
                      {c.comment}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">History</p>
            {!review || review.stages.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">Nothing yet</p>
            ) : (
              <ul className="space-y-2">
                {review.stages.map((stage) => (
                  <li
                    key={stage.assignment_stage_id}
                    className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700"
                  >
                    <p className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {stage.assigned_to_username || "Unassigned"}
                      </span>
                      <span>
                        {stage.completed_at || stage.started_at
                          ? new Date(stage.completed_at || stage.started_at!).toLocaleString()
                          : ""}
                      </span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-white/[0.06]">
                        {/* Same wording as the Digitize history: what
                            happened, and on which round. */}
                        {stage.stage_status === 4
                          ? `Sent back (round ${stage.round})`
                          : stage.stage_type === 1
                          ? `Captured (round ${stage.round})`
                          : `Verified (round ${stage.round})`}
                      </span>
                    </p>
                    {stage.notes && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
                        {stage.notes}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <Button size="xs" type="button" variant="outline" onClick={() => setIsNotesOpen(false)}>
            Close
          </Button>
        </div>
      </Modal>

      {/* Sign-off, with somewhere to leave a word about the batch */}
      <Modal
        isOpen={completing}
        onClose={() => setCompleting(false)}
        className="max-w-lg p-6"
      >
        <h3 className="mb-1 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          Complete this batch
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Every document has been accepted. Completing it publishes the batch.
        </p>
        <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
          Note (optional)
        </label>
        <TextArea
          rows={3}
          placeholder="Anything worth recording about this batch"
          value={batchComment}
          onChange={(value) => setBatchComment(value)}
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button
            size="xs"
            type="button"
            variant="outline"
            onClick={() => setCompleting(false)}
            disabled={finishing}
          >
            Cancel
          </Button>
          <Button size="xs" type="button" disabled={finishing} onClick={completeBatch}>
            {finishing ? "Working..." : "Complete"}
          </Button>
        </div>
      </Modal>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} position="top-center" />
      )}
    </div>
  );
}
