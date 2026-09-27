import { useState } from "react";
import { Modal } from "../ui/modal";
import Button from "../ui/button/Button";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import { authService } from "../../services/authService";
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
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = current.length > 0 && next.length >= 8 && next === again && next !== current;

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
            placeholder="At least 8 characters"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="pw-again">New password again</Label>
          <Input
            id="pw-again"
            type="password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
          {next.length >= 8 && again && next !== again && (
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
