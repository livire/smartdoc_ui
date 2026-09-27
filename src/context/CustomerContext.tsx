import { createContext, useContext, useState } from "react";
import { CustomerDetails } from "../services/customerService";

interface CustomerContextType {
  customer: CustomerDetails | null;
  setCustomer: (customer: CustomerDetails | null) => void;
  clearCustomer: () => void;
  getStoredCustomer: () => CustomerDetails | null;
}

const CustomerContext = createContext<CustomerContextType | undefined>(
  undefined
);

/**
 * The customer's url, from wherever it is known.
 *
 * Screens used to piece this together from `window.location.pathname`,
 * which is empty at `/` — and a link built from it came out as
 * `//select-project`, which a browser reads as another host entirely and
 * lands on a blank page. There is one answer; this is where it lives.
 */
export function storedCustomerUrl(): string | null {
  try {
    const stored = localStorage.getItem("customer_data");
    const fromStorage = stored ? JSON.parse(stored)?.customer_url : null;
    if (fromStorage) return fromStorage;
  } catch {
    // Fall through to the address bar.
  }

  const [, first] = window.location.pathname.split("/");
  // "sys" and the like are not customers.
  if (!first || ["sys", "signin", "select-project", "projects"].includes(first)) return null;
  return first;
}

export function CustomerProvider({ children }: { children: React.ReactNode }) {
  // Read at first render, not in an effect afterwards — see ProjectContext
  // for why. Screens that fell back to reading localStorage themselves
  // "because the context is still empty on the first render" were working
  // around this.
  const [customer, setCustomer] = useState<CustomerDetails | null>(() => {
    try {
      const stored = localStorage.getItem("customer_data");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const handleSetCustomer = (customerData: CustomerDetails | null) => {
    if (customerData) {
      localStorage.setItem("customer_data", JSON.stringify(customerData));
      setCustomer(customerData);
    } else {
      clearCustomer();
    }
  };

  const clearCustomer = () => {
    localStorage.removeItem("customer_data");
    setCustomer(null);
  };

  const getStoredCustomer = (): CustomerDetails | null => {
    const storedCustomer = localStorage.getItem("customer_data");
    if (storedCustomer) {
      try {
        return JSON.parse(storedCustomer);
      } catch {
        return null;
      }
    }
    return null;
  };

  return (
    <CustomerContext.Provider
      value={{
        customer,
        setCustomer: handleSetCustomer,
        clearCustomer,
        getStoredCustomer,
      }}
    >
      {children}
    </CustomerContext.Provider>
  );
}

export function useCustomer() {
  const context = useContext(CustomerContext);
  if (context === undefined) {
    throw new Error("useCustomer must be used within CustomerProvider");
  }
  return context;
}
