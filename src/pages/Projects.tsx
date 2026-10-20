import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageMeta from "../components/common/PageMeta";
import Toast from "../components/common/Toast";
import { Modal } from "../components/ui/modal";
import Button from "../components/ui/button/Button";
import Label from "../components/form/Label";
import Input from "../components/form/input/InputField";
import Checkbox from "../components/form/input/Checkbox";
import { CheckCircleIcon, CloseLineIcon } from "../icons";
import { useCustomer } from "../context/CustomerContext";
import { customerService } from "../services/customerService";
import IdentifierPushCard from "../components/projects/IdentifierPushCard";
import NotificationAreasCard, {
  NotificationAreasHandle,
} from "../components/notifications/NotificationAreasCard";
import {
  modelCatalogueService,
  projectReadinessService,
  CatalogueModel,
  ProjectReadiness,
  ocrModels,
  categoriseModels,
  isSmartDocModel,
  daysUntilRetired,
} from "../services/modelCatalogueService";
import Tabs from "../components/common/Tabs";
import { authService } from "../services/authService";
import { userManagementService, Project } from "../services/userManagementService";
import { storageService } from "../services/storageService";
import type { Storage as StorageRow } from "../services/storageService";
import { projectSettingService } from "../services/projectSettingService";
import type { ProjectSetting } from "../services/projectSettingService";
import { providerShortName } from "../services/storageService";

const emptyNewProject = {
  project_name: "",
  identifier_label: "",
};

// What a project gets if the operator accepts the suggested setup: enhance and
// How wide the project list may be dragged. Below the minimum the names
// truncate to nothing; above the maximum the settings beside it start
// wrapping.
const LIST_MIN = 200;
const LIST_MAX = 520;

// categorise on arrival, verified by a person, and a worker may verify their
// own batch. Storage is deliberately not in here — nothing can guess which
// bucket a project should write to.
// What this installation carries end to end, from its own configuration —
// the same number nginx and the upload service are set up for. The API
// refuses a project limit above it; this is only so the field can say so
// before anyone presses Save.
// Asked for once when the screen opens, not read from this app's own .env:
// the number is nginx's, enforced by smartdoc_upload_api, and used to be
// copied into three files that had to agree. Until it arrives the field has
// no cap of its own — the server refuses anything too big either way.
const NO_CEILING_YET = 0;

const DEFAULT_AUTOMATION = {
  auto_process: true,
  auto_analyze: true,
  // Off, like the column. OCR on every page of every project is the bill
  // nobody predicts.
  auto_ocr: false,
  auto_verify: false,
  allow_self_verify: true,
  allow_self_assign: false,
  // Empty means "follow the customer" — the ordinary case.
  max_file_mb: "",
  categorise_model_id: "",
  read_model_id: "",
};

// The detail pane edits the project row and its settings row together, so one
// form holds both. They're saved with separate calls because they're separate
// records — see saveDetail.
type DetailForm = {
  project_name: string;
  identifier_label: string;
  customer_storage_id: string;
  auto_process: boolean;
  auto_analyze: boolean;
  auto_ocr: boolean;
  auto_verify: boolean;
  allow_self_verify: boolean;
  allow_self_assign: boolean;
  // Kept as text while it is being typed, so a half-deleted number does
  // not become 0 for a keystroke.
  max_file_mb: string;
  // "" means "follow the customer", as with the size limit above.
  categorise_model_id: string;
  read_model_id: string;
};

/**
 * The switches that have no model behind them.
 *
 * **Categorise and OCR are not here.** Each used to be a checkbox beside a
 * model dropdown, and the two could say different things — the switch on
 * with no model meant every page went to a service that could not do the
 * work. They are now one control each: the dropdown says Manual, a model,
 * or whatever the customer chose, and "Manual" is what switching the stage
 * off means. See `MODEL_CHOICE` below.
 */
/**
 * One model in a picker, with the day it stops if it has one.
 *
 * **Said on the option itself**, not only in a warning underneath: somebody
 * scanning the list is choosing, and "retires in 9 days" after they have
 * chosen is late.
 */
function ModelOption({ model }: { model: CatalogueModel }) {
  const days = daysUntilRetired(model);
  const note =
    days === null ? "" : days < 0 ? " — retired" : days === 0 ? " — stops today" : ` — stops in ${days}d`;
  return (
    <option value={String(model.model_id)} className="dark:bg-gray-900">
      {model.display_name}
      {note}
    </option>
  );
}

const AUTOMATION: { key: keyof DetailForm; label: string; hint: string }[] = [
  {
    key: "auto_process",
    label: "Auto Enhance",
    hint: "Crop black edges and correct brightness as soon as a document arrives.",
  },
  {
    key: "auto_verify",
    label: "Auto Verify",
    hint: "Batches are marked verified without anyone reviewing them.",
  },
  {
    key: "allow_self_verify",
    label: "Allow Self Verification",
    hint: "A worker may verify a batch they captured themselves.",
  },
  {
    key: "allow_self_assign",
    label: "Allow Self Assignment",
    hint: "A worker may start a batch on any open folio themselves, instead of waiting for one to be handed out.",
  },
];

