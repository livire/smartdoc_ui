import { useAuth } from "../context/AuthContext";
import { authService } from "../services/authService";

export function useTokenRefresh() {
  const { logout } = useAuth();

  const ensureToken = async (): Promise<string | null> => {
    try {
      const token = await authService.ensureValidToken();
      return token;
    } catch (err) {
      logout();
      throw new Error("Session expired. Please login again.");
    }
  };

  return { ensureToken };
}
