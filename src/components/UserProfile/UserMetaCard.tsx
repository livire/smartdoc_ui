import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { authService } from "../../services/authService";
import {
  avatarService,
  prepareAvatar,
  AVATAR_PIXELS,
  MAX_FILE_LABEL,
} from "../../services/avatarService";
import Toast from "../common/Toast";

/**
 * Who is signed in. Everything here comes from the token — this app holds no
 * profile of its own beyond a username.
 */
export default function UserMetaCard() {
  const { user } = useAuth();
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!user?.user_id) return;
    let cancelled = false;

    (async () => {
      try {
        const token = await authService.ensureValidToken();
        const stored = await avatarService.get(user.user_id!, token);
        if (!cancelled) setAvatar(stored);
      } catch {
        // No picture is a perfectly good state; initials do the job.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.user_id]);

  const choose = async (file: File) => {
    if (!user?.user_id) return;
    setBusy(true);
    setError(null);
    try {
      // Checked and cut down in the browser: the API never handles a file,
      // and what is stored is a few tens of kilobytes.
      const { dataUrl, contentType } = await prepareAvatar(file);
      const token = await authService.ensureValidToken();
      await avatarService.save(user.user_id, dataUrl, contentType, token);
      setAvatar(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not use that image");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!user?.user_id) return;
    setBusy(true);
    setError(null);
    try {
      const token = await authService.ensureValidToken();
      await avatarService.remove(user.user_id, token);
      setAvatar(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the picture");
    } finally {
      setBusy(false);
    }
  };

  const fullName = [user?.given_name, user?.family_name].filter(Boolean).join(" ");
  const initials =
    [user?.given_name?.[0], user?.family_name?.[0]].filter(Boolean).join("").toUpperCase() ||
    user?.preferred_username?.[0]?.toUpperCase() ||
    "?";

  return (
    <div className="p-5 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6">
      <div className="flex items-center gap-5">
        <div className="relative size-20 shrink-0">
          {avatar ? (
            <img
              src={avatar}
              alt=""
              className="size-20 rounded-full object-cover"
            />
          ) : (
            <div className="flex size-20 items-center justify-center rounded-full bg-brand-500/10 text-xl font-semibold text-brand-500">
              {initials}
            </div>
          )}

          <button
            type="button"
            title="Change picture"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-theme-xs hover:text-brand-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
          >
            {busy ? (
              <span className="block size-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
                <path d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10z" />
              </svg>
            )}
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) choose(file);
            }}
          />
        </div>
        <div className="min-w-0">
          <h4 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {fullName || user?.preferred_username || "—"}
          </h4>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
            <span>{user?.preferred_username}</span>
            {user?.email && (
              <>
                <span className="hidden h-3.5 w-px bg-gray-300 dark:bg-gray-700 sm:block" />
                <span className="truncate">{user.email}</span>
              </>
            )}
          </div>

          {/* What is stored is the number that matters — the input limit is
              only what we will read and decode. */}
          <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
            JPG, PNG or WebP · stored as {AVATAR_PIXELS}×{AVATAR_PIXELS}, about 30KB · source up
            to {MAX_FILE_LABEL}
            {avatar && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={clear}
                  disabled={busy}
                  className="text-gray-500 hover:text-error-500 hover:underline disabled:opacity-50 dark:text-gray-400"
                >
                  Remove
                </button>
              </>
            )}
          </p>
          {error && <Toast message={error} type="error" onClose={() => setError(null)} />}
        </div>
      </div>
    </div>
  );
}
