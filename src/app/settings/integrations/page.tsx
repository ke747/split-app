"use client";

import AccountingIntegrationsPanel from "@/components/AccountingIntegrationsPanel";

export default function IntegrationsSettingsPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-2">Integrations</h1>
      <p className="text-sm text-gray-400 mb-8">
        Connect StellarSplit to external accounting tools. Your credentials are
        stored securely and never shared.
      </p>

      <AccountingIntegrationsPanel />
    </main>
  );
}
