/**
 * Unit tests for mobileios.ts
 *
 * Coverage:
 *   1. Deep link generation — invoice, payment, dashboard, verification, custom
 *   2. App Store URL helpers — basic, campaign, review
 *   3. buildAppleAppSiteAssociation — structure and content
 *   4. User-agent detection — isIOSUserAgent, parseIOSVersion
 *   5. getIOSAppMetadata — structure and values
 */

import { describe, it, expect } from "vitest";
import {
  generateInvoiceDeepLink,
  generatePaymentDeepLink,
  generateDashboardDeepLink,
  generateVerificationDeepLink,
  generateCustomDeepLink,
  getAppStoreUrl,
  getAppStoreUrlWithCampaign,
  getAppStoreReviewUrl,
  buildAppleAppSiteAssociation,
  isIOSUserAgent,
  parseIOSVersion,
  getIOSAppMetadata,
  IOS_URL_SCHEME,
} from "./mobileios";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("mobileios", () => {
  // ── Deep link generation ─────────────────────────────────────────────────────

  describe("generateInvoiceDeepLink", () => {
    it("generates a universal link and custom scheme link", () => {
      const link = generateInvoiceDeepLink("INV-123");

      expect(link.path).toBe("/invoice/INV-123");
      expect(link.universalLink).toContain("/invoice/INV-123");
      expect(link.universalLink).toMatch(/^https:\/\//);
      expect(link.customSchemeLink).toBe(`${IOS_URL_SCHEME}://invoice/INV-123`);
    });

    it("encodes the invoice ID in the URL", () => {
      const link = generateInvoiceDeepLink("INV with spaces");

      expect(link.path).toContain(encodeURIComponent("INV with spaces"));
    });
  });

  describe("generatePaymentDeepLink", () => {
    it("generates payment deep link without amount", () => {
      const link = generatePaymentDeepLink("INV-456");

      expect(link.path).toContain("/invoice/INV-456/pay");
      expect(link.customSchemeLink).toContain("/invoice/INV-456/pay");
    });

    it("generates payment deep link with amount query param", () => {
      const link = generatePaymentDeepLink("INV-456", 50_000_000n);

      expect(link.path).toContain("amount=50000000");
      expect(link.universalLink).toContain("amount=50000000");
    });
  });

  describe("generateDashboardDeepLink", () => {
    it("generates dashboard deep link", () => {
      const link = generateDashboardDeepLink();

      expect(link.path).toBe("/dashboard");
      expect(link.universalLink).toContain("/dashboard");
      expect(link.customSchemeLink).toBe(`${IOS_URL_SCHEME}://dashboard`);
    });
  });

  describe("generateVerificationDeepLink", () => {
    it("generates verification deep link", () => {
      const link = generateVerificationDeepLink("INV-789");

      expect(link.path).toBe("/verify/INV-789");
      expect(link.universalLink).toContain("/verify/INV-789");
      expect(link.customSchemeLink).toContain("/verify/INV-789");
    });
  });

  describe("generateCustomDeepLink", () => {
    it("generates a custom deep link with params", () => {
      const link = generateCustomDeepLink("settings", { tab: "security" });

      expect(link.path).toBe("/settings?tab=security");
      expect(link.universalLink).toContain("/settings?tab=security");
      expect(link.customSchemeLink).toContain("settings?tab=security");
    });

    it("generates a custom deep link without params", () => {
      const link = generateCustomDeepLink("profile");

      expect(link.path).toBe("/profile");
      expect(link.universalLink).toContain("/profile");
      expect(link.customSchemeLink).toContain("profile");
    });
  });

  // ── App Store helpers ───────────────────────────────────────────────────────

  describe("getAppStoreUrl", () => {
    it("returns the App Store URL with the app ID", () => {
      const url = getAppStoreUrl();
      expect(url).toContain("apps.apple.com/app/id");
    });
  });

  describe("getAppStoreUrlWithCampaign", () => {
    it("appends campaign token to the URL", () => {
      const url = getAppStoreUrlWithCampaign("summer_promo");
      expect(url).toContain("ct=summer_promo");
    });

    it("appends provider token when provided", () => {
      const url = getAppStoreUrlWithCampaign("summer_promo", "google");
      expect(url).toContain("ct=summer_promo");
      expect(url).toContain("pt=google");
    });

    it("does not append pt when not provided", () => {
      const url = getAppStoreUrlWithCampaign("test");
      expect(url).not.toContain("pt=");
    });
  });

  describe("getAppStoreReviewUrl", () => {
    it("returns a review URL with write-review action", () => {
      const url = getAppStoreReviewUrl();
      expect(url).toContain("action=write-review");
    });
  });

  // ── AASA ─────────────────────────────────────────────────────────────────────

  describe("buildAppleAppSiteAssociation", () => {
    it("returns valid AASA structure", () => {
      const aasa = buildAppleAppSiteAssociation();

      expect(aasa).toHaveProperty("applinks");
      expect(aasa.applinks).toHaveProperty("details");
      expect(aasa.applinks.details).toHaveLength(1);

      const detail = aasa.applinks.details[0];
      expect(detail.appIDs).toHaveLength(1);
      expect(detail.appIDs[0]).toContain(".");
      expect(detail.components.length).toBeGreaterThan(0);
    });

    it("includes webcredentials", () => {
      const aasa = buildAppleAppSiteAssociation();
      expect(aasa.webcredentials).toBeDefined();
      expect(aasa.webcredentials!.apps).toHaveLength(1);
    });

    it("includes paths for invoice, verify, dashboard, and new invoice", () => {
      const aasa = buildAppleAppSiteAssociation();
      const paths = aasa.applinks.details[0].components.map((c) => c["/"]);

      expect(paths).toContain("/invoice/*");
      expect(paths).toContain("/verify/*");
      expect(paths).toContain("/dashboard");
      expect(paths).toContain("/invoice/new");
    });
  });

  // ── User-agent detection ────────────────────────────────────────────────────

  describe("isIOSUserAgent", () => {
    it("returns true for iPhone user agent", () => {
      expect(
        isIOSUserAgent(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
        )
      ).toBe(true);
    });

    it("returns true for iPad user agent", () => {
      expect(
        isIOSUserAgent(
          "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
        )
      ).toBe(true);
    });

    it("returns true for iPod user agent", () => {
      expect(
        isIOSUserAgent("Mozilla/5.0 (iPod touch; CPU iPhone OS 16_0 like Mac OS X)")
      ).toBe(true);
    });

    it("returns false for Android user agent", () => {
      expect(
        isIOSUserAgent(
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36"
        )
      ).toBe(false);
    });

    it("returns false for desktop Chrome user agent", () => {
      expect(
        isIOSUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
      ).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isIOSUserAgent("")).toBe(false);
    });
  });

  describe("parseIOSVersion", () => {
    it("parses iOS 17_0 correctly", () => {
      const result = parseIOSVersion(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"
      );
      expect(result).toEqual({ major: 17, minor: 0 });
    });

    it("parses iOS 16_5 correctly", () => {
      const result = parseIOSVersion(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X)"
      );
      expect(result).toEqual({ major: 16, minor: 5 });
    });

    it("returns null for non-iOS user agent", () => {
      expect(parseIOSVersion("Mozilla/5.0 (Linux; Android 14)")).toBeNull();
    });
  });

  // ── App metadata ─────────────────────────────────────────────────────────────

  describe("getIOSAppMetadata", () => {
    it("returns metadata with all required fields", () => {
      const meta = getIOSAppMetadata();

      expect(meta).toHaveProperty("appStoreId");
      expect(meta).toHaveProperty("bundleId");
      expect(meta).toHaveProperty("teamId");
      expect(meta).toHaveProperty("appName");
      expect(meta).toHaveProperty("appStoreUrl");
      expect(meta).toHaveProperty("minimumOSVersion");
      expect(meta).toHaveProperty("supportedFeatures");
    });

    it("returns app name as StellarSplit", () => {
      expect(getIOSAppMetadata().appName).toBe("StellarSplit");
    });

    it("returns minimumOSVersion as 16.0", () => {
      expect(getIOSAppMetadata().minimumOSVersion).toBe("16.0");
    });

    it("includes expected features", () => {
      const features = getIOSAppMetadata().supportedFeatures;
      expect(features).toContain("invoice_creation");
      expect(features).toContain("payment_splitting");
      expect(features).toContain("blockchain_verification");
      expect(features).toContain("push_notifications");
      expect(features).toContain("biometric_auth");
    });
  });
});
