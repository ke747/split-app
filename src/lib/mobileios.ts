/**
 * mobileios.ts — iOS Universal Links, deep link generation, and App Store
 * URL utilities for the StellarSplit iOS application.
 *
 * Universal Links allow the iOS app to intercept HTTPS URLs served by this
 * web app, providing a seamless handoff between the web and native experience.
 *
 * References:
 *  - https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app
 *  - https://developer.apple.com/documentation/bundleresources/applinks
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Apple App Store application ID (numeric). Update when the app is published. */
export const IOS_APP_STORE_ID = process.env.NEXT_PUBLIC_IOS_APP_STORE_ID ?? "0000000000";

/** iOS app bundle identifier. Must match the value in Xcode project settings. */
export const IOS_BUNDLE_ID =
  process.env.NEXT_PUBLIC_IOS_BUNDLE_ID ?? "com.stellarsplit.app";

/** iOS app Team ID from the Apple Developer Portal. */
export const IOS_TEAM_ID =
  process.env.NEXT_PUBLIC_IOS_TEAM_ID ?? "XXXXXXXXXX";

/** Custom URL scheme registered in the iOS app's Info.plist. */
export const IOS_URL_SCHEME = "stellarsplit";

/** Base URL of the deployed web app. Used to construct Universal Links. */
export const WEB_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://stellarsplit-dapp.vercel.app";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IOSDeepLink {
  /** Universal Link (HTTPS) that will be intercepted by the native app. */
  universalLink: string;
  /** Custom scheme fallback for environments where Universal Links are unavailable. */
  customSchemeLink: string;
  /** Path segment used for routing within the app. */
  path: string;
}

export interface IOSAppMetadata {
  appStoreId: string;
  bundleId: string;
  teamId: string;
  appName: string;
  appStoreUrl: string;
  minimumOSVersion: string;
  supportedFeatures: string[];
}

export interface AppleAppSiteAssociation {
  applinks: {
    details: Array<{
      appIDs: string[];
      components: Array<{
        "/": string;
        comment?: string;
      }>;
    }>;
  };
  webcredentials?: {
    apps: string[];
  };
}

// ─── Deep link generation ─────────────────────────────────────────────────────

/**
 * Generate an iOS deep link for a specific invoice.
 *
 * Universal Link: https://stellarsplit-dapp.vercel.app/invoice/INV-123
 * Custom scheme:  stellarsplit://invoice/INV-123
 */
export function generateInvoiceDeepLink(invoiceId: string): IOSDeepLink {
  const path = `/invoice/${encodeURIComponent(invoiceId)}`;
  return {
    universalLink: `${WEB_BASE_URL}${path}`,
    customSchemeLink: `${IOS_URL_SCHEME}://invoice/${encodeURIComponent(invoiceId)}`,
    path,
  };
}

/**
 * Generate an iOS deep link to the payment screen for an invoice.
 */
export function generatePaymentDeepLink(invoiceId: string, amount?: bigint): IOSDeepLink {
  const params = amount !== undefined ? `?amount=${amount.toString()}` : "";
  const path = `/invoice/${encodeURIComponent(invoiceId)}/pay${params}`;
  return {
    universalLink: `${WEB_BASE_URL}${path}`,
    customSchemeLink: `${IOS_URL_SCHEME}://invoice/${encodeURIComponent(invoiceId)}/pay${params}`,
    path,
  };
}

/**
 * Generate an iOS deep link to the dashboard.
 */
export function generateDashboardDeepLink(): IOSDeepLink {
  return {
    universalLink: `${WEB_BASE_URL}/dashboard`,
    customSchemeLink: `${IOS_URL_SCHEME}://dashboard`,
    path: "/dashboard",
  };
}

/**
 * Generate an iOS deep link for on-chain verification of an invoice.
 */
