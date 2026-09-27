import { useEffect, useMemo, useState } from "react";
import PageMeta from "../components/common/PageMeta";
import Toast from "../components/common/Toast";
import { Modal } from "../components/ui/modal";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../components/ui/table";
import Button from "../components/ui/button/Button";
import Label from "../components/form/Label";
import Input from "../components/form/input/InputField";
import { PencilIcon, LockIcon, CheckCircleIcon, CloseLineIcon, CopyIcon } from "../icons";
import { useCustomer } from "../context/CustomerContext";
import { authService } from "../services/authService";
import { storageService } from "../services/storageService";
import type { Storage as StorageRow, StorageProvider } from "../services/storageService";

// Matches customer_storage's column widths.
const MAX_NAME_CHARS = 100;
const MAX_BUCKET_CHARS = 100;

// The folder every storage sits under. Only the folder is stored — the API
// appends the storage's own id to reach the secret. Editable, because a
// customer whose credentials live elsewhere in Vault is a row change rather
// than a code change.
const DEFAULT_VAULT_FOLDER = "kv/data/smartdoc_storage";

const PROVIDER_OPTIONS: { value: StorageProvider; label: string }[] = [
  { value: "minio", label: "MinIO (self-hosted)" },
  { value: "aws", label: "Amazon S3" },
];

const emptyForm = {
  storage_name: "",
  storage_provider: "minio" as StorageProvider,
  s3_bucket: "",
  s3_endpoint: "",
  s3_region: "us-east-1",
  vault_path: DEFAULT_VAULT_FOLDER,
};

type FormErrors = Partial<Record<keyof typeof emptyForm, string>>;

// Whether a storage's keys are in Vault. Checked per row, because a storage
// row can exist before anyone has written its secret — that is the normal
// order of things, not an error.
type CredentialState = { status: "checking" | "ok" | "missing" | "error"; reason?: string };

