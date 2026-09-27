import { useEffect, useState } from "react";
import Button from "../ui/button/Button";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import { Modal } from "../ui/modal";
import {
  projectApiKeyService,
  ProjectApiKey,
  IdentifierPush,
} from "../../services/projectApiKeyService";

const OUTCOMES: Record<number, { label: string; tone: string }> = {
  201: { label: "Created", tone: "text-success-600 dark:text-success-500" },
  409: { label: "Already there", tone: "text-warning-600 dark:text-warning-500" },
  400: { label: "Bad value", tone: "text-error-600 dark:text-error-500" },
  401: { label: "Bad key", tone: "text-error-600 dark:text-error-500" },
  429: { label: "Too many", tone: "text-error-600 dark:text-error-500" },
  500: { label: "Failed", tone: "text-error-600 dark:text-error-500" },
};

/**
 * The inbound webhook for one project: the keys an outside system uses to
 * push identifiers here as it creates them, and what it has sent lately.
 *
 * The key is shown once, in a dialog, at the moment it is issued. It is not
 * stored anywhere — only its hash is — so it cannot be shown again, and
 * nothing here keeps it after the dialog closes.
 */
export default function IdentifierPushCard({
  projectId,
  onToast,
}: {
  projectId: number;
  onToast: (message: string, type: "success" | "error") => void;
}) {
  const [keys, setKeys] = useState<ProjectApiKey[]>([]);
  const [pushes, setPushes] = useState<IdentifierPush[]>([]);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [revoking, setRevoking] = useState<number | null>(null);
  // The key, for as long as the dialog is open and not a moment longer.
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Revoked and expired keys are kept — the push log refers to them — but
  // they are history, and a card that grows every time one is revoked is a
  // card nobody can read. Hidden behind a switch, in a box of fixed height.
  const [showPast, setShowPast] = useState(false);
  // Issuing asks first, because a key's lifetime cannot be changed
  // afterwards — a key is reissued, not edited.
  const [issueOpen, setIssueOpen] = useState(false);
  // How long the key lives. Spans rather than a date box: "90 days" is
  // what somebody means, and working out what date that is should not be
  // their job.
  const [lifetime, setLifetime] = useState<"never" | "30" | "90" | "180" | "365">("never");

  const endpoint = `${import.meta.env.VITE_API_URL}/identifier/push`;

  const load = async () => {
    setLoading(true);
    try {
      const [keyRows, pushRows] = await Promise.all([
        projectApiKeyService.list(projectId),
        projectApiKeyService.pushLog(projectId, 20).catch(() => []),
      ]);
      setKeys(keyRows);
      setPushes(pushRows);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not read the keys", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const issue = async () => {
    setIssuing(true);
    try {
      const expiresAt = chosenExpiry();
      const created = await projectApiKeyService.issue(projectId, expiresAt);
      setIssueOpen(false);
      setFreshKey(created.key);
      setCopied(false);
      await load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not issue a key", "error");
    } finally {
      setIssuing(false);
    }
  };

  // The date the dialog's choice works out to — null for "no expiry". The
  // day it lands on ends that night, not at the hour it was issued.
  const chosenExpiry = (): string | null => {
    if (lifetime === "never") return null;
    const when = new Date();
    when.setDate(when.getDate() + Number(lifetime));
    when.setHours(23, 59, 59, 0);
    return when.toISOString();
  };

  // A key's lifetime as two columns — the date, and what is left of it —
  // with the colour that says whether it is worth noticing.
  const expiryOf = (k: ProjectApiKey): { date: string; left: string; tone: string } => {
    if (!k.expires_at) {
      return { date: "No expiry", left: "—", tone: "text-gray-500 dark:text-gray-400" };
    }
    const when = new Date(k.expires_at);
    const days = Math.ceil((when.getTime() - Date.now()) / 86_400_000);
    const date = when.toLocaleDateString();
    if (days < 0) return { date, left: "expired", tone: "text-error-600 dark:text-error-500" };
    if (days <= 14) {
      return {
        date,
        left: days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`,
        tone: "text-warning-600 dark:text-warning-500",
      };
    }
    return { date, left: `${days} days`, tone: "text-gray-500 dark:text-gray-400" };
  };

  const revoke = async (keyId: number) => {
    setRevoking(keyId);
    try {
      await projectApiKeyService.revoke(projectId, keyId);
      onToast("Key revoked", "success");
      await load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not revoke the key", "error");
    } finally {
      setRevoking(null);
    }
  };

  // A key is past when it has been revoked, or its date has gone by.
  const isPast = (k: ProjectApiKey) =>
    Boolean(k.revoked_at) || Boolean(k.expires_at && new Date(k.expires_at).getTime() <= Date.now());
  const live = keys.filter((k) => !isPast(k));
  const past = keys.filter(isPast);
  const shown = showPast ? [...live, ...past] : live;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-4">
          <p className="flex-shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">
            Keys{live.length > 0 ? ` · ${live.length} in use` : ""}
          </p>
          {past.length > 0 && (
          /* A switch, not a link: it is a view that stays on until it is
             turned off, and the state is worth seeing at a glance. */
          <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <button
              type="button"
              role="switch"
              aria-checked={showPast}
              onClick={() => setShowPast((on) => !on)}
              className={`flex h-4 w-7 flex-shrink-0 items-center rounded-full p-0.5 transition-colors ${
                showPast ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span
                className={`block size-3 rounded-full bg-white shadow-theme-xs transition-transform ${
                  showPast ? "translate-x-3" : ""
                }`}
              />
            </button>
            Revoked and expired ({past.length})
          </label>
        )}
        </span>
        <span className="flex items-center gap-3">
          {/* Beside the list it adds to, rather than at the top of the
              panel: issuing a key is the one thing this section is for. */}
          <Button
            size="xs"
            onClick={() => {
              setLifetime("never");
              setIssueOpen(true);
            }}
          >
            New key
          </Button>
        </span>
      </div>
      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {keys.length === 0
            ? "No key yet. Issue one and give it to whoever runs the other system."
            : "No key in use. Issue one, or show the revoked ones above."}
        </p>
      ) : (
        /* One height whatever is in it — the box scrolls, the card does not
           grow. Revealing a dozen revoked keys must not push the log and
           everything under it down the page. */
        <div className="h-32 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-800">
          <table className="w-full">
            <thead className="sticky top-0 bg-white dark:bg-gray-800">
              <tr className="border-b border-gray-100 dark:border-gray-800">
                {["Fingerprint", "Expiry", "Days left", "Last used", ""].map((h, i) => (
                  <th
                    key={h || i}
                    className={`whitespace-nowrap px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 ${
                      i === 4 ? "text-right" : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {shown.map((k) => {
                const expiry = expiryOf(k);
                return (
                  <tr key={k.project_api_key_id} className={isPast(k) ? "opacity-60" : ""}>
                    <td className="whitespace-nowrap px-3 py-2">
                      <code
                        className={`text-xs ${
                          isPast(k)
                            ? "text-gray-400 line-through dark:text-gray-500"
                            : "text-gray-800 dark:text-gray-200"
                        }`}
                      >
                        {k.key_label}
                      </code>
                    </td>
                    <td className={`whitespace-nowrap px-3 py-2 text-xs ${expiry.tone}`}>
                      {k.revoked_at ? new Date(k.revoked_at).toLocaleDateString() : expiry.date}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-2 text-xs ${expiry.tone}`}>
                      {k.revoked_at ? "—" : expiry.left}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : "never"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {!k.revoked_at && (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={revoking === k.project_api_key_id}
                          onClick={() => revoke(k.project_api_key_id)}
                        >
                          {revoking === k.project_api_key_id ? "Revoking..." : "Revoke"}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* The request, under the keys: somebody comes here for a key, and
          reads the example once. Three labelled parts — it was one
          sentence with a header and a body run together, which read as
          neither. */}
      <div className="mb-3 mt-4 rounded-lg bg-gray-50 p-3 dark:bg-white/[0.03]">
        <div className="flex items-start justify-between gap-3">
          <dl className="min-w-0 space-y-1.5 text-xs">
            <div className="flex gap-2">
              <dt className="w-16 flex-shrink-0 text-gray-500 dark:text-gray-400">Method</dt>
              <dd className="font-mono text-gray-800 dark:text-gray-200">POST</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 flex-shrink-0 text-gray-500 dark:text-gray-400">URL</dt>
              <dd className="min-w-0 break-all font-mono text-gray-800 dark:text-gray-200">
                {endpoint}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 flex-shrink-0 text-gray-500 dark:text-gray-400">Headers</dt>
              <dd className="min-w-0 break-all font-mono text-gray-800 dark:text-gray-200">
                X-SmartDoc-Key: <span className="text-gray-500 dark:text-gray-400">your key</span>
                <br />
                Content-Type: application/json
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 flex-shrink-0 text-gray-500 dark:text-gray-400">Body</dt>
              <dd className="min-w-0 break-all font-mono text-gray-800 dark:text-gray-200">
                {`{ "value": "44213" }`}
              </dd>
            </div>
          </dl>
          <Button
            size="xs"
            variant="outline"
            className="flex-shrink-0"
            onClick={async () => {
              const curl = `curl -i -X POST ${endpoint} \\\n  -H "X-SmartDoc-Key: YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"value":"44213"}'`;
              try {
                await navigator.clipboard.writeText(curl);
                onToast("Example copied — put your key in place of YOUR_KEY", "success");
              } catch {
                onToast("Could not copy", "error");
              }
            }}
          >
            Copy example
          </Button>
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="font-medium">value</span> is the identifier as the other system knows it.
          201 created · 409 it already exists.
        </p>
      </div>

      {pushes.length > 0 && (
        <>
          <p className="mb-2 mt-4 text-xs font-medium text-gray-500 dark:text-gray-400">
            Last {pushes.length} pushes
          </p>
          <div className="max-h-44 overflow-auto rounded-lg border border-gray-100 dark:border-gray-800">
            <table className="w-full">
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {pushes.map((p) => {
                  const outcome = OUTCOMES[p.outcome] ?? {
                    label: String(p.outcome),
                    tone: "text-gray-500",
                  };
                  return (
                    <tr key={p.identifier_push_log_id}>
                      <td className="whitespace-nowrap px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400">
                        {new Date(p.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-gray-800 dark:text-gray-200">
                        {p.identifier_value || "—"}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-1.5 text-xs font-medium ${outcome.tone}`}>
                        {outcome.label}
                      </td>
                      <td
                        className="max-w-48 truncate px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400"
                        title={p.message || undefined}
                      >
                        {p.message || ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Asked before the key exists: a lifetime cannot be changed
          afterwards, only reissued. */}
      {issueOpen && (
        <Modal isOpen onClose={() => setIssueOpen(false)} className="max-w-md p-6">
          <h3 className="mb-1 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
            New key
          </h3>
          <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
            Shown once, when it is created. Nothing can show it again.
          </p>

          <Label htmlFor="key-lifetime">Validity</Label>
          <select
            id="key-lifetime"
            value={lifetime}
            onChange={(e) => setLifetime(e.target.value as typeof lifetime)}
            className="h-9 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          >
            <option value="never" className="dark:bg-gray-900">No expiry (recommended)</option>
            <option value="30" className="dark:bg-gray-900">30 days</option>
            <option value="90" className="dark:bg-gray-900">90 days</option>
            <option value="180" className="dark:bg-gray-900">6 months</option>
            <option value="365" className="dark:bg-gray-900">1 year</option>
          </select>

          {/* The date a span works out to, so nobody has to count days —
              and the same line says so when there is no date. */}
          <p className="mt-1.5 text-right text-xs text-gray-500 dark:text-gray-400">
            Expiry:{" "}
            <span className="font-medium text-gray-700 dark:text-gray-200">
              {chosenExpiry()
                ? new Date(chosenExpiry()!).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "No expiry"}
            </span>
          </p>

          <div className="mt-5 flex justify-end gap-3">
            <Button size="xs" variant="outline" onClick={() => setIssueOpen(false)} disabled={issuing}>
              Cancel
            </Button>
            <Button
              size="xs"
              onClick={issue}
              disabled={issuing}
            >
              {issuing ? "Issuing..." : "Issue key"}
            </Button>
          </div>
        </Modal>
      )}

      {freshKey && (
        <Modal isOpen onClose={() => setFreshKey(null)} className="max-w-lg p-6">
          <h3 className="mb-2 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
            Your new key
          </h3>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            Copy it now and put it in the other system. SmartDoc keeps only a fingerprint of it, so
            this is the one time it can be shown. Lost, and you issue a new one.
          </p>

          <Label htmlFor="fresh-key">Key</Label>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Input id="fresh-key" compact type="text" value={freshKey} className="font-mono" />
            </div>
            <Button
              size="xs"
              className="h-9"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(freshKey);
                  setCopied(true);
                } catch {
                  onToast("Could not copy — select it and copy by hand", "error");
                }
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          <div className="mt-5 flex justify-end">
            <Button size="xs" onClick={() => setFreshKey(null)}>
              Done
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
