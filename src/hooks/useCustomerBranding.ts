import { useEffect, useState } from "react";
import { useCustomer, storedCustomerUrl } from "../context/CustomerContext";
import { useTheme } from "../context/ThemeContext";
import { authService } from "../services/authService";
import { customerService } from "../services/customerService";

/**
 * The customer's own name and logo, for the menu and the phone header.
 *
 * One place, so the two cannot disagree. The phone header used to show the
 * template's logo instead, from a `./images/...` path that broke on every
 * screen below the customer's address (bug #10).
 */
export function useCustomerBranding() {
  const { customer } = useCustomer();
  // The customer's own logo and name, when they have set them.
  const [branding, setBranding] = useState<{
    label: string | null;
    logo: string | null;
    logoDark: string | null;
  }>(
    () => {
      // Straight from the cache, so the logo is on screen in the first
      // paint rather than after a token and a request.
      const cached = customer?.customer_id
        ? customerService.readCachedSettings(customer.customer_id)
        : // CustomerContext is still empty on the first render, so fall back
          // to the customer stored in the browser.
          customerService.readCachedSettingsForStoredCustomer();
        // Either logo will do: a customer who sets one and not the other
      // should see it everywhere rather than a placeholder on half the
      // screens.
      return {
        label: cached?.customer_label ?? null,
        logo: cached?.menu_logo ?? cached?.login_logo ?? null,
        logoDark: cached?.menu_logo_dark ?? cached?.login_logo_dark ?? null,
      };
    },
  );
  // The customer's mark for the screen somebody is actually on. Falls back
  // to the light one: most logos read on either background, and a customer
  // who set only the one should see it rather than nothing.
  const { theme } = useTheme();
  const shownLogo = theme === "dark" ? branding.logoDark || branding.logo : branding.logo;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Usually the context knows which customer this is. When it does
        // not — a reload that lost it, or a screen reached without going
        // through sign-in — the url in the address bar still says, and a
        // blank corner where the customer's logo belongs is worse than one
        // extra request.
        let customerId = customer?.customer_id ?? null;
        if (!customerId) {
          const url = storedCustomerUrl();
          if (!url) return;
          const response = await customerService.getCustomerByUrl(url);
          customerId = response?.data?.customer_id ?? null;
        }
        if (!customerId || cancelled) return;

        const token = await authService.ensureValidToken();
        const settings = await customerService.getSettings(customerId, token);
        if (!cancelled) {
          setBranding({
            label: settings?.customer_label ?? null,
            logo: settings?.menu_logo ?? settings?.login_logo ?? null,
            logoDark: settings?.menu_logo_dark ?? settings?.login_logo_dark ?? null,
          });
        }
      } catch {
        // The stock logo stays.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [customer?.customer_id]);

  return { branding, shownLogo };
}
