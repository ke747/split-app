"use client";

import { useState } from "react";
import type { AccountingProvider, SyncResult } from "@/lib/accountingIntegrations";

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProviderLogo({ provider }: { provider: AccountingProvider }) {
  if (provider === "quickbooks") {
    return (
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-800 text-green-200 text-xs font-bold">
        QB
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-800 text-blue-200 text-xs font-bold">
      Xe
    </span>
  );
}

function SyncResultSummary({ result }: { result: SyncResult }) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-3 mt-3">
      <p className="text-sm font-semibold mb-2">
        Sync complete &mdash;{" "}
        {new Date(result.syncedAt).toLocaleString()}
      </p>
      <ul className="flex flex-col gap-1 text-xs text-gray-300">
        <li>
          <span className="text-green-400 font-bold">+{result.invoicesCreated}</span>{" "}
          invoices created
        </li>
        <li>
          <span className="text-yellow-400 font-bold">{result.invoicesUpdated}</span>{" "}
          invoices updated
        </li>
        <li>
          <span className="text-indigo-400 font-bold">{result.paymentsCreated}</span>{" "}
          payments recorded
        </li>
        {result.errors.length > 0 && (
          <li className="mt-2">
            <span className="text-red-400 font-bold">{result.errors.length} error(s)</span>
            <ul className="mt-1 pl-3 flex flex-col gap-0.5">
              {result.errors.map((e, i) => (
                <li key={i} className="text-red-300">
                  {e.entityId}: {e.message}
                  {e.retryable && (
                    <span className="ml-1 text-yellow-500">(retryable)</span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        )}
      </ul>
    </div>
  );
}

// ─── Integration card ─────────────────────────────────────────────────────────

interface IntegrationCardProps {
  provider: AccountingProvider;
  label: string;
  description: string;
  connected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
  syncing: boolean;
  syncResult: SyncResult | null;
  error: string | null;
}

function IntegrationCard({
  provider,
  label,
  description,
  connected,
  onConnect,
  onDisconnect,
  onSync,
  syncing,
  syncResult,
  error,
}: IntegrationCardProps) {
  return (
    <article className="rounded-lg border border-gray-700 bg-gray-900 p-4">
      <div className="flex items-center gap-3 mb-3">
        <ProviderLogo provider={provider} />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">{label}</h3>
          <p className="text-xs text-gray-400 truncate">{description}</p>
        </div>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            connected ? "bg-green-900 text-green-300" : "bg-gray-800 text-gray-500"
          }`}
        >
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>

      <div className="flex gap-2 flex-wrap">
        {connected ? (
          <>
            <button
              type="button"
              onClick={onSync}
              disabled={syncing}
              className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {syncing ? "Syncing…" : "Sync Now"}
            </button>
            <button
              type="button"
              onClick={onDisconnect}
              className="px-3 py-1.5 rounded-md border border-gray-600 hover:border-red-600 hover:text-red-400 text-xs font-semibold transition-colors"
            >
              Disconnect
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold transition-colors"
          >
            Connect
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-400">
          {error}
        </p>
      )}

      {syncResult && <SyncResultSummary result={syncResult} />}
    </article>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ConnectionState {
  connected: boolean;
  syncing: boolean;
  syncResult: SyncResult | null;
  error: string | null;
}

const initialConnectionState = (): ConnectionState => ({
  connected: false,
  syncing: false,
  syncResult: null,
  error: null,
});

export default function AccountingIntegrationsPanel() {
  const [qb, setQb] = useState<ConnectionState>(initialConnectionState);
  const [xero, setXero] = useState<ConnectionState>(initialConnectionState);

  // In a real integration these functions would initiate an OAuth flow.
  // Here we simulate connection toggling for the UI.

  const handleConnect = (provider: AccountingProvider) => {
    const setter = provider === "quickbooks" ? setQb : setXero;
    setter((prev) => ({ ...prev, connected: true, error: null }));
  };

  const handleDisconnect = (provider: AccountingProvider) => {
    const setter = provider === "quickbooks" ? setQb : setXero;
    setter(initialConnectionState);
  };

  const handleSync = async (provider: AccountingProvider) => {
    const setter = provider === "quickbooks" ? setQb : setXero;
    setter((prev) => ({ ...prev, syncing: true, error: null, syncResult: null }));

    try {
      const res = await fetch(`/api/integrations/${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sync_invoice",
          // Credentials are omitted here — in production these would be
          // retrieved from a secure session/secrets store.
          credentials: {
            provider,
            clientId: "",
            clientSecret: "",
            accessToken: "",
            refreshToken: "",
            tokenExpiresAt: Date.now() + 3600_000,
          },
          data: { invoice: null },
        }),
      });

      const responseData = await res.json() as {
        error?: string;
        code?: string;
        retryable?: boolean;
      };

      if (!res.ok) {
        throw new Error(responseData.error ?? "Sync failed");
      }

      // Construct a minimal SyncResult to show UI feedback
      const mockResult: SyncResult = {
        provider,
        syncedAt: Date.now(),
        invoicesCreated: 0,
        invoicesUpdated: 0,
        paymentsCreated: 0,
        errors: [],
      };
      setter((prev) => ({ ...prev, syncing: false, syncResult: mockResult }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setter((prev) => ({ ...prev, syncing: false, error: message }));
    }
  };

  return (
    <section
      aria-labelledby="accounting-integrations-heading"
      className="rounded-lg border border-gray-700 bg-gray-900 p-4"
    >
      <h2
        id="accounting-integrations-heading"
        className="text-base font-semibold mb-1"
      >
        Accounting Integrations
      </h2>
      <p className="text-xs text-gray-400 mb-5">
        Connect StellarSplit to your accounting software to automatically sync
        invoices and payments.
      </p>

      <div className="flex flex-col gap-4">
        <IntegrationCard
          provider="quickbooks"
          label="QuickBooks Online"
          description="Sync invoices and payments to QuickBooks Online (QBO)"
          connected={qb.connected}
          onConnect={() => handleConnect("quickbooks")}
          onDisconnect={() => handleDisconnect("quickbooks")}
          onSync={() => handleSync("quickbooks")}
          syncing={qb.syncing}
          syncResult={qb.syncResult}
          error={qb.error}
        />
        <IntegrationCard
          provider="xero"
          label="Xero"
          description="Sync invoices and payments to Xero"
          connected={xero.connected}
          onConnect={() => handleConnect("xero")}
          onDisconnect={() => handleDisconnect("xero")}
          onSync={() => handleSync("xero")}
          syncing={xero.syncing}
          syncResult={xero.syncResult}
          error={xero.error}
        />
      </div>
    </section>
  );
}
