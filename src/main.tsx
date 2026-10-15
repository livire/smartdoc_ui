import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "swiper/swiper-bundle.css";
import "flatpickr/dist/flatpickr.css";
import App from "./App.tsx";
import { AppWrapper } from "./components/common/PageMeta.tsx";
import { ThemeProvider } from "./context/ThemeContext.tsx";
import { installSessionGuard } from "./services/sessionGuard.ts";
import { startSessionKeeper } from "./services/sessionKeeper.ts";
import { CALLBACK_PATH } from "./services/companyLogin.ts";
import CompanyCallback from "./pages/AuthPages/CompanyCallback.tsx";

// The page a company sign-in comes back to is drawn on its own. The app's
// start-up — the session guard, the keeper, AuthProvider — would act on the
// session that was there before, while this page is replacing it.
if (window.location.pathname === CALLBACK_PATH) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <CompanyCallback />
    </StrictMode>,
  );
} else {
  // Installed before anything renders, so no screen has to work out for
  // itself what a 401 means.
  installSessionGuard();

  // And keeps it from expiring in the first place: the guard above is the
  // safety net, this is what stops anyone needing it.
  startSessionKeeper();

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider>
        <AppWrapper>
          <App />
        </AppWrapper>
      </ThemeProvider>
    </StrictMode>,
  );
}
