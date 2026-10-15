import { useCallback, useEffect, useState } from "react";
import Button from "../ui/button/Button";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import Checkbox from "../form/input/Checkbox";
import { Modal } from "../ui/modal";
import Toast from "../common/Toast";
import {
  modelCatalogueService,
  CatalogueModel,
  providerNeedsKey,
  isSmartDocModel,
  daysUntilRetired,
} from "../../services/modelCatalogueService";

const emptyModel = {
  provider: "",
  model_name: "",
  display_name: "",
  endpoint: "",
  // Both ticked for a new model, because most do both.
  can_read: 1 as 0 | 1,
  can_categorise: 1 as 0 | 1,
};

/**
 * The models this customer can use, and the ones they added themselves.
 *
 * **Two lists, because they behave differently.** SmartDoc's are read-only
 * here: SmartDoc decides which of them this customer may choose, and can
 * withdraw one. Their own are theirs — nobody else can see them, the key is
 * theirs, and only they can change or remove one.
 *
 * **Adding is off unless SmartDoc has agreed to it** (`can_add_models`).
 * The button is simply absent then; a disabled one would invite asking the
 * wrong person.
 */
export default function CustomerOwnModels({
  canAdd,
  customerName,
  onChanged,
}: {
  canAdd: boolean;
  /** Heads their own group — "POPO AI Models" rather than "Your models". */
  customerName?: string | null;
  /** So the dropdowns above reload when a model is added or removed. */
  onChanged?: () => void;
}) {
  const [models, setModels] = useState<CatalogueModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogueModel | null>(null);
  const [form, setForm] = useState(emptyModel);
  const [saving, setSaving] = useState(false);

  // The key is a second step, the same as a storage's: a model's Vault path
  // is built from its own id, so the row has to exist first.
  const [keyFor, setKeyFor] = useState<CatalogueModel | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setModels(await modelCatalogueService.offered());
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Could not load", type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      can_read: Number(m.can_read) === 1 ? 1 : 0,
      can_categorise: Number(m.can_categorise) === 1 ? 1 : 0,
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
        can_read: form.can_read,
        can_categorise: form.can_categorise,
      };
      const saved = editing
        ? await modelCatalogueService.update({ ...payload, model_id: editing.model_id })
        : await modelCatalogueService.create(payload);

      setIsFormOpen(false);
      setToast({ message: `"${saved.display_name}" saved`, type: "success" });

      // A new model has no key yet, so ask for one straight away — the same
      // order the storage screen uses, and for the same reason. Unless the
      // engine runs inside SmartDoc and has no key to ask for.
      if (!editing && providerNeedsKey(saved.provider)) {
        setKeyFor(saved);
        setApiKey("");
      }
      await load();
      onChanged?.();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Could not save", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const saveKey = async () => {
    if (!keyFor) return;
    setSavingKey(true);
    try {
      await modelCatalogueService.setKey(keyFor.model_id, apiKey);
      setKeyFor(null);
      setApiKey("");
      setToast({ message: "Key stored", type: "success" });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Could not store the key", type: "error" });
    } finally {
      setSavingKey(false);
    }
  };

  const smartdoc = models.filter(isSmartDocModel);
  const theirs = models.filter((m) => !isSmartDocModel(m));

  const Row = ({ m, own }: { m: CatalogueModel; own: boolean }) => {
    const days = daysUntilRetired(m);
    return (
      <li className="flex items-center gap-3 border-b border-gray-50 px-4 py-2.5 last:border-0 dark:border-gray-800/60">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-gray-800 dark:text-white/90">
            {m.display_name}
          </span>
          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
            {m.provider} · {m.model_name}
          </span>
        </span>

        {/* Only ever on SmartDoc's: a customer's own has no end date set by
            anybody but them, and they have not been given a way to set one. */}
        {days !== null && (
          <span
            className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              days < 0
                ? "bg-error-50 text-error-600 dark:bg-error-500/10 dark:text-error-500"
                : "bg-warning-50 text-warning-600 dark:bg-warning-500/10 dark:text-warning-500"
            }`}
            title={String(m.retires_on).slice(0, 10)}
          >
            {days < 0 ? "Retired" : days === 0 ? "Stops today" : `Stops in ${days}d`}
          </span>
        )}

        {own && (
          <span className="flex flex-shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setKeyFor(m);
                setApiKey("");
              }}
              title="Set the API key"
              className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                <path d="M12 1a5 5 0 0 0-5 5v4H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5Zm3 9H9V6a3 3 0 1 1 6 0v4Z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => openEdit(m)}
              title="Edit"
              className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                <path d="m14.06 9.02.92.92L5.92 19H5v-.92l9.06-9.06M17.66 3c-.25 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83a.996.996 0 0 0 0-1.41l-2.34-2.34c-.2-.2-.45-.29-.71-.29Zm-3.6 3.19L3 17.25V21h3.75L17.81 9.94l-3.75-3.75Z" />
              </svg>
            </button>
          </span>
        )}
      </li>
    );
  };

  /**
   * One card. **The height is fixed, not grown to fit** — the two sit side
   * by side, and a card that is as tall as its contents makes the shorter
   * one look like a mistake and moves everything under them every time a
   * model is added. Anything past the height scrolls inside the card.
   */
  const Card = ({
    title,
    action,
    items,
    empty,
    own,
  }: {
    title: string;
    action?: React.ReactNode;
    items: CatalogueModel[];
    empty: string;
    own: boolean;
  }) => (
    <div className="flex flex-col rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="flex min-h-[44px] items-center justify-between gap-2 border-b border-gray-100 px-4 py-2 dark:border-gray-800">
        <span className="text-sm font-medium text-gray-800 dark:text-white/90">{title}</span>
        {action}
      </div>

      {/* 18rem is about six rows. Scrolls below that, so the card keeps its
          height whether it holds one model or thirty. */}
      <div className="h-72 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">{empty}</p>
        ) : (
          <ul>
            {items.map((m) => (
              <Row key={m.model_id} m={m} own={own} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {loading ? (
        <p className="py-4 text-sm text-gray-400">Loading...</p>
      ) : (
        /* **Two cards side by side, not one list with edit buttons on some
            rows.** Which models are SmartDoc's and which are this
            customer's own is the difference that matters — SmartDoc's can be
            withdrawn or retired from under them, theirs cannot, and the key
            is theirs.

            One column on a narrow screen: two 50% columns of names and
            provider ids wrap onto three lines each on a phone. */
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title="SmartDoc AI Models"
            items={smartdoc}
            empty="SmartDoc has not given this customer any models yet."
            own={false}
          />

          <Card
            title={customerName ? `${customerName} AI Models` : "Your AI Models"}
            items={theirs}
            own
            empty={
              canAdd
                ? "None yet. Add one with the button above."
                : "SmartDoc has not allowed this customer to add their own models."
            }
            action={
              canAdd && (
                <Button
                  size="xs"
                  type="button"
                  variant="outline"
                  onClick={openNew}
                  startIcon={
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  }
                >
                  Add model
                </Button>
              )
            }
          />
        </div>
      )}

      {/* Adding a model. No retirement date here: that is SmartDoc's way of
          giving notice about its own models, and a customer needs no notice
          from itself. */}
      <Modal isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} className="max-w-md p-6">
        <h4 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
          {editing ? "Edit model" : "Add model"}
        </h4>

        <div className="space-y-3">
          <div>
            <Label htmlFor="own-display">Name *</Label>
            <Input
              id="own-display"
              compact
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              placeholder="What your people will read"
            />
          </div>
          <div>
            <Label htmlFor="own-provider">Provider *</Label>
            <Input
              id="own-provider"
              compact
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
              placeholder="openai, anthropic, google"
            />
          </div>
          <div>
            <Label htmlFor="own-model">Model id *</Label>
            <Input
              id="own-model"
              compact
              value={form.model_name}
              onChange={(e) => setForm({ ...form, model_name: e.target.value })}
              placeholder="gpt-4o"
            />
          </div>
          <div>
            <Label htmlFor="own-endpoint">Address *</Label>
            <Input
              id="own-endpoint"
              compact
              value={form.endpoint}
              onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
              placeholder="https://api.openai.com/v1/chat/completions"
            />
          </div>
          {/* **What it can do.** Decides which dropdown it appears in:
              Tesseract reads and cannot categorise, most AI models do both.
              At least one has to be ticked. */}
          <div>
            <Label>Can do *</Label>
            <div className="flex gap-6">
              <Checkbox
                id="own-can-read"
                label="Read pages (OCR)"
                checked={form.can_read === 1}
                onChange={(checked) => setForm({ ...form, can_read: checked ? 1 : 0 })}
              />
              <Checkbox
                id="own-can-categorise"
                label="Categorise"
                checked={form.can_categorise === 1}
                onChange={(checked) => setForm({ ...form, can_categorise: checked ? 1 : 0 })}
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <Button size="xs" type="button" variant="outline" onClick={() => setIsFormOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="xs"
            type="button"
            onClick={save}
            disabled={
              saving ||
              !form.display_name.trim() ||
              !form.provider.trim() ||
              !form.model_name.trim() ||
              !form.endpoint.trim() ||
              (form.can_read !== 1 && form.can_categorise !== 1)
            }
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </Modal>

      {/* The key goes to Vault, never to the database, and never comes back
          — the same arrangement as a storage's keys, and for the same
          reason: every response body is logged. */}
      <Modal isOpen={!!keyFor} onClose={() => setKeyFor(null)} className="max-w-md p-6">
        <h4 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
          API key
        </h4>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          For {keyFor?.display_name}. Stored safely and never shown again.
        </p>

        <Input
          compact
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Paste the key"
        />

        <div className="mt-5 flex justify-end gap-3">
          <Button size="xs" type="button" variant="outline" onClick={() => setKeyFor(null)} disabled={savingKey}>
            Cancel
          </Button>
          <Button size="xs" type="button" onClick={saveKey} disabled={savingKey || !apiKey.trim()}>
            {savingKey ? "Saving..." : "Save key"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
