/**
 * mobileandroid.ts — Android mobile integration utilities
 *
 * Provides helpers for Android deep linking (App Links / intent URLs),
 * Play Store URL generation, device detection, and app metadata.
 * Used by the MobileAndroidBanner component and the /api/mobile/android route.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AndroidAppConfig {
  /** Android package name, e.g. "app.stellarsplit.android" */
  packageName: string;
  /** Play Store application ID (same as packageName) */
  playStoreId: string;
  /** Human-readable app name */
  appName: string;
  /** SHA-256 certificate fingerprint for Android App Links verification */
  sha256CertFingerprint: string;
  /** Minimum supported Android API level */
  minSdkVersion: number;
  /** Target Android API level */
  targetSdkVersion: number;
  /** App version name, e.g. "1.0.0" */
  versionName: string;
  /** App version code */
  versionCode: number;
}

export interface AndroidDeepLinkOptions {
  /** The route path within the app, e.g. "/invoice/abc123" */
  path: string;
  /** Optional query parameters */
  params?: Record<string, string>;
  /** Whether to use the https:// scheme (App Links) vs custom scheme */
  useAppLinks?: boolean;
}

export interface AndroidIntentOptions {
  /** Android action, e.g. "android.intent.action.VIEW" */
  action?: string;
  /** The data URI */
  data?: string;
  /** Package name to restrict to */
  package?: string;
  /** Component class */
  component?: string;
  /** Intent extras as key-value pairs */
  extras?: Record<string, string>;
}

export interface AndroidAppMetadata {
  appName: string;
  packageName: string;
  playStoreUrl: string;
  deepLinkScheme: string;
  minAndroidVersion: string;
  features: string[];
  permissions: string[];
}

export interface AssetLinksStatement {
  relation: string[];
  target: {
    namespace: string;
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
}

// ── Default Configuration ──────────────────────────────────────────────────────

export const ANDROID_APP_CONFIG: AndroidAppConfig = {
  packageName: process.env.NEXT_PUBLIC_ANDROID_PACKAGE_NAME ?? "app.stellarsplit.android",
  playStoreId: process.env.NEXT_PUBLIC_ANDROID_PLAY_STORE_ID ?? "app.stellarsplit.android",
  appName: "StellarSplit",
  sha256CertFingerprint:
    process.env.NEXT_PUBLIC_ANDROID_SHA256_FINGERPRINT ??
    "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
  minSdkVersion: 24, // Android 7.0
  targetSdkVersion: 34, // Android 14
  versionName: "1.0.0",
  versionCode: 1,
};

export const ANDROID_DEEP_LINK_SCHEME = "stellarsplit";
export const ANDROID_HOST =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://stellarsplit-dapp.vercel.app";

// ── Deep Link Generation ───────────────────────────────────────────────────────

/**
 * Generate an Android deep link URL.
 * With useAppLinks=true (default), returns an https:// URL handled by App Links.
 * With useAppLinks=false, returns a custom scheme URI (stellarsplit://...).
 */
export function generateAndroidDeepLink(options: AndroidDeepLinkOptions): string {
  const { path, params, useAppLinks = true } = options;

  const queryString =
    params && Object.keys(params).length > 0
      ? "?" + new URLSearchParams(params).toString()
      : "";

  if (useAppLinks) {
    // Android App Links — requires HTTPS and assetlinks.json verification
    return `${ANDROID_HOST}${path}${queryString}`;
  }

  // Custom URI scheme fallback
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `${ANDROID_DEEP_LINK_SCHEME}://${cleanPath}${queryString}`;
}

/**
 * Generate a deep link for a specific invoice.
 */
export function generateInvoiceDeepLink(
  invoiceId: string,
  useAppLinks = true
): string {
  return generateAndroidDeepLink({
    path: `/invoice/${invoiceId}`,
    useAppLinks,
  });
}

/**
 * Generate a deep link for the payment flow.
 */
export function generatePaymentDeepLink(
  invoiceId: string,
  useAppLinks = true
): string {
  return generateAndroidDeepLink({
    path: `/pay/${invoiceId}`,
    useAppLinks,
  });
}

/**
 * Generate a deep link for the verification page.
 */
export function generateVerifyDeepLink(
  invoiceId: string,
  useAppLinks = true
): string {
  return generateAndroidDeepLink({
    path: `/verify/${invoiceId}`,
    useAppLinks,
  });
}

// ── Intent URL Generation ──────────────────────────────────────────────────────

/**
 * Generate an Android Intent URL for opening the app.
 * Falls back to the Play Store if the app is not installed.
 *
 * Format: intent://<host>/<path>#Intent;scheme=https;package=<pkg>;end
 */
export function generateIntentUrl(
  path: string,
  params?: Record<string, string>
): string {
  const queryString =
    params && Object.keys(params).length > 0
      ? "?" + new URLSearchParams(params).toString()
      : "";

  const host = ANDROID_HOST.replace(/^https?:\/\//, "");
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const fallbackUrl = encodeURIComponent(`${ANDROID_HOST}${path}${queryString}`);
  const playStoreUrl = encodeURIComponent(getPlayStoreUrl());

  return (
    `intent://${host}/${cleanPath}${queryString}` +
    `#Intent;scheme=https;` +
    `package=${ANDROID_APP_CONFIG.packageName};` +
    `S.browser_fallback_url=${fallbackUrl};` +
    `S.market_fallback_url=${playStoreUrl};` +
    `end`
  );
}

// ── Play Store URL Helpers ─────────────────────────────────────────────────────

/**
 * Returns the Google Play Store URL for the app.
 */
export function getPlayStoreUrl(): string {
  return `https://play.google.com/store/apps/details?id=${ANDROID_APP_CONFIG.playStoreId}`;
}

/**
 * Returns the Play Store URL with a referrer campaign tag.
 */
export function getPlayStoreUrlWithReferrer(campaign: string): string {
  const base = getPlayStoreUrl();
  return `${base}&referrer=utm_source%3D${encodeURIComponent(campaign)}%26utm_medium%3Dweb`;
}

/**
 * Returns the market:// URI scheme for direct Play Store opening on device.
 */
export function getMarketUri(): string {
  return `market://details?id=${ANDROID_APP_CONFIG.playStoreId}`;
}

// ── Device Detection ───────────────────────────────────────────────────────────

/**
 * Detect if the current browser is running on an Android device.
 * Safe to call during SSR (returns false).
 */
export function isAndroidDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent);
}

