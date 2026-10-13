import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import Button from "../ui/button/Button";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import { Modal } from "../ui/modal";
import Toast from "../common/Toast";
import { smtpService, SmtpAccount, Sender, ALLOWED_PORTS } from "../../services/smtpService";

const emptyAccount = {
  display_name: "",
  host: "",
  port: 587,
  username: "",
  from_address: "",
  from_name: "",
};

/**
 * A customer's own SMTP server.
 *
 * **What it changes.** Without one, every password link for this customer's
 * people comes from SmartDoc's address. With one, it comes from theirs —
 * which is what somebody wants when their staff should see mail from their
 * own company and not from a supplier.
 *
 * **One account, not a list.** Mail comes from one address; a second would
 * sit there doing nothing. Changing the one they have is the edit.
 *
 * **Adding is off unless SmartDoc has agreed to it** (`can_add_smtp`). The
 * button is simply absent then; a disabled one would invite asking the wrong
 * person.
 *
 * Used twice: on the customer's own settings, where they can add and change
 * it, and on `/sys` → a customer → Email with `canAdd={false}`, where it is
 * only shown — it is their server and their password.
 */
export interface CustomerOwnSmtpHandle {
  /** Write the chosen server. Called by the page's one Save. */
  save: () => Promise<void>;
  /** Whether the choice has been changed and not yet saved. */
  dirty: boolean;
}

