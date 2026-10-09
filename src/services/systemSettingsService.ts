import { authService } from "./authService";

const API_URL = import.meta.env.VITE_API_URL;

/**
 * How somebody may sign in. Three flags on the Keycloak realm, read and
 * written through `smartdoc_api` — never from here straight to `auth_api`,
 * which refuses anything but a service token.
 */
export interface SignInSettings {
  loginWithEmailAllowed: boolean;
  resetPasswordAllowed: boolean;
  verifyEmail: boolean;
}

const headers = async () => ({
  Authorization: `Bearer ${await authService.ensureValidToken()}`,
  "Content-Type": "application/json",
});

const message = async (response: Response, fallback: string) => {
  try {
    const body = await response.json();
    return body?.message || fallback;
  } catch {
    return fallback;
  }
};

export const systemSettingsService = {
  async signIn(): Promise<SignInSettings> {
    const response = await fetch(`${API_URL}/system/sign-in-settings`, {
      headers: await headers(),
    });
    if (!response.ok) throw new Error(await message(response, "Could not read the sign-in settings"));
    const body = await response.json();
    return body.data as SignInSettings;
  },

  /** Change one or more. Answers all three as they now stand. */
  async setSignIn(flags: Partial<SignInSettings>): Promise<SignInSettings> {
    const response = await fetch(`${API_URL}/system/sign-in-settings`, {
      method: "PUT",
      headers: await headers(),
      body: JSON.stringify(flags),
    });
    if (!response.ok) throw new Error(await message(response, "Could not save"));
    const body = await response.json();
    return body.data as SignInSettings;
  },
};
