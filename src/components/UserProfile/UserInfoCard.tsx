import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { authService } from "../../services/authService";
import Button from "../ui/button/Button";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import Toast from "../common/Toast";

/**
 * The details the account carries. They live in Keycloak, not in this
 * app's database. The two names are theirs to change, through `auth_api`'s
 * `/update_profile`; the username and email are shown only — one is an
 * identity, the other is how they are reached, and both are an
 * administrator's to change.
 */
export default function UserInfoCard() {
  const { user, refreshUser } = useAuth();
  const [firstName, setFirstName] = useState(user?.given_name ?? "");
  const [lastName, setLastName] = useState(user?.family_name ?? "");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ text: string; kind: "ok" | "error" } | null>(null);

  // The form follows the account, not the other way round: a refresh after
  // saving brings the names back as Keycloak has them.
  useEffect(() => {
    setFirstName(user?.given_name ?? "");
    setLastName(user?.family_name ?? "");
  }, [user?.given_name, user?.family_name]);

  const changed =
    firstName.trim() !== (user?.given_name ?? "") || lastName.trim() !== (user?.family_name ?? "");
  const ready = changed && firstName.trim().length > 0 && lastName.trim().length > 0;

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    setNote(null);
    try {
      const token = await authService.ensureValidToken();
      await authService.updateProfile(firstName.trim(), lastName.trim(), token);
      // Keycloak has it; now everything that shows the name — the header,
      // the initials — reads it back.
      await refreshUser();
      setNote({ text: "Saved", kind: "ok" });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : "Could not save the name", kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full p-5 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          Personal Information
        </h4>
        <span className="flex items-center gap-3">
          {note && (
            <Toast
              message={note.text}
              type={note.kind === "ok" ? "success" : "error"}
              onClose={() => setNote(null)}
            />
          )}
          <Button size="xs" onClick={save} disabled={saving || !ready}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="profile-first">First name</Label>
          <Input
            id="profile-first"
            compact
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="profile-last">Last name</Label>
          <Input
            id="profile-last"
            compact
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="profile-username">Username</Label>
          <Input id="profile-username" compact type="text" value={user?.preferred_username ?? ""} disabled />
        </div>
        <div>
          <Label htmlFor="profile-email">Email address</Label>
          <Input id="profile-email" compact type="text" value={user?.email ?? ""} disabled />
        </div>
      </div>
      <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
        Username and email are set by your administrator.
      </p>
    </div>
  );
}
