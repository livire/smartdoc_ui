import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Button from "../ui/button/Button";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import LogoPlaceholder from "../common/LogoPlaceholder";
import CollapsiblePanel from "../common/Panel";
import { authService } from "../../services/authService";
import { customerService } from "../../services/customerService";
import { modelCatalogueService, CatalogueModel } from "../../services/modelCatalogueService";
import { projectSettingService } from "../../services/projectSettingService";

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
  box,
  name,
  value,
  onChange,
  onError,
  dark = false,
}: {
  title: string;
  box: readonly [number, number];
  name?: string | null;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  onError: (message: string) => void;
  /** Preview it on a dark panel — a mark for dark screens shown on white
   *  tells nobody whether it works. */
  dark?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
      <p className="text-sm font-medium text-gray-800 dark:text-white/90">{title}</p>

      <div
        className={`mt-3 flex h-24 items-center justify-center rounded-lg p-3 ${
          dark ? "bg-gray-900" : "bg-gray-50 dark:bg-white/[0.03]"
        }`}
      >
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
/**
 * What the page can ask this card to do.
 *
 * The Save button is drawn by the page, at the very top above the
 * customer's own card — one Save for the screen rather than one floating
 * between two sections. So the page needs to reach in and save.
 */
export interface BrandingCardHandle {
  save: () => Promise<void>;
  saving: boolean;
}

/**
 * Why two flags and not one "busy".
 *
 * A single flag made the page's button read "Saving..." the moment the
 * screen opened, because the settings were still being fetched. They are
 * different states and the button needs both: disabled while either is
 * true, but only *saying* "Saving..." when something is actually being
 * saved.
 */
export interface BrandingCardStatus {
  saving: boolean;
  loading: boolean;
}

function BrandingCard({
  customerId,
  customerName,
  onToast,
  // Told whenever saving or loading changes, so the page's button can
  // refuse a press and say which of the two is happening.
  onStatusChange,
  section = null,
}: {
  customerId: number;
  // A hint for the placeholder only; the label itself is never pre-filled
  // from it (see below).
  customerName?: string | null;
  onToast: (toast: { message: string; type: "success" | "error" }) => void;
  onStatusChange?: (status: BrandingCardStatus) => void;
  /**
   * Show one section instead of all four.
   *
   * The page drives tabs with this. All four stay in this one component
   * because they share a single Save — `save()` sends every field together,
   * so splitting them into four components would mean four saves or a lot of
   * lifted state.
   */
  section?: "branding" | "models" | "password" | "misc" | null;
}, ref: React.Ref<BrandingCardHandle>) {
  const [label, setLabel] = useState("");
  // The house limit for every project this customer has, unless a project
  // says otherwise. Kept as text while it is typed, so a half-deleted
  // number does not become 0 for a keystroke.
  const [maxFileMb, setMaxFileMb] = useState("10");
  // The largest this installation carries, from the server. 0 until it
  // arrives, which leaves the field uncapped for a moment — the server
  // refuses an oversized number either way.
  const [maxFileMbCeiling, setMaxFileMbCeiling] = useState(0);
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
  // The same two for a dark screen, both optional.
  const [loginLogoDark, setLoginLogoDark] = useState<string | null>(null);
  const [menuLogoDark, setMenuLogoDark] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // The installation's own ceiling, so the field can refuse a number before
  // Save does. Its own effect because it does not depend on the customer.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await authService.ensureValidToken();
        const limits = await projectSettingService.limits(token);
        if (!cancelled) setMaxFileMbCeiling(limits.max_file_mb);
      } catch {
        // No cap on the field rather than a message: the server refuses an
        // oversized limit anyway.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        setLoginLogoDark(settings?.login_logo_dark ?? null);
        setMenuLogoDark(settings?.menu_logo_dark ?? null);
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
          login_logo_dark: loginLogoDark ?? "",
          menu_logo_dark: menuLogoDark ?? "",
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
      onToast({ message: "Settings saved", type: "success" });
    } catch (err) {
      onToast({
        message: err instanceof Error ? err.message : "Failed to save",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  // Both reported, never merged: pressing Save before the settings arrive
  // would store the empty values this card starts with, so the button must
  // be disabled — but it must not claim to be saving while it waits.
  useEffect(() => {
    onStatusChange?.({ saving, loading });
  }, [saving, loading, onStatusChange]);

  // The page owns the Save button; this is how it reaches the save.
  useImperativeHandle(ref, () => ({ save, saving }));

  /**
   * One section, as a panel or as a tab's contents.
   *
   * A function rather than a component: a component defined inside render is
   * a new type on every render, so React would throw away the inputs below
   * it and take the cursor with them on every keystroke.
   */
  const panel = (
    id: string,
    title: string,
    storageKey: string,
    defaultOpen: boolean,
    children: React.ReactNode,
  ) =>
    section ? (
      // Hidden rather than unmounted: all four share one Save, and
      // unmounting would throw away edits made on another tab before it was
      // pressed.
      //
      // The card is drawn here rather than by the page, so every tab's
      // contents sit in the same box — mixed bare and boxed panels made the
      // tabs look like different screens.
      <div
        className={
          section === id
            ? "rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
            : "hidden"
        }
      >
        {children}
      </div>
    ) : (
      <CollapsiblePanel title={title} storageKey={storageKey} defaultOpen={defaultOpen}>
        {children}
      </CollapsiblePanel>
    );

  return (
    <div className="space-y-3">
      {/* How it looks: the name on screen and the two logos. */}
      {panel("branding", "Branding", "customer.branding", true, (<>
      <div className="grid gap-x-5 gap-y-4 lg:grid-cols-2">
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
        </div>

        <div className="lg:col-span-2 grid gap-4 lg:grid-cols-2">
          <LogoField
            title="Sign-in logo"
            box={LOGO_SIZES.login.max}
            name={label || customerName}
            value={loginLogo}
            onChange={setLoginLogo}
            onError={(message) => onToast({ message, type: "error" })}
          />
          <LogoField
            title="Menu logo"
            box={LOGO_SIZES.menu.max}
            name={label || customerName}
            value={menuLogo}
            onChange={setMenuLogo}
            onError={(message) => onToast({ message, type: "error" })}
          />
        </div>

        {/* The same two marks for a dark screen. Both optional: a logo that
            reads on either background needs only the one, and a dark screen
            falls back to the light version rather than showing nothing.
            SmartDoc cannot tell from the picture whether it will read on
            black — dark text, a white knockout, a shadow that vanishes — so
            the customer says. */}
        <div className="lg:col-span-2 grid gap-4 lg:grid-cols-2">
          <LogoField
            title="Sign-in logo for dark screens"
            box={LOGO_SIZES.login.max}
            name={label || customerName}
            value={loginLogoDark}
            onChange={setLoginLogoDark}
            onError={(message) => onToast({ message, type: "error" })}
            dark
          />
          <LogoField
            title="Menu logo for dark screens"
            box={LOGO_SIZES.menu.max}
            name={label || customerName}
            value={menuLogoDark}
            onChange={setMenuLogoDark}
            onError={(message) => onToast({ message, type: "error" })}
            dark
          />
        </div>
      </div>
      </>))}

      {/* Which model reads and which categorises, for every project here
          unless a project chooses its own. */}
      {panel("models", "AI Models", "customer.models", false, (<>
      {/* Side by side at their own width, not one per half of the screen:
          two short dropdowns spread across a wide column read as two
          unrelated settings. */}
      <div className="flex flex-wrap gap-5">
        {(
          [
            ["categorise", categoriseModelId, setCategoriseModelId, "Categorise"],
            ["read", readModelId, setReadModelId, "OCR"],
          ] as const
        ).map(([purpose, value, setValue, modelLabel]) => {
          // Every offered model, for both: what a model is for is this
          // choice, not a property of the model.
          const choices = offered;
          return (
            <div key={purpose} className="w-56">
              <Label htmlFor={`model-${purpose}`}>{modelLabel}</Label>
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
              {choices.length === 0 && (
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  SmartDoc offers no models yet.
                </p>
              )}
            </div>
          );
        })}
      </div>
      </>))}

      {/* What a password must look like here. Checked by auth_api before
          the password reaches Keycloak — a Keycloak realm has one policy for
          everybody in it, which is why these cannot live there. Keycloak's
          own policy stays underneath as the floor. */}
      {panel("password", "Password", "customer.passwords", false, (<>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
          <div>
            <Label htmlFor="customer-pw-length">Min characters</Label>
            <Input
              id="customer-pw-length"
              compact
              type="number"
              min="8"
              max="64"
              value={pwMinLength}
              onChange={(e) => setPwMinLength(e.target.value)}
              className="max-w-20 text-right"
            />
          </div>

          <div>
            <Label>Must contain</Label>
            <div className="flex h-9 flex-wrap items-center gap-x-5 gap-y-2">
              {(
                [
                  ["Number", pwDigit, setPwDigit],
                  ["Capital letter", pwCapital, setPwCapital],
                  ["Symbol", pwSymbol, setPwSymbol],
                ] as const
              ).map(([label, value, setValue]) => (
                <label
                  key={label}
                  className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
                >
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
          </div>
        </div>
      </>))}

      {/* What is left: the limits that belong to the customer rather than
          to any one project. */}
      {panel("misc", "Miscellaneous", "customer.misc", false, (<>
      {/* Side by side at their own width rather than one per half of the
          panel: two short numbers spread across a wide row read as two
          unrelated settings.

          The idle timeout is the app's own rule — it stops renewing the
          token after this long, and Keycloak's idle rule then ends the
          session. Keycloak's ten-hour maximum is a different thing, set
          once for the whole realm; the 2-to-30 limits here are on the
          field, so a number outside them cannot be typed. */}
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <Label htmlFor="customer-max-file">Max file size</Label>
          <div className="flex items-center gap-2">
            <Input
              id="customer-max-file"
              compact
              type="number"
              min="1"
              // The installation's own ceiling, so the field refuses an
              // oversized number before Save has to.
              max={maxFileMbCeiling ? String(maxFileMbCeiling) : undefined}
              value={maxFileMb}
              onChange={(e) => setMaxFileMb(e.target.value)}
              className="max-w-20 text-right"
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">MB</span>
          </div>
        </div>

        <div>
          <Label htmlFor="customer-idle">Idle timeout</Label>
          <div className="flex items-center gap-2">
            <Input
              id="customer-idle"
              compact
              type="number"
              min="2"
              max="30"
              value={idleMinutes}
              onChange={(e) => setIdleMinutes(e.target.value)}
              className="max-w-20 text-right"
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">minutes</span>
          </div>
        </div>
      </div>
      </>))}
    </div>
  );
}

export default forwardRef(BrandingCard);
