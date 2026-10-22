"use client";

import { useEffect, useState } from "react";
import { isIOSUserAgent, getAppStoreUrl, getAppStoreUrlWithCampaign } from "@/lib/mobileios";

const DISMISSED_KEY = "stellarsplit_ios_banner_dismissed";

interface MobileIOSBannerProps {
  /**
   * UTM campaign token appended to the App Store URL for attribution.
   * Defaults to "web_banner".
   */
  campaignToken?: string;
  /**
   * Called when the user taps the close/dismiss button.
   * If provided the banner will also call this alongside persisting the
   * dismissal to localStorage.
   */
  onDismiss?: () => void;
}

/**
 * MobileIOSBanner — a smart app banner that prompts iOS users to download
 * the StellarSplit native app from the App Store.
 *
 * The banner is only rendered on iOS devices and hides itself once the user
 * dismisses it (stored in localStorage so it stays hidden across page loads).
 *
 * Accessibility: the banner uses role="banner" and can be dismissed with the
 * keyboard. It does not shift layout on non-iOS devices.
 */
export default function MobileIOSBanner({
  campaignToken = "web_banner",
  onDismiss,
}: MobileIOSBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show on iOS user agents
    if (!isIOSUserAgent()) return;

    // Check if the user has already dismissed the banner
    try {
      const dismissed = localStorage.getItem(DISMISSED_KEY);
      if (dismissed) return;
    } catch {
      // localStorage may be unavailable in some contexts; show the banner
    }

    setVisible(true);
  }, []);

  const handleDismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // ignore
    }
    onDismiss?.();
  };

  const appStoreUrl = getAppStoreUrlWithCampaign(campaignToken);

  if (!visible) return null;

  return (
    <div
      role="banner"
      aria-label="Download the StellarSplit app"
      className="fixed bottom-0 inset-x-0 z-50 px-4 pb-safe-or-4 pt-3 bg-gray-950 border-t border-gray-700 shadow-2xl"
    >
      <div className="max-w-md mx-auto flex items-center gap-3">
        {/* App icon placeholder */}
        <div
          aria-hidden
          className="w-12 h-12 shrink-0 rounded-xl bg-indigo-700 flex items-center justify-center text-white text-lg font-bold select-none"
        >
          SS
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white leading-tight">StellarSplit</p>
          <p className="text-xs text-gray-400 truncate">
            Get the native app for a better experience
          </p>
        </div>

        <a
          href={appStoreUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 px-4 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors"
          aria-label="Download StellarSplit on the App Store"
        >
          Get
        </a>

        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss iOS app banner"
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4"
            aria-hidden
          >
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
