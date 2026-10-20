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
import Tabs from "../components/common/Tabs";
import NotificationAreasCard, {
  NotificationAreasHandle,
} from "../components/notifications/NotificationAreasCard";
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
const SETTINGS_TABS = ["branding", "models", "email", "password", "misc"];

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
  /**
   * Which tab is open. **Always the first one on arrival.**
   *
   * It used to be remembered for the browser, on the reasoning that
   * somebody who came to change the logo would come back for the logo. In
   * practice it meant opening Customer Settings and landing on Password or
   * Notifications, with no sign of why — the screen looked different every
   * time without anybody choosing that. Within one visit the tab stays
   * where it is put; coming back starts at the beginning.
   */
  const [tab, setTab] = useState<string>("customer");
  const chooseTab = (id: string) => setTab(id);

  const settingsRef = useRef<BrandingCardHandle>(null);
  // The two notification lists save with everything else now, so the screen
  // has one Save rather than one per tab.
  const workAreasRef = useRef<NotificationAreasHandle>(null);
  const viewerAreasRef = useRef<NotificationAreasHandle>(null);

  /**
   * One Save for the screen.
   *
   * It used to sit on the tab row and save only the four settings tabs,
   * with Customer and Notifications saving themselves — three ways to keep
   * a change on one screen, and no way to tell which applied to what you
   * had just typed. This writes whatever has changed, wherever it is.
   */
  const [savingAll, setSavingAll] = useState(false);
  const saveEverything = async () => {
    setSavingAll(true);
    try {
      // Each part that fails has already said why, so a failure stops here:
      // nothing after it is written, and "Saved" never lands on top of the
      // error — it used to, which read as the save having worked.
      if (canEditRow && !(await saveRow())) return;
      if (settingsRef.current && !(await settingsRef.current.save())) return;
      // The notification cards, unlike the settings card, do not show their
      // own failure — they throw. Uncaught, a refused save showed nothing at
      // all and left the switches looking saved.
      try {
        await workAreasRef.current?.save();
        await viewerAreasRef.current?.save();
      } catch (err) {
        setToast({
          message: err instanceof Error ? err.message : "Could not save the notification settings",
          type: "error",
        });
        return;
      }

      // One message for the screen, not one per card.
      setToast({ message: "Saved", type: "success" });
    } finally {
      setSavingAll(false);
    }
  };
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
          // The stored copy is from sign-in and has no limit in it — the
          // public answer the sign-in page reads leaves it out.
          customerService.getById(customer.customer_id, token).catch(() => null),
          userManagementService.getProjectsByCustomer(customer.customer_id, token).catch(() => []),
        ]);
        if (cancelled) return;
        const row = fresh ?? customer;
        setName(row.customer_name);
        setUrl(row.customer_url);
        setAllowed(row.allowed_projects !== undefined ? String(row.allowed_projects) : "");
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

  /** Saves the customer's own row; says whether it worked (a failure has shown its message). */
  const saveRow = async (): Promise<boolean> => {
    // An empty limit means the row could not be read, not "no projects" —
    // saving then would write 0 and lock the customer out of new projects.
    if (!customer?.customer_id || !name.trim() || !url.trim() || allowed.trim() === "") return false;
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
      // The cached copy is now wrong. Held for the life of the tab, so
      // without this the sidebar and the sign-in page would go on showing
      // the old name until a reload.
      customerService.forgetCustomer(customer.customer_url);
      if (cleanUrl !== customer.customer_url) customerService.forgetCustomer(cleanUrl);
      // A changed address means every screen is now under the wrong one.
      if (cleanUrl !== customer.customer_url) {
        window.location.assign(`/${cleanUrl}/customer-settings`);
      }
      return true;
    } catch (err) {
      // The server explains a refusal — "already has 4 projects" — so it is
      // shown as it comes.
      setToast({
        message: err instanceof Error ? err.message : "Failed to save",
        type: "error",
      });
      return false;
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
            { id: "email", label: "SMTP Server" },
            { id: "password", label: "Password" },
            { id: "misc", label: "Miscellaneous" },
            { id: "notifications", label: "Notifications" },
          ]}
          active={tab}
          onChange={chooseTab}
        />

        {/* One Save for the whole screen, on every tab. The cards draw no
            button of their own — this reaches into them. */}
        <div className="pb-3">
          <Button
            size="xs"
            onClick={saveEverything}
            // Disabled while anything is still being read, but it does not
            // say "Saving..." for that — only for an actual save.
            disabled={
              savingAll || savingRow || settingsStatus.saving || settingsStatus.loading || loading
            }
            startIcon={
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                <path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10z" />
              </svg>
            }
          >
            {savingAll || savingRow || settingsStatus.saving ? "Saving..." : "Save"}
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
          {/* No button of its own: the screen's Save writes this row too. */}
          <div className="mb-2 flex items-center justify-end gap-3">
            {!canEditRow && (
              <span className="text-xs text-gray-500 dark:text-gray-400">Set by SmartDoc</span>
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
                  // Same size as the notification switches, so two toggles
                  // on one screen are not two different controls.
                  className={`flex h-4 w-7 flex-shrink-0 items-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
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
              section={tab as "branding" | "models" | "email" | "password" | "misc"}
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
          {/* Admin beside Viewer, not above it: two short lists stacked
              pushed everything below them off the screen. */}
          {customer && (
            <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">Admin</p>
<NotificationAreasCard ref={workAreasRef} surface="work" />
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">
                  Viewer
                </p>
<NotificationAreasCard ref={viewerAreasRef} surface="viewer" />
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
