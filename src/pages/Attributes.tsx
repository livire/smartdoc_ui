import { useEffect, useMemo, useState } from "react";
import PageMeta from "../components/common/PageMeta";
import Toast from "../components/common/Toast";
import { Modal } from "../components/ui/modal";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../components/ui/table";
import Button from "../components/ui/button/Button";
import Badge from "../components/ui/badge/Badge";
import Label from "../components/form/Label";
import Input from "../components/form/input/InputField";
import Checkbox from "../components/form/input/Checkbox";
import ProjectCombobox from "../components/form/ProjectCombobox";
import Pagination from "../components/ui/pagination/Pagination";
import { PencilIcon } from "../icons";
import { useCustomer } from "../context/CustomerContext";
import { authService } from "../services/authService";
import { documentService, Attribute } from "../services/documentService";
import { userManagementService, Project } from "../services/userManagementService";

type AttributeType = "S" | "N" | "D";

// Type codes as consumed at upload time (see pages/Digitize.tsx): 'S' renders
// a text input bounded by `length`, 'N' a number input, 'D' a date input.
const TYPE_OPTIONS: { value: AttributeType; label: string }[] = [
  { value: "S", label: "Text" },
  { value: "N", label: "Number" },
  { value: "D", label: "Date" },
];

const TYPE_LABELS: Record<string, string> = { S: "Text", N: "Number", D: "Date" };

// `default_value` is varchar(100), and values captured against an attribute
// land in image_attribute.attribute_value which is also varchar(100) — so a
// configured `length` above that would let uploaders type values the DB can't
// store.
const MAX_VALUE_CHARS = 100;

// Sentinel understood by Digitize: a date attribute defaulting to "C" is
// pre-filled with today's date rather than a literal value.
const CURRENT_DATE_SENTINEL = "C";

const emptyForm = {
  attribute_name: "",
  type: "S" as AttributeType,
  required: false,
  length: "",
  default_value: "",
  use_current_date: false,
};

type FormErrors = Partial<Record<keyof typeof emptyForm, string>>;

