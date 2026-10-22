"use client";

import { useState, useCallback } from "react";
import type {
  PaymentVerificationResult,
  VerificationAuditEntry,
  VerificationAnalytics,
} from "@/lib/blockchainVerification";

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PaymentVerificationResult["status"] }) {
  const styles: Record<PaymentVerificationResult["status"], string> = {
    verified: "bg-green-900 text-green-300",
    failed: "bg-red-900 text-red-300",
    pending: "bg-yellow-900 text-yellow-300",
    not_found: "bg-gray-800 text-gray-400",
  };
  const labels: Record<PaymentVerificationResult["status"], string> = {
    verified: "Verified",
    failed: "Failed",
    pending: "Pending",
    not_found: "Not Found",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

function AuditRow({ entry }: { entry: VerificationAuditEntry }) {
  const actionLabel: Record<VerificationAuditEntry["action"], string> = {
    payment_verified: "Payment Verified",
    payment_failed: "Payment Failed",
    settlement_recorded: "Settlement Recorded",
    audit_trail_queried: "Audit Trail Queried",
  };
  return (
    <li className="flex flex-col gap-0.5 py-2 border-b border-gray-800 last:border-0">
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-gray-500">
          {new Date(entry.timestamp).toLocaleString()}
        </span>
        <span className="text-xs font-semibold text-gray-200">
          {actionLabel[entry.action]}
        </span>
        <StatusBadge status={entry.status} />
      </div>
      {entry.details && (
        <p className="text-xs text-gray-400 truncate" title={entry.details}>
          {entry.details}
        </p>
      )}
      <p className="text-xs font-mono text-gray-600 truncate" title={entry.txHash}>
        tx: {entry.txHash.slice(0, 16)}…
      </p>
    </li>
  );
}

function AnalyticsSummary({ analytics }: { analytics: VerificationAnalytics }) {
  const formatRate = (r: number) => `${(r * 100).toFixed(1)}%`;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mt-4">
      {(
        [
          { label: "Total Verifications", value: analytics.totalVerifications },
          { label: "Successful", value: analytics.successfulVerifications },
          { label: "Failed", value: analytics.failedVerifications },
          { label: "Success Rate", value: formatRate(analytics.successRate) },
        ] as const
      ).map(({ label, value }) => (
        <div
          key={label}
          className="flex flex-col gap-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2"
        >
          <span className="text-xs text-gray-400">{label}</span>
          <span className="text-lg font-semibold">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface BlockchainVerificationPanelProps {
  /** Pre-populate the tx hash field (e.g. from invoice detail page). */
  defaultTxHash?: string;
  /** Pre-populate the invoice ID field. */
  defaultInvoiceId?: string;
  /** Pre-populate the recipient field. */
  defaultRecipient?: string;
}

type PanelTab = "verify" | "audit" | "analytics";

export default function BlockchainVerificationPanel({
  defaultTxHash = "",
  defaultInvoiceId = "",
  defaultRecipient = "",
}: BlockchainVerificationPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>("verify");

  // Verify form state
  const [txHash, setTxHash] = useState(defaultTxHash);
  const [invoiceId, setInvoiceId] = useState(defaultInvoiceId);
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [expectedAmount, setExpectedAmount] = useState("");

  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] =
    useState<PaymentVerificationResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Audit trail state
  const [auditEntries, setAuditEntries] = useState<VerificationAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  // Analytics state
  const [analytics, setAnalytics] = useState<VerificationAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  const handleVerify = useCallback(async () => {
    if (!txHash || !invoiceId || !recipient || !expectedAmount) {
      setVerifyError("All fields are required.");
      return;
    }
    setVerifying(true);
    setVerifyError(null);
    setVerificationResult(null);

    try {
      const res = await fetch("/api/blockchain/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash, invoiceId, recipient, expectedAmount }),
      });
      const data = await res.json() as { result?: PaymentVerificationResult; error?: string };
      if (!res.ok || !data.result) {
        throw new Error(data.error ?? "Verification failed");
      }
      setVerificationResult(data.result);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
  }, [txHash, invoiceId, recipient, expectedAmount]);

  const handleLoadAudit = useCallback(async () => {
    setAuditLoading(true);
    setAuditError(null);
    const params = new URLSearchParams();
    if (txHash) params.set("txHash", txHash);
    if (invoiceId) params.set("invoiceId", invoiceId);

    try {
      const res = await fetch(`/api/blockchain/verify?${params.toString()}`);
      const data = await res.json() as {
        audit?: VerificationAuditEntry[];
        analytics?: VerificationAnalytics;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load audit trail");
      setAuditEntries(data.audit ?? []);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuditLoading(false);
    }
  }, [txHash, invoiceId]);

  const handleLoadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const res = await fetch("/api/blockchain/verify");
      const data = await res.json() as {
        analytics?: VerificationAnalytics;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load analytics");
      setAnalytics(data.analytics ?? null);
    } catch (err) {
      setAnalyticsError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  const tabs: Array<{ id: PanelTab; label: string }> = [
    { id: "verify", label: "Verify Payment" },
    { id: "audit", label: "Audit Trail" },
    { id: "analytics", label: "Analytics" },
  ];

  return (
    <section
      aria-labelledby="blockchain-verification-heading"
      className="rounded-lg border border-gray-700 bg-gray-900 p-4"
    >
      <h2
        id="blockchain-verification-heading"
        className="text-base font-semibold mb-4"
      >
        Blockchain Verification
      </h2>

      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Blockchain verification tabs"
        className="flex gap-1 mb-5 border-b border-gray-700"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-sm font-medium rounded-t transition-colors -mb-px ${
              activeTab === tab.id
                ? "border border-b-gray-900 border-gray-700 text-white"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Verify tab */}
      {activeTab === "verify" && (
        <div role="tabpanel" aria-labelledby="tab-verify">
          <div className="flex flex-col gap-3 mb-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-300 font-medium">Transaction Hash</span>
              <input
                type="text"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                placeholder="64-character hex hash"
                className="rounded-md bg-gray-800 border border-gray-600 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-300 font-medium">Invoice ID</span>
              <input
                type="text"
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
                placeholder="Invoice ID"
                className="rounded-md bg-gray-800 border border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-300 font-medium">Recipient Address</span>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="G…"
                className="rounded-md bg-gray-800 border border-gray-600 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-300 font-medium">
                Expected Amount (stroops)
              </span>
              <input
                type="number"
                value={expectedAmount}
                onChange={(e) => setExpectedAmount(e.target.value)}
                placeholder="e.g. 10000000 = 1 USDC"
                min="0"
                className="rounded-md bg-gray-800 border border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={handleVerify}
            disabled={verifying}
            className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {verifying ? "Verifying…" : "Verify on Ledger"}
          </button>

          {verifyError && (
            <p role="alert" className="mt-3 text-sm text-red-400">
              {verifyError}
            </p>
          )}

          {verificationResult && (
            <div className="mt-4 rounded-lg border border-gray-700 bg-gray-800 p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium">Result</span>
                <StatusBadge status={verificationResult.status} />
              </div>
              {verificationResult.ledger && (
                <p className="text-xs text-gray-400">
                  Ledger{" "}
                  <span className="font-mono text-gray-200">
                    {verificationResult.ledger}
                  </span>
                  {verificationResult.createdAt && (
                    <>
                      {" "}
                      &mdash;{" "}
                      {new Date(verificationResult.createdAt).toLocaleString()}
                    </>
                  )}
                </p>
              )}
              {verificationResult.failureReason && (
                <p className="text-xs text-red-400 mt-1">
                  {verificationResult.failureReason}
                </p>
              )}
              {verificationResult.operations.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {verificationResult.operations.map((op, i) => (
                    <li key={i} className="text-xs text-gray-400 font-mono">
                      {op.type}: {op.amount} {op.asset} → {op.to.slice(0, 8)}…
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* Audit trail tab */}
      {activeTab === "audit" && (
        <div role="tabpanel" aria-labelledby="tab-audit">
          <button
            type="button"
            onClick={handleLoadAudit}
            disabled={auditLoading}
            className="mb-4 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {auditLoading ? "Loading…" : "Load Audit Trail"}
          </button>

          {auditError && (
            <p role="alert" className="mb-3 text-sm text-red-400">
              {auditError}
            </p>
          )}

          {auditEntries.length === 0 && !auditLoading && !auditError && (
            <p className="text-sm text-gray-500">
              No audit entries yet. Verify a payment to generate entries.
            </p>
          )}

          {auditEntries.length > 0 && (
            <ul aria-label="Audit trail entries" className="flex flex-col">
              {auditEntries.map((entry) => (
                <AuditRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Analytics tab */}
      {activeTab === "analytics" && (
        <div role="tabpanel" aria-labelledby="tab-analytics">
          <button
            type="button"
            onClick={handleLoadAnalytics}
            disabled={analyticsLoading}
            className="mb-4 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {analyticsLoading ? "Loading…" : "Load Analytics"}
          </button>

          {analyticsError && (
            <p role="alert" className="mb-3 text-sm text-red-400">
              {analyticsError}
            </p>
          )}

          {!analytics && !analyticsLoading && !analyticsError && (
            <p className="text-sm text-gray-500">
              Click &ldquo;Load Analytics&rdquo; to view verification statistics.
            </p>
          )}

          {analytics && (
            <>
              <AnalyticsSummary analytics={analytics} />

              {analytics.topInvoices.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold mb-2">Top Invoices by Verifications</h3>
                  <ul className="flex flex-col gap-1">
                    {analytics.topInvoices.map(({ invoiceId: id, count }) => (
                      <li key={id} className="flex items-center justify-between text-sm">
                        <span className="font-mono text-gray-300 truncate max-w-xs" title={id}>
                          {id}
                        </span>
                        <span className="text-gray-400 ml-4 shrink-0">{count} verifications</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
