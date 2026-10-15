import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import Toast from "../../components/common/Toast";
import {
  modelCatalogueService,
  CatalogueModel,
  isSmartDocModel,
  daysUntilRetired,
} from "../../services/modelCatalogueService";

/**
 * Which SmartDoc models one customer may choose from.
 *
 * **A tick is permission.** No tick is no permission — a customer with
 * nothing ticked can choose no SmartDoc model at all, which is why the
 * migration that added this gave every existing customer every model that
 * was offered at the time.
 *
 * **Taking one away does not unpick what points at it.** A project already
 * using that model keeps working; nobody can pick it again, and the next
 * save of those settings is refused with the reason. Rewriting another
 * customer's configuration from this screen would be a surprise, and the
 * alternative — refusing the change — would leave SmartDoc unable to
 * withdraw a model at all.
 *
 * **Models the customer added themselves are listed but not ticked.** They
 * need no permission from SmartDoc; they are shown so this screen answers
 * "what can they use?" rather than half of it.
 */
export interface CustomerModelsHandle {
  /** Write the allowlist. Called by the pane's one Save. */
  save: () => Promise<void>;
  /** Whether anything is waiting to be saved. */
  dirty: boolean;
}

const CustomerModels = forwardRef(function CustomerModels(
  { customerId }: { customerId: number },
  ref: React.Ref<CustomerModelsHandle>,
) {
  const [models, setModels] = useState<CatalogueModel[]>([]);
  const [allowed, setAllowed] = useState<Set<number>>(new Set());
  const [loadedAllowed, setLoadedAllowed] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, mine] = await Promise.all([
        // The whole catalogue, not the customer-scoped list: this screen
        // decides what that list contains.
        modelCatalogueService.list(),
        modelCatalogueService.allowlist(customerId),
      ]);
      setModels(all);
      setAllowed(new Set(mine));
      setLoadedAllowed(new Set(mine));
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Could not load", type: "error" });
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (model_id: number) => {
    setAllowed((held) => {
      const next = new Set(held);
      if (next.has(model_id)) next.delete(model_id);
      else next.add(model_id);
      return next;
    });
  };

  // Changed since loading, so Save says how much and does nothing when
  // there is nothing to do.
  const changed =
    allowed.size !== loadedAllowed.size || [...allowed].some((id) => !loadedAllowed.has(id));

  /**
   * No Save of its own: the pane has one, and two buttons on a screen meant
   * somebody could change both halves and keep only one.
   */
  useImperativeHandle(ref, () => ({
    dirty: changed,
    save: async () => {
      if (!changed) return;
      setSaving(true);
      try {
        await modelCatalogueService.setAllowlist(customerId, [...allowed]);
        setLoadedAllowed(new Set(allowed));
      } finally {
        setSaving(false);
      }
    },
  }));

  // Only SmartDoc's: a model this customer added needs no permission from
  // anybody, so it has nothing to do on this screen.
  const smartdoc = models.filter(isSmartDocModel);

  /**
   * Grouped by what each model can do, so it is plain which ticks give
   * this customer a way to categorise and which only a way to read. A
   * model that does both is listed once, under its own heading — it is one
   * permission, and showing it twice would mean two boxes for one tick.
   */
  const reads = (m: CatalogueModel) => Number(m.can_read) === 1;
  const categorises = (m: CatalogueModel) => Number(m.can_categorise) === 1;
  const groups = [
    { title: "Categorise and OCR", items: smartdoc.filter((m) => reads(m) && categorises(m)) },
    { title: "Categorise only", items: smartdoc.filter((m) => !reads(m) && categorises(m)) },
    { title: "OCR only", items: smartdoc.filter((m) => reads(m) && !categorises(m)) },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {loading ? (
        <p className="py-6 text-sm text-gray-400">Loading...</p>
      ) : (
        <>
          {/* One row per model, full width of the tab: a name and what it
              actually is are two pieces of text, and a quarter-width column
              put them on separate lines.

              **No pills.** They were added when this was ten checkboxes
              across two columns and "what has this customer got?" needed
              answering without reading all of them. In one short column the
              ticks say it already, and a second list of the same names is
              the same answer twice. */}
          <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5 dark:border-gray-800">
              <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                SmartDoc models
              </span>
              <span className="flex-shrink-0 text-xs text-gray-400">
                {allowed.size} of {smartdoc.length}
                {(changed || saving) && (
                  <span className="ml-1 text-warning-600 dark:text-warning-500">
                    {saving ? "· saving" : "· unsaved"}
                  </span>
                )}
              </span>
            </div>

            {smartdoc.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
                SmartDoc offers no models yet.
              </p>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                {groups.map((group) => (
                  <div key={group.title}>
                    <p className="border-b border-gray-50 bg-gray-50/60 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:border-gray-800/60 dark:bg-white/[0.02] dark:text-gray-400">
                      {group.title}
                    </p>
                    <ul>
                      {group.items.map((m) => {
                        const days = daysUntilRetired(m);
                        const on = allowed.has(Number(m.model_id));
                        return (
                          <li key={m.model_id}>
                            {/* The whole row is the control: a 16px box is a
                                small target for a list somebody goes down. */}
                            <label
                              className={`flex cursor-pointer items-center gap-3 border-b border-gray-50 px-4 py-2.5 transition last:border-0 dark:border-gray-800/60 ${
                                on
                                  ? "bg-brand-50/50 dark:bg-brand-500/[0.07]"
                                  : "hover:bg-gray-50 dark:hover:bg-white/[0.02]"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggle(Number(m.model_id))}
                                className="size-4 flex-shrink-0 rounded border-gray-300 text-brand-500 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-900"
                              />
                              <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-white/90">
                                {m.display_name}
                              </span>
                              <span className="hidden min-w-0 flex-1 truncate text-xs text-gray-500 sm:block dark:text-gray-400">
                                {m.provider} · {m.model_name}
                              </span>

                              {m.is_offered !== 1 ? (
                                <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                                  Not offered
                                </span>
                              ) : days === null ? null : days < 0 ? (
                                <span className="flex-shrink-0 rounded-full bg-error-50 px-2 py-0.5 text-[11px] font-medium text-error-600 dark:bg-error-500/10 dark:text-error-500">
                                  Retired
                                </span>
                              ) : (
                                <span className="flex-shrink-0 rounded-full bg-warning-50 px-2 py-0.5 text-[11px] font-medium text-warning-600 dark:bg-warning-500/10 dark:text-warning-500">
                                  {days === 0 ? "Stops today" : `${days}d left`}
                                </span>
                              )}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {/* Easy to reach by accident, and it leaves the customer unable
                to choose anything at all. */}
            {allowed.size === 0 && smartdoc.length > 0 && (
              <p className="border-t border-gray-100 px-4 py-2.5 text-xs text-warning-600 dark:border-gray-800 dark:text-warning-500">
                Nothing ticked — this customer can choose no SmartDoc model at all.
              </p>
            )}
          </div>

        </>
      )}
    </div>
  );
});

export default CustomerModels;