export default function Attributes() {
  // Customer-level screen: the project picker scopes the list, since attribute
  // definitions are project-scoped.
  const { customer } = useCustomer();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [attributes, setAttributes] = useState<Attribute[]>([]);

  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingAttributes, setLoadingAttributes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [search, setSearch] = useState("");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // One form drives both create and edit — `editingAttribute` is what
  // distinguishes them.
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAttribute, setEditingAttribute] = useState<Attribute | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((p) => String(p.project_id) === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const filteredAttributes = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return attributes;
    return attributes.filter(
      (a) =>
        a.attribute_name.toLowerCase().includes(query) ||
        String(a.attribute_id).includes(query)
    );
  }, [attributes, search]);

  const totalPages = Math.max(1, Math.ceil(filteredAttributes.length / pageSize));

  const pagedAttributes = useMemo(
    () => filteredAttributes.slice((page - 1) * pageSize, page * pageSize),
    [filteredAttributes, page, pageSize]
  );

  // Narrowing the result set (or resizing pages) should put you back at the
  // start rather than on a page that no longer exists.
  useEffect(() => {
    setPage(1);
  }, [selectedProjectId, search, pageSize]);

  // Filtering can shrink the list under the current page.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const loadProjects = async () => {
    if (!customer) return;
    setLoadingProjects(true);
    setError(null);
    try {
      const token = await authService.ensureValidToken();
      const result = await userManagementService.getProjectsByCustomer(customer.customer_id, token);
      setProjects(result);
      setSelectedProjectId((prev) => prev || (result.length > 0 ? String(result[0].project_id) : ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoadingProjects(false);
    }
  };

  const loadAttributes = async () => {
    if (!selectedProjectId) {
      setAttributes([]);
      return;
    }
    setLoadingAttributes(true);
    setError(null);
    try {
      const token = await authService.ensureValidToken();
      const result = await documentService.getAttributes(Number(selectedProjectId), token);
      setAttributes(result.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load attributes");
    } finally {
      setLoadingAttributes(false);
    }
  };

  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer]);

  useEffect(() => {
    loadAttributes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  const openCreate = () => {
    setEditingAttribute(null);
    setForm(emptyForm);
    setErrors({});
    setIsFormOpen(true);
  };

  const openEdit = (a: Attribute) => {
    setEditingAttribute(a);
    setForm({
      attribute_name: a.attribute_name,
      type: (a.type as AttributeType) || "S",
      required: a.required === 1,
      length: a.length != null ? String(a.length) : "",
      default_value:
        a.type === "D" && a.default_value === CURRENT_DATE_SENTINEL ? "" : a.default_value || "",
      use_current_date: a.type === "D" && a.default_value === CURRENT_DATE_SENTINEL,
    });
    setErrors({});
    setIsFormOpen(true);
  };

  // Switching type invalidates whatever was entered for the old one, so reset
  // the type-dependent fields rather than carrying a date default onto a
  // number attribute.
  const changeType = (type: AttributeType) => {
    setForm((prev) => ({ ...prev, type, length: "", default_value: "", use_current_date: false }));
    setErrors((prev) => ({ ...prev, type: undefined, length: undefined, default_value: undefined }));
  };

  const validate = (): FormErrors => {
    const next: FormErrors = {};
    const name = form.attribute_name.trim();

    if (!name) {
      next.attribute_name = "Name is required";
    } else if (name.length > MAX_VALUE_CHARS) {
      next.attribute_name = `Must be ${MAX_VALUE_CHARS} characters or fewer`;
    } else if (
      // attribute_name carries a unique constraint in the DB, so a clash is a
      // hard failure rather than a warning. This catches collisions within the
      // loaded project; cross-project ones surface as a server error on save.
      attributes.some(
        (a) =>
          a.attribute_name.trim().toLowerCase() === name.toLowerCase() &&
          a.attribute_id !== editingAttribute?.attribute_id
      )
    ) {
      next.attribute_name = "An attribute with this name already exists";
    }

    if (!form.type) {
      next.type = "Type is required";
    }

    let maxLen: number | null = null;
    if (form.type === "S" && form.length.trim()) {
      const parsed = Number(form.length);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        next.length = "Must be a whole number greater than 0";
      } else if (parsed > MAX_VALUE_CHARS) {
        next.length = `Cannot exceed ${MAX_VALUE_CHARS} — captured values are stored in a ${MAX_VALUE_CHARS}-character column`;
      } else {
        maxLen = parsed;
      }
    }

    const defaultValue = form.default_value.trim();
    const usingSentinel = form.type === "D" && form.use_current_date;
    if (!usingSentinel && defaultValue) {
      if (defaultValue.length > MAX_VALUE_CHARS) {
        next.default_value = `Must be ${MAX_VALUE_CHARS} characters or fewer`;
      } else if (form.type === "N" && Number.isNaN(Number(defaultValue))) {
        next.default_value = "Must be a number";
      } else if (form.type === "D" && Number.isNaN(Date.parse(defaultValue))) {
        next.default_value = "Must be a valid date";
      } else if (form.type === "S" && maxLen !== null && defaultValue.length > maxLen) {
        next.default_value = `Must be ${maxLen} characters or fewer to fit the configured length`;
      }
    }

    return next;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;

    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const payload = {
      attribute_name: form.attribute_name.trim(),
      project_id: Number(selectedProjectId),
      type: form.type,
      required: (form.required ? 1 : 0) as 0 | 1,
      default_value:
        form.type === "D" && form.use_current_date
          ? CURRENT_DATE_SENTINEL
          : form.default_value.trim() || null,
      // `length` only bounds the text input at upload time, so it's
      // meaningless on number/date attributes — normalize it away.
      length: form.type === "S" && form.length.trim() ? Number(form.length) : null,
    };

    setSaving(true);
    try {
      const token = await authService.ensureValidToken();
      if (editingAttribute) {
        await documentService.updateAttribute(
          { ...payload, attribute_id: editingAttribute.attribute_id },
          token
        );
        setToast({ message: "Attribute updated successfully", type: "success" });
      } else {
        await documentService.createAttribute(payload, token);
        setToast({ message: `"${payload.attribute_name}" created successfully`, type: "success" });
      }
      setIsFormOpen(false);
      loadAttributes();
    } catch (err) {
      setToast({
        message:
          err instanceof Error
            ? err.message
            : `Failed to ${editingAttribute ? "update" : "create"} attribute`,
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const renderDefaultValue = (a: Attribute) => {
    if (a.type === "D" && a.default_value === CURRENT_DATE_SENTINEL) return "Current date";
    return a.default_value || "—";
  };

  return (
    <div className="flex flex-col flex-1 w-full bg-gray-50 dark:bg-gray-900 overflow-hidden min-w-0 min-h-0">
      <PageMeta title="Attributes | SmartDoc" description="Manage attribute definitions for this customer's projects" />

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 min-w-0 flex-shrink-0 overflow-hidden w-full">
        <div className="flex items-center justify-between gap-4 w-full">
          <div className="flex items-center gap-3 min-w-0">
            <ProjectCombobox
              projects={projects}
              selectedProjectId={selectedProjectId}
              onSelect={setSelectedProjectId}
              disabled={loadingProjects || projects.length === 0}
              placeholder={loadingProjects ? "Loading projects..." : "Select a project"}
            />
            <div className="relative w-full max-w-xs">
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
                placeholder="Search attributes..."
                className="h-9 w-full rounded-lg border border-gray-200 bg-transparent py-2 pl-9 pr-3 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
              />
            </div>
          </div>
          <Button size="xs" disabled={!selectedProjectId} onClick={openCreate}>
            Add New Attribute
          </Button>
        </div>
        {error && <Toast message={error} type="error" onClose={() => setError(null)} />}
      </div>

      {/* Body */}
      <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 w-full overflow-auto flex-1 min-w-0">
        <Table>
          <TableHeader className="border-b border-gray-100 dark:border-gray-800">
            <TableRow>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                ID
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Name
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Type
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Required
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Default
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Length
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Actions
              </TableCell>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loadingProjects ? (
              <TableRow>
                <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={7}>
                  Loading projects...
                </TableCell>
              </TableRow>
            ) : projects.length === 0 ? (
              <TableRow>
                <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={7}>
                  No projects found for this customer
                </TableCell>
              </TableRow>
            ) : !selectedProjectId ? (
              <TableRow>
                <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={7}>
                  Select a project to view its attributes
                </TableCell>
              </TableRow>
            ) : loadingAttributes ? (
              <TableRow>
                <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={7}>
                  Loading attributes...
                </TableCell>
              </TableRow>
            ) : filteredAttributes.length === 0 ? (
              <TableRow>
                <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={7}>
                  {attributes.length === 0
                    ? "No attributes found for this project"
                    : "No attributes match your search"}
                </TableCell>
              </TableRow>
            ) : (
              pagedAttributes.map((a) => (
                <TableRow key={a.attribute_id}>
                  <TableCell className="px-4 py-4 text-sm text-gray-700 dark:text-gray-300">
                    {a.attribute_id}
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm text-gray-800 dark:text-white/90">
                    {a.attribute_name}
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm text-gray-700 dark:text-gray-300">
                    {TYPE_LABELS[a.type] || a.type}
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm">
                    <Badge size="sm" color={a.required === 1 ? "info" : "light"}>
                      {a.required === 1 ? "Required" : "Optional"}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm text-gray-700 dark:text-gray-300">
                    {renderDefaultValue(a)}
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm text-gray-700 dark:text-gray-300">
                    {a.length ?? "—"}
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm">
                    <button
                      type="button"
                      title="Edit attribute"
                      onClick={() => openEdit(a)}
                      className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                    >
                      <PencilIcon className="size-4" />
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination sits outside the scroll area so it stays visible */}
      {!loadingProjects && !loadingAttributes && selectedProjectId && (
        <div className="flex-shrink-0">
          <Pagination
            currentPage={page}
            totalItems={filteredAttributes.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemLabel="attributes"
          />
        </div>
      )}

      {/* Create / edit modal */}
      <Modal isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} className="max-w-md p-6">
        <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90">
          {editingAttribute ? "Edit Attribute" : "Add New Attribute"}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="attribute_name">Name *</Label>
            <Input
              id="attribute_name"
              value={form.attribute_name}
              error={!!errors.attribute_name}
              hint={errors.attribute_name}
              onChange={(e) => setForm({ ...form, attribute_name: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="attribute_type">Type *</Label>
            <select
              id="attribute_type"
              value={form.type}
              onChange={(e) => changeType(e.target.value as AttributeType)}
              className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:focus:border-brand-800"
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="dark:bg-gray-900">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Length only bounds text inputs at upload time. */}
          {form.type === "S" && (
            <div>
              <Label htmlFor="attribute_length">Max length</Label>
              <Input
                id="attribute_length"
                type="number"
                min="1"
                max={String(MAX_VALUE_CHARS)}
                value={form.length}
                error={!!errors.length}
                hint={errors.length || `Optional. Up to ${MAX_VALUE_CHARS} characters.`}
                onChange={(e) => setForm({ ...form, length: e.target.value })}
              />
            </div>
          )}

          <div>
            <Label htmlFor="attribute_default">Default value</Label>
            <Input
              id="attribute_default"
              type={form.type === "D" ? "date" : form.type === "N" ? "number" : "text"}
              value={form.default_value}
              disabled={form.type === "D" && form.use_current_date}
              error={!!errors.default_value}
              hint={errors.default_value}
              onChange={(e) => setForm({ ...form, default_value: e.target.value })}
            />
          </div>

          {form.type === "D" && (
            <Checkbox
              id="attribute_current_date"
              label="Default to the current date"
              checked={form.use_current_date}
              onChange={(checked) =>
                setForm((prev) => ({
                  ...prev,
                  use_current_date: checked,
                  default_value: checked ? "" : prev.default_value,
                }))
              }
            />
          )}

          <Checkbox
            id="attribute_required"
            label="Required at upload"
            checked={form.required}
            onChange={(checked) => setForm((prev) => ({ ...prev, required: checked }))}
          />

          {!editingAttribute && selectedProject && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Will be added to{" "}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {selectedProject.project_name}
              </span>
              .
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button size="xs" type="button" variant="outline" onClick={() => setIsFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="xs" type="submit" disabled={saving}>
              {saving
                ? editingAttribute
                  ? "Saving..."
                  : "Creating..."
                : editingAttribute
                ? "Save"
                : "Create Attribute"}
            </Button>
          </div>
        </form>
      </Modal>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} position="top-center" />
      )}
    </div>
  );
}
