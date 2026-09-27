import { useEffect, useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import Toast from "../../components/common/Toast";
import { Modal } from "../../components/ui/modal";
import Button from "../../components/ui/button/Button";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../../components/ui/table";
import { LockIcon, PencilIcon } from "../../icons";
import {
  modelCatalogueService,
  CatalogueModel,
  providerNeedsKey,
} from "../../services/modelCatalogueService";

const emptyModel = {
  provider: "",
  model_name: "",
  display_name: "",
  endpoint: "",
  is_offered: 1 as 0 | 1,
};

/**
 * Every model SmartDoc can use, for both the categoriser and OCR.
 *
 * One catalogue rather than a setting in each service: a customer chooses
 * from this list, a project may differ, and neither ever sees a key — the
 * keys are SmartDoc's, stored in Vault the way storage credentials are.
 *
 * A row here says what a model IS. It does not say what it is for: the
 * same model can categorise for one customer and read for another, and
 * that choice belongs on their screen, not on this one.
 *
 * Retiring a model is "not offered", not deletion: it disappears from the
 * choosers and keeps working for the projects already pointing at it.
 */
export default function SystemModels() {
  const [models, setModels] = useState<CatalogueModel[]>([]);
  const [keyState, setKeyState] = useState<Map<number, boolean>>(new Map());
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogueModel | null>(null);
  const [form, setForm] = useState(emptyModel);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");

  const [keyFor, setKeyFor] = useState<CatalogueModel | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await modelCatalogueService.list();
      setModels(rows);
      // Whether each has a usable key, asked one by one: the answer comes
      // from Vault and is not on the row.
      const checked = await Promise.all(
        rows.map(async (m) => {
          try {
            const verdict = await modelCatalogueService.verifyKey(m.model_id);
            return [m.model_id, verdict.ok] as const;
          } catch {
            return [m.model_id, false] as const;
          }
        }),
      );
      setKeyState(new Map(checked));
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Failed to load", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm(emptyModel);
    setIsFormOpen(true);
  };

  const openEdit = (m: CatalogueModel) => {
    setEditing(m);
    setForm({
      provider: m.provider,
      model_name: m.model_name,
      display_name: m.display_name,
      endpoint: m.endpoint ?? "",
      is_offered: m.is_offered,
    });
    setIsFormOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        provider: form.provider.trim(),
        model_name: form.model_name.trim(),
        display_name: form.display_name.trim(),
        endpoint: form.endpoint.trim(),
        is_offered: form.is_offered,
      };
      const saved = editing
        ? await modelCatalogueService.update({ ...payload, model_id: editing.model_id })
        : await modelCatalogueService.create(payload);
      setIsFormOpen(false);
      setToast({ message: `"${saved.display_name}" saved`, type: "success" });
      // A new model has no key yet, so the keys dialog opens straight away —
      // the same order the storage screen uses, and for the same reason.
      // Unless the engine runs inside SmartDoc, in which case there is no
      // key to ask for and asking would look like a fault.
      if (!editing && providerNeedsKey(saved.provider)) {
        setKeyFor(saved);
        setApiKey("");
      }
      await load();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Failed to save", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const saveKey = async () => {
    if (!keyFor) return;
    setSavingKey(true);
    try {
      await modelCatalogueService.setKey(keyFor.model_id, apiKey);
      setToast({ message: `Key stored for "${keyFor.display_name}"`, type: "success" });
      setKeyFor(null);
      setApiKey("");
      await load();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Failed to store", type: "error" });
    } finally {
      setSavingKey(false);
    }
  };

  const term = search.trim().toLowerCase();
  const shown = term
    ? models.filter((m) =>
        [m.display_name, m.model_name, m.provider].some((f) => f.toLowerCase().includes(term)),
      )
    : models;

  const toggleOffered = async (m: CatalogueModel) => {
    try {
      await modelCatalogueService.update({
        model_id: m.model_id,
        is_offered: m.is_offered === 1 ? 0 : 1,
      });
      await load();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Failed to save", type: "error" });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50 dark:bg-gray-900">
      <PageMeta title="AI Models | SmartDoc System Admin" description="The models SmartDoc can use" />

      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-4 py-2.5 dark:border-gray-800 dark:bg-gray-800">
        <div className="w-56">
          <Input
            compact
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, model id, provider"
          />
        </div>

        <span className="ml-auto flex items-center gap-3">
          {term !== "" && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {shown.length} of {models.length}
            </span>
          )}
          <Button size="xs" onClick={openNew}>
            Add model
          </Button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <Table>
            <TableHeader className="border-b border-gray-100 dark:border-gray-800">
              <TableRow>
                {["Name", "Model id", "Provider", "Key", "Offered", ""].map((h, i) => (
                  <TableCell
                    key={h || i}
                    isHeader
                    className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400"
                  >
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                <TableRow>
                  <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={6}>
                    Loading...
                  </TableCell>
                </TableRow>
              ) : shown.length === 0 ? (
                <TableRow>
                  <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={6}>
                    {term !== ""
                      ? "No model matches that."
                      : "No models yet. Add one, give it a key, and customers can choose it."}
                  </TableCell>
                </TableRow>
              ) : (
                shown.map((m) => (
                  <TableRow
                    key={m.model_id}
                    className="transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                  >
                    <TableCell className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-800 dark:text-white/90">
                      {m.display_name}
                    </TableCell>
                    {/* What the provider is actually sent, kept in its own
                        column: it is the field a wrong character breaks. */}
                    <TableCell className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                      {m.model_name}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {m.provider}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-3 text-sm">
                      {!providerNeedsKey(m.provider) ? (
                        <span className="text-gray-500 dark:text-gray-400">Not needed</span>
                      ) : keyState.get(m.model_id) ? (
                        <span className="text-success-600 dark:text-success-500">Stored</span>
                      ) : (
                        <span className="text-warning-600 dark:text-warning-500">Not set</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-3 text-sm">
                      {/* Not offered is how a model is retired: it leaves the
                          choosers and keeps working for whoever points at it. */}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={m.is_offered === 1}
                        onClick={() => toggleOffered(m)}
                        className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${
                          m.is_offered === 1 ? "bg-success-500" : "bg-gray-300 dark:bg-gray-600"
                        }`}
                      >
                        <span
                          className={`block size-4 rounded-full bg-white shadow-theme-xs transition-transform ${
                            m.is_offered === 1 ? "translate-x-4" : ""
                          }`}
                        />
                      </button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-3 text-right text-sm">
                      <span className="flex items-center justify-end gap-1">
                        {providerNeedsKey(m.provider) && (
                          <button
                            type="button"
                            title="Set the API key"
                            onClick={() => {
                              setKeyFor(m);
                              setApiKey("");
                            }}
                            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                          >
                            <LockIcon className="size-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          title="Edit"
                          onClick={() => openEdit(m)}
                          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                        >
                          <PencilIcon className="size-4" />
                        </button>
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Adding or editing a row */}
      <Modal isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} className="max-w-md p-6">
        <h3 className="mb-5 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          {editing ? `Edit ${editing.display_name}` : "Add a model"}
        </h3>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="display_name">Name *</Label>
              <Input
                id="display_name"
                compact
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder="GPT-4o"
              />
            </div>
            <div>
              <Label htmlFor="provider">Provider *</Label>
              <Input
                id="provider"
                compact
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                placeholder="openai"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="model_name">Model id *</Label>
            <Input
              id="model_name"
              compact
              value={form.model_name}
              onChange={(e) => setForm({ ...form, model_name: e.target.value })}
              placeholder="gpt-4o"
            />
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              Exactly what the provider is sent. The name above is what people read.
            </p>
          </div>

          <div>
            <Label htmlFor="endpoint">Address *</Label>
            <Input
              id="endpoint"
              compact
              value={form.endpoint}
              onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
              placeholder="https://api.openai.com/v1/chat/completions"
            />
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              Where this model answers, in full. SmartDoc sends the same kind of
              request to every provider, so this is the only thing that says
              which one it goes to.
            </p>
          </div>

          {/* The key is not a field on this form. It goes to Vault, not to
              the database, so it cannot be saved with the row — and a row
              has to exist before its Vault path does. Same reason, and the
              same order, as the storage screen.

              An engine that runs inside SmartDoc has no key at all, and
              this says so rather than showing a button that leads nowhere. */}
          <div className="rounded-lg border border-gray-200 px-3 py-2.5 dark:border-gray-700">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-white/90">API key</p>
                {!providerNeedsKey(form.provider) ? (
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    Not needed — this engine runs inside SmartDoc.
                  </p>
                ) : (
                  (!editing || keyState.get(editing.model_id)) && (
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {editing
                        ? "Stored in Vault. It is never shown again."
                        : "You will be asked for it as soon as this is saved."}
                    </p>
                  )
                )}
              </div>
              {editing && providerNeedsKey(form.provider) && (
                <Button
                  size="xs"
                  variant="outline"
                  startIcon={<LockIcon className="size-4" />}
                  onClick={() => {
                    setIsFormOpen(false);
                    setKeyFor(editing);
                    setApiKey("");
                  }}
                >
                  {keyState.get(editing.model_id) ? "Replace" : "Set key"}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <Button size="xs" variant="outline" onClick={() => setIsFormOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="xs"
            onClick={save}
            disabled={saving || !form.display_name.trim() || !form.model_name.trim()}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </Modal>

      {/* The key. Goes to Vault and never comes back. */}
      <Modal isOpen={!!keyFor} onClose={() => setKeyFor(null)} className="max-w-md p-6">
        <h3 className="mb-2 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          API key for {keyFor?.display_name}
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Stored in Vault, never in the database and never shown again. Customers choosing this model
          never see it.
        </p>

        <Label htmlFor="api-key">Key</Label>
        <Input
          id="api-key"
          compact
          type="text"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-…"
          className="font-mono"
        />

        <div className="mt-5 flex justify-end gap-3">
          <Button size="xs" variant="outline" onClick={() => setKeyFor(null)} disabled={savingKey}>
            Cancel
          </Button>
          <Button size="xs" onClick={saveKey} disabled={savingKey || apiKey.trim().length < 8}>
            {savingKey ? "Storing..." : "Store key"}
          </Button>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