const CustomerOwnSmtp = forwardRef(function CustomerOwnSmtp({
  canAdd,
  customerId,
  customerName,
  hideWhenEmpty = false,
  useOwn,
}: {
  canAdd: boolean;
  customerId: number;
  /** Heads the card — "POPO SMTP server". */
  customerName?: string | null;
  /**
   * Draw nothing at all when they have no server and cannot add one.
   *
   * For `/sys`, where a card saying "None" under a dropdown that already
   * names the sender is the same answer twice. On the customer's own screen
   * the card stays: there, "none, and SmartDoc has not allowed you one" is
   * the answer to why the tab looks empty.
   */
  hideWhenEmpty?: boolean;
  /**
   * Whether this customer has their own server switched on, for `/sys`,
   * which cannot ask `/smtp_account/resolved` — that answers for whoever is
   * asking, and a system administrator has no customer.
   */
  useOwn?: boolean;
}, ref: React.Ref<CustomerOwnSmtpHandle>) {
  const [accounts, setAccounts] = useState<SmtpAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<SmtpAccount | null>(null);
  const [form, setForm] = useState(emptyAccount);
  const [saving, setSaving] = useState(false);

  // The password is a second step: its Vault path is built from the row's
  // id, so the row has to exist first. Same as a storage's keys.
  const [passwordFor, setPasswordFor] = useState<SmtpAccount | null>(null);
  const [password, setPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [testing, setTesting] = useState(false);
  // Removing asks first, in a dialog of our own: `window.confirm` is the
  // browser's, cannot be read at a glance, and looks like a warning from the
  // page rather than part of it.
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Where this customer's mail comes from, what else it could come from,
  // and which of the two is in force. The server works it out — the screen
  // showing one thing while the mailer does another is the fault this
  // closes.
  const [sender, setSender] = useState<Sender | null>(null);
  /**
   * The choice as the screen has it, which is not yet the choice as the
   * server has it.
   *
   * **Held until Save**, like every other field on this page. It wrote
   * itself the moment the dropdown changed, which on a page with one Save
   * button reads as a setting that did not take — somebody changes it,
   * presses Save, and cannot tell which of the two did the work.
   */
  const [chosen, setChosen] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts(await smtpService.own(customerId));
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Could not load", type: "error" });
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  // **Only on the customer's own screen.** `/smtp_account/resolved` answers
  // for whoever is asking, and a system administrator has no customer — it
  // would throw "no SmartDoc user matches this token". `hideWhenEmpty` is
  // set by `/sys` and by nothing else.
  const loadSender = useCallback(() => {
    if (hideWhenEmpty) return;
    smtpService
      .resolved()
      .then((answer) => {
        setSender(answer);
        setChosen(null);
      })
      .catch(() => setSender(null));
  }, [hideWhenEmpty]);

  useEffect(() => {
    if (hideWhenEmpty) return;
    let alive = true;
    smtpService
      .resolved()
      .then((answer) => {
        if (!alive) return;
        setSender(answer);
        setChosen(null);
      })
      .catch(() => {
        // Nothing to say rather than a wrong thing: the card falls back to
        // what it knows from the account list alone.
        if (alive) setSender(null);
      });
    return () => {
      alive = false;
    };
  }, [hideWhenEmpty, accounts.length]);

  const account = accounts[0] ?? null;

  const openNew = () => {
    setEditing(null);
    setForm(emptyAccount);
    setIsFormOpen(true);
  };

  const openEdit = (row: SmtpAccount) => {
    setEditing(row);
    setForm({
      display_name: row.display_name,
      host: row.host,
      port: row.port,
      username: row.username,
      from_address: row.from_address,
      from_name: row.from_name ?? "",
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
      };

      const saved = editing
        ? await smtpService.update({ ...payload, smtp_id: editing.smtp_id })
        : await smtpService.create(payload);

      setIsFormOpen(false);
      setToast({ message: "Email server saved", type: "success" });

      // Nothing can be sent until there is a password, so ask straight away.
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
      setToast({ message: "Password stored — press Test to check it", type: "success" });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Could not store the password",
        type: "error",
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const test = async () => {
    if (!account) return;
    setTesting(true);
    try {
      const answer = await smtpService.test(account.smtp_id);
      setToast(
        answer.ok
          ? { message: "Connected. The host, port and password are right.", type: "success" }
          : { message: answer.reason ?? "Could not connect", type: "error" }
      );
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Could not test it",
        type: "error",
      });
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    if (!account) return;
    setRemoving(true);
    try {
      await smtpService.remove(account.smtp_id);
      setConfirmRemove(false);
      setToast({ message: "Email server removed", type: "success" });
      await load();
      loadSender();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Could not remove it", type: "error" });
    } finally {
      setRemoving(false);
    }
  };

  // What the dropdown shows: the unsaved choice if there is one, otherwise
  // what the server says.
  const useOwnNow = chosen ?? sender?.use_own ?? true;
  const dirty = chosen !== null && sender !== null && chosen !== sender.use_own;

  useImperativeHandle(ref, () => ({
    dirty,
    save: async () => {
      if (!dirty) return;
      await smtpService.setUseOwn(useOwnNow);
      loadSender();
    },
  }));

  if (hideWhenEmpty && !loading && !account && !canAdd) return null;

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {loading ? (
        <p className="py-2 text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="space-y-4">
          {/* ---- 1. Which server sends their mail ------------------------
              The choice, and the address it means. Separate from the server
              below because they are different jobs: this one is "whose
              address does our mail carry", that one is "is our server set up
              and working". Tying them together meant their own server could
              only be tested while it was the one in use. */}
          <div className="space-y-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
            {/* **The picker on the left, beside its label.** */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                Send our mail through
              </span>

              {/* **Always a dropdown, even with one thing in it.** It used
                  to disappear when they had no server of their own, and a
                  control that comes and goes reads as a setting that was
                  taken away. With one option it is there and frozen; with
                  none at all it is frozen and says so. */}
              <select
                value={useOwnNow && account ? "own" : "smartdoc"}
                onChange={(e) => setChosen(e.target.value === "own")}
                disabled={!sender?.smartdoc}
                className="h-9 min-w-[16rem] rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:disabled:bg-white/[0.03]"
              >
                {account && (
                  <option value="own">
                    {account.display_name}
                    {account.is_active !== 1 ? " (off)" : ""}
                  </option>
                )}
                <option value="smartdoc">
                  {sender?.smartdoc
                    ? (sender.smartdoc_name ?? "SmartDoc")
                    : "No server set by SmartDoc"}
                </option>
              </select>
            </div>

            {sender && !sender.from && !dirty ? (
              <p className="rounded-lg bg-warning-50 px-3 py-2.5 text-sm text-warning-700 dark:bg-warning-500/10 dark:text-warning-500">
                Email server not set by SmartDoc. Please contact your system administrator.
              </p>
            ) : (
              <div className="min-w-0 rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-white/[0.03]">
                <p className="truncate text-sm text-gray-800 dark:text-white/90">
                  {useOwnNow && account
                    ? account.from_name
                      ? `${account.from_name} <${account.from_address}>`
                      : account.from_address
                    : (sender?.smartdoc ?? sender?.from ?? "SmartDoc's address")}
                </p>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {useOwnNow && account ? "Your own server" : "Provided by SmartDoc"}
                  {dirty ? " — not saved yet" : ""}
                </p>
              </div>
            )}
          </div>

          {/* ---- 2. Their own server --------------------------------------
              Always here, whichever is selected above: a server that cannot
              be reached has to be fixable without first pointing the mail at
              it. Absent only when they have none and are not allowed one. */}
          {(account || canAdd) && (
            <div className="space-y-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {customerName ? `${customerName} SMTP server` : "Your SMTP server"}
                </span>
                {canAdd && !account && (
                  <Button
                    size="xs"
                    type="button"
                    variant="outline"
                    onClick={openNew}
                    startIcon={
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        className="size-4"
                      >
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    }
                  >
                    Add server
                  </Button>
                )}
              </div>

              {!account ? (
                <p className="rounded-lg bg-gray-50 px-3 py-2.5 text-sm text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
                  None yet.
                </p>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-white/[0.03]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-gray-800 dark:text-white/90">
                      {account.from_name
                        ? `${account.from_name} <${account.from_address}>`
                        : account.from_address}
                    </p>
                    <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {account.host}:{account.port} · {account.username}
                    </p>
                    {/* For `/sys`, which has no picker: it cannot ask
                        `/smtp_account/resolved`, because that answers for
                        whoever is asking and a system administrator has no
                        customer. The customer row says it instead. */}
                    {!sender && useOwn !== undefined && (
                      <span
                        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          useOwn
                            ? "bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500"
                            : "bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400"
                        }`}
                      >
                        {useOwn ? "In use" : "Not in use — they send through SmartDoc's"}
                      </span>
                    )}
                  </div>

                  <span className="flex flex-shrink-0 items-center gap-1">
                    <Button
                      size="xs"
                      variant="outline"
                      type="button"
                      disabled={testing}
                      onClick={test}
                    >
                      {testing ? "Testing..." : "Test"}
                    </Button>
                    {canAdd && (
                      <>
                        <button
                          type="button"
                          title="Set the password"
                          onClick={() => {
                            setPasswordFor(account);
                            setPassword("");
                          }}
                          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                            <path d="M12 1a5 5 0 0 0-5 5v4H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5Zm3 9H9V6a3 3 0 1 1 6 0v4Z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          title="Edit"
                          onClick={() => openEdit(account)}
                          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                            <path d="m14.06 9.02.92.92L5.92 19H5v-.92l9.06-9.06M17.66 3c-.25 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83a.996.996 0 0 0 0-1.41l-2.34-2.34c-.2-.2-.45-.29-.71-.29Zm-3.6 3.19L3 17.25V21h3.75L17.81 9.94l-3.75-3.75Z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          title="Remove"
                          onClick={() => setConfirmRemove(true)}
                          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-error-500 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                            <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z" />
                          </svg>
                        </button>
                      </>
                    )}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Removing it. Its own dialog rather than `window.confirm`, which
          cannot say what else changes — and what else changes is the
          address every password link for these people will carry. */}
      <Modal isOpen={confirmRemove} onClose={() => setConfirmRemove(false)} className="max-w-md p-6">
        <div className="flex items-start gap-4">
          <span className="flex size-10 flex-shrink-0 items-center justify-center rounded-full bg-error-50 text-error-500 dark:bg-error-500/10">
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
              <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z" />
            </svg>
          </span>
          <div className="min-w-0">
            <h4 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              Remove SMTP server
            </h4>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {account
                ? `${account.display_name} — ${account.from_address}`
                : "This SMTP server"}
            </p>
          </div>
        </div>

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
          {/* The same Button as every other dialog here, so the two match.
              Red through an `!` override because the component knows only
              primary and outline, and a raw <button> beside a Button is two
              different heights. */}
          <Button
            size="xs"
            type="button"
            onClick={remove}
            disabled={removing}
            className="!bg-error-500 hover:!bg-error-600"
          >
            {removing ? "Removing..." : "Remove server"}
          </Button>
        </div>
      </Modal>

      {/* Adding or changing it. */}
      <Modal isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} className="max-w-lg p-6">
        <h4 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
          {editing ? "Edit SMTP server" : "Add SMTP server"}
        </h4>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Password links for your people will come from this address instead of SmartDoc's.
        </p>

        <div className="space-y-3">
          <div>
            <Label htmlFor="own-smtp-name">Name *</Label>
            <Input
              id="own-smtp-name"
              compact
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              placeholder="Our mail server"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label htmlFor="own-smtp-host">Host *</Label>
              <Input
                id="own-smtp-host"
                compact
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="smtp.yourcompany.com"
              />
            </div>
            <div>
              <Label htmlFor="own-smtp-port">Port *</Label>
              <select
                id="own-smtp-port"
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
            <Label htmlFor="own-smtp-username">Username *</Label>
            <Input
              id="own-smtp-username"
              compact
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="no-reply@yourcompany.com"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="own-smtp-from">From address *</Label>
              <Input
                id="own-smtp-from"
                compact
                value={form.from_address}
                onChange={(e) => setForm({ ...form, from_address: e.target.value })}
                placeholder="no-reply@yourcompany.com"
              />
            </div>
            <div>
              <Label htmlFor="own-smtp-from-name">From name</Label>
              <Input
                id="own-smtp-from-name"
                compact
                value={form.from_name}
                onChange={(e) => setForm({ ...form, from_name: e.target.value })}
                placeholder="Your company"
              />
            </div>
          </div>

          {/* Said before they save, not after a refusal. */}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            The host must be reachable on the internet — an address inside a private network is
            refused.
          </p>
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
          For {passwordFor?.username}. Stored safely and never shown again.
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
});

export default CustomerOwnSmtp;
