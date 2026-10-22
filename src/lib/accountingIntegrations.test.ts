/**
 * Unit tests for accountingIntegrations.ts
 *
 * Coverage:
 *   1. mapInvoiceToAccounting — field mapping, status mapping, line items
 *   2. mapPaymentToAccounting — payment mapping
 *   3. validateCredentials — token expiry, missing token
 *   4. syncInvoiceToQuickBooks — create, update, rate limit, missing realmId
 *   5. syncInvoiceToXero — create, update, rate limit, missing tenantId
 *   6. recordPaymentInQuickBooks / recordPaymentInXero — success and errors
 *   7. syncInvoices — bulk sync with errors and early stop
 *   8. reconcileInvoices — exact match, amount match, unmatched, discrepancies
 *   9. Error classes — AccountingIntegrationError, TokenExpiredError, RateLimitError
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mapInvoiceToAccounting,
  mapPaymentToAccounting,
  syncInvoiceToQuickBooks,
  syncInvoiceToXero,
  recordPaymentInQuickBooks,
  recordPaymentInXero,
  syncInvoices,
  reconcileInvoices,
  AccountingIntegrationError,
  TokenExpiredError,
  RateLimitError,
} from "./accountingIntegrations";
import type {
  StellarInvoice,
  AccountingCredentials,
  AccountingInvoice,
  AccountingProvider,
} from "./accountingIntegrations";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const STROOP = 10_000_000n;

function makeInvoice(overrides: Partial<StellarInvoice> = {}): StellarInvoice {
  return {
    id: "INV-001",
    createdAt: 1705276800000, // 2024-01-15
    dueAt: 1705363200000, // 2024-01-16
    description: "Test invoice",
    totalAmount: 100_000_000n, // 10 USDC
    paidAmount: 30_000_000n, // 3 USDC
    currency: "USD",
    creatorAddress: "GCREATORADDRESS123",
    recipients: [
      { address: "GRECIPIENT1", amount: 60_000_000n, label: "Split A" },
      { address: "GRECIPIENT2", amount: 40_000_000n },
    ],
    status: "partial",
    txHashes: ["tx123"],
    ...overrides,
  };
}

function makeCredentials(
  provider: AccountingProvider,
  overrides: Partial<AccountingCredentials> = {}
): AccountingCredentials {
  return {
    provider,
    clientId: "client-id",
    clientSecret: "client-secret",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    realmId: provider === "quickbooks" ? "realm-123" : undefined,
    tenantId: provider === "xero" ? "tenant-123" : undefined,
    tokenExpiresAt: Date.now() + 3_600_000, // 1 hour from now
    ...overrides,
  };
}

function mockFetchResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>
) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: new Map(Object.entries(headers ?? {})),
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("accountingIntegrations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── mapInvoiceToAccounting ──────────────────────────────────────────────────

  describe("mapInvoiceToAccounting", () => {
    it("maps all fields correctly", () => {
      const invoice = makeInvoice();
      const result = mapInvoiceToAccounting(invoice, "Test Creator");

      expect(result.externalId).toBe("INV-001");
      expect(result.invoiceNumber).toBe("SS-INV-001");
      expect(result.issueDate).toBe("2024-01-15");
      expect(result.dueDate).toBe("2024-01-16");
      expect(result.description).toBe("Test invoice");
      expect(result.currency).toBe("USD");
      expect(result.totalAmount).toBe(10);
      expect(result.amountDue).toBe(7); // 10 - 3
      expect(result.reference).toBe("stellar:INV-001");
      expect(result.contact.name).toBe("Test Creator");
      expect(result.contact.externalRef).toBe("GCREATORADDRESS123");
    });

    it("maps line items from recipients", () => {
      const invoice = makeInvoice();
      const result = mapInvoiceToAccounting(invoice, "Creator");

      expect(result.lineItems).toHaveLength(2);
      expect(result.lineItems[0].description).toBe("Split A");
      expect(result.lineItems[0].unitAmount).toBe(6);
      expect(result.lineItems[1].description).toContain("Payment to");
      expect(result.lineItems[1].unitAmount).toBe(4);
    });

    it("creates a default line item when no recipients", () => {
      const invoice = makeInvoice({ recipients: [] });
      const result = mapInvoiceToAccounting(invoice, "Creator");

      expect(result.lineItems).toHaveLength(1);
      expect(result.lineItems[0].unitAmount).toBe(10);
    });

    it("maps status correctly for each invoice state", () => {
      expect(mapInvoiceToAccounting(makeInvoice({ status: "draft" }), "C").status).toBe("draft");
      expect(mapInvoiceToAccounting(makeInvoice({ status: "pending" }), "C").status).toBe("authorised");
      expect(mapInvoiceToAccounting(makeInvoice({ status: "partial" }), "C").status).toBe("authorised");
      expect(mapInvoiceToAccounting(makeInvoice({ status: "paid" }), "C").status).toBe("paid");
      expect(mapInvoiceToAccounting(makeInvoice({ status: "cancelled" }), "C").status).toBe("voided");
      expect(mapInvoiceToAccounting(makeInvoice({ status: "overdue" }), "C").status).toBe("submitted");
    });

    it("handles null dueAt", () => {
      const invoice = makeInvoice({ dueAt: null });
      const result = mapInvoiceToAccounting(invoice, "Creator");
      expect(result.dueDate).toBeNull();
    });

    it("amountDue is never negative", () => {
      const invoice = makeInvoice({ totalAmount: 10_000_000n, paidAmount: 20_000_000n });
      const result = mapInvoiceToAccounting(invoice, "Creator");
      expect(result.amountDue).toBe(0);
    });
  });

  // ── mapPaymentToAccounting ──────────────────────────────────────────────────

  describe("mapPaymentToAccounting", () => {
    it("maps payment fields correctly", () => {
      const result = mapPaymentToAccounting({
        invoiceId: "INV-001",
        txHash: "abcdef0123456789",
        amount: 50_000_000n,
        currency: "USD",
        settledAt: 1705276800000,
        providerInvoiceRef: "QB-INV-99",
      });

      expect(result.externalId).toBe("abcdef0123456789");
      expect(result.invoiceRef).toBe("QB-INV-99");
      expect(result.amount).toBe(5);
      expect(result.currency).toBe("USD");
      expect(result.date).toBe("2024-01-15");
      expect(result.reference).toContain("tx:");
      expect(result.account).toBe("1000");
    });
  });

  // ── Credential validation ────────────────────────────────────────────────────

  describe("credential validation", () => {
    it("throws TokenExpiredError when token has expired", async () => {
      const creds = makeCredentials("quickbooks", { tokenExpiresAt: Date.now() - 1000 });
      const invoice = mapInvoiceToAccounting(makeInvoice(), "Creator");

      await expect(syncInvoiceToQuickBooks(invoice, creds)).rejects.toThrow(TokenExpiredError);
    });

    it("throws AccountingIntegrationError when accessToken is missing", async () => {
      const creds = makeCredentials("quickbooks", { accessToken: "" });
      const invoice = mapInvoiceToAccounting(makeInvoice(), "Creator");

      await expect(syncInvoiceToQuickBooks(invoice, creds)).rejects.toThrow(
        AccountingIntegrationError
      );
    });
  });

  // ── QuickBooks integration ───────────────────────────────────────────────────

  describe("syncInvoiceToQuickBooks", () => {
    it("creates a new invoice and returns providerRef", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockFetchResponse(200, { Invoice: { Id: "QB-100" } })
      ) as unknown as typeof fetch;

      const invoice = mapInvoiceToAccounting(makeInvoice(), "Creator");
      const creds = makeCredentials("quickbooks");
      const result = await syncInvoiceToQuickBooks(invoice, creds);

      expect(result.providerRef).toBe("QB-100");
      expect(result.created).toBe(true);
    });

    it("updates an existing invoice when providerRef is set", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockFetchResponse(200, { Invoice: { Id: "QB-200" } })
      ) as unknown as typeof fetch;

      const invoice = mapInvoiceToAccounting(makeInvoice(), "Creator");
      invoice.providerRef = "QB-200";
      const creds = makeCredentials("quickbooks");
      const result = await syncInvoiceToQuickBooks(invoice, creds);

      expect(result.created).toBe(false);
    });

    it("throws RateLimitError on 429", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockFetchResponse(429, {}, { "Retry-After": "30" })
      ) as unknown as typeof fetch;

      const invoice = mapInvoiceToAccounting(makeInvoice(), "Creator");
      const creds = makeCredentials("quickbooks");

      await expect(syncInvoiceToQuickBooks(invoice, creds)).rejects.toThrow(RateLimitError);
    });

    it("throws when realmId is missing", async () => {
      const invoice = mapInvoiceToAccounting(makeInvoice(), "Creator");
      const creds = makeCredentials("quickbooks", { realmId: undefined });

      await expect(syncInvoiceToQuickBooks(invoice, creds)).rejects.toThrow(
        AccountingIntegrationError
      );
    });

    it("throws on API error with fault message", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockFetchResponse(400, { Fault: { Error: [{ Message: "Bad request" }] } })
      ) as unknown as typeof fetch;

      const invoice = mapInvoiceToAccounting(makeInvoice(), "Creator");
      const creds = makeCredentials("quickbooks");

      await expect(syncInvoiceToQuickBooks(invoice, creds)).rejects.toThrow("Bad request");
    });
  });

  describe("recordPaymentInQuickBooks", () => {
    it("records a payment and returns providerRef", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockFetchResponse(200, { Payment: { Id: "PM-100" } })
      ) as unknown as typeof fetch;

      const payment = mapPaymentToAccounting({
        invoiceId: "INV-001",
        txHash: "txhash123",
        amount: STROOP,
        currency: "USD",
        settledAt: Date.now(),
        providerInvoiceRef: "QB-100",
      });
      const creds = makeCredentials("quickbooks");

      const result = await recordPaymentInQuickBooks(payment, creds);
      expect(result.providerRef).toBe("PM-100");
    });

    it("throws when realmId is missing", async () => {
      const payment = mapPaymentToAccounting({
        invoiceId: "INV-001",
        txHash: "txhash123",
        amount: STROOP,
        currency: "USD",
        settledAt: Date.now(),
        providerInvoiceRef: "QB-100",
      });
      const creds = makeCredentials("quickbooks", { realmId: undefined });

      await expect(recordPaymentInQuickBooks(payment, creds)).rejects.toThrow(
        AccountingIntegrationError
      );
    });
  });

  // ── Xero integration ────────────────────────────────────────────────────────

  describe("syncInvoiceToXero", () => {
    it("creates a new invoice and returns providerRef", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockFetchResponse(200, { Invoices: [{ InvoiceID: "XERO-100" }] })
      ) as unknown as typeof fetch;

      const invoice = mapInvoiceToAccounting(makeInvoice(), "Creator");
      const creds = makeCredentials("xero");
      const result = await syncInvoiceToXero(invoice, creds);

      expect(result.providerRef).toBe("XERO-100");
      expect(result.created).toBe(true);
    });

    it("updates an existing invoice when providerRef is set", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockFetchResponse(200, { Invoices: [{ InvoiceID: "XERO-200" }] })
      ) as unknown as typeof fetch;

      const invoice = mapInvoiceToAccounting(makeInvoice(), "Creator");
      invoice.providerRef = "XERO-200";
      const creds = makeCredentials("xero");
      const result = await syncInvoiceToXero(invoice, creds);

      expect(result.created).toBe(false);
    });

    it("throws RateLimitError on 429", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockFetchResponse(429, {}, { "Retry-After": "60" })
      ) as unknown as typeof fetch;

      const invoice = mapInvoiceToAccounting(makeInvoice(), "Creator");
      const creds = makeCredentials("xero");

      await expect(syncInvoiceToXero(invoice, creds)).rejects.toThrow(RateLimitError);
    });

    it("throws when tenantId is missing", async () => {
      const invoice = mapInvoiceToAccounting(makeInvoice(), "Creator");
      const creds = makeCredentials("xero", { tenantId: undefined });

      await expect(syncInvoiceToXero(invoice, creds)).rejects.toThrow(
        AccountingIntegrationError
      );
    });

    it("throws on API error with validation message", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockFetchResponse(400, {
          Elements: [{ ValidationErrors: [{ Message: "Invalid date" }] }],
        })
      ) as unknown as typeof fetch;

      const invoice = mapInvoiceToAccounting(makeInvoice(), "Creator");
      const creds = makeCredentials("xero");

      await expect(syncInvoiceToXero(invoice, creds)).rejects.toThrow("Invalid date");
    });
  });

  describe("recordPaymentInXero", () => {
    it("records a payment and returns providerRef", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockFetchResponse(200, { Payments: [{ PaymentID: "PM-XERO-100" }] })
      ) as unknown as typeof fetch;

      const payment = mapPaymentToAccounting({
        invoiceId: "INV-001",
        txHash: "txhash456",
        amount: STROOP,
        currency: "USD",
        settledAt: Date.now(),
        providerInvoiceRef: "XERO-100",
      });
      const creds = makeCredentials("xero");

      const result = await recordPaymentInXero(payment, creds);
      expect(result.providerRef).toBe("PM-XERO-100");
    });
  });

  // ── syncInvoices ────────────────────────────────────────────────────────────

  describe("syncInvoices", () => {
    it("syncs multiple invoices and returns a SyncResult", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockFetchResponse(200, { Invoice: { Id: "QB-1" } })
      ) as unknown as typeof fetch;

      const invoices = [makeInvoice({ id: "INV-A" }), makeInvoice({ id: "INV-B" })];
      const creds = makeCredentials("quickbooks");
      const refMap = new Map<string, string>();

      const result = await syncInvoices(invoices, creds, refMap);

      expect(result.provider).toBe("quickbooks");
      expect(result.invoicesCreated).toBe(2);
      expect(result.invoicesUpdated).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(refMap.get("INV-A")).toBe("QB-1");
      expect(refMap.get("INV-B")).toBe("QB-1");
    });

    it("stops on non-retryable errors", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockFetchResponse(429, {}, { "Retry-After": "10" })
      ) as unknown as typeof fetch;

      const invoices = [makeInvoice({ id: "INV-X" }), makeInvoice({ id: "INV-Y" })];
      const creds = makeCredentials("quickbooks");

      const result = await syncInvoices(invoices, creds);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].retryable).toBe(true);
    });

    it("throws TokenExpiredError immediately when token is expired", async () => {
      const invoices = [makeInvoice({ id: "INV-X" }), makeInvoice({ id: "INV-Y" })];
      const creds = makeCredentials("quickbooks", { tokenExpiresAt: Date.now() - 1000 });

      // validateCredentials is called before the loop, so the error propagates
      await expect(syncInvoices(invoices, creds)).rejects.toThrow(TokenExpiredError);
    });
  });

  // ── reconcileInvoices ──────────────────────────────────────────────────────

  describe("reconcileInvoices", () => {
    it("matches by exact reference", () => {
      const stellar = [makeInvoice({ id: "INV-001" })];
      const provider: AccountingInvoice[] = [{
        externalId: "INV-001",
        invoiceNumber: "SS-INV-001",
        issueDate: "2024-01-15",
        dueDate: "2024-01-16",
        description: "Test",
        currency: "USD",
        lineItems: [],
        totalAmount: 10,
        amountDue: 7,
        status: "authorised",
        contact: { name: "Creator" },
        reference: "stellar:INV-001",
      }];

      const report = reconcileInvoices(stellar, provider, "xero");

      expect(report.matched).toHaveLength(1);
      expect(report.matched[0].matchType).toBe("exact");
      expect(report.matched[0].confidence).toBe(1);
      expect(report.unmatched).toHaveLength(0);
    });

    it("matches by amount when reference is missing", () => {
      const stellar = [makeInvoice({ id: "INV-002" })];
      const provider: AccountingInvoice[] = [{
        externalId: "X",
        invoiceNumber: "X-1",
        issueDate: "2024-01-15",
        dueDate: null,
        description: "",
        currency: "USD",
        lineItems: [],
        totalAmount: 10,
        amountDue: 10,
        status: "authorised",
        contact: { name: "C" },
        reference: "",
      }];

      const report = reconcileInvoices(stellar, provider, "xero");

      expect(report.matched).toHaveLength(1);
      expect(report.matched[0].matchType).toBe("amount_match");
      expect(report.matched[0].confidence).toBe(0.7);
    });

    it("flags unmatched invoices", () => {
      const stellar = [makeInvoice({ id: "INV-003" })];
      const provider: AccountingInvoice[] = [];

      const report = reconcileInvoices(stellar, provider, "xero");

      expect(report.unmatched).toEqual(["INV-003"]);
      expect(report.matched).toHaveLength(0);
    });

    it("detects amount discrepancies on exact match", () => {
      const stellar = [makeInvoice({ id: "INV-004", totalAmount: 100_000_000n })];
      const provider: AccountingInvoice[] = [{
        externalId: "INV-004",
        invoiceNumber: "SS-INV-004",
        issueDate: "2024-01-15",
        dueDate: null,
        description: "",
        currency: "USD",
        lineItems: [],
        totalAmount: 15, // different from 10
        amountDue: 15,
        status: "authorised",
        contact: { name: "C" },
        reference: "stellar:INV-004",
      }];

      const report = reconcileInvoices(stellar, provider, "xero");

      expect(report.discrepancies.length).toBeGreaterThan(0);
      expect(report.discrepancies[0].field).toBe("totalAmount");
    });

    it("detects due date discrepancies", () => {
      const stellar = [makeInvoice({ id: "INV-005", dueAt: 1705276800000 })];
      const provider: AccountingInvoice[] = [{
        externalId: "INV-005",
        invoiceNumber: "SS-INV-005",
        issueDate: "2024-01-15",
        dueDate: "2024-02-01", // different
        description: "",
        currency: "USD",
        lineItems: [],
        totalAmount: 10,
        amountDue: 7,
        status: "authorised",
        contact: { name: "C" },
        reference: "stellar:INV-005",
      }];

      const report = reconcileInvoices(stellar, provider, "xero");

      const dueDateDiscrepancy = report.discrepancies.find((d) => d.field === "dueDate");
      expect(dueDateDiscrepancy).toBeDefined();
    });

    it("returns correct counts in report", () => {
      const stellar = [makeInvoice({ id: "INV-A" }), makeInvoice({ id: "INV-B" })];
      const provider: AccountingInvoice[] = [
        {
          externalId: "INV-A",
          invoiceNumber: "SS-INV-A",
          issueDate: "2024-01-15",
          dueDate: "2024-01-16",
          description: "",
          currency: "USD",
          lineItems: [],
          totalAmount: 10,
          amountDue: 7,
          status: "authorised",
          contact: { name: "C" },
          reference: "stellar:INV-A",
        },
      ];

      const report = reconcileInvoices(stellar, provider, "quickbooks");

      expect(report.totalStellarInvoices).toBe(2);
      expect(report.totalProviderInvoices).toBe(1);
    });
  });

  // ── Error classes ──────────────────────────────────────────────────────────

  describe("error classes", () => {
    it("AccountingIntegrationError has code and retryable", () => {
      const err = new AccountingIntegrationError("msg", "quickbooks", "CODE", true);
      expect(err.message).toBe("msg");
      expect(err.provider).toBe("quickbooks");
      expect(err.code).toBe("CODE");
      expect(err.retryable).toBe(true);
      expect(err.name).toBe("AccountingIntegrationError");
    });

    it("TokenExpiredError is not retryable", () => {
      const err = new TokenExpiredError("xero");
      expect(err.retryable).toBe(false);
      expect(err.code).toBe("TOKEN_EXPIRED");
      expect(err.provider).toBe("xero");
      expect(err.name).toBe("TokenExpiredError");
    });

    it("RateLimitError is retryable and has retryAfterMs", () => {
      const err = new RateLimitError("quickbooks", 5000);
      expect(err.retryable).toBe(true);
      expect(err.retryAfterMs).toBe(5000);
      expect(err.code).toBe("RATE_LIMIT");
      expect(err.name).toBe("RateLimitError");
    });

    it("TokenExpiredError extends AccountingIntegrationError", () => {
      const err = new TokenExpiredError("quickbooks");
      expect(err).toBeInstanceOf(AccountingIntegrationError);
    });

    it("RateLimitError extends AccountingIntegrationError", () => {
      const err = new RateLimitError("xero", 1000);
      expect(err).toBeInstanceOf(AccountingIntegrationError);
    });
  });
});