/**
 * Detect Android version from user agent. Returns null if not on Android.
 */
export function getAndroidVersion(): number | null {
  if (typeof navigator === "undefined") return null;
  const match = navigator.userAgent.match(/Android\s+(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  return parseFloat(match[1]);
}

/**
 * Check if the Android version meets the app's minimum requirement.
 */
export function isAndroidVersionSupported(): boolean {
  const version = getAndroidVersion();
  if (version === null) return false;
  // minSdkVersion 24 = Android 7.0
  return version >= 7.0;
}

/**
 * Detect if the browser is Chrome on Android (best deep link support).
 */
export function isAndroidChrome(): boolean {
  if (typeof navigator === "undefined") return false;
  return isAndroidDevice() && /Chrome\/\d+/.test(navigator.userAgent);
}

// ── Asset Links ────────────────────────────────────────────────────────────────

/**
 * Generate the assetlinks.json content for Android App Links verification.
 * This must be served at /.well-known/assetlinks.json over HTTPS.
 */
export function generateAssetLinksJson(): AssetLinksStatement[] {
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_APP_CONFIG.packageName,
        sha256_cert_fingerprints: [ANDROID_APP_CONFIG.sha256CertFingerprint],
      },
    },
  ];
}

// ── App Metadata ───────────────────────────────────────────────────────────────

/**
 * Returns structured metadata about the Android app for display and API responses.
 */
export function getAndroidAppMetadata(): AndroidAppMetadata {
  return {
    appName: ANDROID_APP_CONFIG.appName,
    packageName: ANDROID_APP_CONFIG.packageName,
    playStoreUrl: getPlayStoreUrl(),
    deepLinkScheme: ANDROID_DEEP_LINK_SCHEME,
    minAndroidVersion: "7.0 (API 24)",
    features: [
      "Invoice creation and management",
      "Stellar blockchain payment verification",
      "Biometric authentication (fingerprint / face unlock)",
      "Offline invoice viewing and draft saving",
      "Push notifications for payment events",
      "QR code scanning for payments",
      "Split payment management",
      "Background data sync",
    ],
    permissions: [
      "INTERNET",
      "USE_BIOMETRIC",
      "USE_FINGERPRINT",
      "RECEIVE_BOOT_COMPLETED",
      "VIBRATE",
      "CAMERA",
      "POST_NOTIFICATIONS",
    ],
  };
}

// ── Notification Channel Helpers ──────────────────────────────────────────────

export type AndroidNotificationChannel =
  | "payment_received"
  | "invoice_due"
  | "dispute_update"
  | "system";

/**
 * Returns the notification channel ID for a given event type.
 * These must match the channel IDs registered in the Android app.
 */
export function getNotificationChannelId(
  channel: AndroidNotificationChannel
): string {
  const channels: Record<AndroidNotificationChannel, string> = {
    payment_received: "stellarsplit_payments",
    invoice_due: "stellarsplit_invoices",
    dispute_update: "stellarsplit_disputes",
    system: "stellarsplit_system",
  };
  return channels[channel];
}

// ── Sync Protocol Helpers ─────────────────────────────────────────────────────

export interface AndroidSyncPayload {
  userId: string;
  lastSyncedAt: number;
  deviceId: string;
  appVersion: string;
}

/**
 * Build a sync request payload for the Android app's background sync worker.
 */
export function buildSyncPayload(
  userId: string,
  lastSyncedAt: number,
  deviceId: string
): AndroidSyncPayload {
  return {
    userId,
    lastSyncedAt,
    deviceId,
    appVersion: ANDROID_APP_CONFIG.versionName,
  };
}
