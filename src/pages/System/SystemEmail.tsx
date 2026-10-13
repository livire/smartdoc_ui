import { useCallback, useEffect, useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import Toast from "../../components/common/Toast";
import { Modal } from "../../components/ui/modal";
import Button from "../../components/ui/button/Button";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../../components/ui/table";
import { LockIcon, PencilIcon } from "../../icons";
import {
  smtpService,
  SmtpAccount,
  isSmartDocAccount,
  ALLOWED_PORTS,
} from "../../services/smtpService";

const emptyAccount = {
  display_name: "",
  host: "",
  port: 587,
  username: "",
  from_address: "",
  from_name: "",
  is_active: 1 as 0 | 1,
};

/**
 * The email accounts SmartDoc's mail goes out through.
 *
 * **Why this screen exists.** SmartDoc began sending its own mail on
 * 2026-10-13 — the password links that used to come from Keycloak. The
 * account was five fields in Vault, which meant a shell on the server to
 * change a port, and one account for everybody.
 *
 * **One SmartDoc account is the default, and without it no mail is sent.**
 * Not "whichever one we find first": two accounts and no default marked is
 * how mail goes out from the wrong address for a month before anybody
 * notices. Asking for a password link then answers "no SmartDoc email
 * account is marked the default", loudly.
 *
 * **A customer's own account is listed here but not edited here.** It is
 * theirs — their server, their address, their password — and the place to
 * change it is their own screen. Shown so this page answers "who sends
 * what?" rather than half of it.
 */
export default function SystemEmail() {
  const [accounts, setAccounts] = useState<SmtpAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<SmtpAccount | null>(null);
  const [form, setForm] = useState(emptyAccount);
  const [saving, setSaving] = useState(false);

  // The password is a second step, as a storage's keys are: its Vault path
  // is built from the row's id, so the row has to exist first.
  const [passwordFor, setPasswordFor] = useState<SmtpAccount | null>(null);
  const [password, setPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  // Which account is being tested. What it said goes to the toast, like
  // every other outcome on this screen.
  const [testing, setTesting] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts(await smtpService.list());
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
    setForm(emptyAccount);
    setIsFormOpen(true);
  };

  const openEdit = (account: SmtpAccount) => {
    setEditing(account);
    setForm({
      display_name: account.display_name,
      host: account.host,
      port: account.port,
      username: account.username,
      from_address: account.from_address,
      from_name: account.from_name ?? "",
      is_active: account.is_active,
    });
    setIsFormOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        display_name: form.display_name.trim(),
        host: form.host.trim(),
        port: Number(form.port),
        username: form.username.trim(),
        from_address: form.from_address.trim(),
        from_name: form.from_name.trim() || null,
        is_active: form.is_active,
      };

      const saved = editing
        ? await smtpService.update({ ...payload, smtp_id: editing.smtp_id })
        : await smtpService.create(payload);

      setIsFormOpen(false);
      setToast({ message: `"${saved.display_name}" saved`, type: "success" });

      // A new account has no password yet, so ask straight away — the same
      // order the storage screen uses, and for the same reason: it cannot
      // send anything until there is one.
      if (!editing) {
        setPasswordFor(saved);
        setPassword("");
      }
      await load();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Could not save", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const savePassword = async () => {
    if (!passwordFor) return;
    setSavingPassword(true);
    try {
      await smtpService.setPassword(passwordFor.smtp_id, password);
      setPasswordFor(null);
      setPassword("");
      setToast({ message: "Password stored", type: "success" });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Could not store the password",
        type: "error",
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const test = async (account: SmtpAccount) => {
    setTesting(account.smtp_id);
    try {
      const answer = await smtpService.test(account.smtp_id);
      setToast(
        answer.ok
          ? { message: `"${account.display_name}" connected.`, type: "success" }
          : {
              message: `"${account.display_name}": ${answer.reason ?? "could not connect"}`,
              type: "error",
            }
      );
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Could not test it",
        type: "error",
      });
    } finally {
      setTesting(null);
    }
  };

  const remove = async (account: SmtpAccount) => {
    if (!window.confirm(`Remove "${account.display_name}"?`)) return;
    try {
      await smtpService.remove(account.smtp_id);
      setToast({ message: `"${account.display_name}" removed`, type: "success" });
      await load();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Could not remove it", type: "error" });
    }
  };

  // **SmartDoc's own only.** A customer's server was listed here too, so
  // this page could answer "who sends what?" — but it is theirs, it cannot
  // be changed from here, and a list of other people's servers is a list
  // nobody running SmartDoc acts on. It is on their own Email tab, where it
  // can be changed.
  const smartdoc = accounts.filter(isSmartDocAccount);

  return (
    // The same shape as AI Models: a toolbar across the top, the list in a
    // card below it. `SystemLayout` gives its screens no padding and no
    // background of their own, so each supplies both.
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50 dark:bg-gray-900">
      <PageMeta title="SMTP Server | SmartDoc" description="" />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* **No title and no explanation.** The menu on the left says Email,
          and a paragraph about what the page is for is read once and then
          sits above the work for ever.

          No search either, unlike AI Models: there are as many accounts here
          as SmartDoc has sending addresses, and a box to filter two rows is
          a control that does nothing. */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-4 py-2.5 dark:border-gray-800 dark:bg-gray-800">
        <span className="ml-auto">
          <Button size="xs" onClick={openNew}>
            Add server
          </Button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <Table>
            <TableHeader className="border-b border-gray-100 dark:border-gray-800">
              <TableRow>
                {["Account", "Server", "From", ""].map((h, i) => (
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
                  <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={4}>
                    Loading...
                  </TableCell>
                </TableRow>
              ) : smartdoc.length === 0 ? (
                <TableRow>
                  <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={4}>
                    No SMTP servers yet. Add one, then choose it for each customer on their SMTP Server tab.
                  </TableCell>
                </TableRow>
              ) : (
                smartdoc.map((account) => (
                  <TableRow
                    key={account.smtp_id}
                    className="transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                  >
                    <TableCell className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-800 dark:text-white/90">
                      <span className="flex items-center gap-2">
                        {account.display_name}
                        {account.is_active !== 1 && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                            Off
                          </span>
                        )}
                      </span>
                    </TableCell>
                    {/* The host and the login, kept apart from the address
                        it sends as: one is how SmartDoc connects, the other
                        is what the mail carries, and they are often
                        different. */}
                    <TableCell className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                      {account.host}:{account.port}
                      <span className="block">{account.username}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {account.from_name
                        ? `${account.from_name} <${account.from_address}>`
                        : account.from_address}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-3 text-end">
                      <span className="flex items-center justify-end gap-1">
                        <Button
                          size="xs"
                          variant="outline"
                          type="button"
                          disabled={testing === account.smtp_id}
                          onClick={() => test(account)}
                        >
                          {testing === account.smtp_id ? "Testing..." : "Test"}
                        </Button>
                        <button
                          type="button"
                          title="Set the password"
                          onClick={() => {
                            setPasswordFor(account);
                            setPassword("");
                          }}
                          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                        >
                          <LockIcon className="size-4" />
                        </button>
                        <button
                          type="button"
                          title="Edit"
                          onClick={() => openEdit(account)}
                          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                        >
                          <PencilIcon className="size-4" />
                        </button>
                        <button
                          type="button"
                          title="Remove"
                          onClick={() => remove(account)}
                          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-error-500 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                            <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z" />
                          </svg>
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

      {/* Adding or changing one of SmartDoc's own. */}
      <Modal isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} className="max-w-lg p-6">
        <h4 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
          {editing ? "Edit SMTP server" : "Add SMTP server"}
        </h4>

        <div className="space-y-3">
          <div>
            <Label htmlFor="smtp-name">Name *</Label>
            <Input
              id="smtp-name"
              compact
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              placeholder="Zoho (SmartDoc)"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label htmlFor="smtp-host">Host *</Label>
              <Input
                id="smtp-host"
                compact
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="smtp.zoho.com"
              />
            </div>
            <div>
              <Label htmlFor="smtp-port">Port *</Label>
              {/* Three ports, all of them SMTP. A free number here would let
                  this screen point SmartDoc at anything listening. */}
              <select
                id="smtp-port"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                className="h-9 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              >
                {ALLOWED_PORTS.map((port) => (
                  <option key={port} value={port}>
                    {port}
                    {port === 587 ? " (STARTTLS)" : port === 465 ? " (TLS)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="smtp-username">Username *</Label>
            <Input
              id="smtp-username"
              compact
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="no-reply@fasteksystems.com"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="smtp-from">From address *</Label>
              <Input
                id="smtp-from"
                compact
                value={form.from_address}
                onChange={(e) => setForm({ ...form, from_address: e.target.value })}
                placeholder="no-reply@fasteksystems.com"
              />
            </div>
            <div>
              <Label htmlFor="smtp-from-name">From name</Label>
              <Input
                id="smtp-from-name"
                compact
                value={form.from_name}
                onChange={(e) => setForm({ ...form, from_name: e.target.value })}
                placeholder="SmartDoc"
              />
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={form.is_active === 1}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked ? 1 : 0 })}
                className="size-4 rounded border-gray-300 text-brand-500 dark:border-gray-600 dark:bg-gray-900"
              />
              In use
            </label>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <Button
            size="xs"
            type="button"
            variant="outline"
            onClick={() => setIsFormOpen(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size="xs"
            type="button"
            onClick={save}
            disabled={
              saving ||
              !form.display_name.trim() ||
              !form.host.trim() ||
              !form.username.trim() ||
              !form.from_address.trim()
            }
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </Modal>

      {/* The password goes to Vault, never to the database, and never comes
          back — the same arrangement as a storage's keys, and for the same
          reason: every response body is logged. */}
      <Modal isOpen={!!passwordFor} onClose={() => setPasswordFor(null)} className="max-w-md p-6">
        <h4 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Password</h4>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          For {passwordFor?.display_name}. Stored safely and never shown again. Press Test
          afterwards to check it.
        </p>

        <Input
          compact
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Paste the password"
        />

        <div className="mt-5 flex justify-end gap-3">
          <Button
            size="xs"
            type="button"
            variant="outline"
            onClick={() => setPasswordFor(null)}
            disabled={savingPassword}
          >
            Cancel
          </Button>
          <Button
            size="xs"
            type="button"
            onClick={savePassword}
            disabled={savingPassword || !password.trim()}
          >
            {savingPassword ? "Saving..." : "Save password"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
