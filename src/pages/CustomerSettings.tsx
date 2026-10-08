import { useCallback, useEffect, useRef, useState } from "react";
import PageMeta from "../components/common/PageMeta";
import Toast from "../components/common/Toast";
import Button from "../components/ui/button/Button";
import Label from "../components/form/Label";
import Input from "../components/form/input/InputField";
import { useCustomer } from "../context/CustomerContext";
import { useMembership } from "../context/MembershipContext";
import { userManagementService } from "../services/userManagementService";
import { authService } from "../services/authService";
import { customerService } from "../services/customerService";
import NotificationAreasCard from "../components/notifications/NotificationAreasCard";
import Tabs from "../components/common/Tabs";
import BrandingCard, {
  BrandingCardHandle,
  BrandingCardStatus,
} from "../components/customer/BrandingCard";

/**
 * What this customer's SmartDoc is called and looks like: the sign-in
 * address, the name on screen, and the two logos.
 *
 * Not project-specific — everything here belongs to the customer, which is
 * why it sits apart from the project settings on the Projects screen.
 */
// The four tabs that one Save covers. The other two — Customer and
// Notifications — save themselves.
const SETTINGS_TABS = ["branding", "models", "password", "misc"];

export default function CustomerSettings() {
  const { customer, setCustomer } = useCustomer();
  const { account } = useMembership();
  // The customer's own row: name, address, limit, active. Set by whoever
  // runs SmartDoc, so editable only for a system administrator; everyone
  // else sees it, because "3 of 5 projects" is worth knowing before the
  // Projects screen refuses a new one.
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [allowed, setAllowed] = useState("");
  const [active, setActive] = useState(true);
  const [projectCount, setProjectCount] = useState<number | null>(null);
  const [savingRow, setSavingRow] = useState(false);
  const canEditRow = account.is_sysadmin;
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // The settings card below draws no Save of its own; this screen's one
  // button reaches into it.
  // Which tab is open. Remembered for this browser, because somebody who
  // came here to change the logo will come back for the logo.
  const [tab, setTab] = useState<string>(() => {
    try {
      return localStorage.getItem("customer_settings_tab") || "customer";
    } catch {
      return "customer";
    }
  });
  const chooseTab = (id: string) => {
    setTab(id);
    try {
      localStorage.setItem("customer_settings_tab", id);
    } catch {
      // A private window refuses this. Not worth telling anybody about.
    }
  };

  const settingsRef = useRef<BrandingCardHandle>(null);
  const [settingsStatus, setSettingsStatus] = useState<BrandingCardStatus>({
    saving: false,
    loading: true,
  });
  // Stable, so the card's effect does not fire on every render of this page.
  const onSettingsStatus = useCallback((status: BrandingCardStatus) => {
    setSettingsStatus(status);
  }, []);

  useEffect(() => {
    if (!customer?.customer_id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const token = await authService.ensureValidToken();
        const [fresh, projects] = await Promise.all([
          // The stored copy is from sign-in; the limit may have moved since.
          customerService.getCustomerByUrl(customer.customer_url).catch(() => null),
          userManagementService.getProjectsByCustomer(customer.customer_id, token).catch(() => []),
        ]);
        if (cancelled) return;
        const row = fresh?.data ?? customer;
        setName(row.customer_name);
        setUrl(row.customer_url);
        setAllowed(String(row.allowed_projects));
        setActive(row.is_active === 1);
        setProjectCount(projects.length);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [customer?.customer_id, customer?.customer_name]);

  const saveRow = async () => {
    if (!customer?.customer_id || !name.trim() || !url.trim()) return;
    setSavingRow(true);
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
      // What the rest of the app reads the customer from.
      setCustomer({
        ...customer,
        customer_name: name.trim(),
        customer_url: cleanUrl,
        allowed_projects: Number(allowed),
        is_active: active ? 1 : 0,
      });
      setToast({ message: "Customer saved", type: "success" });
      // The cached copy is now wrong. Held for the life of the tab, so
      // without this the sidebar and the sign-in page would go on showing
      // the old name until a reload.
      customerService.forgetCustomer(customer.customer_url);
      if (cleanUrl !== customer.customer_url) customerService.forgetCustomer(cleanUrl);
      // A changed address means every screen is now under the wrong one.
      if (cleanUrl !== customer.customer_url) {
        window.location.assign(`/${cleanUrl}/customer-settings`);
      }
    } catch (err) {
      // The server explains a refusal — "already has 4 projects" — so it is
      // shown as it comes.
      setToast({
        message: err instanceof Error ? err.message : "Failed to save",
        type: "error",
      });
    } finally {
      setSavingRow(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 w-full bg-gray-50 dark:bg-gray-900 overflow-auto min-w-0 min-h-0">
      <PageMeta title="Customer Settings | SmartDoc" description="How this customer's SmartDoc looks" />

      <div className="space-y-3 p-3">
        {/* The Save sits on the tab row rather than in a band of its own:
            on its own line it read as belonging to the whole screen, when
            it saves only the four settings tabs. */}
        <div className="flex items-end gap-3">
        <Tabs
          className="flex-1"
          tabs={[
            { id: "customer", label: "Customer" },
            { id: "branding", label: "Branding" },
            { id: "models", label: "AI Models" },
            { id: "password", label: "Password" },
            { id: "misc", label: "Miscellaneous" },
            { id: "notifications", label: "Notifications" },
          ]}
          active={tab}
          onChange={chooseTab}
        />

        {/* The settings card draws no button of its own — this reaches into
            it. Hidden on Customer and Notifications, which save themselves. */}
        <div className={`pb-1.5 ${SETTINGS_TABS.includes(tab) ? "" : "hidden"}`}>
          <Button
            size="xs"
            onClick={() => settingsRef.current?.save()}
            // Disabled while the settings are still being read, but it does
            // not say "Saving..." for that — only for an actual save.
            disabled={settingsStatus.saving || settingsStatus.loading || loading}
            startIcon={
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                <path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10z" />
              </svg>
            }
          >
            {settingsStatus.saving ? "Saving..." : "Save"}
          </Button>
        </div>
        </div>

        {/* The customer itself — what SmartDoc set up for them. Editable by
            a system administrator; read-only for the customer's own people,
            who cannot raise their own limit but should be able to see it.

            Every panel stays mounted and the inactive ones are hidden:
            unmounting would throw away half-typed edits when somebody
            glances at another tab. */}
        <div className={tab === "customer" ? "" : "hidden"}>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          {/* No heading: the tab above already says Customer. */}
          <div className="mb-2 flex items-center justify-end gap-3">
            {!canEditRow ? (
              <span className="text-xs text-gray-500 dark:text-gray-400">Set by SmartDoc</span>
            ) : (
              <Button
                size="xs"
                onClick={saveRow}
                disabled={
                  savingRow ||
                  loading ||
                  !name.trim() ||
                  !url.trim() ||
                  Number(allowed) < Math.max(1, projectCount ?? 0)
                }
              >
                {savingRow ? "Saving..." : "Save customer"}
              </Button>
            )}
          </div>

          {/* One row, no small print: what each field is, is in its label,
              and what it is allowed to be is enforced on the field. */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label htmlFor="customer-name">Name</Label>
              <Input
                id="customer-name"
                compact
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canEditRow}
              />
            </div>

            <div>
              <Label htmlFor="customer-url">Sign-in address</Label>
              <Input
                id="customer-url"
                compact
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={!canEditRow}
              />
            </div>

            <div>
              {/* Used against allowed, on the label where the eye already
                  is — the floor on the field says the rest. */}
              <Label htmlFor="customer-projects">
                Projects allowed
                {projectCount !== null && (
                  <span className="ml-1.5 font-normal text-gray-400">
                    {projectCount}/{allowed || "?"}
                  </span>
                )}
              </Label>
              <Input
                id="customer-projects"
                compact
                type="number"
                min={String(Math.max(1, projectCount ?? 0))}
                value={allowed}
                onChange={(e) => setAllowed(e.target.value)}
                disabled={!canEditRow}
              />
            </div>

            <div>
              <Label htmlFor="customer-active">Active</Label>
              <div className="flex h-9 items-center">
                <button
                  id="customer-active"
                  type="button"
                  role="switch"
                  aria-checked={active}
                  disabled={!canEditRow}
                  onClick={() => setActive((on) => !on)}
                  className={`flex h-5 w-9 flex-shrink-0 items-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
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

        </div>

        {/* Branding, AI Models, Password and Miscellaneous all live in this
            one card because they share a single Save — it sends every field
            together. It is told which tab is open and draws that one.

            Kept mounted on the other two tabs and hidden, so a half-typed
            password rule survives a glance at the Customer tab. */}
        <div className={SETTINGS_TABS.includes(tab) ? "" : "hidden"}>
          {customer?.customer_id && (
            <BrandingCard
              ref={settingsRef}
              customerId={customer.customer_id}
              customerName={customer.customer_name}
              onToast={setToast}
              onStatusChange={onSettingsStatus}
              section={tab as "branding" | "models" | "password" | "misc"}
            />
          )}
        </div>


        {/* What this customer's people are told. A project can say
            otherwise on its own screen; this is the answer everywhere
            that has not. */}
        <div
          className={
            tab === "notifications"
              ? "rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
              : "hidden"
          }
        >
          {customer && (
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">Admin</p>
                <NotificationAreasCard surface="work" />
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">
                  Viewer
                </p>
                <NotificationAreasCard surface="viewer" />
              </div>
            </div>
          )}
        </div>
      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          position="top-center"
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