export function generateVerificationDeepLink(invoiceId: string): IOSDeepLink {
  const path = `/verify/${encodeURIComponent(invoiceId)}`;
  return {
    universalLink: `${WEB_BASE_URL}${path}`,
    customSchemeLink: `${IOS_URL_SCHEME}://verify/${encodeURIComponent(invoiceId)}`,
    path,
  };
}

/**
 * Generate a deep link to a named screen with arbitrary query parameters.
 */
export function generateCustomDeepLink(
  screen: string,
  params?: Record<string, string>
): IOSDeepLink {
  const queryString =
    params && Object.keys(params).length > 0
      ? "?" + new URLSearchParams(params).toString()
      : "";
  const path = `/${screen}${queryString}`;
  return {
    universalLink: `${WEB_BASE_URL}${path}`,
    customSchemeLink: `${IOS_URL_SCHEME}://${screen}${queryString}`,
    path,
  };
}

// ─── App Store helpers ────────────────────────────────────────────────────────

/**
 * Returns the direct App Store URL for the StellarSplit iOS app.
 */
export function getAppStoreUrl(): string {
  return `https://apps.apple.com/app/id${IOS_APP_STORE_ID}`;
}

/**
 * Returns an App Store URL with a campaign token for attribution tracking.
 */
export function getAppStoreUrlWithCampaign(
  campaignToken: string,
  providerToken?: string
): string {
  const base = getAppStoreUrl();
  const params = new URLSearchParams({ ct: campaignToken });
  if (providerToken) params.set("pt", providerToken);
  return `${base}?${params.toString()}`;
}

/**
 * Returns the App Store review URL (deep links directly to the review prompt).
 */
export function getAppStoreReviewUrl(): string {
  return `${getAppStoreUrl()}?action=write-review`;
}

// ─── Universal Links configuration ───────────────────────────────────────────

/**
 * Build the apple-app-site-association (AASA) JSON document.
 *
 * This file must be served at:
 *   https://<domain>/.well-known/apple-app-site-association
 *   https://<domain>/apple-app-site-association
 *
 * Apple fetches it during app installation to determine which URLs the app
 * should handle.
 */
export function buildAppleAppSiteAssociation(): AppleAppSiteAssociation {
  const appId = `${IOS_TEAM_ID}.${IOS_BUNDLE_ID}`;

  return {
    applinks: {
      details: [
        {
          appIDs: [appId],
          components: [
            { "/": "/invoice/*", comment: "Invoice detail and payment screens" },
            { "/": "/verify/*", comment: "On-chain verification screens" },
            { "/": "/dashboard", comment: "User dashboard" },
            { "/": "/invoice/new", comment: "Create invoice" },
          ],
        },
      ],
    },
    webcredentials: {
      apps: [appId],
    },
  };
}

// ─── User-agent detection ─────────────────────────────────────────────────────

/**
 * Detect whether the current browser user-agent belongs to an iOS device.
 * Only reliable on the client side (window/navigator).
 */
export function isIOSUserAgent(userAgent?: string): boolean {
  const ua = userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return /iphone|ipad|ipod/i.test(ua);
}

/**
 * Parse the iOS version from a user-agent string.
 * Returns null if the UA is not iOS or the version cannot be parsed.
 */
export function parseIOSVersion(userAgent?: string): { major: number; minor: number } | null {
  const ua = userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const match = ua.match(/OS (\d+)_(\d+)/);
  if (!match) return null;
  return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) };
}

// ─── App metadata ─────────────────────────────────────────────────────────────

/** Returns the iOS app metadata object. */
export function getIOSAppMetadata(): IOSAppMetadata {
  return {
    appStoreId: IOS_APP_STORE_ID,
    bundleId: IOS_BUNDLE_ID,
    teamId: IOS_TEAM_ID,
    appName: "StellarSplit",
    appStoreUrl: getAppStoreUrl(),
    minimumOSVersion: "16.0",
    supportedFeatures: [
      "invoice_creation",
      "payment_splitting",
      "blockchain_verification",
      "freighter_wallet_integration",
      "push_notifications",
      "biometric_auth",
    ],
  };
}
