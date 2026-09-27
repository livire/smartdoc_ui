import React from "react";
import ThemeTogglerTwo from "../../components/common/ThemeTogglerTwo";

/**
 * The frame around signing in.
 *
 * The template's blue half — a stock logo and a sentence about digitising
 * paper — was about the product rather than about signing in, and it left the
 * form squeezed into half a screen. The form now has the page.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-1 bg-white p-6 dark:bg-gray-900 sm:p-0">
      <div className="relative flex h-screen w-full flex-col justify-center dark:bg-gray-900 sm:p-0">
        {children}

        {/* Whose software this is. The customer's own logo has the top of
            the page; this stands on its own at the bottom — the "Powered by"
            in front of it only made the mark look like a footnote. */}
        <div className="flex items-center justify-center pb-10 pt-8">
          {/* One image for both themes: the mark is green on transparent,
              which sits fine on either background. */}
          <img src="/images/logo/smartdoc-logo.png" alt="SmartDoc" className="h-10 w-auto" />
        </div>

        <div className="fixed bottom-6 right-6 z-50 hidden sm:block">
          <ThemeTogglerTwo />
        </div>
      </div>
    </div>
  );
}
