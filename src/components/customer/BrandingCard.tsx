import { useEffect, useRef, useState } from "react";
import Button from "../ui/button/Button";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import LogoPlaceholder from "../common/LogoPlaceholder";
import { authService } from "../../services/authService";
import { customerService } from "../../services/customerService";
import { modelCatalogueService, CatalogueModel } from "../../services/modelCatalogueService";

// Logos are stored as data URLs in the database, so they are shrunk here
// first. Wide rather than square: a logo is a strip, not a portrait. The two
// places one appears want different sizes — the sign-in page has room, the
// menu rail does not.
const LOGO_SIZES = {
  login: { max: [480, 160] as const, min: [160, 40] as const },
  // Stored at the same size as the sign-in logo. The menu draws it smaller,
  // but storing it small meant the rail had to scale a 240px image up, and it
  // never filled the space it was given.
  menu: { max: [480, 160] as const, min: [80, 24] as const },
};
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

async function prepareLogo(file: File, box: readonly [number, number]): Promise<string> {
  if (!ALLOWED.includes(file.type)) throw new Error("Choose a PNG, JPG, WebP or SVG");
  if (file.size > MAX_FILE_BYTES) throw new Error("That image is over 2MB — choose a smaller one");

  // An SVG is already small and scales by itself; there is nothing to resize.
  if (file.type === "image/svg+xml") {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("That file could not be read"));
      reader.readAsDataURL(file);
    });
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file could not be read as an image"));
      el.src = objectUrl;
    });

    // Fit inside the box, keeping the shape — never stretched to fill it.
    const [maxWidth, maxHeight] = box;
    const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser would not give us a canvas to draw on");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    // PNG: a logo usually has a transparent background, which JPEG cannot keep.
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function LogoField({
  title,
  hint,
  box,
  name,
  value,
  onChange,
  onError,
}: {
  title: string;
  hint: string;
  box: readonly [number, number];
  name?: string | null;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  onError: (message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
      <p className="text-sm font-medium text-gray-800 dark:text-white/90">{title}</p>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>

      <div className="mt-3 flex h-24 items-center justify-center rounded-lg bg-gray-50 p-3 dark:bg-white/[0.03]">
        {value ? (
          // h/w-full, not max-*: `max-` only ever shrinks, so a small logo sat
          // at its own size in the middle of the frame instead of filling it.
          <img src={value} alt="" className="h-full w-full object-contain" />
        ) : (
          <LogoPlaceholder name={name} />
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button size="xs" variant="outline" onClick={() => fileRef.current?.click()}>
          Choose image
        </Button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-gray-500 hover:text-error-500 hover:underline dark:text-gray-400"
          >
            Remove
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            onChange(await prepareLogo(file, box));
          } catch (err) {
            onError(err instanceof Error ? err.message : "Could not use that image");
          }
        }}
      />
    </div>
  );
}


/**
 * The Branding card: what this customer's SmartDoc is called on screen and
 * the two logos. Its own load and its own save, so it can sit on the
 * customer's settings page and on the system administrator's customer pane
 * alike — the same card, told which customer by prop.
 */
