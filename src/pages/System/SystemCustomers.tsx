import { useEffect, useMemo, useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import Toast from "../../components/common/Toast";
import { Modal } from "../../components/ui/modal";
import Button from "../../components/ui/button/Button";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import { authService } from "../../services/authService";
import { customerService, CustomerSummary } from "../../services/customerService";
import CustomerPane from "./CustomerPane";
import { ArrowRightIcon } from "../../icons";

/**
 * Every customer, for the people who run SmartDoc.
 *
 * Two jobs: start a new customer off, and step into one. Stepping in makes
 * the rest of the application behave as it does for that customer's own
 * administrator — the menus, the branding, the projects — because that is
 * what setting a customer up means in practice: creating its first
 * administrator, its projects and its storage from the inside.
 */
export default function SystemCustomers() {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(
    null,
  );

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newAllowed, setNewAllowed] = useState("5");
  const [creating, setCreating] = useState(false);
  // Which one the right-hand side is about. An id rather than the row, so a
  // reload of the list keeps the choice.
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await authService.ensureValidToken();
      const rows = await customerService.getAll(token);
      setCustomers(rows);
      // Something is always shown on the right: the first customer until
      // somebody picks another.
      setSelectedId((current) =>
        current && rows.some((r) => r.customer_id === current)
          ? current
          : rows[0]?.customer_id ?? null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read the customers");
    } finally {
      setLoading(false);
    }
  };

  // Helmet can lose the race when the screen being left unmounts after this
  // one mounts — the tab then still says "Projects". Setting it here is
  // the one thing that always wins.
  useEffect(() => {
    document.title = "Customers | SmartDoc System Admin";
  }, []);

  // SystemLayout has already confirmed a system account before this
  // renders, so there is nothing to wait for.
  useEffect(() => {
    load();
  }, []);

  const selected = customers.find((c) => c.customer_id === selectedId) ?? null;

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter(
      (row) =>
        row.customer_name.toLowerCase().includes(query) ||
        row.customer_url.toLowerCase().includes(query),
    );
  }, [customers, search]);

  const createCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newUrl.trim()) return;

    setCreating(true);
    try {
      const token = await authService.ensureValidToken();
      await customerService.createCustomer(
        {
          customer_name: newName.trim(),
          // The address its people will sign in at, so it has to be the
          // shape of a url segment rather than whatever was typed.
          customer_url: newUrl.trim().toLowerCase().replace(/[^a-z0-9-]/g, ""),
          allowed_projects: Number(newAllowed) || 1,
        },
        token,
      );
      setToast({ message: "Customer created", type: "success" });
      setIsCreateOpen(false);
      setNewName("");
      setNewUrl("");
      const before = new Set(customers.map((c) => c.customer_id));
      await load();
      // Whichever row is new: the point of creating one is to set it up.
      setCustomers((rows) => {
        const fresh = rows.find((c) => !before.has(c.customer_id));
        if (fresh) setSelectedId(fresh.customer_id);
        return rows;
      });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to create the customer",
        type: "error",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <PageMeta title="Customers | SmartDoc System Admin" description="Every customer" />

        <div className="flex min-h-0 flex-1">
          {/* The list, and the customer being looked at beside it. One
              screen: picking another is a click, not a page. */}
          <div className="flex w-80 flex-shrink-0 flex-col border-r border-gray-200 bg-white min-h-0 dark:border-gray-800 dark:bg-gray-800">
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-gray-100 p-3 dark:border-gray-800">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customers..."
                compact
              />
              <Button
                size="xs"
                onClick={() => setIsCreateOpen(true)}
                startIcon={
                  <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
                    <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
                  </svg>
                }
              >
                New
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <p className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">Loading...</p>
              ) : error ? (
                <>
                  <p className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">Could not load the customers.</p>
                  <Toast message={error} type="error" onClose={() => setError(null)} />
                </>
              ) : matches.length === 0 ? (
                <p className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">
                  {customers.length === 0 ? "No customers yet." : "Nothing matches that."}
                </p>
              ) : (
                matches.map((row) => {
                  const chosen = row.customer_id === selectedId;
                  return (
                    /* Loading is a button, not the row: choosing a customer
                       fetches its storages and its people, and a click while
                       scanning the list should not set that off. The name
                       alone in the row — the rest is on the right once
                       loaded. */
                    <div
                      key={row.customer_id}
                      className={`flex w-full items-center gap-3 border-b border-gray-100 px-4 py-2.5 dark:border-gray-800 ${
                        chosen ? "bg-brand-50 dark:bg-brand-500/10" : ""
                      }`}
                    >
                      <span className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
                          {row.customer_name}
                        </span>
                        {row.is_active !== 1 && (
                          <span className="text-xs text-error-500">inactive</span>
                        )}
                      </span>
                      {/* One button in two states: pressed for the loaded
                          customer, so the list reads like a set of tabs. */}
                      <button
                        type="button"
                        aria-pressed={chosen}
                        title={chosen ? "This customer is loaded" : "Load this customer"}
                        disabled={chosen}
                        onClick={() => setSelectedId(row.customer_id)}
                        className={`flex-shrink-0 rounded-lg border p-1.5 transition ${
                          chosen
                            ? "border-brand-500 bg-brand-500 text-white shadow-inner"
                            : "border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.05] dark:hover:text-white/90"
                        }`}
                      >
                        <ArrowRightIcon className="size-4 fill-current" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <p className="flex-shrink-0 border-t border-gray-100 px-4 py-2 text-xs text-gray-400 dark:border-gray-800">
              {matches.length === customers.length
                ? `${customers.length} customers`
                : `${matches.length} of ${customers.length} customers`}
            </p>
          </div>

          {/* A flex column with its height pinned, so the pane's title and
              tabs stay put and only the tab's own content scrolls. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {selected ? (
              <CustomerPane customer={selected} onSaved={load} />
            ) : (
              <p className="px-6 py-6 text-sm text-gray-500 dark:text-gray-400">
                {loading ? "" : "Select a customer to see it here"}
              </p>
            )}
          </div>
        </div>

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} className="max-w-md p-6">
        <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90">New customer</h3>
        <form onSubmit={createCustomer} className="space-y-4">
          <div>
            <Label htmlFor="customer-name">Name *</Label>
            <Input
              id="customer-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Company name"
            />
          </div>
          <div>
            <Label htmlFor="customer-url">Sign-in address *</Label>
            <Input
              id="customer-url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="company"
            />
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              Their people will sign in at /{newUrl.trim().toLowerCase().replace(/[^a-z0-9-]/g, "") || "name"}.
              Letters, numbers and hyphens.
            </p>
          </div>
          <div>
            <Label htmlFor="customer-projects">Projects allowed</Label>
            <Input
              id="customer-projects"
              type="number"
              value={newAllowed}
              onChange={(e) => setNewAllowed(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button size="xs" type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button size="xs" type="submit" disabled={creating}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
