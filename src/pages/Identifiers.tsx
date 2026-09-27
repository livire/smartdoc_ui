import { useEffect, useMemo, useState } from "react";
import PageMeta from "../components/common/PageMeta";
import Toast from "../components/common/Toast";
import { Modal } from "../components/ui/modal";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../components/ui/table";
import Button from "../components/ui/button/Button";
import Badge from "../components/ui/badge/Badge";
import Label from "../components/form/Label";
import Input from "../components/form/input/InputField";
import ProjectCombobox from "../components/form/ProjectCombobox";
import Pagination from "../components/ui/pagination/Pagination";
import { PencilIcon, LockIcon } from "../icons";
import { useCustomer } from "../context/CustomerContext";
import { authService } from "../services/authService";
import { documentService, Identifier, IdentifierLock } from "../services/documentService";
import { userManagementService, Project } from "../services/userManagementService";

export default function Identifiers() {
  // Customer-level screen: the project picker in the header scopes the list.
  // Projects come from the customer-scoped endpoint and identifiers from the
  // project-scoped one, so neither call crosses the tenancy boundary — see
  // smartdoc_context/domain-model.md.
  const { customer } = useCustomer();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [identifiers, setIdentifiers] = useState<Identifier[]>([]);

  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingIdentifiers, setLoadingIdentifiers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [search, setSearch] = useState("");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Closing is one-way from this screen — reopening a closed identifier is
  // done from the assignment screen, not here.
  const [closingId, setClosingId] = useState<number | null>(null);
  const [pendingClose, setPendingClose] = useState<Identifier | null>(null);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newIdentifierValue, setNewIdentifierValue] = useState("");
  const [creating, setCreating] = useState(false);

  const [selectedIdentifier, setSelectedIdentifier] = useState<Identifier | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editIdentifierValue, setEditIdentifierValue] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((p) => String(p.project_id) === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  // What the selected project calls an identifier — "Folio Number", "MR
  // Number", etc. Already on the project row, so no extra fetch needed.
  const identifierLabel = selectedProject?.identifier_label || "Identifier";

  const filteredIdentifiers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return identifiers;
    return identifiers.filter(
      (i) =>
        i.identifier_value.toLowerCase().includes(query) ||
        String(i.identifier_id).includes(query)
    );
  }, [identifiers, search]);

  const totalPages = Math.max(1, Math.ceil(filteredIdentifiers.length / pageSize));

  const pagedIdentifiers = useMemo(
    () => filteredIdentifiers.slice((page - 1) * pageSize, page * pageSize),
    [filteredIdentifiers, page, pageSize]
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
      // Land on a project so the screen isn't empty on arrival.
      setSelectedProjectId((prev) =>
        prev || (result.length > 0 ? String(result[0].project_id) : "")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoadingProjects(false);
    }
  };

  const loadIdentifiers = async () => {
    if (!selectedProjectId) {
      setIdentifiers([]);
      return;
    }
    setLoadingIdentifiers(true);
    setError(null);
    try {
      const token = await authService.ensureValidToken();
      const result = await documentService.getIdentifiers(Number(selectedProjectId), token);
      setIdentifiers(result.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load identifiers");
    } finally {
      setLoadingIdentifiers(false);
    }
  };

  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer]);

  useEffect(() => {
    loadIdentifiers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  /**
   * Release a sequencing lock somebody left open.
   *
   * Only that kind. A file held by an assignment is released by the
   * assignment's own workflow — finished, handed over or cancelled — and
   * the server refuses this on one, so the flag and the assignment can
   * never disagree.
   */
  const confirmRelease = async () => {
    if (!pendingClose) return;
    const i = pendingClose;

    setPendingClose(null);
    setClosingId(i.identifier_id);
    try {
      const token = await authService.ensureValidToken();
      const updated = await documentService.closeSequencing(i.identifier_id, token);
      setIdentifiers((prev) =>
        prev.map((row) => (row.identifier_id === i.identifier_id ? updated : row))
      );
      setToast({ message: `"${i.identifier_value}" released`, type: "success" });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to release the identifier",
        type: "error",
      });
    } finally {
      setClosingId(null);
    }
  };

  const openEdit = (i: Identifier) => {
    setSelectedIdentifier(i);
    setEditIdentifierValue(i.identifier_value);
    setIsEditOpen(true);
  };

  const handleAddIdentifier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;

    if (!newIdentifierValue.trim()) {
      setToast({ message: `${identifierLabel} is required`, type: "error" });
      return;
    }

    setCreating(true);
    try {
      const token = await authService.ensureValidToken();
      await documentService.createIdentifier(
        newIdentifierValue.trim(),
        Number(selectedProjectId),
        token
      );
      setToast({ message: `"${newIdentifierValue.trim()}" created successfully`, type: "success" });
      setIsAddOpen(false);
      setNewIdentifierValue("");
      loadIdentifiers();
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to create identifier",
        type: "error",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleEditIdentifier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIdentifier || !editIdentifierValue.trim()) return;

    setSavingEdit(true);
    try {
      const token = await authService.ensureValidToken();
      await documentService.updateIdentifier(
        selectedIdentifier.identifier_id,
        editIdentifierValue.trim(),
        selectedIdentifier.project_id,
        selectedIdentifier.open,
        token
      );
      setToast({ message: "Identifier updated successfully", type: "success" });
      setIsEditOpen(false);
      loadIdentifiers();
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to update identifier",
        type: "error",
      });
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 w-full bg-gray-50 dark:bg-gray-900 overflow-hidden min-w-0 min-h-0">
      <PageMeta title="Identifiers | SmartDoc" description="Manage identifiers across this customer's projects" />

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
                placeholder="Search identifiers..."
                className="h-9 w-full rounded-lg border border-gray-200 bg-transparent py-2 pl-9 pr-3 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
              />
            </div>
          </div>
          <Button size="xs" disabled={!selectedProjectId} onClick={() => setIsAddOpen(true)}>
            Add New Identifier
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
                {identifierLabel}
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Status
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Actions
              </TableCell>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loadingProjects ? (
              <TableRow>
                <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={4}>
                  Loading projects...
                </TableCell>
              </TableRow>
            ) : projects.length === 0 ? (
              <TableRow>
                <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={4}>
                  No projects found for this customer
                </TableCell>
              </TableRow>
            ) : !selectedProjectId ? (
              <TableRow>
                <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={4}>
                  Select a project to view its identifiers
                </TableCell>
              </TableRow>
            ) : loadingIdentifiers ? (
              <TableRow>
                <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={4}>
                  Loading identifiers...
                </TableCell>
              </TableRow>
            ) : filteredIdentifiers.length === 0 ? (
              <TableRow>
                <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={4}>
                  {identifiers.length === 0
                    ? "No identifiers found for this project"
                    : "No identifiers match your search"}
                </TableCell>
              </TableRow>
            ) : (
              pagedIdentifiers.map((i) => {
                const lock = Number(i.open) || IdentifierLock.FREE;
                const sequencing = lock === IdentifierLock.SEQUENCING;
                return (
                  <TableRow key={i.identifier_id}>
                    <TableCell className="px-4 py-4 text-sm text-gray-700 dark:text-gray-300">
                      {i.identifier_id}
                    </TableCell>
                    <TableCell className="px-4 py-4 text-sm text-gray-800 dark:text-white/90">
                      {i.identifier_value}
                    </TableCell>
                    {/* What holds this file, if anything. "Open" here means
                        open for editing by somebody — taken, not available. */}
                    <TableCell className="px-4 py-4 text-sm">
                      <span className="flex items-center gap-2">
                        <Badge
                          size="sm"
                          color={
                            lock === IdentifierLock.FREE
                              ? "light"
                              : sequencing
                                ? "warning"
                                : "info"
                          }
                        >
                          {lock === IdentifierLock.FREE
                            ? "Free"
                            : sequencing
                              ? "Being sequenced"
                              : "Being captured"}
                        </Badge>
                        {lock !== IdentifierLock.FREE && i.opened_at && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            since {new Date(i.opened_at).toLocaleString()}
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-4 text-sm">
                      <div className="flex items-center gap-1">
                        {/* Only a sequencing lock. A file held by an
                            assignment ends with that batch — finished,
                            handed over or cancelled — and there is
                            deliberately no way to force it from here. */}
                        {sequencing && (
                          <button
                            type="button"
                            title="Release — somebody left this open for sequencing"
                            disabled={closingId === i.identifier_id}
                            onClick={() => setPendingClose(i)}
                            className="p-1.5 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                          >
                            {closingId === i.identifier_id ? (
                              <span className="block size-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                            ) : (
                              <LockIcon className="size-4" />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          title="Edit identifier"
                          onClick={() => openEdit(i)}
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
      {!loadingProjects && !loadingIdentifiers && selectedProjectId && (
        <div className="flex-shrink-0">
          <Pagination
            currentPage={page}
            totalItems={filteredIdentifiers.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemLabel="identifiers"
          />
        </div>
      )}

      {/* Add New Identifier modal */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} className="max-w-md p-6">
        <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90">Add New Identifier</h3>
        <form onSubmit={handleAddIdentifier} className="space-y-4">
          <div>
            <Label htmlFor="identifier_value">{identifierLabel} *</Label>
            <Input
              id="identifier_value"
              value={newIdentifierValue}
              onChange={(e) => setNewIdentifierValue(e.target.value)}
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Will be created under{" "}
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {selectedProject?.project_name}
            </span>
            , and starts open so documents can be uploaded against it.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button size="xs" type="button" variant="outline" onClick={() => setIsAddOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button size="xs" type="submit" disabled={creating}>
              {creating ? "Creating..." : "Create Identifier"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit identifier modal */}
      <Modal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} className="max-w-md p-6">
        <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90">Edit Identifier</h3>
        <form onSubmit={handleEditIdentifier} className="space-y-4">
          <div>
            <Label htmlFor="edit-identifier-value">{identifierLabel} *</Label>
            <Input
              id="edit-identifier-value"
              value={editIdentifierValue}
              onChange={(e) => setEditIdentifierValue(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button size="xs" type="button" variant="outline" onClick={() => setIsEditOpen(false)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button size="xs" type="submit" disabled={savingEdit}>
              {savingEdit ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Releasing somebody else's sequencing lock */}
      <Modal isOpen={!!pendingClose} onClose={() => setPendingClose(null)} className="max-w-sm p-6">
        <h3 className="mb-2 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          Release {pendingClose?.identifier_value}?
        </h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          Somebody has this open on the Sequencing screen. Releasing it frees the file to be
          captured or sequenced — anything they have not saved is lost.
        </p>
        <div className="flex justify-end gap-3">
          <Button size="xs" type="button" variant="outline" onClick={() => setPendingClose(null)}>
            Cancel
          </Button>
          <Button size="xs" type="button" onClick={confirmRelease}>
            Release
          </Button>
        </div>
      </Modal>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} position="top-center" />
      )}
    </div>
  );
}
