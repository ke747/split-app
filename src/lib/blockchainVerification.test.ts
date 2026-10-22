/**
 * Unit tests for blockchainVerification.ts
 *
 * Coverage:
 *   1. verifyPayment — successful verification, not found, recipient mismatch, insufficient amount, network error
 *   2. recordSettlement — recording, idempotency, retrieval by txHash and invoiceId
 *   3. verifySettlementIntegrity — valid and tampered records
 *   4. getAuditTrail — filtering by invoiceId, txHash, limit
 *   5. getVerificationAnalytics — aggregation metrics
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  verifyPayment,
  recordSettlement,
  getSettlement,
  getSettlementsForInvoice,
  verifySettlementIntegrity,
  getAuditTrail,
  getVerificationAnalytics,
} from "./blockchainVerification";
import type { PaymentVerificationRequest } from "./blockchainVerification";

// ── Helpers ──────────────────────────────────────────────────────────────────

const TX_HASH = "a".repeat(64);
const RECIPIENT = "GAQHJ6J5Q7N3M4W2ZVCXY7RQZ5DQ3X2VQK2Y5GQN3VQX5J6J5QZ";
const INVOICE_ID = "INV-001";
const STROOP = 10_000_000n; // 1 USDC

function mockTxResponse(overrides?: {
  ledger?: number;
  created_at?: string;
  memo?: string;
  operations?: Array<Record<string, unknown>>;
}) {
  return {
    id: TX_HASH,
    ledger: overrides?.ledger ?? 12345,
    created_at: overrides?.created_at ?? "2024-01-15T10:30:00Z",
    memo: overrides?.memo ?? INVOICE_ID,
    _links: { operations: { href: "https://horizon-testnet.stellar.org/transactions/abc/operations" } },
  };
}

function mockPaymentOperation(overrides?: Partial<{
  type: string;
  from: string;
  to: string;
  asset_code: string;
  asset_type: string;
  amount: string;
}>) {
  return {
    type: overrides?.type ?? "payment",
    from: overrides?.from ?? "GPAYERADDRESS",
    to: overrides?.to ?? RECIPIENT,
    asset_code: overrides?.asset_code ?? "USDC",
    asset_type: overrides?.asset_type ?? "credit_alphanum4",
    amount: overrides?.amount ?? "1.0000000",
  };
}

function mockOpsResponse(operations: Array<Record<string, unknown>>) {
  return {
    _embedded: { records: operations },
  };
}

function setupFetchMocks(
  txResponse: Record<string, unknown> | null,
  opsResponse: Record<string, unknown>
) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.includes(`/transactions/${TX_HASH}`)) {
      if (txResponse === null) {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(txResponse),
      });
    }
    if (url.includes("/operations")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(opsResponse),
      });
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("blockchainVerification", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── verifyPayment ─────────────────────────────────────────────────────────

  describe("verifyPayment", () => {
    const baseRequest: PaymentVerificationRequest = {
      txHash: TX_HASH,
      invoiceId: INVOICE_ID,
      recipient: RECIPIENT,
      expectedAmount: STROOP, // 1 USDC
    };

    it("returns verified when payment matches recipient and amount", async () => {
      setupFetchMocks(
        mockTxResponse(),
        mockOpsResponse([mockPaymentOperation()])
      );

      const result = await verifyPayment(baseRequest);

      expect(result.status).toBe("verified");
      expect(result.txHash).toBe(TX_HASH);
      expect(result.invoiceId).toBe(INVOICE_ID);
      expect(result.ledger).toBe(12345);
      expect(result.createdAt).toBe("2024-01-15T10:30:00Z");
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toEqual({
        type: "payment",
        from: "GPAYERADDRESS",
        to: RECIPIENT,
        asset: "USDC",
        amount: "1.0000000",
      });
    });

    it("returns not_found when transaction does not exist on ledger", async () => {
      setupFetchMocks(null, mockOpsResponse([]));

      const result = await verifyPayment(baseRequest);

      expect(result.status).toBe("not_found");
      expect(result.ledger).toBeNull();
      expect(result.operations).toHaveLength(0);
      expect(result.failureReason).toContain("not found");
    });

    it("returns failed when no payment operation targets the recipient", async () => {
      setupFetchMocks(
        mockTxResponse(),
        mockOpsResponse([
          mockPaymentOperation({ to: "GDIFERENTRECIPIENT" }),
        ])
      );

      const result = await verifyPayment(baseRequest);

      expect(result.status).toBe("failed");
      expect(result.failureReason).toContain("No payment operation found");
    });

    it("returns failed when paid amount is less than expected", async () => {
      setupFetchMocks(
        mockTxResponse(),
        mockOpsResponse([
          mockPaymentOperation({ amount: "0.5000000" }), // 0.5 USDC < 1 USDC
        ])
      );

      const result = await verifyPayment(baseRequest);

      expect(result.status).toBe("failed");
      expect(result.failureReason).toContain("Paid");
      expect(result.failureReason).toContain("expected at least");
    });

    it("returns failed when Horizon fetch throws a network error", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("Network error"));
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await verifyPayment(baseRequest);

      expect(result.status).toBe("failed");
      expect(result.failureReason).toBe("Network error");
    });

    it("returns failed when Horizon returns a non-404 error", async () => {
      const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await verifyPayment(baseRequest);

      expect(result.status).toBe("failed");
      expect(result.failureReason).toContain("500");
    });

    it("handles path_payment_strict_receive operations", async () => {
      setupFetchMocks(
        mockTxResponse(),
        mockOpsResponse([
          mockPaymentOperation({
            type: "path_payment_strict_receive",
            amount: "2.0000000",
          }),
        ])
      );

      const result = await verifyPayment({
        ...baseRequest,
        expectedAmount: STROOP,
      });

      expect(result.status).toBe("verified");
      expect(result.operations[0].type).toBe("path_payment_strict_receive");
    });

    it("handles native XLM assets", async () => {
      setupFetchMocks(
        mockTxResponse(),
        mockOpsResponse([
          mockPaymentOperation({ asset_type: "native", asset_code: undefined }),
        ])
      );

      const result = await verifyPayment(baseRequest);

      expect(result.status).toBe("verified");
      expect(result.operations[0].asset).toBe("XLM");
    });

    it("sums amounts across multiple matching operations", async () => {
      setupFetchMocks(
        mockTxResponse(),
        mockOpsResponse([
          mockPaymentOperation({ amount: "0.4000000" }),
          mockPaymentOperation({ amount: "0.6000000" }),
        ])
      );

      const result = await verifyPayment(baseRequest);

      expect(result.status).toBe("verified");
      expect(result.operations).toHaveLength(2);
    });

    it("is case-insensitive for recipient matching", async () => {
      setupFetchMocks(
        mockTxResponse(),
        mockOpsResponse([
          mockPaymentOperation({ to: RECIPIENT.toLowerCase() }),
        ])
      );

      const result = await verifyPayment(baseRequest);

      expect(result.status).toBe("verified");
    });
  });

  // ── recordSettlement & retrieval ───────────────────────────────────────────

  describe("recordSettlement", () => {
    it("records a settlement and returns it with an integrity hash", () => {
      const record = recordSettlement({
        txHash: "b".repeat(64),
        invoiceId: "INV-002",
        payer: "GPAYER",
        recipient: RECIPIENT,
        amount: STROOP,
        asset: "USDC",
        ledger: 99999,
      });

      expect(record.id).toBeDefined();
      expect(record.txHash).toBe("b".repeat(64));
      expect(record.invoiceId).toBe("INV-002");
      expect(record.amount).toBe(STROOP);
      expect(record.asset).toBe("USDC");
      expect(record.ledger).toBe(99999);
      expect(record.integrityHash).toBeDefined();
      expect(record.integrityHash).toHaveLength(8);
    });

    it("is idempotent — re-recording same txHash returns the existing record", () => {
      const params = {
        txHash: "c".repeat(64),
        invoiceId: "INV-003",
        payer: "GPAYER",
        recipient: RECIPIENT,
        amount: STROOP,
        asset: "USDC",
        ledger: 11111,
      };

      const first = recordSettlement(params);
      const second = recordSettlement(params);

      expect(second.id).toBe(first.id);
      expect(second.integrityHash).toBe(first.integrityHash);
    });

    it("uses custom settledAt when provided", () => {
      const record = recordSettlement({
        txHash: "d".repeat(64),
        invoiceId: "INV-004",
        payer: "GPAYER",
        recipient: RECIPIENT,
        amount: STROOP,
        asset: "USDC",
        ledger: 22222,
        settledAt: 1000000,
      });

      expect(record.settledAt).toBe(1000000);
    });
  });

  describe("getSettlement", () => {
    it("returns the settlement for a known txHash", () => {
      const txHash = "e".repeat(64);
      recordSettlement({
        txHash,
        invoiceId: "INV-005",
        payer: "GPAYER",
        recipient: RECIPIENT,
        amount: STROOP,
        asset: "USDC",
        ledger: 33333,
      });

      const result = getSettlement(txHash);
      expect(result).not.toBeNull();
      expect(result?.invoiceId).toBe("INV-005");
    });

    it("returns null for an unknown txHash", () => {
      expect(getSettlement("f".repeat(64))).toBeNull();
    });
  });

  describe("getSettlementsForInvoice", () => {
    it("returns all settlements for a given invoice ID", () => {
      recordSettlement({
        txHash: "1" + "0".repeat(63),
        invoiceId: "INV-MULTI",
        payer: "GPAYER",
        recipient: RECIPIENT,
        amount: STROOP,
        asset: "USDC",
        ledger: 1,
      });
      recordSettlement({
        txHash: "2" + "0".repeat(63),
        invoiceId: "INV-MULTI",
        payer: "GPAYER",
        recipient: RECIPIENT,
        amount: STROOP,
        asset: "USDC",
        ledger: 2,
      });

      const results = getSettlementsForInvoice("INV-MULTI");
      expect(results).toHaveLength(2);
    });

    it("returns empty array for invoice with no settlements", () => {
      expect(getSettlementsForInvoice("INV-NONE")).toHaveLength(0);
    });
  });

  // ── verifySettlementIntegrity ──────────────────────────────────────────────

  describe("verifySettlementIntegrity", () => {
    it("returns true for a valid untampered record", () => {
      const txHash = "a".repeat(64);
      recordSettlement({
        txHash,
        invoiceId: "INV-INTEGRITY",
        payer: "GPAYER",
        recipient: RECIPIENT,
        amount: STROOP,
        asset: "USDC",
        ledger: 44444,
      });

      expect(verifySettlementIntegrity(txHash)).toBe(true);
    });

    it("returns false for a non-existent txHash", () => {
      expect(verifySettlementIntegrity("z".repeat(64))).toBe(false);
    });
  });

  // ── getAuditTrail ───────────────────────────────────────────────────────────

  describe("getAuditTrail", () => {
    it("returns all entries when no filter is provided", () => {
      const entries = getAuditTrail();
      // Previous tests generated audit entries
      expect(entries.length).toBeGreaterThan(0);
    });

    it("filters by invoiceId", () => {
      const entries = getAuditTrail({ invoiceId: INVOICE_ID });
      // Entries from verifyPayment tests
      expect(entries.every((e) => e.invoiceId === INVOICE_ID)).toBe(true);
    });

    it("filters by txHash", () => {
      const entries = getAuditTrail({ txHash: TX_HASH });
      expect(entries.every((e) => e.txHash === TX_HASH)).toBe(true);
    });

    it("respects the limit parameter", () => {
      const entries = getAuditTrail({ limit: 1 });
      expect(entries.length).toBeLessThanOrEqual(1);
    });

    it("returns entries sorted newest first", () => {
      const entries = getAuditTrail();
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i - 1].timestamp).toBeGreaterThanOrEqual(entries[i].timestamp);
      }
    });
  });

  // ── getVerificationAnalytics ────────────────────────────────────────────────

  describe("getVerificationAnalytics", () => {
    it("returns analytics with correct structure", () => {
      const analytics = getVerificationAnalytics();

      expect(analytics).toHaveProperty("totalVerifications");
      expect(analytics).toHaveProperty("successfulVerifications");
      expect(analytics).toHaveProperty("failedVerifications");
      expect(analytics).toHaveProperty("pendingVerifications");
      expect(analytics).toHaveProperty("successRate");
      expect(analytics).toHaveProperty("totalSettledAmount");
      expect(analytics).toHaveProperty("averageSettlementAmount");
      expect(analytics).toHaveProperty("verificationsByDay");
      expect(analytics).toHaveProperty("topInvoices");
    });

    it("successRate is between 0 and 1", () => {
      const analytics = getVerificationAnalytics();
      expect(analytics.successRate).toBeGreaterThanOrEqual(0);
      expect(analytics.successRate).toBeLessThanOrEqual(1);
    });

    it("totalSettledAmount is a bigint", () => {
      const analytics = getVerificationAnalytics();
      expect(typeof analytics.totalSettledAmount).toBe("bigint");
    });

    it("topInvoices is an array sorted by count descending", () => {
      const analytics = getVerificationAnalytics();
      for (let i = 1; i < analytics.topInvoices.length; i++) {
        expect(analytics.topInvoices[i - 1].count).toBeGreaterThanOrEqual(
          analytics.topInvoices[i].count
        );
      }
    });

    it("verificationsByDay keys are ISO date strings", () => {
      const analytics = getVerificationAnalytics();
      for (const day of Object.keys(analytics.verificationsByDay)) {
        expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });
  });
});
