import { useMemo, useState } from "react";
import { Modal } from "../ui/modal";
import Button from "../ui/button/Button";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import { authService } from "../../services/authService";
import { customerService } from "../../services/customerService";
import { useCustomer } from "../../context/CustomerContext";
import Toast from "../common/Toast";

/**
 * Somebody changing their own password, from the user menu.
 *
 * Goes through the same door as a temporary password: the current password
 * is the proof, `auth_api` sets the new one and signs them in with it, and
 * the tokens it hands back replace the ones in use — so nothing else about
 * the session moves.
 */
export default function ChangePasswordDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string, type: "success" | "error") => void;
}) {
  /**
   * What this customer asks of a password.
   *
   * **Read, not assumed.** This dialog said "At least 8 characters" and
   * refused anything shorter, whatever the customer had set — so somebody at
   * a customer asking for 10 and a symbol was told 8 would do, typed one,
   * and was refused by `auth_api` with a different message. The rules live in
   * `customer_setting` and are already on this browser: the same cached read
   * the sign-in form and the Users screen use.
   */
  const { customer } = useCustomer();
  const rules = useMemo(() => {
    const settings = customer?.customer_id
      ? customerService.readCachedSettings(Number(customer.customer_id))
      : null;
    return {
      minLength: Number(settings?.password_min_length ?? 8),
      needsDigit: settings?.password_needs_digit === 1,
      needsSymbol: settings?.password_needs_symbol === 1,
      needsCapital: settings?.password_needs_capital === 1,
    };
  }, [customer?.customer_id]);

  // Every rule and whether it is met, so somebody sees what is left rather
  // than being refused once they have finished typing.
  const checks = (value: string) => {
    const list = [{ text: `At least ${rules.minLength} characters`, met: value.length >= rules.minLength }];
    if (rules.needsDigit) list.push({ text: "A number", met: /[0-9]/.test(value) });
    if (rules.needsCapital) list.push({ text: "A capital letter", met: /[A-Z]/.test(value) });
    if (rules.needsSymbol) list.push({ text: "A symbol", met: /[^A-Za-z0-9]/.test(value) });
    return list;
  };

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const met = checks(next);
  const ready =
    current.length > 0 && met.every((r) => r.met) && next === again && next !== current;

  const submit = async () => {
    const username = authService.getStoredUser()?.preferred_username;
    if (!username || !ready) return;
    setSaving(true);
    setError(null);
    try {
      const tokens = await authService.completePassword(username, current, next);
      const { access_token, refresh_token, token_expiry } = tokens.data;
      authService.saveTokens(access_token, refresh_token, token_expiry);
      onDone("Password reset", "success");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} className="max-w-sm p-6">
      <h3 className="mb-4 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
        Reset password
      </h3>

      {error && <Toast message={error} type="error" onClose={() => setError(null)} />}

      <div className="space-y-4">
        <div>
          <Label htmlFor="pw-current">Current password</Label>
          <Input
            id="pw-current"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="pw-next">New password</Label>
          <Input
            id="pw-next"
            type="password"
            placeholder={`At least ${rules.minLength} characters`}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />

          <ul className="mt-2 space-y-1 rounded-lg bg-gray-50 p-2.5 dark:bg-white/[0.03]">
            {met.map((rule) => (
              <li
                key={rule.text}
                className={`flex items-center gap-2 text-xs ${
                  rule.met
                    ? "text-success-600 dark:text-success-500"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                <span className="w-3 text-center">{rule.met ? "✓" : "•"}</span>
                {rule.text}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <Label htmlFor="pw-again">New password again</Label>
          <Input
            id="pw-again"
            type="password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
          {next.length > 0 && again && next !== again && (
            <p className="mt-1.5 text-xs text-error-600 dark:text-error-400">
              The two passwords are not the same.
            </p>
          )}
          {next && next === current && (
            <p className="mt-1.5 text-xs text-error-600 dark:text-error-400">
              The new password must be different from the current one.
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-3">
        <Button size="xs" type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button size="xs" type="button" disabled={saving || !ready} onClick={submit}>
          {saving ? "Resetting..." : "Reset password"}
        </Button>
      </div>
    </Modal>
  );
}
