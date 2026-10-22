import { NextRequest, NextResponse } from "next/server";
import {
  syncInvoiceToXero,
  recordPaymentInXero,
  reconcileInvoices,
  mapInvoiceToAccounting,
  mapPaymentToAccounting,
  AccountingIntegrationError,
} from "@/lib/accountingIntegrations";
import type {
  AccountingCredentials,
  StellarInvoice,
  AccountingInvoice,
} from "@/lib/accountingIntegrations";

/**
 * POST /api/integrations/xero
 *
 * Actions:
 *   - "sync_invoice"   — map and upsert an invoice to Xero
 *   - "record_payment" — post a payment against an existing Xero invoice
 *   - "reconcile"      — reconcile Stellar invoices against Xero invoice list
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, credentials, data } = body as {
    action?: string;
    credentials?: AccountingCredentials;
    data?: Record<string, unknown>;
  };

  if (!credentials) {
    return NextResponse.json({ error: "credentials are required" }, { status: 400 });
  }
  if (credentials.provider !== "xero") {
    return NextResponse.json(
      { error: "credentials.provider must be 'xero'" },
      { status: 400 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "data payload is required" }, { status: 400 });
  }

  try {
    switch (action) {
      case "sync_invoice": {
        const invoice = data.invoice as StellarInvoice | undefined;
        if (!invoice) {
          return NextResponse.json({ error: "data.invoice is required" }, { status: 400 });
        }
        const contactName =
          typeof data.contactName === "string"
            ? data.contactName
            : `Creator ${invoice.creatorAddress.slice(0, 8)}`;

        const mapped = mapInvoiceToAccounting(invoice, contactName);
        if (typeof data.providerRef === "string") {
          mapped.providerRef = data.providerRef;
        }
        const result = await syncInvoiceToXero(mapped, credentials);
        return NextResponse.json({ success: true, ...result });
      }

      case "record_payment": {
        const { txHash, invoiceId, amount, currency, settledAt, providerInvoiceRef } =
          data as Record<string, unknown>;

        if (
          typeof txHash !== "string" ||
          typeof invoiceId !== "string" ||
          (typeof amount !== "string" && typeof amount !== "number") ||
          typeof currency !== "string" ||
          typeof settledAt !== "number" ||
          typeof providerInvoiceRef !== "string"
        ) {
          return NextResponse.json(
            {
              error:
                "data must include txHash, invoiceId, amount, currency, settledAt, providerInvoiceRef",
            },
            { status: 400 }
          );
        }

        const payment = mapPaymentToAccounting({
          invoiceId: String(invoiceId),
          txHash: String(txHash),
          amount: BigInt(amount),
          currency: String(currency),
          settledAt: Number(settledAt),
          providerInvoiceRef: String(providerInvoiceRef),
        });
        const result = await recordPaymentInXero(payment, credentials);
        return NextResponse.json({ success: true, ...result });
      }

      case "reconcile": {
        const stellarInvoices = data.stellarInvoices as StellarInvoice[] | undefined;
        const providerInvoices = data.providerInvoices as AccountingInvoice[] | undefined;

        if (!Array.isArray(stellarInvoices) || !Array.isArray(providerInvoices)) {
          return NextResponse.json(
            { error: "data.stellarInvoices and data.providerInvoices (arrays) are required" },
            { status: 400 }
          );
        }

        const report = reconcileInvoices(stellarInvoices, providerInvoices, "xero");
        return NextResponse.json({ success: true, report });
      }

      default:
        return NextResponse.json(
          {
            error: `Unknown action '${action}'. Valid actions: sync_invoice, record_payment, reconcile`,
          },
          { status: 400 }
        );
    }
  } catch (err) {
    if (err instanceof AccountingIntegrationError) {
      return NextResponse.json(
        { error: err.message, code: err.code, retryable: err.retryable },
        { status: 422 }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
