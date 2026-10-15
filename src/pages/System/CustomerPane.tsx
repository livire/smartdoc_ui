import { useCallback, useEffect, useRef, useState } from "react";
import Button from "../../components/ui/button/Button";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import { authService } from "../../services/authService";
import { customerService, CustomerSummary } from "../../services/customerService";
import Users from "../Users";
import Storage from "../Storage";
import Toast from "../../components/common/Toast";
import BrandingCard, {
  BrandingCardHandle,
  BrandingCardStatus,
} from "../../components/customer/BrandingCard";
import CustomerModels, { CustomerModelsHandle } from "./CustomerModels";
import CustomerSso from "./CustomerSso";
import CustomerOwnSmtp from "../../components/customer/CustomerOwnSmtp";
import { smtpService, SmtpAccount, isSmartDocAccount } from "../../services/smtpService";

/**
 * One customer, as the people who run SmartDoc see it: its own row, where
 * its documents live, and its accounts — on one page, beside the list.
 *
 * Deliberately not the customer's own screens under the customer's own url:
 * a system account never renders those. The Users and Storage screens here
 * are the same components the customer sees, given a customer id outright
 * rather than taking one from context — one screen, two ways in, not two
 * copies drifting apart. `manageProjects={false}` on Users because who
 * works on which project is the customer administrator's decision.
 */
