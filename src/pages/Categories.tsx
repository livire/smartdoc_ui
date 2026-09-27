import { useEffect, useMemo, useState } from "react";
import PageMeta from "../components/common/PageMeta";
import Toast from "../components/common/Toast";
import { Modal } from "../components/ui/modal";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../components/ui/table";
import Button from "../components/ui/button/Button";
import Label from "../components/form/Label";
import Input from "../components/form/input/InputField";
import TextArea from "../components/form/input/TextArea";
import ProjectCombobox from "../components/form/ProjectCombobox";
import Pagination from "../components/ui/pagination/Pagination";
import { PencilIcon, CheckCircleIcon, CloseLineIcon } from "../icons";
import { useCustomer } from "../context/CustomerContext";
import { authService } from "../services/authService";
import { documentService, Category } from "../services/documentService";
import { userManagementService, Project } from "../services/userManagementService";

// category_name is varchar(100).
const MAX_NAME_CHARS = 100;

const emptyForm = {
  category_name: "",
  category_description: "",
};

type FormErrors = Partial<Record<keyof typeof emptyForm, string>>;

export default function Categories() {
  // Customer-level screen: the project picker scopes the list, since category
  // definitions are project-scoped.
  const { customer } = useCustomer();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);

  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [search, setSearch] = useState("");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [pendingToggle, setPendingToggle] = useState<{ category: Category; nextActive: 0 | 1 } | null>(null);

  // One form drives both create and edit — `editingCategory` distinguishes them.
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((p) => String(p.project_id) === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const filteredCategories = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return categories;
    return categories.filter(
      (c) =>
        c.category_name.toLowerCase().includes(query) ||
        (c.category_description || "").toLowerCase().includes(query) ||
        String(c.category_id).includes(query)
    );
  }, [categories, search]);

  const totalPages = Math.max(1, Math.ceil(filteredCategories.length / pageSize));

  const pagedCategories = useMemo(
    () => filteredCategories.slice((page - 1) * pageSize, page * pageSize),
    [filteredCategories, page, pageSize]
  );

  // Narrowing the result set (or resizing pages) should put you back at the
  // start rather than on a page that no longer exists.
  useEffect(() => {
    setPage(1);
  }, [selectedProjectId, search, pageSize]);

  // Deleting/filtering can shrink the list under the current page.
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

  const loadCategories = async () => {
    if (!selectedProjectId) {
      setCategories([]);
      return;
    }
    setLoadingCategories(true);
    setError(null);
    try {
      const token = await authService.ensureValidToken();
      const result = await documentService.getCategories(Number(selectedProjectId), token);
      setCategories(result.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load categories");
    } finally {
      setLoadingCategories(false);
    }
  };

  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer]);

  useEffect(() => {
    loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  const openCreate = () => {
    setEditingCategory(null);
    setForm(emptyForm);
    setErrors({});
    setIsFormOpen(true);
  };

  const openEdit = (c: Category) => {
    setEditingCategory(c);
    setForm({
      category_name: c.category_name,
      category_description: c.category_description || "",
    });
    setErrors({});
    setIsFormOpen(true);
  };

  const validate = (): FormErrors => {
    const next: FormErrors = {};
    const name = form.category_name.trim();

    if (!name) {
      next.category_name = "Name is required";
    } else if (name.length > MAX_NAME_CHARS) {
      next.category_name = `Must be ${MAX_NAME_CHARS} characters or fewer`;
    } else if (
      // category_name carries a unique constraint in the DB, so a clash is a
      // hard failure. This catches collisions within the loaded project;
      // cross-project ones surface as a server error on save.
      categories.some(
        (c) =>
          c.category_name.trim().toLowerCase() === name.toLowerCase() &&
          c.category_id !== editingCategory?.category_id
      )
    ) {
      next.category_name = "A category with this name already exists";
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
      category_name: form.category_name.trim(),
      category_description: form.category_description.trim() || null,
      project_id: Number(selectedProjectId),
      // NOT NULL with no DB default — new categories start enabled.
      is_active: (editingCategory ? editingCategory.is_active : 1) as 0 | 1,
    };

    setSaving(true);
    try {
      const token = await authService.ensureValidToken();
      if (editingCategory) {
        await documentService.updateCategory(
          { ...payload, category_id: editingCategory.category_id },
          token
        );
        setToast({ message: "Category updated successfully", type: "success" });
      } else {
        await documentService.createCategory(payload, token);
        setToast({ message: `"${payload.category_name}" created successfully`, type: "success" });
      }
      setIsFormOpen(false);
      loadCategories();
    } catch (err) {
      setToast({
        message:
          err instanceof Error
            ? err.message
            : `Failed to ${editingCategory ? "update" : "create"} category`,
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = (c: Category) => {
    setPendingToggle({ category: c, nextActive: c.is_active === 1 ? 0 : 1 });
  };

  const confirmToggleActive = async () => {
    if (!pendingToggle) return;
    const { category: c, nextActive } = pendingToggle;

    setPendingToggle(null);
    setTogglingId(c.category_id);
    try {
      const token = await authService.ensureValidToken();
      await documentService.updateCategory({ ...c, is_active: nextActive }, token);
      setCategories((prev) =>
        prev.map((row) => (row.category_id === c.category_id ? { ...row, is_active: nextActive } : row))
      );
      setToast({
        message: `Category "${c.category_name}" ${nextActive === 1 ? "enabled" : "disabled"} successfully`,
        type: "success",
      });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to update category",
        type: "error",
      });
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="flex flex-col flex-1 w-full bg-gray-50 dark:bg-gray-900 overflow-hidden min-w-0 min-h-0">
      <PageMeta title="Categories | SmartDoc" description="Manage categories for this customer's projects" />

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
                placeholder="Search categories..."
                className="h-9 w-full rounded-lg border border-gray-200 bg-transparent py-2 pl-9 pr-3 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
              />
            </div>
          </div>
          <Button size="xs" disabled={!selectedProjectId} onClick={openCreate}>
            Add New Category
          </Button>
        </div>
        {error && <Toast message={error} type="error" onClose={() => setError(null)} />}
      </div>

      {/* Body */}
      <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 w-full overflow-auto flex-1 min-w-0">
        <Table>
          <TableHeader className="border-b border-gray-100 dark:border-gray-800">
            <TableRow>
              <TableCell isHeader className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                ID
              </TableCell>
              <TableCell isHeader className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Name
              </TableCell>
              <TableCell isHeader className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                AI Prompt
              </TableCell>
              <TableCell isHeader className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Actions
              </TableCell>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loadingProjects ? (
              <TableRow>
                <TableCell className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400" colSpan={4}>
                  Loading projects...
                </TableCell>
              </TableRow>
            ) : projects.length === 0 ? (
              <TableRow>
                <TableCell className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400" colSpan={4}>
                  No projects found for this customer
                </TableCell>
              </TableRow>
            ) : !selectedProjectId ? (
              <TableRow>
                <TableCell className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400" colSpan={4}>
                  Select a project to view its categories
                </TableCell>
              </TableRow>
            ) : loadingCategories ? (
              <TableRow>
                <TableCell className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400" colSpan={4}>
                  Loading categories...
                </TableCell>
              </TableRow>
            ) : filteredCategories.length === 0 ? (
              <TableRow>
                <TableCell className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400" colSpan={4}>
                  {categories.length === 0
                    ? "No categories found for this project"
                    : "No categories match your search"}
                </TableCell>
              </TableRow>
            ) : (
              pagedCategories.map((c) => {
                const isEnabled = c.is_active === 1;
                return (
                  <TableRow key={c.category_id}>
                    <TableCell className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">
                      {c.category_id}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-sm text-gray-800 dark:text-white/90">
                      {c.category_name}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">
                      {/* Prompts run long — keep them to a single line so every
                          row is the same height. Full text on hover. */}
                      <span
                        title={c.category_description || undefined}
                        className="block max-w-md truncate"
                      >
                        {c.category_description || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-sm">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title={isEnabled ? "Disable category" : "Enable category"}
                          disabled={togglingId === c.category_id}
                          onClick={() => toggleActive(c)}
                          className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/[0.05] disabled:opacity-50 ${
                            isEnabled ? "text-success-500" : "text-gray-400"
                          }`}
                        >
                          {togglingId === c.category_id ? (
                            <span className="block size-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                          ) : isEnabled ? (
                            <CheckCircleIcon className="size-4" />
                          ) : (
                            <CloseLineIcon className="size-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          title="Edit category"
                          onClick={() => openEdit(c)}
                          className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                        >
                          <PencilIcon className="size-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination sits outside the scroll area so it stays visible */}
      {!loadingProjects && !loadingCategories && selectedProjectId && (
        <div className="flex-shrink-0">
          <Pagination
            currentPage={page}
            totalItems={filteredCategories.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemLabel="categories"
          />
        </div>
      )}

      {/* Create / edit modal */}
      <Modal isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} className="max-w-2xl p-6">
        <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90">
          {editingCategory ? "Edit Category" : "Add New Category"}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="category_name">Name *</Label>
            <Input
              id="category_name"
              value={form.category_name}
              error={!!errors.category_name}
              hint={errors.category_name}
              onChange={(e) => setForm({ ...form, category_name: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="category_description">AI prompt</Label>
            <TextArea
              rows={10}
              placeholder={`Describe how to recognise a "${
                form.category_name.trim() || "this"
              }" document — distinguishing features, typical layout, wording to look for.`}
              value={form.category_description}
              onChange={(value) => setForm({ ...form, category_description: value })}
            />
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              Sent to the recognition model alongside the category name to classify uploaded
              documents. Be specific about what sets this category apart from the others in this
              project.
            </p>
          </div>

          {!editingCategory && selectedProject && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Will be added to{" "}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {selectedProject.project_name}
              </span>
              , and starts enabled.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button size="xs" type="button" variant="outline" onClick={() => setIsFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="xs" type="submit" disabled={saving}>
              {saving
                ? editingCategory
                  ? "Saving..."
                  : "Creating..."
                : editingCategory
                ? "Save"
                : "Create Category"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Enable/disable confirmation dialog */}
      <Modal isOpen={!!pendingToggle} onClose={() => setPendingToggle(null)} className="max-w-sm p-6">
        <h3 className="mb-2 text-lg font-semibold text-gray-800 dark:text-white/90">
          {pendingToggle?.nextActive === 0 ? "Disable category?" : "Enable category?"}
        </h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          {pendingToggle?.nextActive === 0
            ? `"${pendingToggle?.category.category_name}" will no longer be available for classifying documents.`
            : `"${pendingToggle?.category.category_name}" will be available for classifying documents again.`}
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
