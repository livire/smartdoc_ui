# Token Refresh Implementation Guide

## Overview
The app now automatically handles token expiration and refresh across the entire application.

## How It Works

### 1. **Automatic Token Refresh on Page Load**
When you navigate to a protected route, `ProtectedRoute` automatically:
- Checks if the current token is expired
- If expired, uses the refresh token to get a new one
- If refresh fails, logs you out and redirects to signin

### 2. **Manual Token Refresh in Components**
Use the `useTokenRefresh` hook for action buttons and API calls:

```tsx
import { useTokenRefresh } from "../../hooks/useTokenRefresh";

export default function MyComponent() {
  const { ensureToken } = useTokenRefresh();

  const handleButtonClick = async () => {
    try {
      const token = await ensureToken();
      // Make your API call with the valid token
      console.log("Token is valid:", token);
    } catch (error) {
      // User will be logged out and redirected to signin
      console.error(error.message);
    }
  };

  return <button onClick={handleButtonClick}>Action</button>;
}
```

### 3. **API Calls with Automatic Token Handling**
Use the `apiClient` utility for API calls that automatically handle tokens:

```tsx
import { apiCall } from "../../utils/apiClient";

// Example API call
const data = await apiCall<any>("/api/endpoint", {
  method: "GET",
  needsAuth: true,
});
```

The `apiClient` will:
- Automatically check and refresh token if needed
- Add the token to request headers
- Handle 401 responses by logging out the user

## Token Expiration Checks

### Where Token is Checked:
1. **On App Startup** - AuthContext initializes and checks token validity
2. **On Protected Route Entry** - ProtectedRoute validates before rendering
3. **Before API Calls** - When using `useTokenRefresh` or `apiClient`

### Token Expiry Logic:
- Token expiry time is stored in localStorage as `token_expiry` (milliseconds)
- When current time > expiry time, token is considered expired
- Expired tokens are automatically refreshed using the refresh token
- If refresh fails, user is logged out

## Example: Form Submission with Token Refresh

```tsx
import { useTokenRefresh } from "../../hooks/useTokenRefresh";
import { useAuth } from "../../context/AuthContext";

export default function MyForm() {
  const { ensureToken } = useTokenRefresh();
  const { logout } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const token = await ensureToken();
      
      // Make API call with valid token
      const response = await fetch("/api/your-endpoint", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      if (response.status === 401) {
        logout();
        throw new Error("Session expired");
      }

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const data = await response.json();
      // Handle success
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error">{error}</div>}
      {/* form fields */}
      <button disabled={loading}>{loading ? "Loading..." : "Submit"}</button>
    </form>
  );
}
```

## Logout Behavior
When token refresh fails or user manually logs out:
- All tokens and user data are cleared from localStorage
- User is redirected to signin page
- Auth context is reset

## Important Notes
- Token expiry time is in milliseconds (not seconds)
- Keep the refresh token safe - it's used to get new access tokens
- If both tokens expire, user must login again
- Token validation happens before sensitive operations