export default function BrandingCard({
  customerId,
  customerName,
  onToast,
}: {
  customerId: number;
  // A hint for the placeholder only; the label itself is never pre-filled
  // from it (see below).
  customerName?: string | null;
  onToast: (toast: { message: string; type: "success" | "error" }) => void;
}) {
  const [label, setLabel] = useState("");
  // The house limit for every project this customer has, unless a project
  // says otherwise. Kept as text while it is typed, so a half-deleted
  // number does not become 0 for a keystroke.
  const [maxFileMb, setMaxFileMb] = useState("10");
  // Kept as text while it is being typed, so a half-deleted number does not
  // become 0 for a keystroke — the same reason the size field is text.
  const [idleMinutes, setIdleMinutes] = useState("15");
  // What a password must look like here. Customer level only — a password
  // belongs to a person, and a person can be on several projects, so there
  // is no project-level answer.
  const [pwMinLength, setPwMinLength] = useState("8");
  const [pwDigit, setPwDigit] = useState(false);
  const [pwSymbol, setPwSymbol] = useState(false);
  const [pwCapital, setPwCapital] = useState(false);
  // The models every project here uses unless it says otherwise. Chosen
  // from what SmartDoc offers; the keys are SmartDoc's and never seen.
  const [categoriseModelId, setCategoriseModelId] = useState("");
  const [readModelId, setReadModelId] = useState("");
  const [offered, setOffered] = useState<CatalogueModel[]>([]);
  const [loginLogo, setLoginLogo] = useState<string | null>(null);
  const [menuLogo, setMenuLogo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [settings, models] = await Promise.all([
          customerService.getSettings(customerId),
          modelCatalogueService.offered().catch(() => []),
        ]);
        if (cancelled) return;
        setOffered(models);
        // Empty when nothing has been set, with the customer's name as a
        // hint only. Pre-filling it would copy that name into every
        // customer's label on the first save, and leave it stale if the
        // customer were ever renamed.
        setLabel(settings?.customer_label ?? "");
        setMaxFileMb(String(settings?.max_file_mb ?? 10));
        setIdleMinutes(String(settings?.idle_timeout_minutes ?? 15));
        setPwMinLength(String(settings?.password_min_length ?? 8));
        setPwDigit(settings?.password_needs_digit === 1);
        setPwSymbol(settings?.password_needs_symbol === 1);
        setPwCapital(settings?.password_needs_capital === 1);
        setCategoriseModelId(
          settings?.categorise_model_id != null ? String(settings.categorise_model_id) : "",
        );
        setReadModelId(settings?.read_model_id != null ? String(settings.read_model_id) : "");
        setLoginLogo(settings?.login_logo ?? null);
        setMenuLogo(settings?.menu_logo ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const save = async () => {
    setSaving(true);
    try {
      const token = await authService.ensureValidToken();
      await customerService.saveSettings(
        customerId,
        {
          customer_label: label.trim(),
          // "" clears one; the API leaves out what it isn't sent.
          login_logo: loginLogo ?? "",
          menu_logo: menuLogo ?? "",
          max_file_mb: Number(maxFileMb),
          idle_timeout_minutes: Number(idleMinutes),
          password_min_length: Number(pwMinLength),
          password_needs_digit: (pwDigit ? 1 : 0) as 0 | 1,
          password_needs_symbol: (pwSymbol ? 1 : 0) as 0 | 1,
          password_needs_capital: (pwCapital ? 1 : 0) as 0 | 1,
          categorise_model_id: categoriseModelId ? Number(categoriseModelId) : null,
          read_model_id: readModelId ? Number(readModelId) : null,
        },
        token,
      );
      onToast({ message: "Branding saved", type: "success" });
    } catch (err) {
      onToast({
        message: err instanceof Error ? err.message : "Failed to save",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800 lg:p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">Branding</h3>
        <Button size="xs" onClick={save} disabled={saving || loading}>
          {saving ? "Saving..." : "Save branding"}
        </Button>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <Label htmlFor="customer-label">Customer label</Label>
          <Input
            id="customer-label"
            compact
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Not set"
          />
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            Shown on the sign-in page and above the menu. Left empty, neither shows a name.
          </p>
        </div>

        {/* Not branding, but it belongs to the customer rather than to any
            one project, and this is the customer's own card. */}
        <div>
          <Label htmlFor="customer-max-file">Customer level max file size</Label>
          <div className="flex items-center gap-2">
            <Input
              id="customer-max-file"
              compact
              type="number"
              min="1"
              value={maxFileMb}
              onChange={(e) => setMaxFileMb(e.target.value)}
              className="max-w-28"
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">MB</span>
          </div>
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            Applies to every project. A project may set its own instead.
          </p>
        </div>

        {/* How long a session may sit untouched. The app's own rule: it
            stops renewing the token after this long, and Keycloak's idle
            timeout then ends the session. Keycloak's ten-hour maximum is
            set once for the whole realm and is not this — the line below
            says so, rather than leaving somebody to think this number
            decides everything. */}
        <div>
          <Label htmlFor="customer-idle">Sign out after inactivity</Label>
          <div className="flex items-center gap-2">
            <Input
              id="customer-idle"
              compact
              type="number"
              min="2"
              max="30"
              value={idleMinutes}
              onChange={(e) => setIdleMinutes(e.target.value)}
              className="max-w-28"
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">minutes</span>
          </div>
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            Between 2 and 30. A session also ends after 10 hours whatever this says.
          </p>
        </div>

        {/* What a password must look like here. Checked by auth_api before
            the password reaches Keycloak — Keycloak has one policy for
            every customer, which is why these cannot live there. Keycloak's
            own policy stays underneath as the floor. */}
        <div>
          <Label htmlFor="customer-pw-length">Passwords</Label>
          <div className="flex items-center gap-2">
            <Input
              id="customer-pw-length"
              compact
              type="number"
              min="8"
              max="64"
              value={pwMinLength}
              onChange={(e) => setPwMinLength(e.target.value)}
              className="max-w-28"
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">characters at least</span>
          </div>

          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {(
              [
                ["Must contain a number", pwDigit, setPwDigit],
                ["Must contain a capital letter", pwCapital, setPwCapital],
                ["Must contain a symbol", pwSymbol, setPwSymbol],
              ] as const
            ).map(([label, value, setValue]) => (
              <label key={label} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => setValue(e.target.checked)}
                  className="size-4"
                />
                {label}
              </label>
            ))}
          </div>

          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            Applies when anyone here sets or changes a password. Existing passwords are
            not affected until they are changed.
          </p>
        </div>

        {/* The models, chosen from what SmartDoc offers. A project may
            differ; a stage switched on with neither chosen is refused. */}
        {(
          [
            ["categorise", categoriseModelId, setCategoriseModelId, "Categorise"],
            ["read", readModelId, setReadModelId, "OCR"],
          ] as const
        ).map(([purpose, value, setValue, label]) => {
          // Every offered model, for both: what a model is for is this
          // choice, not a property of the model.
          const choices = offered;
          return (
            <div key={purpose}>
              <Label htmlFor={`model-${purpose}`}>{label}</Label>
              <select
                id={`model-${purpose}`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="h-9 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              >
                <option value="" className="dark:bg-gray-900">
                  Not chosen
                </option>
                {choices.map((m) => (
                  <option key={m.model_id} value={String(m.model_id)} className="dark:bg-gray-900">
                    {m.display_name}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {choices.length === 0
                  ? "SmartDoc offers no models yet."
                  : "Applies to every project unless the project chooses its own."}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <LogoField
          title="Sign-in logo"
          hint={`Shown on the sign-in page. At least ${LOGO_SIZES.login.min[0]}×${LOGO_SIZES.login.min[1]}, fitted inside ${LOGO_SIZES.login.max[0]}×${LOGO_SIZES.login.max[1]}. PNG keeps a transparent background.`}
          box={LOGO_SIZES.login.max}
          name={label || customerName}
          value={loginLogo}
          onChange={setLoginLogo}
          onError={(message) => onToast({ message, type: "error" })}
        />
        <LogoField
          title="Menu logo"
          hint={`Shown above the menu. At least ${LOGO_SIZES.menu.min[0]}×${LOGO_SIZES.menu.min[1]}, fitted inside ${LOGO_SIZES.menu.max[0]}×${LOGO_SIZES.menu.max[1]}.`}
          box={LOGO_SIZES.menu.max}
          name={label || customerName}
          value={menuLogo}
          onChange={setMenuLogo}
          onError={(message) => onToast({ message, type: "error" })}
        />
      </div>
    </div>
  );
}