export default function CustomerPane({
  customer,
  onSaved,
}: {
  customer: CustomerSummary;
  onSaved: () => void;
}) {
  const [name, setName] = useState(customer.customer_name);
  const [url, setUrl] = useState(customer.customer_url);
  const [allowed, setAllowed] = useState(String(customer.allowed_projects));
  const [active, setActive] = useState(customer.is_active === 1);
  // Whether this customer may add AI models of their own. SmartDoc's
  // decision, beside the project limit, not something they set.
  const [canAddModels, setCanAddModels] = useState(customer.can_add_models === 1);
  const [canAddSmtp, setCanAddSmtp] = useState(customer.can_add_smtp === 1);
  // Which of SmartDoc's email accounts sends this customer's mail. "" is
  // the default one, which is every customer until somebody chooses.
  const [smtpId, setSmtpId] = useState(customer.smtp_id ? String(customer.smtp_id) : "");
  // SmartDoc's own accounts, to choose from. Theirs is not in this list:
  // when they have one it is used ahead of any of these, and offering it
  // here would read as a choice that can be unmade.
  const [smtpOptions, setSmtpOptions] = useState<SmtpAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // The settings card draws no Save; this pane puts one above it.
  const settingsRef = useRef<BrandingCardHandle>(null);
  // The allowlist saves with everything else: one Save for the pane.
  const modelsRef = useRef<CustomerModelsHandle>(null);
  const [settingsStatus, setSettingsStatus] = useState<BrandingCardStatus>({
    saving: false,
    loading: true,
  });
  // Stable, so the card's effect does not fire on every render of this pane.
  const onSettingsStatus = useCallback((status: BrandingCardStatus) => {
    setSettingsStatus(status);
  }, []);
  // Bumped by the refresh button. It is the key of the tab's content, so
  // the cards inside — branding, storage, users — are mounted afresh and
  // fetch again, while the list, the title row and the tabs stay put.
  const [refreshKey, setRefreshKey] = useState(0);
  // Two tabs, because they answer different questions: what this customer
  // is, and who is in it. The second is a long list and deserves the height.
  /**
   * Which panel is open.
   *
   * **One tab per panel**, the same shape as the customer's own screens.
   * They were collapsible panels stacked down one tab, which meant
   * scrolling past four of them to reach the fifth and no way to link
   * somebody to one.
   *
   * `branding`, `models`, `password` and `misc` are `BrandingCard`'s own
   * sections: it is mounted once and told which to show, so all four share
   * the one Save and an edit on another tab is not thrown away.
   */
  const [tab, setTab] = useState<
    | "customer"
    | "branding"
    | "models"
    | "email"
    | "password"
    | "misc"
    | "sso"
    | "storage"
    | "users"
  >("customer");

  // The tabs whose contents BrandingCard draws.
  // `models` is not here: SmartDoc's AI models tab is the allowlist and
  // the toggle, both drawn below. The card's own models section lost its
  // contents when the customer-wide defaults went, and an empty panel is
  // worse than none.
  const CARD_TABS = ["branding", "password", "misc"];

  // The tabs the one Save writes: the customer row, the settings card's
  // three, and the allowlist. Storage, Users and Single sign-on save
  // themselves, so a Save over them would be a button that does nothing to
  // what is on screen.
  const SAVE_TABS = ["customer", "branding", "models", "email", "password", "misc"];

  // SmartDoc's own email accounts, to choose a sender from. Read once —
  // this list changes on /sys → Email, not here.
  useEffect(() => {
    let cancelled = false;
    smtpService
      .list()
      .then((all) => {
        if (!cancelled) setSmtpOptions(all.filter(isSmartDocAccount));
      })
      .catch(() => {
        // The dropdown then offers only "SmartDoc's default", which is what
        // every customer has anyway. Not worth a message over the whole pane.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Another customer picked in the list: the form follows, rather than
  // keeping the last one's half-typed name.
  /**
   * Start again when a **different** customer is opened.
   *
   * **Keyed on the id, not the object.** Saving reloads the customer list,
   * which makes a new object for the same customer — on `[customer]` that
   * ran this, and somebody who pressed Save on the AI models tab was put
   * back on Customer with no idea why.
   */
  useEffect(() => {
    setName(customer.customer_name);
    setUrl(customer.customer_url);
    setAllowed(String(customer.allowed_projects));
    setCanAddModels(customer.can_add_models === 1);
    setCanAddSmtp(customer.can_add_smtp === 1);
    setSmtpId(customer.smtp_id ? String(customer.smtp_id) : "");
    setActive(customer.is_active === 1);
    setSaved(null);
    setError(null);
    setTab("customer");
    // Only the id: the rest is read once here and owned by this screen
    // until another customer is chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer.customer_id]);

  /**
   * Save the customer's own row.
   *
   * Called by the one Save at the top, which saves the settings panels
   * too — they are two records, but one screen, and two buttons meant
   * somebody could change both and save half.
   */
  const saveEverything = async () => {
    // The row first: if it is refused — a name already taken, a project
    // limit below what they have — nothing else should have been written
    // either, and its message is the one worth reading.
    const ok = await save();
    if (!ok) return;

    await settingsRef.current?.save();
    // The allowlist is its own record, written after the rest for the same
    // reason: if the row was refused, nothing else should have changed.
    await modelsRef.current?.save();

    // Said once, at the end, for all three.
    setSaved("Saved");
  };

  const save = async () => {
    if (!name.trim() || !url.trim()) return false;
    setSaving(true);
    setSaved(null);
    setError(null);
    try {
      const token = await authService.ensureValidToken();
      const cleanUrl = url.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
      await customerService.updateCustomer(
        {
          customer_id: customer.customer_id,
          customer_name: name.trim(),
          customer_url: cleanUrl,
          allowed_projects: Number(allowed),
          can_add_models: (canAddModels ? 1 : 0) as 0 | 1,
          can_add_smtp: (canAddSmtp ? 1 : 0) as 0 | 1,
          smtp_id: smtpId ? Number(smtpId) : null,
          is_active: active ? 1 : 0,
        },
        token,
      );
      setUrl(cleanUrl);
      onSaved();
      return true;
    } catch (err) {
      // The server explains a refusal — "already has 4 projects" — as it is.
      setError(err instanceof Error ? err.message : "Failed to save");
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Which customer this pane is about, as the list no longer says
          more than the name and the form below can be mid-edit. The
          record's own values, not the form's — this is a title, not a
          preview of the save. */}
      <div className="flex flex-shrink-0 items-baseline gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-800">
        <h2 className="truncate text-lg font-semibold text-gray-800 dark:text-white/90">
          {customer.customer_name}
        </h2>
        <span className="font-mono text-xs text-gray-400">/{customer.customer_url}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {customer.projects}/{customer.allowed_projects} projects
        </span>
        {customer.is_active !== 1 && <span className="text-xs text-error-500">inactive</span>}
        <button
          type="button"
          title="Refresh"
          onClick={() => {
            // The summary (counts, name, limit) comes from the list's load;
            // everything inside the tab from a fresh mount.
            onSaved();
            setRefreshKey((n) => n + 1);
          }}
          className="ml-auto flex size-7 items-center justify-center self-center rounded-lg border border-gray-300 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.05] dark:hover:text-white/90"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
            <path d="M12 4a8 8 0 0 1 7.4 5H17v2h6V5h-2v2.3A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8Zm8 8h-2a8 8 0 0 1-15.4 3H7v-2H1v6h2v-2.3A10 10 0 0 0 22 12h-2Z" />
          </svg>
        </button>
      </div>
      <div className="flex flex-shrink-0 flex-wrap items-center gap-1 border-b border-gray-200 bg-white px-4 py-1 dark:border-gray-800 dark:bg-gray-800">
        {([
          ["customer", "Customer"],
          ["branding", "Branding"],
          ["models", "AI models"],
          ["email", "SMTP Server"],
          ["password", "Password"],
          ["misc", "Miscellaneous"],
          ["sso", "Single sign-on"],
          ["storage", "Storage"],
          ["users", `Users${customer.users ? ` (${customer.users})` : ""}`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === key
                ? "border-brand-500 text-brand-500"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white/90"
            }`}
          >
            {label}
          </button>
        ))}

        {/* **On the tab row, not above the content.** On its own line it was
            a band of white with one button in it, and it read as belonging
            to the whole pane rather than to what the tabs save. */}
        {SAVE_TABS.includes(tab) && (
          <span className="ml-auto flex items-center gap-3 self-center">
            {saved && <Toast message={saved} type="success" onClose={() => setSaved(null)} />}
            {error && <Toast message={error} type="error" onClose={() => setError(null)} />}
            <Button
              size="xs"
              onClick={saveEverything}
              // Disabled while the settings are still being read, but it
              // does not say "Saving..." for that — only for a real save.
              disabled={
                saving ||
                settingsStatus.saving ||
                settingsStatus.loading ||
                !name.trim() ||
                !url.trim() ||
                Number(allowed) < 1
              }
              startIcon={
                <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                  <path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10z" />
                </svg>
              }
            >
              {saving || settingsStatus.saving ? "Saving..." : "Save"}
            </Button>
          </span>
        )}
      </div>

      {/* The Users screen scrolls its own table under its own header, so it
          is given the height and told to fill it; the customer tab is plain
          content and scrolls as a whole. */}
      <div
        key={refreshKey}
        className={`min-h-0 flex-1 ${
          tab === "users" || tab === "storage"
            ? "flex flex-col overflow-hidden"
            : "overflow-auto"
        }`}
      >
        {tab === "users" ? (
          /* Accounts: added, enabled, disabled. Which projects they work on
             is the customer administrator's decision, on their own
             screens. */
          <Users
            customerId={customer.customer_id}
            // Its url as well as its id: the Users screen needs it to take
            // the customer's prefix off a username for display.
            forCustomerUrl={customer.customer_url}
            manageProjects={false}
          />
        ) : tab === "storage" ? (
          /* Where this customer's documents live. Its own tab rather than a
             panel on the Customer tab: it has a list, a search and its own
             Add button, and the one Save there saves none of it. */
          <Storage customerId={customer.customer_id} />
        ) : (
          <div className="space-y-4 p-4 pb-10">
            {/* A plain card, not a collapsible panel. It was one of several
                stacked down this tab and needed folding away; it is the
                whole tab now, and a heading that opens and shuts over the
                only thing on screen is furniture. */}
            {tab === "customer" && (
            <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <Label htmlFor="sys-customer-name">Name</Label>
                  <Input
                    id="sys-customer-name"
                    compact
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="sys-customer-url">Sign-in address</Label>
                  <Input
                    id="sys-customer-url"
                    compact
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </div>
                <div>
                  {/* Used against allowed, on the label. The server refuses a
                      limit below the projects already made. */}
                  <Label htmlFor="sys-customer-projects">
                    Projects allowed
                    <span className="ml-1.5 font-normal text-gray-400">
                      {customer.projects ?? 0}/{allowed || "?"}
                    </span>
                  </Label>
                  <Input
                    id="sys-customer-projects"
                    compact
                    type="number"
                    min="1"
                    value={allowed}
                    onChange={(e) => setAllowed(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="sys-customer-active">Active</Label>
                  <div className="flex h-9 items-center">
                    <button
                      id="sys-customer-active"
                      type="button"
                      role="switch"
                      aria-checked={active}
                      onClick={() => setActive((on) => !on)}
                      className={`flex h-4 w-7 flex-shrink-0 items-center rounded-full p-0.5 transition-colors ${
                        active ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-600"
                      }`}
                    >
                      <span
                        className={`block size-3 rounded-full bg-white shadow-theme-xs transition-transform ${
                          active ? "translate-x-3" : ""
                        }`}
                      />
                    </button>
                    <span className="ml-3 text-sm text-gray-600 dark:text-gray-300">
                      {active ? "Users can sign in" : "Nobody can sign in"}
                    </span>
                  </div>
                </div>

              </div>
            </div>
            )}

            {/* Which of SmartDoc's models this customer may choose from.
                Above the card's own AI Models section, because what they
                may pick from has to be settled before picking a default
                out of it. Its own Save: an allowlist is a different record
                from the settings. */}
            {tab === "models" && (
              <div className="space-y-4">
                {/* **Whether they may add models of their own.** Here
                    rather than beside the project limit: it is about AI
                    models, and this is the AI models tab. */}
                <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
                  <div className="flex items-center justify-between gap-4">
                    <span>
                      <span className="block text-sm font-medium text-gray-800 dark:text-white/90">
                        Allow creating own models
                      </span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={canAddModels}
                      aria-label="Allow creating own models"
                      onClick={() => setCanAddModels((on) => !on)}
                      className={`flex h-4 w-7 flex-shrink-0 items-center rounded-full p-0.5 transition-colors ${
                        canAddModels ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-600"
                      }`}
                    >
                      <span
                        className={`block size-3 rounded-full bg-white shadow-theme-xs transition-transform ${
                          canAddModels ? "translate-x-3" : ""
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <CustomerModels ref={modelsRef} customerId={customer.customer_id} />
              </div>
            )}

            {tab === "email" && (
              <div className="space-y-4">
                {/* **Which SmartDoc address their mail comes from.**
                    Chosen here and nowhere else: there is no default
                    account, so a customer nobody has chosen for is sent no
                    mail at all — loudly, rather than from whichever address
                    a flag on another row happened to name. */}
                <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-800 dark:text-white/90">
                        Send their mail through
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                        An account of their own, if they have one, is used instead of this.
                      </span>
                    </span>
                    <select
                      value={smtpId}
                      onChange={(e) => setSmtpId(e.target.value)}
                      className="h-9 min-w-[18rem] rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                    >
                      <option value="">Not chosen — no mail is sent</option>
                      {smtpOptions.map((a) => (
                        <option key={a.smtp_id} value={a.smtp_id}>
                          {a.display_name} — {a.from_address}
                          {a.is_active !== 1 ? " (off)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* The one case the dropdown cannot state for itself:
                      there is nothing to choose from yet. */}
                  {smtpOptions.length === 0 && (
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      SmartDoc has no email account yet. Add one on /sys → Email, then choose it
                      here.
                    </p>
                  )}
                </div>

                {/* **Whether their people's mail may come from their own
                    server.** With this off, every password link for this
                    customer comes from SmartDoc's address, which is the
                    normal arrangement.

                    Turning it off again does **not** move their mail back:
                    an account they already have goes on carrying it, so
                    nobody's sender changes behind their back. Removing the
                    account does that, visibly. */}
                <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
                  <div className="flex items-center justify-between gap-4">
                    <span>
                      <span className="block text-sm font-medium text-gray-800 dark:text-white/90">
                        Allow own SMTP server
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                        Their password links then come from their address. Whether that mail is
                        accepted depends on the SPF and DKIM records on their domain, which are
                        theirs to set.
                      </span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={canAddSmtp}
                      aria-label="Allow own SMTP server"
                      onClick={() => setCanAddSmtp((on) => !on)}
                      className={`flex h-4 w-7 flex-shrink-0 items-center rounded-full p-0.5 transition-colors ${
                        canAddSmtp ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-600"
                      }`}
                    >
                      <span
                        className={`block size-3 rounded-full bg-white shadow-theme-xs transition-transform ${
                          canAddSmtp ? "translate-x-3" : ""
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Their account, if they have made one. Read-only here: it
                    is their server and their password. Absent entirely when
                    they have none and cannot have one — the dropdown above
                    already says where their mail comes from. */}
                <CustomerOwnSmtp
                  canAdd={false}
                  customerId={customer.customer_id}
                  customerName={customer.customer_name}
                  hideWhenEmpty
                  useOwn={customer.use_own_smtp !== 0}
                />
              </div>
            )}

            {/* Their company login. Its own Save: it lives in Keycloak, not
                in the customer's row. */}
            {tab === "sso" && <CustomerSso customerId={customer.customer_id} onToast={setToast} />}

            {/* How it looks — the same card the customer's own settings
                page shows, so what SmartDoc sets up for them is what they
                then see. **Mounted once and told which section to draw**:
                all four share one Save, and unmounting would throw away an
                edit made on another tab before it was pressed. */}
            <div className={CARD_TABS.includes(tab) ? "" : "hidden"}>
              <BrandingCard
                ref={settingsRef}
                customerId={customer.customer_id}
                customerName={customer.customer_name}
                onToast={setToast}
                onStatusChange={onSettingsStatus}
                section={tab as "branding" | "password" | "misc"}
                showOwnModels={false}
                showOwnSmtp={false}
              />
            </div>

          </div>
        )}
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} position="top-center" onClose={() => setToast(null)} />
      )}
    </div>
  );
}