export default function Storage({
  customerId,
  // A heading for the header row, when this list sits inside another
  // screen (the system administrator's customer pane) and needs to say
  // what it is. On its own page the sidebar already says so.
  title,
}: {
  customerId?: number;
  title?: string;
}) {
  // Customer-level screen: storages belong to a customer, and each project
  // picks one at setup. No project picker here.
  // Whose customer this screen is about. The customer in context when one
  // of its own people is using it; named outright when a system
  // administrator is, from /sys — where there is no customer in context at
  // all, by design.
  const { customer: contextCustomer } = useCustomer();
  // Held steady: built fresh on every render it was a new object each time,
  // so every effect that depends on it ran again, which fetched, which
  // rendered — the screen flickered and the network tab filled up.
  const customer = useMemo(
    () =>
      customerId
        ? ({ ...contextCustomer, customer_id: customerId } as typeof contextCustomer)
        : contextCustomer,
    [contextCustomer, customerId],
  );

  const [storages, setStorages] = useState<StorageRow[]>([]);
  const [credentials, setCredentials] = useState<Record<number, CredentialState>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [search, setSearch] = useState("");

  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [pendingToggle, setPendingToggle] = useState<{ storage: StorageRow; nextActive: 0 | 1 } | null>(null);

  // One form drives both create and edit — `editingStorage` distinguishes them.
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingStorage, setEditingStorage] = useState<StorageRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  // Credentials are a separate step from the row itself: the Vault path is
  // built from the id, so it cannot be known until the row exists.
  const [keysFor, setKeysFor] = useState<StorageRow | null>(null);
  const [keyForm, setKeyForm] = useState({ access: "", secret: "" });
  const [savingKeys, setSavingKeys] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  const filteredStorages = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return storages;
    return storages.filter(
      (s) =>
        s.storage_name.toLowerCase().includes(query) ||
        s.s3_bucket.toLowerCase().includes(query) ||
        (s.s3_endpoint || "").toLowerCase().includes(query) ||
        String(s.customer_storage_id).includes(query)
    );
  }, [storages, search]);

  const checkCredentials = async (storage: StorageRow) => {
    setCredentials((prev) => ({ ...prev, [storage.customer_storage_id]: { status: "checking" } }));
    try {
      const token = await authService.ensureValidToken();
      const verdict = await storageService.verifyStorage(storage.customer_storage_id, token);
      setCredentials((prev) => ({
        ...prev,
        [storage.customer_storage_id]: verdict.ok
          ? { status: "ok" }
          : { status: "missing", reason: verdict.reason || undefined },
      }));
    } catch (err) {
      setCredentials((prev) => ({
        ...prev,
        [storage.customer_storage_id]: {
          status: "error",
          reason: err instanceof Error ? err.message : "Check failed",
        },
      }));
    }
  };

  const loadStorages = async () => {
    if (!customer) return;
    setLoading(true);
    setError(null);
    try {
      const token = await authService.ensureValidToken();
      const result = await storageService.getStoragesByCustomer(customer.customer_id, token);
      setStorages(result);
      // Each row's credentials are checked on its own so one unreachable path
      // doesn't blank the whole table.
      result.forEach((s) => checkCredentials(s));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load storages");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStorages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer]);

  const openCreate = () => {
    setEditingStorage(null);
    setForm(emptyForm);
    setErrors({});
    setIsFormOpen(true);
  };

  const openEdit = (s: StorageRow) => {
    setEditingStorage(s);
    setForm({
      storage_name: s.storage_name,
      storage_provider: s.storage_provider,
      s3_bucket: s.s3_bucket,
      s3_endpoint: s.s3_endpoint || "",
      s3_region: s.s3_region,
      vault_path: s.vault_path,
    });
    setErrors({});
    setIsFormOpen(true);
  };

  const openKeys = (s: StorageRow) => {
    setKeysFor(s);
    setKeyForm({ access: "", secret: "" });
    setKeyError(null);
  };

  const validate = (): FormErrors => {
    const next: FormErrors = {};
    const name = form.storage_name.trim();
    const bucket = form.s3_bucket.trim();
    const endpoint = form.s3_endpoint.trim();

    if (!name) {
      next.storage_name = "Name is required";
    } else if (name.length > MAX_NAME_CHARS) {
      next.storage_name = `Must be ${MAX_NAME_CHARS} characters or fewer`;
    } else if (
      storages.some(
        (s) =>
          s.storage_name.trim().toLowerCase() === name.toLowerCase() &&
          s.customer_storage_id !== editingStorage?.customer_storage_id
      )
    ) {
      next.storage_name = "This customer already has a storage with that name";
    }

    if (!bucket) {
      next.s3_bucket = "Bucket is required";
    } else if (bucket.length > MAX_BUCKET_CHARS) {
      next.s3_bucket = `Must be ${MAX_BUCKET_CHARS} characters or fewer`;
    }

    if (!form.s3_region.trim()) {
      next.s3_region = "Region is required — both SDKs demand one, even MinIO";
    }

    // MinIO has nothing to derive an endpoint from; AWS derives it from the
    // region, and an endpoint there would override it wrongly.
    if (form.storage_provider === "minio" && !endpoint) {
      next.s3_endpoint = "Required for MinIO — the address of your S3 server";
    }

    if (!form.vault_path.trim()) {
      next.vault_path = "Vault folder is required";
    } else if (!form.vault_path.trim().includes("/data/")) {
      // The commonest mistake by far: the CLI writes kv/x, the API reads
      // kv/data/x. Catch it here rather than as a 404 from Vault later.
      next.vault_path = 'Must include "/data/" — the API reads kv/data/…, even though the CLI writes kv/…';
    }

    return next;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) return;

    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const payload = {
      customer_id: customer.customer_id,
      storage_name: form.storage_name.trim(),
      storage_provider: form.storage_provider,
      s3_bucket: form.s3_bucket.trim(),
      // Deliberately null rather than "" for AWS: the SDK treats an empty
      // endpoint as a real one and fails to sign.
      s3_endpoint: form.storage_provider === "minio" ? form.s3_endpoint.trim() : null,
      s3_region: form.s3_region.trim(),
      vault_path: form.vault_path.trim(),
      is_active: (editingStorage ? editingStorage.is_active : 1) as 0 | 1,
    };

    setSaving(true);
    try {
      const token = await authService.ensureValidToken();
      if (editingStorage) {
        const updated = await storageService.updateStorage(
          { ...payload, customer_storage_id: editingStorage.customer_storage_id },
          token
        );
        setToast({ message: "Storage updated successfully", type: "success" });
        setIsFormOpen(false);
        await loadStorages();
        if (updated) checkCredentials(updated);
      } else {
        const created = await storageService.createStorage(payload, token);
        setToast({ message: `"${payload.storage_name}" created — now add its keys`, type: "success" });
        setIsFormOpen(false);
        await loadStorages();
        // Storing the keys is the required next step, and the resolved path
        // only exists now that the row does. Go straight there.
        if (created) openKeys(created);
      }
    } catch (err) {
      setToast({
        message:
          err instanceof Error
            ? err.message
            : `Failed to ${editingStorage ? "update" : "create"} storage`,
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keysFor) return;

    if (!keyForm.access.trim() || !keyForm.secret.trim()) {
      setKeyError("Both the access key and the secret key are required");
      return;
    }

    setSavingKeys(true);
    setKeyError(null);
    try {
      const token = await authService.ensureValidToken();
      await storageService.setCredentials(
        keysFor.customer_storage_id,
        keyForm.access.trim(),
        keyForm.secret.trim(),
        token
      );
      setToast({ message: `Keys stored for "${keysFor.storage_name}"`, type: "success" });
      const saved = keysFor;
      setKeysFor(null);
      setKeyForm({ access: "", secret: "" });
      checkCredentials(saved);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : "Failed to store credentials");
    } finally {
      setSavingKeys(false);
    }
  };

  const toggleActive = (s: StorageRow) => {
    setPendingToggle({ storage: s, nextActive: s.is_active === 1 ? 0 : 1 });
  };

  const confirmToggleActive = async () => {
    if (!pendingToggle) return;
    const { storage: s, nextActive } = pendingToggle;

    setPendingToggle(null);
    setTogglingId(s.customer_storage_id);
    try {
      const token = await authService.ensureValidToken();
      await storageService.updateStorage(
        { customer_storage_id: s.customer_storage_id, is_active: nextActive },
        token
      );
      setStorages((prev) =>
        prev.map((row) =>
          row.customer_storage_id === s.customer_storage_id ? { ...row, is_active: nextActive } : row
        )
      );
      setToast({
        message: `Storage "${s.storage_name}" ${nextActive === 1 ? "enabled" : "disabled"} successfully`,
        type: "success",
      });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to update storage",
        type: "error",
      });
    } finally {
      setTogglingId(null);
    }
  };

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setToast({ message: "Path copied", type: "info" });
  };

  const resolvedPath = (s: StorageRow) =>
    s.resolved_vault_path || `${s.vault_path.replace(/\/+$/, "")}/${s.customer_storage_id}`;

  // What an operator types into the Vault CLI: it omits the "data/" segment
  // that the HTTP API requires.
  const cliPath = (s: StorageRow) => resolvedPath(s).replace("/data/", "/");

  return (
    <div className="flex flex-col flex-1 w-full bg-gray-50 dark:bg-gray-900 overflow-hidden min-w-0 min-h-0">
      <PageMeta title="Storage | SmartDoc" description="Where this customer's documents are stored" />

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 min-w-0 flex-shrink-0 overflow-hidden w-full">
        <div className="flex items-center justify-between gap-4 w-full">
          <div className="flex items-center gap-3 min-w-0">
            {title && (
              <h3 className="flex-shrink-0 text-base font-semibold text-gray-800 dark:text-white/90">
                {title}
              </h3>
            )}
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
                placeholder="Search storages..."
                className="h-9 w-full rounded-lg border border-gray-200 bg-transparent py-2 pl-9 pr-3 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
              />
            </div>
          </div>
          <Button size="xs" disabled={!customer} onClick={openCreate}>
            Add New Storage
          </Button>
        </div>
        {error && <Toast message={error} type="error" onClose={() => setError(null)} />}
      </div>

      {/* Body */}
      <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 w-full overflow-auto flex-1 min-w-0">
        <Table>
          <TableHeader className="border-b border-gray-100 dark:border-gray-800">
            <TableRow>
              {["ID", "Name", "Provider", "Bucket", "Endpoint", "Region", "Keys", "Actions"].map((h) => (
                <TableCell
                  key={h}
                  isHeader
                  className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400"
                >
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading ? (
              <TableRow>
                <TableCell className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400" colSpan={8}>
                  Loading storages...
                </TableCell>
              </TableRow>
            ) : filteredStorages.length === 0 ? (
              <TableRow>
                <TableCell className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400" colSpan={8}>
                  {storages.length === 0
                    ? "No storage configured yet — add one to say where this customer's documents live"
                    : "No storages match your search"}
                </TableCell>
              </TableRow>
            ) : (
              filteredStorages.map((s) => {
                const isEnabled = s.is_active === 1;
                const creds = credentials[s.customer_storage_id];
                return (
                  <TableRow key={s.customer_storage_id}>
                    <TableCell className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">
                      {s.customer_storage_id}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-sm text-gray-800 dark:text-white/90">
                      {s.storage_name}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">
                      {s.storage_provider === "minio" ? "MinIO" : "Amazon S3"}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">
                      {s.s3_bucket}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">
                      <span title={s.s3_endpoint || undefined} className="block max-w-xs truncate">
                        {s.s3_endpoint || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">
                      {s.s3_region}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-sm">
                      {/* Whether the secret exists in Vault. Click to re-check. */}
                      <button
                        type="button"
                        onClick={() => checkCredentials(s)}
                        title={creds?.reason || "Check again"}
                        className="text-xs underline-offset-2 hover:underline"
                      >
                        {!creds || creds.status === "checking" ? (
                          <span className="text-gray-400">Checking...</span>
                        ) : creds.status === "ok" ? (
                          <span className="text-success-500">Stored</span>
                        ) : creds.status === "missing" ? (
                          <span className="text-warning-500">Not set</span>
                        ) : (
                          <span className="text-red-500">Check failed</span>
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-sm">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title={isEnabled ? "Disable storage" : "Enable storage"}
                          disabled={togglingId === s.customer_storage_id}
                          onClick={() => toggleActive(s)}
                          className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/[0.05] disabled:opacity-50 ${
                            isEnabled ? "text-success-500" : "text-gray-400"
                          }`}
                        >
                          {togglingId === s.customer_storage_id ? (
                            <span className="block size-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                          ) : isEnabled ? (
                            <CheckCircleIcon className="size-4" />
                          ) : (
                            <CloseLineIcon className="size-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          title="Set access keys"
                          onClick={() => openKeys(s)}
                          className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                        >
                          <LockIcon className="size-4" />
                        </button>
                        <button
                          type="button"
                          title="Edit storage"
                          onClick={() => openEdit(s)}
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

      {/* Create / edit modal */}
      <Modal isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} className="max-w-2xl p-6">
        <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90">
          {editingStorage ? "Edit Storage" : "Add New Storage"}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="storage_name">Name *</Label>
            <Input
              id="storage_name"
              placeholder="Primary"
              value={form.storage_name}
              error={!!errors.storage_name}
              hint={errors.storage_name}
              onChange={(e) => setForm({ ...form, storage_name: e.target.value })}
            />
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              What you'll see when picking storage for a project.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="storage_provider">Provider *</Label>
              <select
                id="storage_provider"
                value={form.storage_provider}
                onChange={(e) =>
                  setForm({ ...form, storage_provider: e.target.value as StorageProvider })
                }
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:focus:border-brand-800"
              >
                {PROVIDER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="dark:bg-gray-900">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="s3_region">Region *</Label>
              <Input
                id="s3_region"
                placeholder="us-east-1"
                value={form.s3_region}
                error={!!errors.s3_region}
                hint={errors.s3_region}
                onChange={(e) => setForm({ ...form, s3_region: e.target.value })}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="s3_bucket">Bucket *</Label>
            <Input
              id="s3_bucket"
              placeholder="smartdoc"
              value={form.s3_bucket}
              error={!!errors.s3_bucket}
              hint={errors.s3_bucket}
              onChange={(e) => setForm({ ...form, s3_bucket: e.target.value })}
            />
          </div>

          {form.storage_provider === "minio" && (
            <div>
              <Label htmlFor="s3_endpoint">Endpoint *</Label>
              <Input
                id="s3_endpoint"
                placeholder="https://s3.example.com"
                value={form.s3_endpoint}
                error={!!errors.s3_endpoint}
                hint={errors.s3_endpoint}
                onChange={(e) => setForm({ ...form, s3_endpoint: e.target.value })}
              />
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                The public address of the S3 server. Browsers upload straight to it, so it has to be
                reachable from outside and carry a valid certificate.
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="vault_path">Vault folder *</Label>
            <Input
              id="vault_path"
              placeholder={DEFAULT_VAULT_FOLDER}
              value={form.vault_path}
              error={!!errors.vault_path}
              hint={errors.vault_path}
              onChange={(e) => setForm({ ...form, vault_path: e.target.value })}
            />
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              Where the access keys are kept. Only the folder goes here — this storage's own ID is
              added on the end, so each storage gets its own secret.
              {editingStorage && (
                <>
                  {" "}
                  This one resolves to{" "}
                  <code className="text-gray-700 dark:text-gray-300">
                    {form.vault_path.replace(/\/+$/, "")}/{editingStorage.customer_storage_id}
                  </code>
                  .
                </>
              )}
            </p>
          </div>

          {!editingStorage && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              You'll be asked for the access keys next — they can only be stored once this storage
              exists and has an ID.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button size="xs" type="button" variant="outline" onClick={() => setIsFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="xs" type="submit" disabled={saving}>
              {saving
                ? editingStorage
                  ? "Saving..."
                  : "Creating..."
                : editingStorage
                ? "Save"
                : "Create Storage"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Access keys modal */}
      <Modal isOpen={!!keysFor} onClose={() => setKeysFor(null)} className="max-w-xl p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
          Access keys{keysFor ? ` — ${keysFor.storage_name}` : ""}
        </h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          Stored in Vault, never in the database, and never shown again once saved.
        </p>

        <form onSubmit={handleSaveKeys} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="s3_access_key">Access key *</Label>
            <Input
              id="s3_access_key"
              value={keyForm.access}
              onChange={(e) => setKeyForm({ ...keyForm, access: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="s3_secret_key">Secret key *</Label>
            <Input
              id="s3_secret_key"
              type="password"
              value={keyForm.secret}
              onChange={(e) => setKeyForm({ ...keyForm, secret: e.target.value })}
            />
          </div>

          {keysFor && (
            <div className="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-white/[0.03]">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Saved to <code className="text-gray-700 dark:text-gray-300">{resolvedPath(keysFor)}</code>
                <button
                  type="button"
                  onClick={() => copyPath(resolvedPath(keysFor))}
                  title="Copy path"
                  className="ml-1.5 align-middle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <CopyIcon className="inline size-3.5" />
                </button>
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Same thing from the command line:{" "}
                <code className="text-gray-700 dark:text-gray-300">vault kv put {cliPath(keysFor)} …</code>
              </p>
            </div>
          )}

          {keyError && <Toast message={keyError} type="error" onClose={() => setKeyError(null)} />}

          <div className="flex justify-end gap-3 pt-2">
            <Button size="xs" type="button" variant="outline" onClick={() => setKeysFor(null)} disabled={savingKeys}>
              Cancel
            </Button>
            <Button size="xs" type="submit" disabled={savingKeys}>
              {savingKeys ? "Saving..." : "Save Keys"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Enable/disable confirmation dialog */}
      <Modal isOpen={!!pendingToggle} onClose={() => setPendingToggle(null)} className="max-w-sm p-6">
        <h3 className="mb-2 text-lg font-semibold text-gray-800 dark:text-white/90">
          {pendingToggle?.nextActive === 0 ? "Disable storage?" : "Enable storage?"}
        </h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          {pendingToggle?.nextActive === 0
            ? `"${pendingToggle?.storage.storage_name}" will no longer be offered when setting up a project. Projects already using it are unaffected.`
            : `"${pendingToggle?.storage.storage_name}" will be available when setting up a project again.`}
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
