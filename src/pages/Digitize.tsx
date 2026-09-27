import { useEffect, useMemo, useState, useRef } from "react";
import PageMeta from "../components/common/PageMeta";
import { useProject } from "../context/ProjectContext";
import { useAuth } from "../context/AuthContext";
import { documentService, Identifier, Attribute, ProjectDetails } from "../services/documentService";
import { uploadService, UploadAttribute, DeadLetter, QueueHealth } from "../services/uploadService";
import { authService } from "../services/authService";
import {
  assignmentStageService,
  MyAssignment,
  AssignmentStatus,
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_STATUS_COLORS,
} from "../services/assignmentStageService";
import UploadArea from "../components/documents/UploadArea";
import Toast from "../components/common/Toast";
import { projectSettingService } from "../services/projectSettingService";
import { assignmentService, assignmentLabel } from "../services/assignmentService";
import SearchSelect from "../components/form/SearchSelect";
import { Modal } from "../components/ui/modal";
import BatchPanel, { BatchPanelHandle } from "../components/documents/BatchPanel";
import NotesHistoryDialog, { NotesHistoryIcon } from "../components/assignments/NotesHistoryDialog";
import Tip from "../components/ui/tooltip/Tip";
import { verificationService } from "../services/verificationService";
import type { Review } from "../services/verificationService";
import Button from "../components/ui/button/Button";
import Badge from "../components/ui/badge/Badge";
import { Dropdown } from "../components/ui/dropdown/Dropdown";

export interface UploadedImage {
  id: string;
  file: File;
  preview: string;
  uploaded: boolean;
  uploading: boolean;
  progress: number;
  uploadedAt?: Date;
  s3ObjectKey?: string;
  // Where this page sits in the batch, in the order the files were picked.
  // Kept so a retry re-sends the same position rather than putting the page
  // on the end.
  sequence?: number;
}


// Text and number attributes are sized to their configured character limit so
// the box itself hints at how much can be typed; date inputs keep a fixed
// default (their content is a fixed-length date plus the browser's picker
// icon). Clamped at both ends: a 1-character limit still needs to be
// clickable, and the 100-character ceiling would otherwise run off the row.
//
// Caveat for 'N': pages/Attributes.tsx only persists `length` for 'S' and
// normalizes it to null on number attributes, so number fields keep the
// default width until a limit is actually stored for them.
const MIN_FIELD_CHARS = 5;
const MAX_FIELD_CHARS = 30;

const attributeFieldWidth = (attr: Attribute) => {
  if ((attr.type !== "S" && attr.type !== "N") || !attr.length) return null;
  const chars = Math.min(Math.max(attr.length, MIN_FIELD_CHARS), MAX_FIELD_CHARS);
  // + padding (px-2 both sides) and borders, so `length` characters actually
  // fit. Number inputs also carry the browser's spinner, hence the extra room.
  const padding = attr.type === "N" ? "2.25rem" : "1.25rem";
  return `calc(${chars}ch + ${padding})`;
};

// dd/mm/yyyy — written out rather than left to toLocaleDateString, which
// gives mm/dd/yyyy in a US locale and would silently read as a different date.
const formatAssignedDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
};

// How long ago, in the largest unit that fits: "3 days ago", "2 hours
// ago", "just now". Beside the exact moment, not instead of it.
const formatAgo = (value: string) => {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
};

