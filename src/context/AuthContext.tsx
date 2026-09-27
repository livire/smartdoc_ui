import { createContext, useContext, useEffect, useState } from "react";
import { authService, PASSWORD_CHANGE_REQUIRED } from "../services/authService";
import { LOCK_WINDOW_MS, requireReauth } from "../services/sessionExpiry";

interface User {
  sub: string;
  email_verified: boolean;
  name: string;
  preferred_username: string;
  given_name: string;
  family_name: string;
  email: string;
  roles: string[];
  groups: string[];
  user_id?: number;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  // Re-read who is signed in from Keycloak, after something about them
  // changed — their name, say. The user object is otherwise from sign-in.
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initializeAuth = async () => {
      const storedUser = authService.getStoredUser();
      const storedToken = authService.getStoredToken();

      if (storedUser && storedToken) {
        try {
          if (authService.isTokenExpired()) {
            await authService.refreshToken();
          }
          setUser(storedUser);
        } catch {
          // The refresh token has died. How long ago decides what happens.
          //
          // Beyond the lock window the session is long gone — Keycloak
          // dropped it, and the screen behind the prompt is hours stale —
          // so the sign-in page is what anyone expects. Asking for a
          // password here as well as in the fetch guard is what made the
          // lock flash up for a second and then vanish into sign-in.
          if (authService.msUntilExpiry() < -LOCK_WINDOW_MS) {
            authService.sessionExpired();
            setUser(null);
            setIsLoading(false);
            return;
          }

          // Within it, this is somebody coming back from a coffee: ask for
          // the password rather than signing them out, and the screen they
          // were on, and the project they had chosen, are still here to
          // come back to.
          const signedBackIn = await requireReauth();
          if (signedBackIn) {
            setUser(authService.getStoredUser());
          } else {
            authService.logout();
            setUser(null);
          }
        }
      }
      setIsLoading(false);
    };

    initializeAuth();
  }, []);

  const login = async (username: string, password: string) => {
    setIsLoading(true);
    setError(null);

    // Typing a password starts a new day's work: which project it is about
    // is asked again, rather than inherited from whatever was open when the
    // last session ended. Signing out already cleared this; an expired
    // session or a closed browser did not, which is why being asked felt
    // like it happened only sometimes. (One project still opens itself —
    // there is nothing to choose.)
    try {
      localStorage.removeItem("selected_project");
      sessionStorage.removeItem("projects_checked");
    } catch {
      // A browser refusing storage asks anyway.
    }

    try {
      const tokenResponse = await authService.login({ username, password });
      const { access_token, refresh_token, token_expiry } = tokenResponse.data;

      authService.saveTokens(access_token, refresh_token, token_expiry);

      const userResponse = await authService.getUserInfo(access_token);
      const userData = userResponse.data;

      // Verify user has access to the customer
      const storedCustomer = localStorage.getItem("customer_data");
      if (storedCustomer) {
        try {
          const customerData = JSON.parse(storedCustomer);
          await authService.verifyUserCustomerAccess(
            username,
            customerData.customer_id,
            access_token
          );
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "User does not have access to this customer";
          setError(message);
          authService.logout();
          throw new Error(message);
        }
      }

      authService.saveUser(userData);
      setUser(userData);
    } catch (err) {
      // Not a failure: the password was right and the form takes it from
      // here with a "choose a new password" step. Painting it red would
      // tell the person they got something wrong.
      if (err instanceof Error && err.name === PASSWORD_CHANGE_REQUIRED) throw err;
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const refreshUser = async () => {
    const token = await authService.ensureValidToken();
    const fresh = (await authService.getUserInfo(token)).data;
    // Keep what sign-in learned and Keycloak's userinfo does not carry —
    // the app's own user_id.
    const merged = { ...user, ...fresh, user_id: user?.user_id ?? fresh.user_id };
    authService.saveUser(merged);
    setUser(merged);
  };

  const logout = () => {
    authService.logout();
    setUser(null);
    setError(null);
    localStorage.removeItem("customer_data");
    localStorage.removeItem("selected_project");
    sessionStorage.removeItem("projects_checked");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        error,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
