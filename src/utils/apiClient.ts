import { authService } from "../services/authService";

interface FetchOptions extends RequestInit {
  needsAuth?: boolean;
}

export async function apiCall<T>(
  url: string,
  options: FetchOptions = {}
): Promise<T> {
  const { needsAuth = true, ...fetchOptions } = options;

  try {
    if (needsAuth) {
      const token = await authService.ensureValidToken();
      const headers = new Headers(fetchOptions.headers);
      headers.set("Authorization", `Bearer ${token}`);
      fetchOptions.headers = headers;
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 401) {
      authService.logout();
      throw new Error("Session expired. Please login again.");
    }

    if (!response.ok) {
      throw new Error(`API call failed: ${response.statusText}`);
    }

    return response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("An unexpected error occurred");
  }
}