// The same, with the time of day: dd/mm/yyyy hh:mm.
const formatAssignedMoment = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${formatAssignedDate(value)} ${hours}:${minutes}`;
};

export default function Digitize() {
  const { project } = useProject();
  const { user } = useAuth();
  const [selectedIdentifier, setSelectedIdentifier] = useState<number | null>(null);
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [attributeValues, setAttributeValues] = useState<{ [key: number]: string }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<UploadedImage[]>([]);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [myAssignments, setMyAssignments] = useState<MyAssignment[]>([]);
  const [activeAssignmentIdentifier, setActiveAssignmentIdentifier] = useState<Identifier | null>(null);
  const [projectDetails, setProjectDetails] = useState<ProjectDetails | null>(null);
  const [documentCount, setDocumentCount] = useState<number | null>(null);
  const [isCountInfoOpen, setIsCountInfoOpen] = useState(false);
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false);
  // Two views of the same assignment: what you're adding, and what's already
  // in it. The batch tab is where a returned document and its reason live —
  // before it, an uploader had no way to see either.
  const [tab, setTab] = useState<"upload" | "batch">("upload");
  // Which staged documents are picked out in the Add documents grid. Held
  // here so the count and its actions can sit on the tab row.
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  // How far through a batch upload we are. Non-null means an upload is
  // running, which is what hides the actions that must not be touched
  // half-way through.
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  // Read between files rather than watched, so cancelling stops the queue
  // without abandoning the file already in flight.
  const cancelUploadRef = useRef(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  // Thumbnail size for the Batch tab. Held here because the slider lives in
  // the tab bar, and remembered per browser so it survives a reload.
  const [tileSize, setTileSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("smartdoc.batchTileSize"));
      return saved >= 80 && saved <= 320 ? saved : 120;
    } catch {
      return 120;
    }
  });

  // Whether the Batch tab's detail pane is showing. Remembered per browser,
  // like the thumbnail size — someone who works in the grid alone should not
  // have to close it every visit.
  const [showBatchPane, setShowBatchPane] = useState(() => {
    try {
      return localStorage.getItem("smartdoc.batchPaneHidden") !== "1";
    } catch {
      return true;
    }
  });

  const toggleBatchPane = () => {
    setShowBatchPane((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("smartdoc.batchPaneHidden", next ? "0" : "1");
      } catch {
        // A browser that refuses storage still gets a working toggle.
      }
      return next;
    });
  };

  // Bumped to ask the batch panel to re-check. A counter beats a callback
  // here — the button lives in the tab bar, the data lives in the panel.
  const [batchRefresh, setBatchRefresh] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);
  // null until the batch has actually been read. Starting at 0 meant every
  // load showed Decline — the answer for an empty batch — for the moment
  // before the real count arrived, and then swapped it for Handover.
  const [batchTotal, setBatchTotal] = useState<number | null>(null);
  const [batchRefreshing, setBatchRefreshing] = useState(false);
  // Documents of this batch the db service gave up on: stored, never
  // recorded, sitting in the dead-letter queue. Asked of the queue itself,
  // so they show in a fresh tab too — the Add documents tab only knows about
  // uploads it made. The server refuses to close the batch while any exist.
  const [stuck, setStuck] = useState<DeadLetter[]>([]);
  const [queueHealth, setQueueHealth] = useState<QueueHealth | null>(null);
  const [stuckRetried, setStuckRetried] = useState(false);
  const [retryingStuck, setRetryingStuck] = useState(false);
  // Documents in the batch holding unsaved changes. Reported up so the offer
  // to save them sits on the tab row with the rest of the batch controls.
  const batchRef = useRef<BatchPanelHandle>(null);
  const [draftState, setDraftState] = useState<{
    count: number;
    saving: { done: number; total: number } | null;
  }>({ count: 0, saving: null });
  // Pages dragged into a new order that has not been written yet.
  const [orderState, setOrderState] = useState<{ changed: boolean; saving: boolean }>({
    changed: false,
    saving: false,
  });
  // Documents the pipeline gave up on, so the offer to ask again sits on the
  // tab row with the other batch controls.
  const [failState, setFailState] = useState<{
    count: number;
    enhance: number;
    analyze: number;
    retrying: boolean;
  }>({ count: 0, enhance: 0, analyze: 0, retrying: false });

  const changeTileSize = (next: number) => {
    setTileSize(next);
    try {
      localStorage.setItem("smartdoc.batchTileSize", String(next));
    } catch {
      // A browser that refuses storage still gets a working slider.
    }
  };
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [roundTipOpen, setRoundTipOpen] = useState(false);
  // The status pill's bubble: every stage this batch has been through, in
  // order. Fetched the first time the pill is hovered and kept for the
  // assignment; a status change (start, close) refetches by clearing it.
  const [statusTipOpen, setStatusTipOpen] = useState(false);
  const [statusTrail, setStatusTrail] = useState<
    { key: number; label: string; who: string | null; when: string | null }[] | null
  >(null);
  const loadStatusTrail = async () => {
    if (!currentAssignment || statusTrail) return;
    try {
      const token = await authService.ensureValidToken();
      const review = await verificationService.getReview(currentAssignment.assignment_id, token);
      setStatusTrail(
        [...review.stages]
          .sort((a, b) => a.assignment_stage_id - b.assignment_stage_id)
          .map((st) => ({
            key: st.assignment_stage_id,
            label: `${st.stage_type === 1 ? "Capture" : "Verification"} round ${st.round} — ${
              st.stage_status === 1
                ? "waiting"
                : st.stage_status === 2
                  ? "in progress"
                  : st.stage_status === 3
                    ? "completed"
                    : st.stage_status === 4
                      ? "sent back"
                      : `status ${st.stage_status}`
            }`,
            who: st.assigned_to_username ?? null,
            when: st.completed_at || st.started_at,
          })),
      );
    } catch {
      setStatusTrail([]);
    }
  };
  const [isStartConfirmOpen, setIsStartConfirmOpen] = useState(false);
  // Giving a batch back, or asking for it to be moved. Both need a reason —
  // the next person has to know why it arrived with them.
  const [reasonDialog, setReasonDialog] = useState<"decline" | "handover" | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [reasonBusy, setReasonBusy] = useState(false);
  const [startingAssignment, setStartingAssignment] = useState(false);
  const [closingAssignment, setClosingAssignment] = useState(false);
  // Why the API refused to close — "3 documents are still being processed",
  // say. Shown in the dialog, which is where the person is still standing.
  const [closeRefusal, setCloseRefusal] = useState<string | null>(null);
  // Whether closing hands the batch to a verifier or publishes it there and
  // then. The button says which, because "Send for verification" is simply
  // untrue on a project that verifies itself.
  const [autoVerify, setAutoVerify] = useState<boolean | null>(null);
  // Whether this project lets people give themselves a batch. Off means the
  // ordinary way of working: a supervisor hands the work out, and this screen
  // only shows what has been handed to you.
  const [selfAssign, setSelfAssign] = useState(false);
  // The largest one page may be on this project, in megabytes. Null until
  // the settings land — nothing is refused on a guess.
  const [maxFileMb, setMaxFileMb] = useState<number | null>(null);
  // Files turned away at the door, kept on screen until the next selection
  // or a click: a page silently missing from a batch is the one thing worse
  // than an upload that fails.
  const [tooBig, setTooBig] = useState<{ name: string; mb: string }[]>([]);
  const [isSelfAssignOpen, setIsSelfAssignOpen] = useState(false);
  const [identifierChoices, setIdentifierChoices] = useState<Identifier[]>([]);
  // What has been picked: an existing identifier's id, or NEW_IDENTIFIER for
  // a value typed in that does not exist yet and is created on Start.
  const [identifierPick, setIdentifierPick] = useState("");
  const [newIdentifierValue, setNewIdentifierValue] = useState("");
  const [selfAssigning, setSelfAssigning] = useState(false);
  const [selfAssignError, setSelfAssignError] = useState<string | null>(null);

  const closeLabel = autoVerify ? "Finish assignment" : "Send for verification";
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The one assignment the user is actively capturing. CAPTURING means a
  // capture stage of theirs is in progress — the server enforces one at a
  // time, so at most one row can match.
  const activeAssignment =
    myAssignments.find((a) => a.assignment_status === AssignmentStatus.CAPTURING) || null;

  // Nothing in progress? Offer the oldest batch waiting to be started, so
  // capture can begin here rather than sending someone to another screen and
  // back. Corrections count too — a returned batch restarts capture.
  const startable = activeAssignment
    ? null
    : [...myAssignments]
        .filter(
          (a) =>
            a.my_stage.stage_type === 1 &&
            (a.assignment_status === AssignmentStatus.PENDING_CAPTURE ||
              a.assignment_status === AssignmentStatus.RETURNED_FOR_CORRECTION)
        )
        .sort((a, b) => a.assignment_id - b.assignment_id)[0] || null;

  const otherWaiting = activeAssignment
    ? 0
    : Math.max(
        0,
        myAssignments.filter(
          (a) =>
            a.my_stage.stage_type === 1 &&
            (a.assignment_status === AssignmentStatus.PENDING_CAPTURE ||
              a.assignment_status === AssignmentStatus.RETURNED_FOR_CORRECTION)
        ).length - 1
      );

  // The batch this screen is about, whether or not capture has begun. The
  // header reads the same either way — only the action differs — so a batch
  // waiting to be started isn't a blank screen with an id on it.
  const currentAssignment = activeAssignment ?? startable;

  // A different batch, or this one moving on, means the trail behind the
  // status pill is stale: forget it, and the next hover fetches afresh.
  useEffect(() => {
    setStatusTrail(null);
  }, [currentAssignment?.assignment_id, currentAssignment?.assignment_status]);

  // The real assignment_id groups this upload batch — replaces the old
  // client-generated UUID, which never matched a real `assignment` row
  // (see known-issues.md).
  const assignmentId = activeAssignment ? String(activeAssignment.assignment_id) : null;

  // What the self-assign dialog offers. Everything is listed, including the
  // folios someone else is working on — leaving those out just makes a
  // person wonder whether the number exists at all. They are shown greyed,
  // with the reason.
  const NEW_IDENTIFIER = "__new__";
  const identifierOptions = [
    ...identifierChoices.map((row) => ({
      value: String(row.identifier_id),
      label: row.identifier_value,
      disabled: row.open === 1,
      hint: row.open === 1 ? "Open for Edit" : undefined,
    })),
    ...(newIdentifierValue
      ? [{ value: NEW_IDENTIFIER, label: newIdentifierValue, hint: "new" }]
      : []),
  ];

  const isUploadingImages = selectedImages.some((img) => img.uploading);
  const pendingImageCount = selectedImages.filter((img) => !img.uploaded).length;
  // Uploaded documents can be picked out but not removed here — taking one
  // off this screen would not take it out of the batch.
  // Everything except a document mid-upload. An uploaded one still in the
  // tray is one the batch never recorded, and that is exactly the kind
  // someone needs to clear — the tab row's Remove was still refusing them.
  const removableSelectedIds = selectedImages
    .filter((img) => selectedDocIds.has(img.id) && !img.uploading)
    .map((img) => img.id);

  const computeDefaultAttributeValues = (attrs: Attribute[]) => {
    const initialValues: { [key: number]: string } = {};
    attrs.forEach((attr) => {
      if (attr.default_value) {
        if (attr.type === 'D' && attr.default_value === 'C') {
          // Use current date for 'C'
          const today = new Date().toISOString().split('T')[0];
          initialValues[attr.attribute_id] = today;
        } else {
          initialValues[attr.attribute_id] = attr.default_value;
        }
      } else {
        initialValues[attr.attribute_id] = "";
      }
    });
    return initialValues;
  };

  // Carry the last document's attribute values forward when picking a batch
  // back up. A session is usually one folder of paper with the same GR number
  // and scan date on every page, so retyping them after every break is work
  // the screen can do — and a mistyped value is worse than a stale one being
  // corrected.
  //
  // Fed by the Batch panel's own load rather than a second fetch of the same
  // endpoint, and applied once per assignment so it can't overwrite what the
  // person has since typed.
  const prefilledFor = useRef<number | null>(null);

  // Which uploaded documents have reached the database. The upload API
  // answers "queued", not "stored" — the row is created later by
  // smartdoc_db_service off the queue — so this is the only honest source
  // for whether a document is really in the batch.
  const [batchPaths, setBatchPaths] = useState<Set<string>>(new Set());

  const prefillFromBatch = (review: Review) => {
    setBatchPaths(new Set(review.images.map((i) => i.image.image_path)));
    const assignment = review.assignment.assignment_id;
    if (prefilledFor.current === assignment) return;
    prefilledFor.current = assignment;

    const last = review.images[review.images.length - 1];
    const stored = (last?.image as unknown as {
      image_attributes?: { attribute_id: number; attribute_value: string }[];
    })?.image_attributes;

    if (!stored || stored.length === 0) return;

    setAttributeValues((prev) => {
      const next = { ...prev };
      stored.forEach((row) => {
        if (row.attribute_value !== null && row.attribute_value !== undefined) {
          next[row.attribute_id] = String(row.attribute_value);
        }
      });
      return next;
    });
  };

  // Total images already stored against the assignment's identifier. Kept
  // non-fatal: a failure here leaves the count hidden rather than blocking
  // the upload screen behind an error.
  const refreshDocumentCount = async (identifier: Identifier | null, token: string) => {
    if (!identifier) {
      setDocumentCount(null);
      return;
    }

    try {
      const count = await documentService.getImageCountByIdentifier(
        identifier.project_id,
        identifier.identifier_value,
        token
      );
      setDocumentCount(count);
    } catch (err) {
      console.error("Failed to fetch document count:", err);
      setDocumentCount(null);
    }
  };

  useEffect(() => {
    const fetchIdentifiers = async () => {
      if (!project?.project_id || !user) {
        setLoading(false);
        return;
      }

      try {
        const token = await authService.ensureValidToken();

        // Three independent reads, so they go together rather than in a
        // chain. Serialised, the screen waited for attributes, then the
        // project, then the assignment list before drawing anything.
        //
        // `data` comes back null (not []) when the API can't resolve the
        // project, which would otherwise blow up the .map() below.
        const [attributesResponse, projectData, mine] = await Promise.all([
          documentService.getAttributes(project.project_id, token),
          documentService.getProjectById(project.project_id, token),
          user.user_id
            ? assignmentStageService.getMyWork(project.project_id, token)
            : Promise.resolve([]),
        ]);

        const projectAttributes = attributesResponse.data || [];
        setAttributes(projectAttributes);
        setAttributeValues(computeDefaultAttributeValues(projectAttributes));
        setProjectDetails(projectData);
        setMyAssignments(mine);

        const nextUp = mine
          .filter(
            (a) =>
              a.my_stage.stage_type === 1 &&
              (a.assignment_status === AssignmentStatus.PENDING_CAPTURE ||
                a.assignment_status === AssignmentStatus.RETURNED_FOR_CORRECTION)
          )
          .sort((a, b) => a.assignment_id - b.assignment_id)[0];

        const inProgress = mine.find((a) => a.assignment_status === AssignmentStatus.CAPTURING);
        if (!inProgress && nextUp) {
          // Not started yet, but the header still needs its identifier and
          // count — otherwise the screen shows a bare id.
          const identifier = await documentService.getIdentifierById(nextUp.identifier_id, token);
          setActiveAssignmentIdentifier(identifier);
          setLoading(false);
          refreshDocumentCount(identifier, token);
        }

        if (inProgress) {
          setSelectedIdentifier(inProgress.identifier_id);
          // Land on the batch when there's a send-back to read.
          if (inProgress.return_reason) setTab("batch");

          const identifier = await documentService.getIdentifierById(inProgress.identifier_id, token);
          setActiveAssignmentIdentifier(identifier);

          // The screen is usable now: the fields, the assignment and the
          // identifier are all known. The document count is a number in a
          // tooltip, so it can arrive late rather than hold everything up.
          setLoading(false);
          refreshDocumentCount(identifier, token);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to fetch data";
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    fetchIdentifiers();
  }, [project?.project_id, user]);


  useEffect(() => {
    if (!project?.project_id) return;
    let cancelled = false;

    (async () => {
      try {
        const token = await authService.ensureValidToken();
        const settings = await projectSettingService.getByProject(project.project_id, token);
        if (!cancelled) {
          setAutoVerify(settings ? settings.auto_verify === 1 : false);
          setSelfAssign(settings ? settings.allow_self_assign === 1 : false);
          // What actually applies here — the project's own number or its
          // customer's, resolved by the API so this screen never has to
          // know which.
          setMaxFileMb(settings?.max_file_mb_effective ?? null);
        }
      } catch {
        // Falls back to the wording for the ordinary case.
        if (!cancelled) {
          setAutoVerify(false);
          setSelfAssign(false);
          setMaxFileMb(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [project?.project_id]);

  /**
   * Give yourself a batch and start it.
   *
   * On a project with self assignment turned on there is no supervisor
   * handing work out, so the two steps that normally happen on two screens —
   * an assignment being created, and capture being started — happen here in
   * one go. An unknown folio number is created as it is picked, because on
   * these projects the paper arrives before anyone has entered it.
   */
  const openSelfAssign = async () => {
    setSelfAssignError(null);
    setIdentifierPick("");
    setNewIdentifierValue("");
    setIsSelfAssignOpen(true);

    if (!project?.project_id) return;
    try {
      const token = await authService.ensureValidToken();
      const response = await documentService.getIdentifiers(project.project_id, token);
      setIdentifierChoices(response.data || []);
    } catch (err) {
      setSelfAssignError(err instanceof Error ? err.message : "Could not read the list");
    }
  };

  const startSelfAssignment = async () => {
    if (!project?.project_id || !user?.user_id || !identifierPick) return;

    const chosen =
      identifierPick === NEW_IDENTIFIER
        ? null
        : identifierChoices.find((row) => String(row.identifier_id) === identifierPick) ?? null;

    setSelfAssigning(true);
    setSelfAssignError(null);
    try {
      const token = await authService.ensureValidToken();

      const target =
        chosen ??
        (await documentService.createIdentifier(
          newIdentifierValue.trim(),
          project.project_id,
          token,
        ));

      const assignment = await assignmentService.create(
        {
          identifier_id: target.identifier_id,
          assigned_to: user.user_id,
          assigned_by: user.user_id,
        },
        token,
      );

      const result = await assignmentStageService.transition(
        assignment.assignment_id,
        "START_CAPTURE",
        token,
      );

      // The list this screen reads from is the server's answer to "what am I
      // working on", so it is asked again rather than guessed at.
      const mine = await assignmentStageService.getMyWork(project.project_id, token);
      setMyAssignments(mine);

      setSelectedIdentifier(target.identifier_id);
      setActiveAssignmentIdentifier(target);
      await refreshDocumentCount(target, token);

      setIsSelfAssignOpen(false);
      setToast({
        message:
          result.assignment_status === AssignmentStatus.CAPTURING
            ? `Assignment ${assignmentLabel(assignment)} started successfully`
            : `Assignment ${assignmentLabel(assignment)} created`,
        type: "success",
      });
    } catch (err) {
      setSelfAssignError(
        err instanceof Error ? err.message : "Could not start an assignment",
      );
    } finally {
      setSelfAssigning(false);
    }
  };

  /**
   * Give a batch back, or ask for it to be moved to someone else.
   *
   * The rule is one sentence: you may give back a batch you have not put
   * anything in. Once documents are in it, the next person inherits someone
   * else's work, and who answers for that mixture is a supervisor's
   * decision — so the worker asks instead, and the batch stays theirs until
   * the supervisor acts.
   */
  const submitReason = async () => {
    const target = activeAssignment ?? startable;
    if (!target || !reasonText.trim() || !project?.project_id) return;

    setReasonBusy(true);
    try {
      const token = await authService.ensureValidToken();

      if (reasonDialog === "decline") {
        await assignmentStageService.transition(
          target.assignment_id,
          "DECLINE_CAPTURE",
          token,
          reasonText.trim(),
        );
        // It is somebody else's now, so the screen asks what is left rather
        // than patching the row it just gave away.
        const mine = await assignmentStageService.getMyWork(project.project_id, token);
        setMyAssignments(mine);
        setActiveAssignmentIdentifier(null);
        setSelectedIdentifier(null);
        setDocumentCount(null);
        setToast({
          message: `Assignment ${assignmentLabel(target)} declined successfully`,
          type: "success",
        });
      } else {
        await assignmentStageService.requestHandover(
          target.assignment_id,
          reasonText.trim(),
          token,
        );
        setMyAssignments((prev) =>
          prev.map((row) =>
            row.assignment_id === target.assignment_id
              ? { ...row, handover_requested: 1 as const }
              : row,
          ),
        );
        setToast({
          message: "Asked for a handover — it stays yours until someone moves it",
          type: "success",
        });
      }

      setReasonDialog(null);
      setReasonText("");
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Could not do that",
        type: "error",
      });
    } finally {
      setReasonBusy(false);
    }
  };

  const handleStartAssignment = async () => {
    if (!startable) return;

    setStartingAssignment(true);
    try {
      const token = await authService.ensureValidToken();
      const result = await assignmentStageService.transition(
        startable.assignment_id,
        "START_CAPTURE",
        token
      );
      setMyAssignments((prev) =>
        prev.map((row) =>
          row.assignment_id === startable.assignment_id
            ? { ...row, assignment_status: result.assignment_status }
            : row
        )
      );
      // Capture is now open on this batch, so the screen needs its identifier
      // and the count of what's already stored against it.
      setSelectedIdentifier(startable.identifier_id);
      const identifier = await documentService.getIdentifierById(startable.identifier_id, token);
      setActiveAssignmentIdentifier(identifier);
      await refreshDocumentCount(identifier, token);
      setToast({
        message: `Assignment ${assignmentLabel(startable)} started successfully`,
        type: "success",
      });
      setIsStartConfirmOpen(false);
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to start assignment",
        type: "error",
      });
    } finally {
      setStartingAssignment(false);
    }
  };

  /**
   * Ask the upload API to record this document again.
   *
   * The file is already in storage; what is missing is the row, which is
   * created off a queue. Re-confirming republishes that message.
   * `smartdoc_api` treats the same object key as the same document, so this
   * cannot produce a duplicate if the first message arrives late after all.
   */
  const retryAllConfirms = async () => {
    for (const image of lateRow) {
      await retryConfirm(image.id);
    }
  };

  const retryConfirm = async (id: string) => {
    const image = selectedImages.find((img) => img.id === id);
    if (!image?.s3ObjectKey || !selectedIdentifier || !project) return;

    try {
      const token = await authService.ensureValidToken();
      const attributesPayload: UploadAttribute[] = Object.entries(attributeValues)
        .filter(([, value]) => value?.trim())
        .map(([attributeId, value]) => ({
          attribute_id: Number(attributeId),
          attribute_value: value,
        }));

      await uploadService.confirmUpload(
        image.s3ObjectKey,
        image.file.name,
        project.project_id,
        selectedIdentifier,
        image.file.size,
        token,
        assignmentId || undefined,
        attributesPayload,
        image.sequence,
      );
      setToast({ message: "Asked again — it should appear shortly", type: "success" });
      setBatchRefresh((n) => n + 1);
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Could not record the document",
        type: "error",
      });
    }
  };

  // Documents uploaded but not yet in the batch. Normally a second or two;
  // longer means the queue or the database is in trouble.
  const awaitingRow = selectedImages.filter(
    (img) => img.uploaded && (!img.s3ObjectKey || !batchPaths.has(img.s3ObjectKey)),
  );

  // Waiting is normal — the row is written by another service off a queue, so
  // every document is "stored but not recorded" for a moment. Only once it has
  // been waiting this long is it worth anyone's attention.
  const RECORD_GRACE_MS = 15_000;

  // Nothing here changes on its own, so a wait would sit at "waiting" forever
  // without something to nudge the screen.
  const [waitTick, setWaitTick] = useState(0);
  useEffect(() => {
    if (awaitingRow.length === 0) return;
    const id = window.setInterval(() => setWaitTick((n) => n + 1), 2000);
    return () => window.clearInterval(id);
  }, [awaitingRow.length]);

  // Asked again whenever the batch is re-read, and after a retry has had a
  // few seconds to land.
  useEffect(() => {
    if (!activeAssignment?.assignment_id) {
      setStuck([]);
      setStuckRetried(false);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const token = await authService.ensureValidToken();
        // The project goes along: the queue is shared by every customer,
        // and the service only answers for a project the caller belongs to.
        const result = await uploadService.getDeadLetters(
          { projectId: project?.project_id, assignmentId: activeAssignment.assignment_id },
          token,
        );
        if (!cancelled) {
          setStuck(result.messages);
          setQueueHealth(result.queue);
        }
      } catch {
        // The queue could not be read. The server will refuse the close if
        // it matters; nothing to alarm anyone with here.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeAssignment?.assignment_id, batchRefresh, project?.project_id]);

  const retryStuck = async () => {
    if (!activeAssignment) return;
    setRetryingStuck(true);
    try {
      const token = await authService.ensureValidToken();
      await uploadService.requeueDeadLetters(
        { projectId: project?.project_id, assignmentId: activeAssignment.assignment_id },
        token,
      );
      setStuckRetried(true);
      setToast({ message: "Trying again — they should appear shortly", type: "success" });
      // Long enough for the db service to have another go and either record
      // the row or give up again.
      window.setTimeout(() => setBatchRefresh((n) => n + 1), 5000);
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Could not retry",
        type: "error",
      });
    } finally {
      setRetryingStuck(false);
    }
  };

  const lateRow = useMemo(
    () =>
      awaitingRow.filter(
        (img) => !img.uploadedAt || Date.now() - img.uploadedAt.getTime() > RECORD_GRACE_MS,
      ),
    // waitTick is what makes a quiet wait turn into a warning by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [awaitingRow, waitTick],
  );

  const lateIds = useMemo(() => new Set(lateRow.map((img) => img.id)), [lateRow]);

  const batchSaving = orderState.saving || draftState.saving !== null;

  // The order and the edited documents are written by different calls, but
  // they are one Save to whoever pressed it. Order first: it is one small
  // call, and having it in before a long run of uploads means a failure part
  // way through still leaves the pages in the right places.
  const saveBatchChanges = async () => {
    if (orderState.changed) await batchRef.current?.saveOrder();
    if (draftState.count > 0) await batchRef.current?.saveAllDrafts();
  };

  // Still within the grace period: normal, and worth showing only as a count.
  const waitingRow = awaitingRow.filter((img) => !lateIds.has(img.id));

  // Two of these lose work outright, so they stop the close; the third is
  // just worth knowing before handing the batch back.
  // A page the verifier sent back has to be answered before the batch goes
  // round again. Named on its own because the box below tells the other
  // blockers to be uploaded or cleared, which is not what to do about this
  // one — and because matching it back by its wording would catch the
  // upload lines too, whenever the counts happened to agree.
  const rejectedBlocker =
    rejectedCount > 0
      ? rejectedCount === 1
        ? "1 document was sent back and has not been redone. Open it on the Batch tab, redo or replace it."
        : `${rejectedCount} documents were sent back and have not been redone. Open them on the Batch tab, redo or replace them.`
      : null;

  const blockingBeforeClose = [
    // The header button is already disabled mid-upload, but the dialog can
    // have been opened a moment before one started.
    uploadProgress || isUploadingImages
      ? uploadProgress
        ? `Uploading ${Math.min(uploadProgress.done + 1, uploadProgress.total)} of ${uploadProgress.total} — wait for it to finish.`
        : "Documents are still uploading — wait for them to finish."
      : null,
    awaitingRow.length > 0
      ? awaitingRow.length === 1
        ? "1 document has not reached the batch yet — it is in storage but has no record."
        : `${awaitingRow.length} documents have not reached the batch yet — they are in storage but have no record.`
      : null,
    stuck.length > 0
      ? stuck.length === 1
        ? "1 document is stored but could not be recorded — retry it from the Batch tab."
        : `${stuck.length} documents are stored but could not be recorded — retry them from the Batch tab.`
      : null,
    queueHealth && queueHealth.consumers === 0 && queueHealth.waiting > 0
      ? `The recording service is not running and ${queueHealth.waiting} document${
          queueHealth.waiting === 1 ? " is" : "s are"
        } waiting — some may be this batch's. Contact your administrator.`
      : null,
    pendingImageCount > 0
      ? pendingImageCount === 1
        ? "1 document has not been uploaded yet — it only exists in this browser."
        : `${pendingImageCount} documents have not been uploaded yet — they only exist in this browser.`
      : null,
    draftState.count > 0
      ? draftState.count === 1
        ? "1 document has unsaved changes on the Batch tab."
        : `${draftState.count} documents have unsaved changes on the Batch tab.`
      : null,
    // Stops the close rather than warning about it, because smartdoc_api
    // refuses it outright — the screen used to say "closing sends them to
    // the verifier unchanged", which was not true, and the person pressed
    // the button and was refused by the same dialog that had just told them
    // it was fine.
    rejectedBlocker,
  ].filter((line): line is string => line !== null);

  const handleCloseAssignment = async () => {
    if (!activeAssignment || blockingBeforeClose.length > 0) return;

    setClosingAssignment(true);
    setCloseRefusal(null);
    try {
      const token = await authService.ensureValidToken();
      const result = await assignmentStageService.transition(
        activeAssignment.assignment_id,
        "CLOSE_CAPTURE",
        token
      );
      setMyAssignments((prev) =>
        prev.map((row) =>
          row.assignment_id === activeAssignment.assignment_id
            ? { ...row, assignment_status: result.assignment_status }
            : row
        )
      );
      setToast({
        message:
          result.assignment_status === AssignmentStatus.VERIFIED
            ? "Assignment closed and verified"
            : "Assignment closed and sent for verification",
        type: "success",
      });
      setIsCloseConfirmOpen(false);
    } catch (err) {
      setCloseRefusal(err instanceof Error ? err.message : "Failed to close assignment");
    } finally {
      setClosingAssignment(false);
    }
  };

  const addImages = (files: File[]) => {
    if (!assignmentId) {
      setToast({ message: 'You need an active assignment before adding documents', type: 'error' });
      return;
    }

    // Too big for this project: not added, and said so plainly. The size
    // comes from the file itself, so nothing is read and nothing travels —
    // the refusal is instant even for a 40MB scan. The nine good files in a
    // selection of ten still go in; punishing them for the tenth is what
    // the old behaviour did, at the end of a failed upload.
    //
    // Until the project's settings have landed nothing is refused: a guess
    // here would turn away a page that was perfectly acceptable.
    const limitBytes = maxFileMb === null ? null : maxFileMb * 1024 * 1024;
    const allowed = limitBytes === null ? files : files.filter((f) => f.size <= limitBytes);
    const refused = limitBytes === null ? [] : files.filter((f) => f.size > limitBytes);

    if (refused.length > 0) {
      setTooBig(
        refused.map((f) => ({ name: f.name, mb: (f.size / (1024 * 1024)).toFixed(1) })),
      );
    } else {
      setTooBig([]);
    }
    if (allowed.length === 0) return;

    const newImages: UploadedImage[] = allowed.map((file) => ({
      id: Date.now() + Math.random().toString(),
      file,
      preview: URL.createObjectURL(file),
      uploaded: false,
      uploading: false,
      progress: 0,
    }));
    setSelectedImages((prev) => [...prev, ...newImages]);
  };

  // Once a document is in the batch it can leave the staging area — it is
  // visible on the Batch tab, and keeping a second copy invites re-uploading.
  useEffect(() => {
    setSelectedImages((prev) => {
      const landed = prev.filter((img) => img.s3ObjectKey && batchPaths.has(img.s3ObjectKey));
      if (landed.length === 0) return prev;
      landed.forEach((img) => URL.revokeObjectURL(img.preview));
      return prev.filter((img) => !landed.includes(img));
    });
  }, [batchPaths]);

  // The rows are created off a queue, so they arrive a moment after the
  // upload — and sometimes not at all. Ask again a few times rather than
  // leaving someone staring at a half-ticked document.
  useEffect(() => {
    const waiting = selectedImages.some(
      (img) => img.uploaded && (!img.s3ObjectKey || !batchPaths.has(img.s3ObjectKey)),
    );
    if (!waiting) return;

    const id = window.setTimeout(() => setBatchRefresh((n) => n + 1), 3000);
    return () => window.clearTimeout(id);
  }, [selectedImages, batchPaths]);

  const removeImage = (id: string) => {
    if (uploadProgress) return;
    setSelectedImages((prev) => prev.filter((img) => img.id !== id));
  };

  const removeImages = (ids: string[]) => {
    if (ids.length === 0 || uploadProgress) return;
    const doomed = new Set(ids);
    setSelectedImages((prev) =>
      // A document mid-upload stays; everything else may go. An uploaded one
      // still in the tray is one the batch never recorded — the file remains
      // in storage, unreferenced, which is the lesser problem.
      prev.filter((img) => !doomed.has(img.id) || img.uploading),
    );
  };

  const cancelUpload = () => {
    if (pendingImageCount === 0 || uploadProgress) return;
    setIsClearConfirmOpen(true);
  };

  const clearPendingImages = () => {
    setSelectedImages((prev) => prev.filter((img) => img.uploaded));
    setSelectedDocIds(new Set());
    setIsClearConfirmOpen(false);
  };

  const uploadImages = async () => {
    console.log('Upload button clicked', { selectedImages: selectedImages.length, selectedIdentifier });

    if (selectedImages.length === 0) {
      setToast({ message: 'No documents selected', type: 'error' });
      return;
    }

    if (!selectedIdentifier) {
      setToast({ message: 'Please select an identifier', type: 'error' });
      return;
    }

    // Check required attributes
    const missingRequired = attributes.filter(
      (attr) => attr.required === 1 && !attributeValues[attr.attribute_id]?.trim()
    );

    if (missingRequired.length > 0) {
      setToast({
        message: `Please fill required field(s): ${missingRequired.map((a) => a.attribute_name).join(', ')}`,
        type: 'error',
      });
      return;
    }

    const token = await authService.ensureValidToken();
    // A stored document is never uploaded again — it is retried through
    // confirm, under the key it already has.
    const filesToUpload = selectedImages.filter((img) => !img.uploaded && !img.uploading);

    const attributesPayload: UploadAttribute[] = Object.entries(attributeValues)
      .filter(([, value]) => value?.trim())
      .map(([attributeId, value]) => ({
        attribute_id: Number(attributeId),
        attribute_value: value,
      }));

    if (filesToUpload.length === 0) {
      setToast({ message: 'No new files to upload', type: 'error' });
      return;
    }

    cancelUploadRef.current = false;
    setCancelRequested(false);
    setUploadProgress({ done: 0, total: filesToUpload.length });

    try {
      // Request signed URLs from server
      const urlsResponse = await uploadService.requestUploadUrls(
        project!.project_id,
        selectedIdentifier,
        filesToUpload.map((img) => img.file),
        token
      );

      // Where these pages start in the batch: after whatever is already in
      // it. The order within this run is the order the files were picked.
      const firstSequence = batchPaths.size + 1;

      // Upload each file to S3 and confirm
      let uploaded = 0;
      for (let i = 0; i < filesToUpload.length; i++) {
        // Checked here, between files: the one already on its way finishes
        // rather than leaving a half-written object in the bucket.
        if (cancelUploadRef.current) {
          setToast({
            message: `Upload stopped — ${uploaded} of ${filesToUpload.length} uploaded. The rest are still here.`,
            type: "error",
          });
          break;
        }

        const image = filesToUpload[i];
        const uploadUrl = urlsResponse.uploads[i];
        console.log('Upload URL object:', uploadUrl);

        setSelectedImages((prev) =>
          prev.map((img) => (img.id === image.id ? { ...img, uploading: true } : img))
        );

        try {
          // Upload to S3
          await uploadService.uploadFileToS3(uploadUrl.signedUrl, image.file);

          // Storage has the file from here on. Recorded before confirming, so
          // a confirm that fails leaves the document as "stored, not
          // recorded" — the same state as a database that never got the
          // message — rather than as "not uploaded". Pressing Upload again on
          // one of those would store a second copy under a new key and orphan
          // this one.
          setSelectedImages((prev) =>
            prev.map((img) =>
              img.id === image.id
                ? {
                    ...img,
                    uploading: false,
                    uploaded: true,
                    progress: 100,
                    uploadedAt: new Date(),
                    s3ObjectKey: uploadUrl.objectKey,
                    sequence: firstSequence + i,
                  }
                : img
            )
          );

          // Confirm upload on server
          await uploadService.confirmUpload(
            uploadUrl.objectKey,
            uploadUrl.originalname,
            project!.project_id,
            selectedIdentifier,
            uploadUrl.size,
            token,
            assignmentId || undefined,
            attributesPayload,
            firstSequence + i,
          );

          uploaded += 1;
        } catch (err) {
          console.error("Upload error for", image.file.name, err);
          // Only clears the spinner. Whether this one counts as stored was
          // already decided above, by whether storage took the file.
          setSelectedImages((prev) =>
            prev.map((img) => (img.id === image.id ? { ...img, uploading: false } : img))
          );
        }

        setUploadProgress({ done: i + 1, total: filesToUpload.length });
      }

      // The batch just added rows against this identifier — re-read the total
      // so the header count isn't stale for the rest of the session.
      await refreshDocumentCount(activeAssignmentIdentifier, token);

      // Uploaded documents stay here until their row appears in the batch.
      // Leaving as soon as storage accepted them was how a document could be
      // ticked as done and then be in no batch at all: the queue message that
      // creates the row can fail long after the upload succeeded.

      // Tell the batch panel to pick them up. It only signs URLs for documents
      // it hasn't seen, so this costs one request per new page.
      setBatchRefresh((n) => n + 1);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to request upload URLs";
      console.error("Failed to request upload URLs:", err);
      setToast({
        // Name the host actually being called — this used to say
        // localhost:3001 whatever VITE_UPLOAD_API_URL pointed at.
        message: `Upload Error: ${errorMessage} (${import.meta.env.VITE_UPLOAD_API_URL})`,
        type: "error",
      });
    } finally {
      setUploadProgress(null);
      cancelUploadRef.current = false;
      setCancelRequested(false);
    }
  };

  return (
    <>
      <PageMeta title="Digitize | SmartDoc" description="Upload and process documents" />
      <div className="relative flex flex-col flex-1 w-full bg-gray-50 dark:bg-gray-900 overflow-hidden min-w-0 min-h-0">
        {/* Header */}
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 min-w-0 flex-shrink-0 overflow-hidden w-full">
          <div className="mb-3 pb-3 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                {/* Nothing about "no assignment" is known until the load
                    finishes — saying it under the loader was a wrong answer
                    that then corrected itself. */}
                {loading ? null : currentAssignment ? (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {/* The two ways out of a batch, first on the line and
                            icon only — they belong to the assignment, like the
                            code beside them, not to the tab. An empty batch can
                            simply be given back; one with documents in it can
                            only be moved by a supervisor, so all a worker can
                            do is ask. */}
                    {!loading && activeAssignment && (
                      activeAssignment.handover_requested === 1 ? (
                        <Tip text="Handover asked for">
                        <span className="flex size-8 items-center justify-center rounded-lg border border-warning-500/40 bg-warning-500/10 text-warning-600 dark:text-warning-500">
                          {/* The same hand-off mark, waiting rather than
                              offered. */}
                          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4.5">
                            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5v5.2l3.5 2.1-.9 1.5L11 13V7h2Z" />
                          </svg>
                        </span>
                        </Tip>
                      ) : batchTotal === null ? (
                        // Nothing is known about the batch yet, and guessing
                        // wrong here is a button that changes under the cursor.
                        <span className="size-8 rounded-lg bg-gray-100 dark:bg-white/[0.03]" />
                      ) : batchTotal === 0 && pendingImageCount === 0 ? (
                        <Tip text="Decline the batch">
                        <button
                          type="button"
                          onClick={() => {
                            setReasonText("");
                            setReasonDialog("decline");
                          }}
                          className="flex size-8 items-center justify-center rounded-lg border border-error-500/40 bg-error-500/10 text-error-600 transition hover:bg-error-500 hover:text-white dark:text-error-500 dark:hover:text-white"
                        >
                          {/* The same U-turn mirrored: the batch goes back
                              to be given out again. */}
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="size-4.5"
                          >
                            <path d="M20 8H10a4 4 0 0 0 0 8h10" />
                            <path d="m16 12 4 4-4 4" />
                          </svg>
                        </button>
                        </Tip>
                      ) : (
                        <Tip text="Handover the batch">
                        <button
                          type="button"
                          onClick={() => {
                            setReasonText("");
                            setReasonDialog("handover");
                          }}
                          className="flex size-8 items-center justify-center rounded-lg border border-brand-500/40 bg-brand-500/10 text-brand-500 transition hover:bg-brand-500 hover:text-white"
                        >
                          {/* A U-turn: out along the top, round, and back
                              on the same line — the batch goes on to
                              somebody else. */}
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="size-4.5"
                          >
                            <path d="M4 8h10a4 4 0 0 1 0 8H4" />
                            <path d="m8 12-4 4 4 4" />
                          </svg>
                        </button>
                        </Tip>
                      )
                    )}
                      {/* The batch, then the file it belongs to: a
                          supervisor asking about "250811-228896" and a
                          capturer looking at "Circulars" are talking about
                          the same line. The label the project gives its
                          identifiers ("Doc Type") is on hover. */}
                      <div
                        title={`${projectDetails?.identifier_label || "Identifier"}: ${
                          activeAssignmentIdentifier?.identifier_value ??
                          currentAssignment.identifier_id
                        }`}
                        className="text-xs text-gray-700 dark:text-gray-300"
                      >
                        <span className="font-mono">{assignmentLabel(currentAssignment)}</span>
                        <span className="px-1.5 text-gray-300 dark:text-gray-600">|</span>
                        <span className="font-medium">
                          {activeAssignmentIdentifier?.identifier_value ||
                            `#${currentAssignment.identifier_id}`}
                        </span>
                      </div>
                      {/* Whoever handed out this batch may have said something
                          about it. Kept behind a click — it can be a paragraph,
                          and it is read once. */}
                      <button
                        type="button"
                        onClick={() => setIsNotesOpen(true)}
                        className="flex items-center gap-1 text-xs text-brand-500 hover:underline"
                      >
                        <NotesHistoryIcon />
                        Notes and History
                      </button>
                      {documentCount !== null && (
                        <div className="relative">
                          <button
                            type="button"
                            title="Document count"
                            onClick={() => setIsCountInfoOpen((prev) => !prev)}
                            className="dropdown-toggle flex h-4 w-4 items-center justify-center rounded-full border border-brand-500 text-[10px] font-serif italic leading-none text-brand-500 hover:bg-brand-50 dark:border-brand-400 dark:text-brand-400 dark:hover:bg-brand-500/[0.12]"
                          >
                            i
                          </button>
                          <Dropdown
                            isOpen={isCountInfoOpen}
                            onClose={() => setIsCountInfoOpen(false)}
                            className="right-auto! left-0 w-64 p-3"
                          >
                            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                              Total Count: {documentCount}
                            </p>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              Documents already stored against this{" "}
                              {(projectDetails?.identifier_label || "Identifier").toLowerCase()}, across
                              all assignments — not just the current session.
                            </p>
                          </Dropdown>
                        </div>
                      )}
                    </div>
                  </div>
                ) : error ? (
                  // A failed load is not the same as having no work — saying
                  // "no assignment in progress" there is a wrong answer.
                  <p className="text-sm text-red-500">{error}</p>
                ) : (
                  <span className="flex items-center gap-3">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No assignment in progress.
                    </p>
                    {/* Only where the project allows it. Everywhere else the
                        work is handed out, and an offer to start one here
                        would be an offer the server refuses. */}
                    {selfAssign && (
                      <Button size="xs" onClick={openSelfAssign}>
                        Start new assignment
                      </Button>
                    )}
                  </span>
                )}
              </div>

              {/* Assignment state stays in the header — it isn't an upload
                  control, and it applies to both tabs. Shown for a batch that
                  hasn't started too, where the action is Start. */}
              {currentAssignment && (
                <div className="flex gap-2 items-center flex-shrink-0">
                  {/* Not started yet: the batch is described above, and this
                      is the one thing to do about it. */}
                  {!loading && !activeAssignment && startable && (
                    <>
                      {startable.assignment_status === AssignmentStatus.RETURNED_FOR_CORRECTION && (
                        <span className="text-xs text-warning-500">sent back for correction</span>
                      )}
                      {otherWaiting > 0 && (
                        <span className="text-[11px] text-gray-500 dark:text-gray-400">
                          {otherWaiting} more waiting
                        </span>
                      )}
                      <Button
                        size="xs"
                        onClick={() => setIsStartConfirmOpen(true)}
                        startIcon={
                          /* A play mark: begin. */
                          <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
                            <path d="M8 5v14l11-7L8 5Z" />
                          </svg>
                        }
                      >
                        Start
                      </Button>
                      {/* Nothing has been captured yet, so this can simply go
                          back to be given to someone else. A corrections
                          round always has the rejected pages in it, so it is
                          not offered there. The same button as the one an
                          open batch shows, so the two states read alike. */}
                      {startable.assignment_status !== AssignmentStatus.RETURNED_FOR_CORRECTION && (
                        <button
                          type="button"
                          title="Nothing has been captured — give this batch back to be assigned to someone else"
                          onClick={() => {
                            setReasonText("");
                            setReasonDialog("decline");
                          }}
                          className="flex h-8 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-xs font-medium text-gray-700 transition hover:border-error-500 hover:bg-error-50 hover:text-error-600 dark:border-gray-700 dark:text-gray-200 dark:hover:border-error-500 dark:hover:bg-error-500/10 dark:hover:text-error-500"
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5 shrink-0">
                            <path d="M11 5.6 9.6 4.2 1.8 12l7.8 7.8L11 18.4 5.6 13H15a4 4 0 0 1 4 4v3h2v-3a6 6 0 0 0-6-6H5.6L11 5.6Z" />
                          </svg>
                          Decline
                        </button>
                      )}
                    </>
                  )}

                  {/* Top right, with the rest of the assignment's state: it
                      describes the whole batch, not the tab you happen to be
                      looking at. */}
                  {/* Why it came back, on the same line as the round it
                      belongs with. Short here on purpose — the whole reason
                      is in Notes and History, and again in the close
                      dialog. */}
                  {/* What is wrong with the batch, in the header with the rest
                      of its state. Three different things, three tones:
                      the recording service being down is red and nobody
                      here can fix it; pages the pipeline could not process
                      are amber, because enhancing and categorising can both
                      be done by hand; pages stored but not recorded are red
                      with a Retry, because they block sending. Short on the
                      chip; the whole story on hover. */}
                  {queueHealth && queueHealth.consumers === 0 && queueHealth.waiting > 0 && (
                    <span
                      title={`${queueHealth.waiting} document${queueHealth.waiting === 1 ? " is" : "s are"} waiting to be recorded and nothing is reading the queue. The recording service is not running — contact your administrator. The batch cannot be sent until it is back.`}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-error-500/40 bg-error-500/10 px-2.5 text-xs font-medium text-error-600 dark:text-error-500"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5 shrink-0">
                        <path d="M11 7h2v6h-2V7Zm0 8h2v2h-2v-2Zm1-13a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z" />
                      </svg>
                      Recording stopped · {queueHealth.waiting} waiting
                    </span>
                  )}

                  {stuck.length > 0 && (
                    <span
                      title={`Stored but not recorded${stuckRetried ? " — still stuck after a retry; contact your administrator" : ""}:\n${stuck.map((m) => `${m.originalName ?? m.objectKey}${m.error ? ` — ${m.error}` : ""}`).join("\n")}`}
                      className="flex h-8 items-center gap-2 rounded-lg border border-error-500/40 bg-error-500/10 px-2.5 text-xs font-medium text-error-600 dark:text-error-500"
                    >
                      {stuck.length} not recorded
                      {stuckRetried && " · still stuck"}
                      <button
                        type="button"
                        onClick={retryStuck}
                        disabled={retryingStuck}
                        className="flex h-6 items-center gap-1 rounded-md border border-error-500/50 px-2 text-xs font-medium transition hover:bg-error-500/10 disabled:opacity-50"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="size-3 shrink-0">
                          <path d="M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6a5.9 5.9 0 0 1 4.22 1.78L13 11h7V4z" />
                        </svg>
                        {retryingStuck ? "Retrying..." : "Retry"}
                      </button>
                    </span>
                  )}

                  {failState.count > 0 && (
                    <span
                      title="The pipeline gave up on these. Ask it again, or enhance and categorise them by hand — either is fine, and the batch can be sent without them."
                      className="flex h-8 items-center gap-2 rounded-lg border border-warning-500/40 bg-warning-500/10 px-2.5 text-xs font-medium text-warning-600 dark:text-warning-500"
                    >
                      {[
                        failState.enhance > 0 && `${failState.enhance} not enhanced`,
                        failState.analyze > 0 && `${failState.analyze} not categorised`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      <button
                        type="button"
                        onClick={() => batchRef.current?.retryAllFailed()}
                        disabled={failState.retrying}
                        className="flex h-6 items-center gap-1 rounded-md border border-warning-500/50 px-2 text-xs font-medium transition hover:bg-warning-500/10 disabled:opacity-50"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="size-3 shrink-0">
                          <path d="M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6a5.9 5.9 0 0 1 4.22 1.78L13 11h7V4z" />
                        </svg>
                        {failState.retrying ? "Asking..." : "Retry"}
                      </button>
                      <button
                        type="button"
                        title="Hide this"
                        onClick={() => batchRef.current?.ignoreFailures()}
                        className="flex size-6 items-center justify-center rounded-md text-warning-600/70 transition hover:bg-warning-500/10 hover:text-warning-600 dark:text-warning-500/70"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="size-3">
                          <path d="M4.3 4.3a1 1 0 011.4 0L10 8.6l4.3-4.3a1 1 0 111.4 1.4L11.4 10l4.3 4.3a1 1 0 01-1.4 1.4L10 11.4l-4.3 4.3a1 1 0 01-1.4-1.4L8.6 10 4.3 5.7a1 1 0 010-1.4z" />
                        </svg>
                      </button>
                    </span>
                  )}

                  {activeAssignment?.return_reason && (
                    <button
                      type="button"
                      title={activeAssignment.return_reason}
                      onClick={() => setIsNotesOpen(true)}
                      className="flex max-w-xs items-center gap-1 rounded-full bg-error-50 px-2 py-0.5 text-xs font-medium text-error-600 hover:bg-error-100 dark:bg-error-500/15 dark:text-error-500"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3 shrink-0">
                        <path d="M11 15h2v2h-2zm0-8h2v6h-2zm1-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                      </svg>
                      <span className="truncate">
                        Sent back
                        {activeAssignment.returned_by_username
                          ? ` by ${activeAssignment.returned_by_username}`
                          : ""}
                        : {activeAssignment.return_reason}
                      </span>
                    </button>
                  )}

                  {/* Two labels, not one: the round is a fact about the
                      batch, the send-back count is work to do. Round one is
                      green because there is nothing to correct yet. */}
                  {currentAssignment?.my_stage.round != null && (
                    <span className="relative">
                      {/* The round's start date is behind the label: a
                          bare date beside it read as nobody knew what. Our
                          own bubble, on hover or click, rather than the
                          browser's title — which takes a second to appear
                          and often does not. */}
                      <button
                        type="button"
                        onClick={() => setRoundTipOpen((open) => !open)}
                        onMouseEnter={() => setRoundTipOpen(true)}
                        onMouseLeave={() => setRoundTipOpen(false)}
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          currentAssignment.my_stage.round === 1
                            ? "bg-success-500/15 text-success-600 dark:text-success-500"
                            : "bg-warning-500/15 text-warning-600 dark:text-warning-500"
                        }`}
                      >
                        Round {currentAssignment.my_stage.round}
                      </button>
                      {roundTipOpen && (
                        <span className="absolute left-1/2 top-full z-20 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-gray-800 px-2.5 py-1.5 text-xs text-white shadow-theme-md dark:bg-gray-700">
                          {activeAssignment?.my_stage.started_at
                            ? `Started on ${formatAssignedMoment(activeAssignment.my_stage.started_at)} [${formatAgo(
                                activeAssignment.my_stage.started_at,
                              )}]`
                            : "Not started yet"}
                        </span>
                      )}
                    </span>
                  )}

                  {rejectedCount > 0 && (
                    <button
                      type="button"
                      title="Show the documents that were sent back"
                      onClick={() => setTab("batch")}
                      className="rounded-full bg-error-50 px-2 py-0.5 text-xs font-medium text-error-600 hover:bg-error-100 dark:bg-error-500/15 dark:text-error-500"
                    >
                      {rejectedCount}/{batchTotal} sent back
                    </button>
                  )}

                  <span
                    className="relative cursor-pointer"
                    onMouseEnter={() => {
                      setStatusTipOpen(true);
                      loadStatusTrail();
                    }}
                    onMouseLeave={() => setStatusTipOpen(false)}
                    onClick={() => {
                      setStatusTipOpen((open) => !open);
                      loadStatusTrail();
                    }}
                  >
                    <Badge
                      size="sm"
                      color={ASSIGNMENT_STATUS_COLORS[currentAssignment.assignment_status] || "light"}
                    >
                      {ASSIGNMENT_STATUS_LABELS[currentAssignment.assignment_status] ||
                        currentAssignment.assignment_status}
                    </Badge>
                    {/* How it got here: each stage in order, with who and
                        when. The same bubble the Round pill uses. */}
                    {statusTipOpen && (
                      <span className="absolute left-1/2 top-full z-20 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-gray-800 px-3 py-2 text-left text-xs text-white shadow-theme-md dark:bg-gray-700">
                        {statusTrail === null ? (
                          "Loading..."
                        ) : statusTrail.length === 0 ? (
                          "Nothing yet"
                        ) : (
                          <span className="flex flex-col gap-1">
                            {statusTrail.map((t) => (
                              <span key={t.key}>
                                {t.label}
                                {t.who && <span className="text-gray-300"> · {t.who}</span>}
                                {t.when && (
                                  <span className="text-gray-300">
                                    {" "}
                                    · {formatAssignedMoment(t.when)} [{formatAgo(t.when)}]
                                  </span>
                                )}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                    )}
                  </span>

                  {activeAssignment?.assignment_status === AssignmentStatus.CAPTURING && (
                    // Worded, and red on hover: closing hands the batch to a
                    // verifier and cannot be undone from here.
                    <button
                      type="button"
                      title={
                        uploadProgress
                          ? "Wait for the upload to finish"
                          : autoVerify
                          ? "Close the assignment and publish the batch"
                          : "Close the assignment and hand it to a verifier"
                      }
                      disabled={!!uploadProgress}
                      onClick={() => setIsCloseConfirmOpen(true)}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-xs font-medium text-gray-700 transition hover:border-error-500 hover:bg-error-50 hover:text-error-600 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-gray-300 disabled:hover:bg-transparent disabled:hover:text-gray-700 dark:border-gray-700 dark:text-gray-200 dark:hover:border-error-500 dark:hover:bg-error-500/10 dark:hover:text-error-500"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5 shrink-0">
                        <rect x="6" y="6" width="12" height="12" rx="1.5" />
                      </svg>
                      {closeLabel}
                    </button>
                  )}
                </div>
              )}
            </div>
            {error && <Toast message={error} type="error" onClose={() => setError(null)} />}
          </div>
          {activeAssignment && (
            <div className="flex flex-wrap gap-3 items-start w-full">
              {/* Attributes. An empty list used to render as blank space with
                  no explanation — say why there are no fields instead. */}
              {attributes.length === 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">No attributes</p>
              )}
              {attributes.map((attr) => {
                const fieldWidth = attributeFieldWidth(attr);
                return (
                <div
                  key={attr.attribute_id}
                  className={`flex-shrink-0 ${fieldWidth ? "" : attr.type === "D" ? "w-32" : "w-48"}`}
                  style={fieldWidth ? { width: fieldWidth } : undefined}
                >
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {attr.attribute_name}
                    {attr.required === 1 && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <input
                    type={attr.type === 'D' ? 'date' : attr.type === 'N' ? 'number' : 'text'}
                    value={attributeValues[attr.attribute_id] || ""}
                    onChange={(e) =>
                      setAttributeValues((prev) => ({
                        ...prev,
                        [attr.attribute_id]: e.target.value,
                      }))
                    }
                    placeholder={attr.type === 'D' ? undefined : "Enter value"}
                    required={attr.required === 1}
                    maxLength={attr.type === 'S' && attr.length ? attr.length : undefined}
                    className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Tabs: add documents, or look at what's already in the batch */}
        {activeAssignment && (
          <div className="flex flex-shrink-0 gap-1 border-t border-gray-200 bg-white px-2 pt-2 dark:border-gray-700 dark:bg-gray-800">
            {([
              ["upload", "Add documents"],
              ["batch", "Batch"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
                  tab === key
                    ? "bg-gray-50 text-brand-500 dark:bg-white/[0.04]"
                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                {label}
                {key === "batch" && activeAssignment.return_reason && (
                  <span className="ml-2 inline-block size-1.5 rounded-full bg-error-500 align-middle" />
                )}
              </button>
            ))}

            {/* Whatever the open tab needs, on the same line as the tabs:
                upload controls for capture, thumbnail size for the batch. */}
            <div className="ml-auto flex items-center gap-2 pb-2">
              {tab === "upload" ? (
                uploadProgress ? (
                  /* Nothing else on this row while documents are going up:
                     adding, clearing or closing half-way through leaves the
                     batch in a state nobody asked for. */
                  <>
                    <span className="flex h-8 items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                      <span className="block size-3.5 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
                      Uploading {Math.min(uploadProgress.done + 1, uploadProgress.total)} of{" "}
                      {uploadProgress.total}
                    </span>
                    <button
                      onClick={() => {
                        cancelUploadRef.current = true;
                        setCancelRequested(true);
                      }}
                      disabled={cancelRequested}
                      title="Stop after the document being uploaded now"
                      className="flex h-7 items-center rounded-lg border border-gray-300 px-2.5 text-xs font-medium text-gray-700 transition hover:border-error-500 hover:text-error-500 disabled:opacity-40 disabled:cursor-not-allowed dark:border-gray-700 dark:text-gray-200"
                    >
                      {cancelRequested ? "Stopping..." : "Cancel"}
                    </button>
                  </>
                ) : (
                <>
                {/* Where an upload stands after the file itself is safe: the
                    row is written by another service off a queue. Said once,
                    here, rather than as a mark on every tile. */}
                {waitingRow.length > 0 && (
                  <span className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800">
                    <span className="block size-3 rounded-full border-2 border-gray-400 border-t-transparent animate-spin" />
                    <span className="text-xs text-gray-600 dark:text-gray-300">
                      {waitingRow.length === 1
                        ? "Recording 1 document..."
                        : `Recording ${waitingRow.length} documents...`}
                    </span>
                  </span>
                )}

                {/* Overdue: the queue or the database is in trouble, and this
                    is the way to ask again. */}
                {lateRow.length > 0 && (
                  <span className="flex items-center gap-2 rounded-lg border border-warning-500/40 bg-warning-500/10 px-2 py-1">
                    <span className="text-xs font-medium text-warning-600 dark:text-warning-500">
                      {lateRow.length === 1
                        ? "1 not recorded"
                        : `${lateRow.length} not recorded`}
                    </span>
                    <button
                      type="button"
                      onClick={retryAllConfirms}
                      className="flex h-6 items-center gap-1 rounded-md border border-warning-500/50 px-2 text-xs font-medium text-warning-600 transition hover:bg-warning-500/10 dark:text-warning-500"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3 shrink-0">
                        <path d="M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6a5.9 5.9 0 0 1 4.22 1.78L13 11h7V4z" />
                      </svg>
                      Retry
                    </button>
                  </span>
                )}

                {selectedDocIds.size > 0 && (
                  <>
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      {selectedDocIds.size} selected
                    </span>
                    <button
                      onClick={() => {
                        removeImages(removableSelectedIds);
                        setSelectedDocIds(new Set());
                      }}
                      disabled={removableSelectedIds.length === 0}
                      title={
                        removableSelectedIds.length === 0
                          ? "Nothing selected that can be removed"
                          : undefined
                      }
                      className="flex h-7 items-center gap-1 rounded-lg border border-error-300 px-2.5 text-xs font-medium text-error-500 transition hover:bg-error-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:border-error-500/40 dark:hover:bg-error-500/10"
                    >
                      <svg className="size-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Remove
                      {removableSelectedIds.length !== selectedDocIds.size
                        ? ` (${removableSelectedIds.length})`
                        : ""}
                    </button>
                  </>
                )}
                {/* Worded buttons: three actions that read differently at a
                    glance beat three coloured circles you have to hover. */}
                <button
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                      fileInputRef.current.click();
                    }
                  }}
                  disabled={isUploadingImages || !assignmentId}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.05]"
                >
                  <svg className="size-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add
                </button>
                <button
                  onClick={cancelUpload}
                  disabled={isUploadingImages || pendingImageCount === 0}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.05]"
                >
                  <svg className="size-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M4 7h16M10 7V4a1 1 0 011-1h2a1 1 0 011 1v3" />
                  </svg>
                  Clear
                </button>
                <button
                  onClick={uploadImages}
                  disabled={isUploadingImages || pendingImageCount === 0}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-xs font-medium text-white shadow-theme-xs transition hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg className="size-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  {isUploadingImages
                    ? "Uploading..."
                    : pendingImageCount > 0
                    ? `Upload ${pendingImageCount}`
                    : "Upload"}
                </button>
                </>
                )
              ) : (
                <>
                  {/* One document failing and twelve failing have the same
                      cause, so one button asks again for all of them. The x
                      hides it: enhancing and categorising can both be done by
                      hand, and a batch nobody intends to retry should not
                      keep saying so. */}
                  {/* Stored but never recorded. Different from the amber
                      mark on the Add documents tab, which knows only about
                      this tab's uploads: this is what the queue says, so it
                      is here in a fresh tab too, and it is why the batch
                      will not send. */}
                  {/* Each kind of unsaved change keeps its own area and its
                      own way out — Reset for the order, Discard for edits to
                      documents — but Save is one button for both, because
                      "save my work" should not depend on which sort of work
                      it was. */}
                  {orderState.changed && (
                    <span className="mr-1 flex items-center gap-2 rounded-lg border border-warning-500/40 bg-warning-500/10 px-2 py-1">
                      <span className="text-xs text-gray-700 dark:text-gray-200">
                        Order not saved
                      </span>
                      <button
                        type="button"
                        onClick={() => batchRef.current?.resetOrder()}
                        disabled={batchSaving}
                        className="flex h-6 items-center rounded-md border border-gray-300 px-2 text-xs font-medium text-gray-700 transition hover:border-error-500 hover:text-error-500 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200"
                      >
                        Reset
                      </button>
                    </span>
                  )}

                  {draftState.count > 0 && (
                    <span className="mr-1 flex items-center gap-2 rounded-lg border border-warning-500/40 bg-warning-500/10 px-2 py-1">
                      <span className="text-xs text-gray-700 dark:text-gray-200">
                        {draftState.count === 1
                          ? "1 document edited"
                          : `${draftState.count} documents edited`}
                      </span>
                      <button
                        type="button"
                        onClick={() => batchRef.current?.discardAllDrafts()}
                        disabled={batchSaving}
                        className="flex h-6 items-center rounded-md border border-gray-300 px-2 text-xs font-medium text-gray-700 transition hover:border-error-500 hover:text-error-500 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200"
                      >
                        Discard
                      </button>
                    </span>
                  )}

                  {(orderState.changed || draftState.count > 0) && (
                    <button
                      type="button"
                      onClick={saveBatchChanges}
                      disabled={batchSaving}
                      className="mr-1 flex h-7 items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-xs font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
                    >
                      {batchSaving ? (
                        <span className="block size-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                      ) : (
                        <svg className="size-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                      )}
                      {draftState.saving
                        ? `Saving ${draftState.saving.done + 1} of ${draftState.saving.total}...`
                        : batchSaving
                        ? "Saving..."
                        : "Save"}
                    </button>
                  )}

                  <button
                    type="button"
                    title="Check for new documents"
                    disabled={batchRefreshing}
                    onClick={() => setBatchRefresh((n) => n + 1)}
                    className="flex size-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-60 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                  >
                    {batchRefreshing ? (
                      <span className="block size-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    ) : (
                      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                        <path d="M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6a5.9 5.9 0 0 1 4.22 1.78L13 11h7V4z" />
                      </svg>
                    )}
                  </button>
                  <span className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" />
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
                  <span className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" />
                  {/* The detail pane costs a third of the width, which is
                      worth reclaiming when you are only scanning thumbnails. */}
                  <button
                    type="button"
                    title={showBatchPane ? "Hide the detail pane" : "Show the detail pane"}
                    onClick={toggleBatchPane}
                    className={`flex size-7 items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-white/[0.05] ${
                      showBatchPane ? "text-brand-500" : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-4">
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <line x1="15" y1="4" x2="15" y2="20" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Fixed height, header stays pinned, only the grid scrolls */}
        <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-2 py-2 w-full overflow-hidden flex flex-col min-w-0 flex-shrink-0" style={{ height: '75vh', minHeight: '500px' }}>
          {/* Both tabs stay mounted; the hidden one keeps its state. Switching
              to Batch used to unmount the panel, throwing away every signed URL
              and reloading the whole grid on the way back. */}
          {activeAssignment && (
            <div className={`min-h-0 flex-1 flex-col ${tab === "batch" ? "flex" : "hidden"}`}>
              <BatchPanel
                assignmentId={activeAssignment.assignment_id}
                tileSize={tileSize}
                ref={batchRef}
                onDraftsChange={setDraftState}
                onOrderChange={setOrderState}
                onFailuresChange={setFailState}
                onToast={(message, type) => setToast({ message, type })}
                showPane={showBatchPane}
                refreshSignal={batchRefresh}
                onRejectedCount={(rejected, total) => {
                  setRejectedCount(rejected);
                  setBatchTotal(total);
                }}
                onRefreshing={setBatchRefreshing}
                onLoaded={prefillFromBatch}
              />
            </div>
          )}
          {/* Not while loading: with no assignment resolved yet the drop zone
              says "pick up an assignment", which is a guess that then
              contradicts itself. */}
          {/* What was turned away, and why. Above the drop area rather than
              a toast: a toast goes, and a page missing from a batch nobody
              noticed is the fault this exists to prevent. */}
          {tab === "upload" && tooBig.length > 0 && (
            <div className="mx-6 mb-2 flex items-start justify-between gap-3 rounded-lg border border-warning-500/40 bg-warning-500/10 px-3 py-2">
              <p className="text-xs text-gray-800 dark:text-white/90">
                <span className="font-medium">
                  {tooBig.length === 1 ? "Not added — bigger" : `${tooBig.length} not added — bigger`} than
                  this project's {maxFileMb}MB limit:
                </span>{" "}
                {tooBig.map((f) => `${f.name} (${f.mb} MB)`).join(", ")}
              </p>
              <button
                type="button"
                title="Dismiss"
                onClick={() => setTooBig([])}
                className="flex-shrink-0 text-warning-600 hover:text-warning-700 dark:text-warning-500"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                  <path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3 1.4 1.4Z" />
                </svg>
              </button>
            </div>
          )}
          {tab === "upload" && !loading && (
            <UploadArea
              selectedImages={selectedImages}
              onAddImages={addImages}
              onRemoveImage={removeImage}
              onRemoveImages={removeImages}
              busy={!!uploadProgress}
              lateIds={lateIds}
              selectedIds={selectedDocIds}
              onSelectionChange={setSelectedDocIds}
              assignmentId={assignmentId}
              emptyHint={
                startable ? "Start the assignment to begin adding documents" : undefined
              }
              maxFileMb={maxFileMb}
              fileInputRef={fileInputRef}
            />
          )}
        </div>

        {/* Toast Notification */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            position="top-center"
            onClose={() => setToast(null)}
          />
        )}
      </div>

      {isNotesOpen && currentAssignment && (
        <NotesHistoryDialog assignment={currentAssignment} onClose={() => setIsNotesOpen(false)} />
      )}

      {/* Giving a batch back, or asking for it to be moved. A reason is
          required either way: the next person has to know why it reached
          them. */}
      <Modal
        isOpen={reasonDialog !== null}
        onClose={() => setReasonDialog(null)}
        className="max-w-md p-6"
      >
        <h3 className="mb-4 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          {reasonDialog === "decline" ? "Decline Assignment" : "Handover Assignment"}{" "}
          {currentAssignment && <span className="font-mono">{assignmentLabel(currentAssignment)}</span>}
        </h3>
        {reasonDialog === "handover" && (
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            It has documents in it, so a supervisor decides who takes it on. It stays yours until they do.
          </p>
        )}

        <textarea
          autoFocus
          rows={3}
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          placeholder="Reason"
          className="w-full rounded-lg border border-gray-300 p-3 text-sm text-gray-800 focus:border-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
        />

        <div className="mt-5 flex justify-end gap-2">
          <Button size="xs" variant="outline" onClick={() => setReasonDialog(null)}>
            Cancel
          </Button>
          <Button size="xs" disabled={!reasonText.trim() || reasonBusy} onClick={submitReason}>
            {reasonBusy ? "Sending..." : reasonDialog === "decline" ? "Decline" : "Ask for a handover"}
          </Button>
        </div>
      </Modal>

      {/* Picking your own folio to work on. Only reachable where the project
          allows it — see project_setting.allow_self_assign. */}
      <Modal
        isOpen={isSelfAssignOpen}
        onClose={() => setIsSelfAssignOpen(false)}
        className="max-w-md p-6"
      >
        <h3 className="mb-2 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          Start a new assignment
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Pick the {(projectDetails?.identifier_label || "identifier").toLowerCase()} you are about
          to capture. It becomes your assignment in progress, and you can only have one at a time.
        </p>

        {/* The same picker as the Assignments screen: a project can hold
            thousands of these, so it is typed at rather than scrolled. The
            one addition is being able to create what is missing — on a
            self-assign project the paper often arrives before its number has
            been entered anywhere. */}
        <SearchSelect
          id="self-assign-identifier"
          options={identifierOptions}
          value={identifierPick}
          onChange={setIdentifierPick}
          onCreate={(value) => {
            setNewIdentifierValue(value);
            setIdentifierPick(NEW_IDENTIFIER);
          }}
          createLabel={(value) => `Create "${value}"`}
          placeholder={`Type to search ${(projectDetails?.identifier_label || "identifier").toLowerCase()}s`}
          emptyText="Nothing matches that"
        />
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          Greyed-out entries are still open for upload, or already have an assignment that
          hasn't been verified.
        </p>

        {selfAssignError && <Toast message={selfAssignError} type="error" onClose={() => setSelfAssignError(null)} />}

        <div className="mt-5 flex justify-end gap-2">
          <Button size="xs" variant="outline" onClick={() => setIsSelfAssignOpen(false)}>
            Cancel
          </Button>
          <Button size="xs" disabled={!identifierPick || selfAssigning} onClick={startSelfAssignment}>
            {selfAssigning ? "Starting..." : "Start"}
          </Button>
        </div>
      </Modal>

      {/* Start assignment confirmation. Starting is a commitment — it's the
          one capture you may hold, and it puts the batch in progress for
          everyone watching the queue. */}
      <Modal isOpen={isStartConfirmOpen} onClose={() => setIsStartConfirmOpen(false)} className="max-w-sm p-6">
        <h3 className="mb-2 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          Start assignment?
        </h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          {startable?.assignment_status === AssignmentStatus.RETURNED_FOR_CORRECTION
            ? "This batch was sent back for correction. Starting it reopens capture so you can replace the rejected documents."
            : "This becomes your assignment in progress, and you can only have one at a time."}
        </p>
        <div className="flex justify-end gap-2">
          <Button
            size="xs"
            type="button"
            variant="outline"
            onClick={() => setIsStartConfirmOpen(false)}
            disabled={startingAssignment}
          >
            Cancel
          </Button>
          <Button size="xs" type="button" onClick={handleStartAssignment} disabled={startingAssignment}>
            {startingAssignment ? "Starting..." : "Start"}
          </Button>
        </div>
      </Modal>

      {/* Close assignment confirmation */}
      {/* Clearing staged documents — the browser's own confirm box looked
          nothing like the rest of the screen. */}
      <Modal isOpen={isClearConfirmOpen} onClose={() => setIsClearConfirmOpen(false)} className="max-w-sm p-6">
        <h3 className="mb-2 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          Clear documents?
        </h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          {pendingImageCount === 1
            ? "This removes the one document you have not uploaded yet. Documents already uploaded stay in the batch."
            : `This removes the ${pendingImageCount} documents you have not uploaded yet. Documents already uploaded stay in the batch.`}
        </p>
        <div className="flex justify-end gap-2">
          <Button
            size="xs"
            type="button"
            variant="outline"
            onClick={() => setIsClearConfirmOpen(false)}
          >
            Cancel
          </Button>
          <Button size="xs" type="button" onClick={clearPendingImages}>
            Clear
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={isCloseConfirmOpen}
        onClose={() => {
          setCloseRefusal(null);
          setIsCloseConfirmOpen(false);
        }}
        className="max-w-sm p-6"
      >
        {/* pr-10 on the heading: the modal's own close button sits top-right
            and was landing on top of the title. */}
        <h3 className="mb-2 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          {closeLabel}?
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {autoVerify
            ? "This project verifies its own batches, so this publishes it."
            : "This marks the batch available for verification."}
        </p>

        {/* Quoted at the moment of closing, so a batch cannot go back
            unchanged without its reason having been in front of someone. */}
        {activeAssignment?.return_reason && (
          <p className="mb-4 rounded-lg border border-error-500/40 bg-error-500/10 p-3 text-sm text-gray-700 dark:text-gray-200">
            <span className="font-medium text-error-600 dark:text-error-500">
              It was sent back for:
            </span>{" "}
            {activeAssignment.return_reason}
          </p>
        )}

        {blockingBeforeClose.length > 0 && (
          <div className="mb-4 rounded-lg border border-error-500/40 bg-error-500/10 p-3">
            <ul className="space-y-1 text-sm text-error-600 dark:text-error-500">
              {blockingBeforeClose.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {/* Only for the documents that have not arrived. A page that
                was sent back is not thrown away by closing — it is the
                reason closing is refused, and its own line says what to do
                about it. */}
            {blockingBeforeClose.some((line) => line !== rejectedBlocker) && (
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                Upload or clear them first — closing now would throw them away.
              </p>
            )}
          </div>
        )}

        {closeRefusal && (
          <p className="mb-4 rounded-lg border border-error-500/40 bg-error-500/10 p-3 text-sm text-error-600 dark:text-error-500">
            {closeRefusal}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            size="xs"
            type="button"
            variant="outline"
            onClick={() => {
              setCloseRefusal(null);
              setIsCloseConfirmOpen(false);
            }}
            disabled={closingAssignment}
          >
            Cancel
          </Button>
          <Button
            size="xs"
            type="button"
            onClick={handleCloseAssignment}
            disabled={closingAssignment || blockingBeforeClose.length > 0}
          >
            {closingAssignment ? "Closing..." : closeLabel}
          </Button>
        </div>
      </Modal>
    </>
  );
}