export default function Projects() {
  const { customer } = useCustomer();

  const [projects, setProjects] = useState<Project[]>([]);
  const [storages, setStorages] = useState<StorageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [search, setSearch] = useState("");

  // The customer's own limit, so the field can say what "follow the
  // customer" works out to rather than leaving somebody to go and look.
  const [customerLimit, setCustomerLimit] = useState<number | null>(null);
  // The models on offer, and what this project resolves to today — so the
  // dropdown can say what "follow the customer" works out to rather than
  // leaving somebody to go and look.
  const [offeredModels, setOfferedModels] = useState<CatalogueModel[]>([]);
  // What this project still needs before it can take a document.
  const [readiness, setReadiness] = useState<ProjectReadiness | null>(null);

  const [togglingProjectId, setTogglingProjectId] = useState<number | null>(null);
  const [pendingToggle, setPendingToggle] = useState<{ project: Project; nextActive: 0 | 1 } | null>(null);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newProject, setNewProject] = useState(emptyNewProject);
  const [creating, setCreating] = useState(false);

  // Master/detail: the list on the left selects, the pane on the right edits.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [setting, setSetting] = useState<ProjectSetting | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  // The largest document this installation carries, from the server.
  const [maxFileMbCeiling, setMaxFileMbCeiling] = useState(NO_CEILING_YET);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await authService.ensureValidToken();
        const limits = await projectSettingService.limits(token);
        if (!cancelled) setMaxFileMbCeiling(limits.max_file_mb);
      } catch {
        // No cap on the field rather than a message: the server refuses an
        // oversized limit anyway, and a failure here is not the reason
        // somebody opened this screen.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  /**
   * Which tab of the selected project is open. **Always the first one on
   * arrival** — see `CustomerSettings.tsx` for why it is no longer
   * remembered between visits.
   */
  const [tab, setTab] = useState<string>("general");
  const chooseTab = (id: string) => setTab(id);

  const [form, setForm] = useState<DetailForm | null>(null);
  const [saving, setSaving] = useState(false);

  // The notification lists hold their changes, so this screen's Save has to
  // write them along with everything else — otherwise a switch somebody
  // pressed on that tab would be dropped on the way out.
  const workAreasRef = useRef<NotificationAreasHandle>(null);
  const viewerAreasRef = useRef<NotificationAreasHandle>(null);
  // How many projects this customer may have. Read fresh, not from the copy
  // stored at sign-in: whoever runs SmartDoc can raise it while this screen
  // is open, and a stale limit would refuse a project the server allows.
  const [allowedProjects, setAllowedProjects] = useState<number | null>(null);

  /**
   * How wide the project list is, and whether it is there at all.
   *
   * Read from the browser in the initial state, never in an effect: set
   * afterwards, the panel is drawn at its default width and jumps to the
   * remembered one a frame later.
   */
  const [listWidth, setListWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("projects_list_width"));
    return Number.isFinite(saved) && saved >= LIST_MIN && saved <= LIST_MAX ? saved : 288;
  });
  const [listOpen, setListOpen] = useState<boolean>(
    () => localStorage.getItem("projects_list_open") !== "0",
  );
  // Kept in step with the state so the drag can read it without closing
  // over a stale value.
  useEffect(() => {
    latestWidth.current = listWidth;
  }, [listWidth]);
  const dragging = useRef(false);
  // Measured rather than assumed: the menu to the left of this panel
  // collapses to a rail, so the panel's own left edge moves.
  const listRef = useRef<HTMLElement>(null);
  const latestWidth = useRef(0);

  /**
   * Dragging the divider.
   *
   * Listeners on the window rather than the handle: the pointer leaves a
   * 4px strip immediately, and a handler bound to the handle stops being
   * called the moment it does.
   */
  const startDrag = useCallback(() => {
    dragging.current = true;
    // While dragging, nothing on the page should select or show an I-beam.
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, []);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      const left = listRef.current?.getBoundingClientRect().left ?? 0;
      const next = Math.min(LIST_MAX, Math.max(LIST_MIN, e.clientX - left));
      latestWidth.current = next;
      setListWidth(next);
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      // Written on release, not on every pixel of the drag. From a ref
      // rather than a state updater: a side effect inside one runs twice
      // under StrictMode.
      localStorage.setItem("projects_list_width", String(latestWidth.current));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const toggleList = () => {
    setListOpen((open) => {
      localStorage.setItem("projects_list_open", open ? "0" : "1");
      return !open;
    });
  };

  /**
   * Whether this project would actually categorise anything.
   *
   * A blank choice on the project means "use the customer's"; a blank
   * choice there means Manual — somebody picks the category by hand. So
   * the question is whether anything resolves at all.
   *
   * **Auto Categorize cannot be on without one.** The pipeline routes on
   * the switch alone: with it on, every page is published to
   * `smartdoc.analyze`, and the categoriser then has no model to use and
   * the page fails at the far end. Keeping the switch and the model in step
   * here means the pipeline only ever has to look at the switch.
   */
  /**
   * The value meaning "nothing runs this stage here".
   *
   * A real value rather than "", because "" is what the select shows when
   * nothing matches — and a stage with no model has to be a deliberate
   * answer, not the absence of one.
   */
  const MANUAL = "manual";

  const selectedProject = useMemo(
    () => projects.find((p) => p.project_id === selectedId) || null,
    [projects, selectedId]
  );

  // Only active storages are offered. An inactive one that a project already
  // uses still shows, otherwise the dropdown would silently misrepresent what
  // the project is actually pointing at.
  const storageOptions = useMemo(
    () =>
      storages.filter(
        (s) => s.is_active === 1 || String(s.customer_storage_id) === form?.customer_storage_id
      ),
    [storages, form?.customer_storage_id]
  );

  const selectedStorage = useMemo(
    () => storages.find((s) => String(s.customer_storage_id) === form?.customer_storage_id) || null,
    [storages, form?.customer_storage_id]
  );

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter(
      // The name only: the id is no longer shown, so matching on it would
      // hide rows for a reason nobody can see.
      (p) => p.project_name.toLowerCase().includes(query)
    );
  }, [projects, search]);

  // `silent` refreshes the data without flipping the screen back to its
  // loading state — after a save, replacing the form with "Loading..." for a
  // moment reads as something having gone wrong.
  const loadAll = async ({ silent = false } = {}) => {
    if (!customer) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const token = await authService.ensureValidToken();
      const [projectResult, storageResult, customerResult, customerSettings, models] = await Promise.all([
        userManagementService.getProjectsByCustomer(customer.customer_id, token),
        storageService.getStoragesByCustomer(customer.customer_id, token),
        // The full row, with the person's own token: the public answer the
        // sign-in page reads has no project limit in it.
        customerService.getById(customer.customer_id, token).catch(() => null),
        customerService.getSettings(customer.customer_id, token).catch(() => null),
        modelCatalogueService.offered().catch(() => []),
      ]);
      setProjects(projectResult);
      setStorages(storageResult);
      setCustomerLimit(customerSettings?.max_file_mb ?? null);
      setOfferedModels(models);
      setAllowedProjects(customerResult?.allowed_projects ?? customer.allowed_projects ?? null);
      setSelectedId((prev) => prev ?? (projectResult.length > 0 ? projectResult[0].project_id : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadDetail = async (project: Project, { silent = false } = {}) => {
    if (!silent) setLoadingDetail(true);
    setDetailError(null);
    try {
      const token = await authService.ensureValidToken();
      const result = await projectSettingService.getByProject(project.project_id, token);
      setSetting(result);
      setForm({
        project_name: project.project_name,
        identifier_label: project.identifier_label,
        customer_storage_id: result ? String(result.customer_storage_id) : "",
        // Nothing is assumed for a project with no settings row — every
        // switch starts off, and the prompt below offers to fill them in.
        auto_process: result ? result.auto_process === 1 : false,
        auto_analyze: result ? result.auto_analyze === 1 : false,
        auto_ocr: result ? result.auto_ocr === 1 : false,
        auto_verify: result ? result.auto_verify === 1 : false,
        allow_self_verify: result ? result.allow_self_verify === 1 : false,
        allow_self_assign: result ? result.allow_self_assign === 1 : false,
        // Empty when the project follows its customer, which is most of
        // them. The placeholder below says what that works out to.
        max_file_mb: result?.max_file_mb != null ? String(result.max_file_mb) : "",
        categorise_model_id:
          result?.categorise_model_id != null ? String(result.categorise_model_id) : "",
        read_model_id: result?.read_model_id != null ? String(result.read_model_id) : "",
      });
      projectReadinessService
        .check(project.project_id)
        .then(setReadiness)
        .catch(() => setReadiness(null));
    } catch (err) {
      // A settings row that exists but names no storage fails the GET by
      // design. Say so here rather than showing an empty form.
      setSetting(null);
      setForm(null);
      setDetailError(err instanceof Error ? err.message : "Failed to load project settings");
    } finally {
      if (!silent) setLoadingDetail(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer]);

  useEffect(() => {
    if (selectedProject) loadDetail(selectedProject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, projects.length]);

  const toggleActive = (p: Project) => {
    setPendingToggle({ project: p, nextActive: p.is_active === 1 ? 0 : 1 });
  };

  const confirmToggleActive = async () => {
    if (!pendingToggle) return;
    const { project: p, nextActive } = pendingToggle;

    setPendingToggle(null);
    setTogglingProjectId(p.project_id);
    try {
      const token = await authService.ensureValidToken();
      await userManagementService.updateProject(
        p.project_id,
        p.project_name,
        p.customer_id,
        p.identifier_label,
        nextActive,
        token
      );
      setProjects((prev) =>
        prev.map((row) => (row.project_id === p.project_id ? { ...row, is_active: nextActive } : row))
      );
      setToast({
        message: `Project "${p.project_name}" ${nextActive === 1 ? "enabled" : "disabled"} successfully`,
        type: "success",
      });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to update project",
        type: "error",
      });
    } finally {
      setTogglingProjectId(null);
    }
  };

  // A name this customer already uses on another project. Names are unique
  // per customer; the server refuses a clash too, this says so first.
  const nameTaken = (name: string, exceptId?: number) =>
    projects.some(
      (p) =>
        p.project_name.trim().toLowerCase() === name.trim().toLowerCase() &&
        p.project_id !== exceptId,
    );

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) return;

    if (!newProject.project_name.trim() || !newProject.identifier_label.trim()) {
      setToast({ message: "Project name and identifier label are required", type: "error" });
      return;
    }
    if (nameTaken(newProject.project_name)) {
      setToast({ message: `There is already a project called "${newProject.project_name.trim()}"`, type: "error" });
      return;
    }

    setCreating(true);
    try {
      const token = await authService.ensureValidToken();
      const created = await userManagementService.createProject(
        newProject.project_name.trim(),
        customer.customer_id,
        newProject.identifier_label.trim(),
        token
      );
      setToast({
        message: `Project "${newProject.project_name.trim()}" created — now choose its storage`,
        type: "success",
      });
      setIsAddOpen(false);
      setNewProject(emptyNewProject);
      await loadAll();
      // Settings are the unfinished half of creating a project, so select the
      // new one rather than leaving the pane on whatever was open.
      if (created?.project_id) setSelectedId(created.project_id);
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to create project",
        type: "error",
      });
    } finally {
      setCreating(false);
    }
  };

  // Called both by the form (Enter key) and by the Save button in the fixed
  // header, which sits outside the form element.
  const saveDetail = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedProject || !form) return;

    if (!form.project_name.trim() || !form.identifier_label.trim()) {
      setToast({ message: "Project name and identifier label are required", type: "error" });
      return;
    }

    if (nameTaken(form.project_name, selectedProject.project_id)) {
      setToast({ message: `There is already a project called "${form.project_name.trim()}"`, type: "error" });
      return;
    }

    if (!form.customer_storage_id) {
      setToast({ message: "Choose where this project's documents are stored", type: "error" });
      return;
    }

    setSaving(true);
    try {
      const token = await authService.ensureValidToken();

      // The project row and its settings row are separate records, so this is
      // two calls. The project name is saved first because it's the one that
      // can't be refused for a reason worth reading.
      if (
        form.project_name.trim() !== selectedProject.project_name ||
        form.identifier_label.trim() !== selectedProject.identifier_label
      ) {
        await userManagementService.updateProject(
          selectedProject.project_id,
          form.project_name.trim(),
          selectedProject.customer_id,
          form.identifier_label.trim(),
          selectedProject.is_active,
          token
        );
      }

      const flags = {
        auto_process: (form.auto_process ? 1 : 0) as 0 | 1,
        auto_analyze: (form.auto_analyze ? 1 : 0) as 0 | 1,
        auto_ocr: (form.auto_ocr ? 1 : 0) as 0 | 1,
        auto_verify: (form.auto_verify ? 1 : 0) as 0 | 1,
        allow_self_verify: (form.allow_self_verify ? 1 : 0) as 0 | 1,
        allow_self_assign: (form.allow_self_assign ? 1 : 0) as 0 | 1,
        // null, not 0: an empty field means the customer's number applies.
        max_file_mb: form.max_file_mb.trim() === "" ? null : Number(form.max_file_mb),
        categorise_model_id: form.categorise_model_id ? Number(form.categorise_model_id) : null,
        read_model_id: form.read_model_id ? Number(form.read_model_id) : null,
        customer_storage_id: Number(form.customer_storage_id),
      };

      if (setting) {
        await projectSettingService.update(
          { ...flags, project_setting_id: setting.project_setting_id, project_id: selectedProject.project_id },
          token
        );
      } else {
        await projectSettingService.create({ ...flags, project_id: selectedProject.project_id }, token);
      }

      await workAreasRef.current?.save();
      await viewerAreasRef.current?.save();

      setToast({ message: "Project saved", type: "success" });
      await loadAll({ silent: true });
      await loadDetail(
        {
          ...selectedProject,
          project_name: form.project_name.trim(),
          identifier_label: form.identifier_label.trim(),
        },
        { silent: true }
      );
    } catch (err) {
      // Worth showing verbatim: "already has N document(s)" and the
      // wrong-customer refusal both explain exactly what to do next.
      setToast({
        message: err instanceof Error ? err.message : "Failed to save project",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 w-full bg-gray-50 dark:bg-gray-900 overflow-hidden min-w-0 min-h-0">
      <PageMeta title="Projects | SmartDoc" description="Manage projects and their settings" />

      {/* Master / detail */}
      <div className="flex flex-1 min-h-0 min-w-0">
        {/* Master: the project list. Width is dragged and remembered; it
            can be folded away entirely when the settings beside it need the
            room. */}
        {!listOpen ? (
          <button
            type="button"
            onClick={toggleList}
            title="Show the project list"
            className="flex w-8 flex-shrink-0 flex-col items-center gap-2 border-r border-gray-200 bg-white pt-3 text-gray-500 hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-white/[0.03] dark:hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4">
              <path d="m9 18 6-6-6-6" />
            </svg>
            {/* The name reads bottom-to-top so the rail stays 32px wide. */}
            <span className="text-xs font-medium [writing-mode:vertical-rl]">Projects</span>
          </button>
        ) : (
        <aside
          ref={listRef}
          style={{ width: listWidth }}
          className="relative flex flex-shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div className="flex-shrink-0 border-b border-gray-100 p-3 dark:border-gray-800">
            {/* Row one: the way to fold the list away, what it holds, and
                the way to add to it. Row two is the search on its own,
                which needs the width more than anything here. */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleList}
                title="Hide the project list"
                className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.05] dark:hover:text-white"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {/* A chip rather than a line of text: it is a count against a
                  limit, which reads as a badge. Tinted red once there is no
                  room left — the New button beside it is already disabled,
                  so no sentence is needed. */}
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  !loading && allowedProjects !== null && projects.length >= allowedProjects
                    ? "bg-error-50 text-error-600 dark:bg-error-500/10 dark:text-error-500"
                    : "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
                }`}
              >
                {loading
                  ? "Projects"
                  : allowedProjects !== null
                  ? `Limit ${allowedProjects} · Remaining ${Math.max(0, allowedProjects - projects.length)}`
                  : `${filteredProjects.length} project${filteredProjects.length === 1 ? "" : "s"}`}
              </span>

              {/* Only while a search is narrowing the list. */}
              {!loading && filteredProjects.length !== projects.length && (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">
                  {filteredProjects.length} shown
                </span>
              )}

              </div>
              <Button
                size="xs"
                onClick={() => setIsAddOpen(true)}
                // Greyed rather than hidden at the limit: the chip beside it
                // says why, and a button that vanished would leave people
                // hunting for it.
                disabled={
                  (allowedProjects !== null && projects.length >= allowedProjects) ||
                  !storages.some((row) => row.is_active === 1)
                }
              >
                New
              </Button>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <span className="absolute -translate-y-1/2 pointer-events-none left-3 top-1/2">
                  <svg
                    className="fill-gray-500 dark:fill-gray-400"
                    width="16"
                    height="16"
                    viewBox="0 0 20 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M3.04175 9.37363C3.04175 5.87693 5.87711 3.04199 9.37508 3.04199C12.8731 3.04199 15.7084 5.87693 15.7084 9.37363C15.7084 12.8703 12.8731 15.7053 9.37508 15.7053C5.87711 15.7053 3.04175 12.8703 3.04175 9.37363ZM9.37508 1.54199C5.04902 1.54199 1.54175 5.04817 1.54175 9.37363C1.54175 13.6991 5.04902 17.2053 9.37508 17.2053C11.2674 17.2053 13.003 16.5344 14.357 15.4176L17.177 18.238C17.4699 18.5309 17.9448 18.5309 18.2377 18.238C18.5306 17.9451 18.5306 17.4703 18.2377 17.1774L15.418 14.3573C16.5365 13.0033 17.2084 11.2669 17.2084 9.37363C17.2084 5.04817 13.7011 1.54199 9.37508 1.54199Z"
                      fill=""
                    />
                  </svg>
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search projects..."
                  className="h-9 w-full rounded-lg border border-gray-200 bg-transparent py-2 pl-9 pr-3 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
                />
              </div>
            </div>

            {/* Nowhere for a project to live yet. On its own line because
                it is a sentence, not a count — in the row above it wrapped
                and pushed the New button down. */}
            {!loading && !storages.some((row) => row.is_active === 1) && (
              <p className="mt-2 text-xs font-medium text-warning-600 dark:text-warning-500">
                No storage yet — add one under Setup → Storage
              </p>
            )}

            {error && <Toast message={error} type="error" onClose={() => setError(null)} />}
          </div>
          <div className="flex-1 overflow-auto">
          {loading ? (
            <p className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">Loading projects...</p>
          ) : filteredProjects.length === 0 ? (
            <p className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">
              {projects.length === 0 ? "No projects found" : "No projects match your search"}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {filteredProjects.map((p) => {
                const isSelected = p.project_id === selectedId;
                return (
                  <li key={p.project_id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.project_id)}
                      className={`flex w-full items-center gap-2 px-4 py-3 text-left ${
                        isSelected
                          ? "bg-brand-50 dark:bg-brand-500/10"
                          : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                      }`}
                    >
                      <span
                        title={p.is_active === 1 ? "Enabled" : "Disabled"}
                        className={`size-1.5 flex-shrink-0 rounded-full ${
                          p.is_active === 1 ? "bg-success-500" : "bg-gray-300 dark:bg-gray-600"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-gray-800 dark:text-white/90">
                          {p.project_name}
                        </span>
                        <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                          {p.identifier_label}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          </div>

          {/* The divider. A 4px strip with a wider invisible grab area, so
              it can be caught without hunting for it. Double-click puts it
              back to the width it started at. */}
          <div
            onMouseDown={startDrag}
            onDoubleClick={() => {
              setListWidth(288);
              localStorage.setItem("projects_list_width", "288");
            }}
            title="Drag to resize, double-click to reset"
            className="group absolute right-0 top-0 z-10 h-full w-1.5 translate-x-1/2 cursor-col-resize"
          >
            <div className="mx-auto h-full w-0.5 bg-transparent transition-colors group-hover:bg-brand-500/60" />
          </div>
        </aside>
        )}

        {/* Detail: the selected project and its settings */}
        <section className="flex flex-1 flex-col min-h-0 min-w-0">
          {!selectedProject ? (
            <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
              Select a project to view its settings
            </p>
          ) : loadingDetail ? (
            <p className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading settings...</p>
          ) : (
            <>
              {/* Fixed header: the actions stay put however long the form gets */}
              <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-gray-800 dark:text-white/90">
                    {selectedProject.project_name}
                  </h2>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={togglingProjectId === selectedProject.project_id}
                    onClick={() => toggleActive(selectedProject)}
                  >
                    {selectedProject.is_active === 1 ? (
                      <>
                        <CheckCircleIcon className="size-4 text-success-500" /> Enabled
                      </>
                    ) : (
                      <>
                        <CloseLineIcon className="size-4 text-gray-400" /> Disabled
                      </>
                    )}
                  </Button>
                  {form && (
                    <>
                      <Button
                        size="xs"
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={() => selectedProject && loadDetail(selectedProject)}
                      >
                        Reset
                      </Button>
                      <Button size="xs" type="button" disabled={saving} onClick={() => saveDetail()}>
                        {saving && (
                          <span className="block size-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                        )}
                        {saving ? "Saving" : "Save Changes"}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4">
              {detailError && <Toast message={detailError} type="error" onClose={() => setDetailError(null)} />}

              {/* A project with no settings row cannot take a single document:
                  the upload service asks this API where to put the file and
                  gets nothing back. Worth saying loudly. */}
              {!setting && !detailError && (
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 dark:border-red-500/40 dark:bg-red-500/10">
                  <div>
                    <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                      No settings saved for this project
                    </p>
                    <p className="mt-0.5 text-xs text-red-600/90 dark:text-red-400/80">
                      It cannot receive documents until storage is chosen and these settings are
                      saved.
                    </p>
                  </div>
                  <Button
                    size="xs"
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (form) setForm({ ...form, ...DEFAULT_AUTOMATION });
                      setToast({
                        message: "Defaults filled in — choose storage, then Save Changes",
                        type: "info",
                      });
                    }}
                  >
                    Use recommended settings
                  </Button>
                </div>
              )}

              {/* What this project still needs before a document can reach
                  it. The same answer the save and the assignment refuse
                  with — shown here so somebody can see it before either
                  tries. */}
              {readiness && !readiness.ready && form && (
                <div className="mb-3 rounded-lg border border-warning-500/40 bg-warning-500/10 px-4 py-3">
                  <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                    Not ready for documents
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {readiness.reasons.map((reason) => (
                      <li key={reason} className="text-xs text-gray-700 dark:text-gray-200">
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {form && (
                <form
                  id="project-detail-form"
                  onSubmit={saveDetail}
                  className={`max-w-5xl space-y-3 transition-opacity duration-150 ${
                    saving ? "pointer-events-none opacity-60" : ""
                  }`}
                  noValidate
                >
                  <Tabs
                    tabs={[
                      { id: "general", label: "Project" },
                      { id: "storage", label: "Storage" },
                      // Only once the project has a settings row: the
                      // webhook card needs one to show anything.
                      ...(setting ? [{ id: "webhook", label: "Webhook" }] : []),
                      { id: "misc", label: "Miscellaneous" },
                      { id: "notifications", label: "Notifications" },
                    ]}
                    active={tab}
                    onChange={chooseTab}
                  />
                  {/* Three panels, each one thing somebody came here to
                      change: what the project is, where its documents go,
                      and how another system talks to it. Folded state is
                      remembered, so a screen somebody uses every day opens
                      the way they left it. */}
                  <div className={tab === "general" ? "rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800" : "hidden"}>
                    <div className="grid gap-5 lg:grid-cols-2">
                      <div className="space-y-3">
                        <div>
                          <Label htmlFor="project_name">Project Name *</Label>
                        <Input
                          id="project_name"
                          compact
                          value={form.project_name}
                          onChange={(e) => setForm({ ...form, project_name: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="identifier_label">Identifier label *</Label>
                        <Input
                          id="identifier_label"
                          compact
                          placeholder="e.g. Folio Number"
                          value={form.identifier_label}
                          onChange={(e) => setForm({ ...form, identifier_label: e.target.value })}
                        />
                      </div>
                      </div>

                      <div className="space-y-2.5">
                        {/* Which model does each stage, now that the stage's
                            switch IS the model choice. One per row: the
                            label and the inherited name together are wider
                            than half a column. */}
                        <div className="space-y-3">
                          {(
                            [
                              ["categorise", "categorise_model_id", "Categorise"],
                              ["read", "read_model_id", "OCR"],
                            ] as const
                          ).map(([purpose, field, label]) => {
                            // Only the models whose row says they can do
                            // this job — Tesseract is not under Categorise.
                            const reading = purpose === "read";
                            const all = reading
                              ? ocrModels(offeredModels)
                              : categoriseModels(offeredModels);
                            // SmartDoc's, then this customer's own.
                            const mine = all.filter(isSmartDocModel);
                            const theirs = all.filter((m) => !isSmartDocModel(m));
                            // The column this stage's switch lives in. Written
                            // with the model so the two always agree.
                            const switchField = reading
                              ? ("auto_ocr" as const)
                              : ("auto_analyze" as const);
                            /**
                             * What "no model" is called for this stage.
                             *
                             * Categorising without a model is a real way to
                             * work: somebody picks the category by hand.
                             * Reading without one is not — nobody types a
                             * page out — so for OCR it is simply off, and
                             * the words are not searchable.
                             */
                            const noneLabel = reading ? "Off" : "Manual";
                            return (
                              <div key={field}>
                                <Label htmlFor={field}>{label}</Label>
                                <select
                                  id={field}
                                  value={form[field] || MANUAL}
                                  onChange={(e) => {
                                    const chosen = e.target.value;
                                    // One control, two columns. A model named
                                    // means the stage runs; Manual means it
                                    // does not. There is no third answer now
                                    // that customer-wide defaults are gone.
                                    const named = chosen !== MANUAL && Boolean(chosen);
                                    setForm({
                                      ...form,
                                      [field]: named ? chosen : "",
                                      [switchField]: named,
                                    });
                                  }}
                                  className="h-9 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                                >
                                  {/* **Nothing runs this stage here.**
                                      First, because it is the plainest
                                      answer: the page is never published to
                                      that queue, so no service is asked to
                                      do work it cannot do.

                                      There is no "use the customer's
                                      choice" any more — customer-wide
                                      defaults were removed on 2026-10-12,
                                      so a project either names a model or
                                      does not run the stage. One answer,
                                      one place. */}
                                  <option value={MANUAL} className="dark:bg-gray-900">
                                    {noneLabel}
                                  </option>

                                  {/* **Two groups, when there are two.**
                                      SmartDoc's models can be withdrawn or
                                      retired under this customer; their own
                                      cannot, and the key is theirs. A single
                                      heading over everything is noise, so
                                      the groups only appear when both have
                                      something in them. */}
                                  {mine.length === 0 ? (
                                    theirs.map((m) => (
                                      <ModelOption key={m.model_id} model={m} />
                                    ))
                                  ) : theirs.length === 0 ? (
                                    mine.map((m) => (
                                      <ModelOption key={m.model_id} model={m} />
                                    ))
                                  ) : (
                                    <>
                                      <optgroup label="SmartDoc models">
                                        {mine.map((m) => (
                                          <ModelOption key={m.model_id} model={m} />
                                        ))}
                                      </optgroup>
                                      <optgroup label="Your models">
                                        {theirs.map((m) => (
                                          <ModelOption key={m.model_id} model={m} />
                                        ))}
                                      </optgroup>
                                    </>
                                  )}
                                </select>
                                {all.length === 0 && (
                                  <p className="mt-1.5 text-xs text-warning-600 dark:text-warning-500">
                                    {reading
                                      ? "SmartDoc offers no reading engine yet."
                                      : "SmartDoc offers no model that can categorise yet."}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {AUTOMATION.map((item) => (
                        <div key={item.key}>
                          <Checkbox
                            id={item.key}
                            label={item.label}
                            checked={Boolean(form[item.key])}
                            onChange={(checked) => setForm({ ...form, [item.key]: checked })}
                          />
                          <p className="mt-1 pl-8 text-xs text-gray-500 dark:text-gray-400">
                            {item.hint}
                          </p>
                        </div>
                      ))}


                      </div>
                    </div>
                  </div>

                  <div className={tab === "storage" ? "rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800" : "hidden"}>
                    {/* The two together: where documents go, and how big one
                        may be. One decision each, and both short. */}
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    <div>
                      <Label htmlFor="customer_storage_id">Select Storage *</Label>
                      <select
                        id="customer_storage_id"
                        value={form.customer_storage_id}
                        onChange={(e) => setForm({ ...form, customer_storage_id: e.target.value })}
                        className="h-9 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:focus:border-brand-800"
                      >
                        <option value="" className="dark:bg-gray-900">
                          Select storage...
                        </option>
                        {storageOptions.map((s) => (
                          <option
                            key={s.customer_storage_id}
                            value={String(s.customer_storage_id)}
                            className="dark:bg-gray-900"
                          >
                            {s.storage_name}
                            {s.is_active === 0 ? " (disabled)" : ""}
                          </option>
                        ))}
                      </select>

                      {selectedStorage ? (
                        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                          {providerShortName(selectedStorage.storage_provider)} ·{" "}
                          {selectedStorage.s3_bucket}
                          {selectedStorage.s3_region ? ` · ${selectedStorage.s3_region}` : ""}
                          {selectedStorage.s3_endpoint ? ` · ${selectedStorage.s3_endpoint}` : ""}
                        </p>
                      ) : storages.length === 0 ? (
                        <p className="mt-1.5 text-xs text-warning-500">
                          This customer has no storage yet — add one on the Storage screen first.
                        </p>
                      ) : null}

                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        Changing this once documents exist is refused: switching storage doesn't move
                        the files, so everything already uploaded would point at a bucket it was never
                        written to.
                      </p>
                    </div>

                    </div>
                  </div>


                  <div className={tab === "misc" ? "rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800" : "hidden"}>
                    {/* How big one page may be. Empty means the customer's
                        own limit applies. */}
                    <div>
                      <Label htmlFor="max_file_mb">Max doc size</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="max_file_mb"
                          compact
                          type="number"
                          min="1"
                          max={maxFileMbCeiling ? String(maxFileMbCeiling) : undefined}
                          value={form.max_file_mb}
                          onChange={(e) => setForm({ ...form, max_file_mb: e.target.value })}
                          placeholder={customerLimit === null ? "" : String(customerLimit)}
                          className="max-w-28"
                        />
                        <span className="text-sm text-gray-500 dark:text-gray-400">MB</span>
                      </div>
                      {form.max_file_mb.trim() !== "" && (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, max_file_mb: "" })}
                          className="mt-1.5 text-xs text-brand-500 hover:text-brand-600"
                        >
                          Set default
                        </button>
                      )}
                    </div>
                  </div>

                  {setting && (
                    <div className={tab === "webhook" ? "rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800" : "hidden"}>
                      <IdentifierPushCard
                        projectId={selectedProject.project_id}
                        onToast={(message, type) => setToast({ message, type })}
                      />
                    </div>
                  )}

                  {/* What this project's people are told. Anything left
                      alone follows the customer, so the usual case is to
                      open this and change nothing. */}
                  <div className={tab === "notifications" ? "rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800" : "hidden"}>
                    {/* Admin beside Viewer, not above it: two short lists
                        stacked pushed the Save button off the bottom. */}
                    <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
                      <div>
                        <p className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">
                          Admin
                        </p>
                        <NotificationAreasCard
                          ref={workAreasRef}
                          projectId={selectedProject.project_id}
                          surface="work"
                        />
                      </div>
                      <div>
                        <p className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">
                          Viewer
                        </p>
                        <NotificationAreasCard
                          ref={viewerAreasRef}
                          projectId={selectedProject.project_id}
                          surface="viewer"
                        />
                      </div>
                    </div>
                  </div>
                </form>
              )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* Add New Project modal */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} className="max-w-md p-6">
        <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90">Add New Project</h3>
        <form onSubmit={handleAddProject} className="space-y-4">
          <div>
            <Label htmlFor="new_project_name">Project Name *</Label>
            <Input
              id="new_project_name"
              value={newProject.project_name}
              onChange={(e) => setNewProject({ ...newProject, project_name: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="new_identifier_label">Identifier Label *</Label>
            <Input
              id="new_identifier_label"
              value={newProject.identifier_label}
              onChange={(e) => setNewProject({ ...newProject, identifier_label: e.target.value })}
              placeholder="e.g. Folio Number"
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Storage and automation are set next, on the project itself.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button size="xs" type="button" variant="outline" onClick={() => setIsAddOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button size="xs" type="submit" disabled={creating}>
              {creating ? "Creating..." : "Create Project"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Enable/disable confirmation dialog */}
      <Modal isOpen={!!pendingToggle} onClose={() => setPendingToggle(null)} className="max-w-sm p-6">
        <h3 className="mb-2 text-lg font-semibold text-gray-800 dark:text-white/90">
          {pendingToggle?.nextActive === 0 ? "Disable project?" : "Enable project?"}
        </h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          {pendingToggle?.nextActive === 0
            ? `"${pendingToggle?.project.project_name}" will be disabled.`
            : `"${pendingToggle?.project.project_name}" will be enabled.`}
        </p>
        <div className="flex justify-end gap-3">
          <Button size="xs" type="button" variant="outline" onClick={() => setPendingToggle(null)}>
            Cancel
          </Button>
          <Button size="xs" type="button" onClick={confirmToggleActive}>
            {pendingToggle?.nextActive === 0 ? "Disable" : "Enable"}
          </Button>
        </div>
      </Modal>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} position="top-center" />
      )}
    </div>
  );
}
