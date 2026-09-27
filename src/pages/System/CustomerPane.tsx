import { useEffect, useState } from "react";
import Button from "../../components/ui/button/Button";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import { authService } from "../../services/authService";
import { customerService, CustomerSummary } from "../../services/customerService";
import Users from "../Users";
import Storage from "../Storage";
import Toast from "../../components/common/Toast";
import BrandingCard from "../../components/customer/BrandingCard";

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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  // Bumped by the refresh button. It is the key of the tab's content, so
  // the cards inside — branding, storage, users — are mounted afresh and
  // fetch again, while the list, the title row and the tabs stay put.
  const [refreshKey, setRefreshKey] = useState(0);
  // Two tabs, because they answer different questions: what this customer
  // is, and who is in it. The second is a long list and deserves the height.
  const [tab, setTab] = useState<"customer" | "users">("customer");

  // Another customer picked in the list: the form follows, rather than
  // keeping the last one's half-typed name.
  useEffect(() => {
    setName(customer.customer_name);
    setUrl(customer.customer_url);
    setAllowed(String(customer.allowed_projects));
    setActive(customer.is_active === 1);
    setSaved(null);
    setError(null);
    setTab("customer");
  }, [customer]);

  const save = async () => {
    if (!name.trim() || !url.trim()) return;
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
          is_active: active ? 1 : 0,
        },
        token,
      );
      setUrl(cleanUrl);
      setSaved("Saved");
      onSaved();
    } catch (err) {
      // The server explains a refusal — "already has 4 projects" — as it is.
      setError(err instanceof Error ? err.message : "Failed to save");
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
      <div className="flex flex-shrink-0 gap-1 border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-800">
        {([
          ["customer", "Customer"],
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
      </div>

      {/* The Users screen scrolls its own table under its own header, so it
          is given the height and told to fill it; the customer tab is plain
          content and scrolls as a whole. */}
      <div
        key={refreshKey}
        className={`min-h-0 flex-1 ${
          tab === "users" ? "flex flex-col overflow-hidden" : "overflow-auto"
        }`}
      >
        {tab === "users" ? (
          /* Accounts: added, enabled, disabled. Which projects they work on
             is the customer administrator's decision, on their own
             screens. */
          <Users customerId={customer.customer_id} manageProjects={false} />
        ) : (
          <div className="space-y-4 p-4 pb-10">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
                  Basic Information
                </h3>
                <span className="flex items-center gap-3">
                  {saved && <Toast message={saved} type="success" onClose={() => setSaved(null)} />}
                  {error && <Toast message={error} type="error" onClose={() => setError(null)} />}
                  <Button
                    size="xs"
                    onClick={save}
                    disabled={saving || !name.trim() || !url.trim() || Number(allowed) < 1}
                  >
                    {saving ? "Saving..." : "Save customer"}
                  </Button>
                </span>
              </div>

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
                      className={`flex h-5 w-9 flex-shrink-0 items-center rounded-full p-0.5 transition-colors ${
                        active ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-600"
                      }`}
                    >
                      <span
                        className={`block size-4 rounded-full bg-white shadow-theme-xs transition-transform ${
                          active ? "translate-x-4" : ""
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

            {/* How it looks — the same card the customer's own settings
                page shows, so what SmartDoc sets up for them is what they
                then see. */}
            <BrandingCard
              customerId={customer.customer_id}
              customerName={customer.customer_name}
              onToast={setToast}
            />

            {/* Where this customer's documents live. A project cannot be
                created until there is one, so it comes before the people who
                would create it. */}
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
              <Storage customerId={customer.customer_id} title="Storage" />
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
