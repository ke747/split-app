/**
 * Unit tests for mobileandroid.ts
 *
 * Coverage:
 *   1. Deep link generation — invoice, payment, verify, custom (App Links and custom scheme)
 *   2. Intent URL generation
 *   3. Play Store URL helpers — basic, referrer, market URI
 *   4. Device detection — isAndroidDevice, getAndroidVersion, isAndroidVersionSupported, isAndroidChrome
 *   5. generateAssetLinksJson — structure and content
 *   6. getAndroidAppMetadata — structure and values
 *   7. Notification channel helpers
 *   8. Sync payload builder
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generateAndroidDeepLink,
  generateInvoiceDeepLink,
  generatePaymentDeepLink,
  generateVerifyDeepLink,
  generateIntentUrl,
  getPlayStoreUrl,
  getPlayStoreUrlWithReferrer,
  getMarketUri,
  isAndroidDevice,
  getAndroidVersion,
  isAndroidVersionSupported,
  isAndroidChrome,
  generateAssetLinksJson,
  getAndroidAppMetadata,
  getNotificationChannelId,
  buildSyncPayload,
  ANDROID_APP_CONFIG,
  ANDROID_DEEP_LINK_SCHEME,
} from "./mobileandroid";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("mobileandroid", () => {
  // ── Deep link generation ─────────────────────────────────────────────────────

  describe("generateAndroidDeepLink", () => {
    it("generates an App Link (https://) by default", () => {
      const url = generateAndroidDeepLink({ path: "/invoice/INV-123" });
      expect(url).toMatch(/^https:\/\//);
      expect(url).toContain("/invoice/INV-123");
    });

    it("generates a custom scheme URL when useAppLinks=false", () => {
      const url = generateAndroidDeepLink({ path: "/invoice/INV-123", useAppLinks: false });
      expect(url).toBe(`${ANDROID_DEEP_LINK_SCHEME}://invoice/INV-123`);
    });

    it("appends query parameters", () => {
      const url = generateAndroidDeepLink({
        path: "/invoice/INV-123",
        params: { ref: "web", tab: "details" },
      });
      expect(url).toContain("ref=web");
      expect(url).toContain("tab=details");
    });

    it("does not append ? when no params", () => {
      const url = generateAndroidDeepLink({ path: "/dashboard" });
      expect(url).not.toContain("?");
    });
  });

  describe("generateInvoiceDeepLink", () => {
    it("generates a deep link for a specific invoice (App Links)", () => {
      const url = generateInvoiceDeepLink("INV-456");
      expect(url).toContain("/invoice/INV-456");
      expect(url).toMatch(/^https:\/\//);
    });

    it("generates a deep link with custom scheme", () => {
      const url = generateInvoiceDeepLink("INV-456", false);
      expect(url).toBe(`${ANDROID_DEEP_LINK_SCHEME}://invoice/INV-456`);
    });
  });

  describe("generatePaymentDeepLink", () => {
    it("generates a payment deep link", () => {
      const url = generatePaymentDeepLink("INV-789");
      expect(url).toContain("/pay/INV-789");
    });
  });

  describe("generateVerifyDeepLink", () => {
    it("generates a verification deep link", () => {
      const url = generateVerifyDeepLink("INV-999");
      expect(url).toContain("/verify/INV-999");
    });
  });

  // ── Intent URL ───────────────────────────────────────────────────────────────

  describe("generateIntentUrl", () => {
    it("generates an intent:// URL with package and fallback", () => {
      const url = generateIntentUrl("/invoice/INV-123");
      expect(url).toMatch(/^intent:\/\//);
      expect(url).toContain(`package=${ANDROID_APP_CONFIG.packageName}`);
      expect(url).toContain("S.browser_fallback_url=");
      expect(url).toContain("S.market_fallback_url=");
      expect(url).toContain(";end");
    });

    it("appends query params to intent URL", () => {
      const url = generateIntentUrl("/invoice/INV-123", { ref: "web" });
      expect(url).toContain("ref=web");
    });
  });

  // ── Play Store helpers ──────────────────────────────────────────────────────

  describe("getPlayStoreUrl", () => {
    it("returns the Play Store URL with package name", () => {
      const url = getPlayStoreUrl();
      expect(url).toContain("play.google.com/store/apps/details");
      expect(url).toContain(ANDROID_APP_CONFIG.playStoreId);
    });
  });

  describe("getPlayStoreUrlWithReferrer", () => {
    it("appends referrer campaign", () => {
      const url = getPlayStoreUrlWithReferrer("summer_campaign");
      expect(url).toContain("referrer=");
      expect(url).toContain("utm_source");
      expect(url).toContain("summer_campaign");
    });
  });

  describe("getMarketUri", () => {
    it("returns the market:// URI", () => {
      const uri = getMarketUri();
      expect(uri).toMatch(/^market:\/\//);
      expect(uri).toContain(ANDROID_APP_CONFIG.playStoreId);
    });
  });

  // ── Device detection ─────────────────────────────────────────────────────────

  describe("device detection", () => {
    const originalNavigator = navigator;

    afterEach(() => {
      // Restore navigator
      Object.defineProperty(global, "navigator", {
        value: originalNavigator,
        configurable: true,
        writable: true,
      });
    });

    describe("isAndroidDevice", () => {
      it("returns true for Android user agent", () => {
        Object.defineProperty(global, "navigator", {
          value: { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)" },
          configurable: true,
          writable: true,
        });
        expect(isAndroidDevice()).toBe(true);
      });

      it("returns false for iOS user agent", () => {
        Object.defineProperty(global, "navigator", {
          value: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" },
          configurable: true,
          writable: true,
        });
        expect(isAndroidDevice()).toBe(false);
      });

      it("returns false during SSR (navigator undefined)", () => {
        Object.defineProperty(global, "navigator", {
          value: undefined,
          configurable: true,
          writable: true,
        });
        expect(isAndroidDevice()).toBe(false);
      });
    });

    describe("getAndroidVersion", () => {
      it("parses Android 14", () => {
        Object.defineProperty(global, "navigator", {
          value: { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)" },
          configurable: true,
          writable: true,
        });
        expect(getAndroidVersion()).toBe(14);
      });

      it("parses Android 10.5", () => {
        Object.defineProperty(global, "navigator", {
          value: { userAgent: "Mozilla/5.0 (Linux; Android 10.5; Samsung)" },
          configurable: true,
          writable: true,
        });
        expect(getAndroidVersion()).toBe(10.5);
      });

      it("returns null for non-Android", () => {
        Object.defineProperty(global, "navigator", {
          value: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17)" },
          configurable: true,
          writable: true,
        });
        expect(getAndroidVersion()).toBeNull();
      });

      it("returns null during SSR", () => {
        Object.defineProperty(global, "navigator", {
          value: undefined,
          configurable: true,
          writable: true,
        });
        expect(getAndroidVersion()).toBeNull();
      });
    });

    describe("isAndroidVersionSupported", () => {
      it("returns true for version >= 7.0", () => {
        Object.defineProperty(global, "navigator", {
          value: { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel)" },
          configurable: true,
          writable: true,
        });
        expect(isAndroidVersionSupported()).toBe(true);
      });

      it("returns false for version < 7.0", () => {
        Object.defineProperty(global, "navigator", {
          value: { userAgent: "Mozilla/5.0 (Linux; Android 6.0; Old)" },
          configurable: true,
          writable: true,
        });
        expect(isAndroidVersionSupported()).toBe(false);
      });

      it("returns false for non-Android", () => {
        Object.defineProperty(global, "navigator", {
          value: { userAgent: "Mozilla/5.0 (Windows NT 10.0)" },
          configurable: true,
          writable: true,
        });
        expect(isAndroidVersionSupported()).toBe(false);
      });
    });

    describe("isAndroidChrome", () => {
      it("returns true for Android Chrome", () => {
        Object.defineProperty(global, "navigator", {
          value: {
            userAgent:
              "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
          },
          configurable: true,
          writable: true,
        });
        expect(isAndroidChrome()).toBe(true);
      });

      it("returns false for Android Firefox", () => {
        Object.defineProperty(global, "navigator", {
          value: {
            userAgent:
              "Mozilla/5.0 (Linux; Android 14; Pixel 8) Gecko/121.0 Firefox/121.0",
          },
          configurable: true,
          writable: true,
        });
        expect(isAndroidChrome()).toBe(false);
      });

      it("returns false for desktop Chrome", () => {
        Object.defineProperty(global, "navigator", {
          value: {
            userAgent:
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0",
          },
          configurable: true,
          writable: true,
        });
        expect(isAndroidChrome()).toBe(false);
      });
    });
  });

  // ── Asset Links ──────────────────────────────────────────────────────────────

  describe("generateAssetLinksJson", () => {
    it("returns valid assetlinks.json structure", () => {
      const statements = generateAssetLinksJson();

      expect(statements).toHaveLength(1);
      expect(statements[0].relation).toContain("delegate_permission/common.handle_all_urls");
      expect(statements[0].target.namespace).toBe("android_app");
      expect(statements[0].target.package_name).toBe(ANDROID_APP_CONFIG.packageName);
      expect(statements[0].target.sha256_cert_fingerprints).toHaveLength(1);
      expect(statements[0].target.sha256_cert_fingerprints[0]).toBe(
        ANDROID_APP_CONFIG.sha256CertFingerprint
      );
    });
  });

  // ── App metadata ─────────────────────────────────────────────────────────────

  describe("getAndroidAppMetadata", () => {
    it("returns metadata with all required fields", () => {
      const meta = getAndroidAppMetadata();

      expect(meta).toHaveProperty("appName");
      expect(meta).toHaveProperty("packageName");
      expect(meta).toHaveProperty("playStoreUrl");
      expect(meta).toHaveProperty("deepLinkScheme");
      expect(meta).toHaveProperty("minAndroidVersion");
      expect(meta).toHaveProperty("features");
      expect(meta).toHaveProperty("permissions");
    });

    it("returns appName as StellarSplit", () => {
      expect(getAndroidAppMetadata().appName).toBe("StellarSplit");
    });

    it("returns minimum version 7.0 (API 24)", () => {
      expect(getAndroidAppMetadata().minAndroidVersion).toContain("7.0");
    });

    it("includes expected features", () => {
      const features = getAndroidAppMetadata().features;
      expect(features).toContain("Invoice creation and management");
      expect(features).toContain("Stellar blockchain payment verification");
      expect(features).toContain("Biometric authentication (fingerprint / face unlock)");
      expect(features).toContain("Offline invoice viewing and draft saving");
      expect(features).toContain("Push notifications for payment events");
    });

    it("includes expected permissions", () => {
      const permissions = getAndroidAppMetadata().permissions;
      expect(permissions).toContain("INTERNET");
      expect(permissions).toContain("USE_BIOMETRIC");
      expect(permissions).toContain("CAMERA");
      expect(permissions).toContain("POST_NOTIFICATIONS");
    });
  });

  // ── Notification channels ─────────────────────────────────────────────────────

  describe("getNotificationChannelId", () => {
    it("returns correct channel ID for payment_received", () => {
      expect(getNotificationChannelId("payment_received")).toBe("stellarsplit_payments");
    });

    it("returns correct channel ID for invoice_due", () => {
      expect(getNotificationChannelId("invoice_due")).toBe("stellarsplit_invoices");
    });

    it("returns correct channel ID for dispute_update", () => {
      expect(getNotificationChannelId("dispute_update")).toBe("stellarsplit_disputes");
    });

    it("returns correct channel ID for system", () => {
      expect(getNotificationChannelId("system")).toBe("stellarsplit_system");
    });
  });

  // ── Sync payload ──────────────────────────────────────────────────────────────

  describe("buildSyncPayload", () => {
    it("builds a sync payload with all fields", () => {
      const payload = buildSyncPayload("user-123", 1705276800000, "device-abc");

      expect(payload.userId).toBe("user-123");
      expect(payload.lastSyncedAt).toBe(1705276800000);
      expect(payload.deviceId).toBe("device-abc");
      expect(payload.appVersion).toBe(ANDROID_APP_CONFIG.versionName);
    });
  });
});
