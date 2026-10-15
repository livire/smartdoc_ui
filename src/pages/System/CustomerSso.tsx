import { useCallback, useEffect, useState } from "react";
import Button from "../../components/ui/button/Button";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import { Modal } from "../../components/ui/modal";
import { customerSsoService, CustomerSso as Sso } from "../../services/customerSsoService";

/**
 * A customer's single sign-on — their people sign in with their company's
 * own login (Microsoft Entra, Google, Okta) instead of a SmartDoc password.
 *
 * **Its own Save**, like Storage: it is not a row in our database but a
 * company login in Keycloak, and it has its own way to fail (a discovery
 * address that cannot be read, a domain another customer holds).
 *
 * Read the domains with care: **everybody whose email is on one is sent to
 * this customer's login.** The server refuses the obvious shared ones
 * (gmail.com and so on); checking the customer owns the domain is the
 * person on this screen's job.
 *
 * Nobody gets in by this alone. A person still has to be added on the Users
 * screen first, with an email on one of these domains — the company login
 * attaches to that invited account and never makes one.
 */
export default function CustomerSso({
  customerId,
  onToast,
}: {
  customerId: number;
  onToast: (toast: { message: string; type: "success" | "error" }) => void;
}) {
  const [sso, setSso] = useState<Sso | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [domains, setDomains] = useState("");
  const [discoveryUrl, setDiscoveryUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  // The form follows what Keycloak holds, after a load and after a save.
  const show = useCallback((answer: Sso) => {
    setSso(answer);
    setDomains((answer.domains ?? []).join(", "));
    setDiscoveryUrl(answer.discovery_url ?? "");
    setClientId(answer.client_id ?? "");
    setClientSecret("");
    // Off until somebody switches it on: a new company login usually needs
    // the customer's IT team to enter the return address first.
    setEnabled(answer.configured ? Boolean(answer.enabled) : false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSso(null);
    setLoadError(null);
    customerSsoService
      .get(customerId)
      .then((answer) => {
        if (!cancelled) show(answer);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load");
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, show]);

  const needsSecret = !sso?.has_secret;
  const canSave =
    !saving &&
    domains.trim() !== "" &&
    discoveryUrl.trim() !== "" &&
    clientId.trim() !== "" &&
    (!needsSecret || clientSecret.trim() !== "");

  const save = async () => {
    setSaving(true);
    try {
      show(
        await customerSsoService.save(customerId, {
          domains,
          discovery_url: discoveryUrl,
          client_id: clientId,
          client_secret: clientSecret,
          enabled,
        }),
      );
      onToast({ message: "Saved", type: "success" });
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Could not save", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setRemoving(true);
    try {
      show(await customerSsoService.remove(customerId));
      setConfirmRemove(false);
      onToast({ message: "Single sign-on removed", type: "success" });
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Could not remove", type: "error" });
    } finally {
      setRemoving(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast({ message: "Copied", type: "success" });
    } catch {
      onToast({ message: "Could not copy — select it and copy by hand", type: "error" });
    }
  };

  if (loadError) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-error-500 dark:border-gray-700 dark:bg-gray-800">
        {loadError}
      </div>
    );
  }
  if (!sso) return <p className="py-6 text-center text-sm text-gray-400">Loading...</p>;

  return (
    <div className="space-y-4">
      {/* **First, because it comes first.** The customer's IT team enters
          this in their own login system before anything here can work. */}
      <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <span className="block text-sm font-medium text-gray-800 dark:text-white/90">
          Return address for their IT team
        </span>
        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
          They enter this as the redirect URI in their Microsoft Entra, Google or Okta app. Their
          company login sends people back to SmartDoc here, and nowhere else.
        </span>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300">
            {sso.return_url}
          </code>
          <Button size="xs" variant="outline" type="button" onClick={() => copy(sso.return_url)}>
            Copy
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-start justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-gray-800 dark:text-white/90">
              Sign in with their company login
            </span>
            <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
              {sso.configured
                ? enabled
                  ? "People with an email on these domains are sent to their company login."
                  : "Set up but off: their people get the SmartDoc password screen."
                : "Not set up. Their people sign in with a SmartDoc password."}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Sign in with their company login"
            onClick={() => setEnabled((on) => !on)}
            className={`mt-1 flex h-4 w-7 flex-shrink-0 items-center rounded-full p-0.5 transition-colors ${
              enabled ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-600"
            }`}
          >
            <span
              className={`block size-3 rounded-full bg-white shadow-theme-xs transition-transform ${
                enabled ? "translate-x-3" : ""
              }`}
            />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label htmlFor="sso-domains">Email domains</Label>
            <Input
              id="sso-domains"
              compact
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="customer.com, customer.co.uk"
            />
            {/* The one field that can send other people to the wrong place.
                Said where it is typed, not after it is saved. */}
            <p className="mt-1 text-xs text-warning-600 dark:text-warning-500">
              Only domains this customer owns. Everybody with an email on one is sent to their
              company login.
            </p>
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="sso-discovery">Discovery address</Label>
            <Input
              id="sso-discovery"
              compact
              value={discoveryUrl}
              onChange={(e) => setDiscoveryUrl(e.target.value)}
              placeholder="https://login.microsoftonline.com/<tenant>/v2.0/.well-known/openid-configuration"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Their IT team gives this. It ends in /.well-known/openid-configuration.
            </p>
          </div>

          <div>
            <Label htmlFor="sso-client-id">Client ID</Label>
            <Input
              id="sso-client-id"
              compact
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="sso-client-secret">Client secret</Label>
            <Input
              id="sso-client-secret"
              compact
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              // Never shown back. Empty keeps the stored one.
              placeholder={sso.has_secret ? "Stored — leave empty to keep it" : ""}
            />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          {sso.configured ? (
            <Button
              size="xs"
              variant="outline"
              type="button"
              onClick={() => setConfirmRemove(true)}
              className="!border-error-300 !text-error-500"
            >
              Remove
            </Button>
          ) : (
            <span />
          )}
          <Button size="xs" type="button" onClick={save} disabled={!canSave}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <Modal isOpen={confirmRemove} onClose={() => setConfirmRemove(false)} className="max-w-md p-6">
        <h4 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          Remove single sign-on
        </h4>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Their people will sign in with a SmartDoc password from now on. Anybody who never set one
          will need "Forgot password". To stop it for a while instead, switch it off and save.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            size="xs"
            type="button"
            variant="outline"
            onClick={() => setConfirmRemove(false)}
            disabled={removing}
          >
            Cancel
          </Button>
          <Button
            size="xs"
            type="button"
            onClick={remove}
            disabled={removing}
            className="!bg-error-500 hover:!bg-error-600"
          >
            {removing ? "Removing..." : "Remove"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
