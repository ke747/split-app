/**
 * accountingIntegrations.ts — QuickBooks and Xero accounting software integrations.
 *
 * Provides:
 *  - Data mapping between StellarSplit invoice/payment models and QB/Xero formats
 *  - Sync engine with conflict detection
 *  - Reconciliation helpers
 *  - Error handling with typed error classes
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type AccountingProvider = "quickbooks" | "xero";

export interface AccountingCredentials {
  provider: AccountingProvider;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  realmId?: string;       // QuickBooks tenant id
  tenantId?: string;      // Xero organisation id
  tokenExpiresAt: number; // Unix ms
}

export interface StellarInvoice {
  id: string;
  createdAt: number;
  dueAt: number | null;
  description: string;
  totalAmount: bigint;
  paidAmount: bigint;
  currency: string;
  creatorAddress: string;
  recipients: Array<{
    address: string;
    amount: bigint;
    label?: string;
  }>;
  status: "draft" | "pending" | "partial" | "paid" | "overdue" | "cancelled";
  txHashes: string[];
}

// Accounting-platform-agnostic invoice representation
export interface AccountingInvoice {
  externalId: string;
  providerRef?: string; // ID assigned by QB/Xero on first sync
  invoiceNumber: string;
  issueDate: string;   // ISO 8601 date
  dueDate: string | null;
  description: string;
  currency: string;
  lineItems: AccountingLineItem[];
  totalAmount: number; // in major currency units (e.g. 1.00 = $1.00)
  amountDue: number;
  status: "draft" | "submitted" | "authorised" | "paid" | "voided";
  contact: AccountingContact;
  reference: string;
}

export interface AccountingLineItem {
  description: string;
  quantity: number;
  unitAmount: number;
  accountCode?: string;
  taxType?: string;
}

export interface AccountingContact {
  name: string;
  email?: string;
  externalRef?: string;
}

export interface AccountingPayment {
  externalId: string;
  providerRef?: string;
  invoiceRef: string;
  amount: number;
  currency: string;
  date: string;
  reference: string;
  account?: string;
}

export type SyncStatus = "idle" | "syncing" | "success" | "error";

export interface SyncResult {
  provider: AccountingProvider;
  syncedAt: number;
  invoicesCreated: number;
  invoicesUpdated: number;
  paymentsCreated: number;
  errors: SyncError[];
}

export interface SyncError {
  entityId: string;
  entityType: "invoice" | "payment";
  message: string;
  retryable: boolean;
}

export interface ReconciliationMatch {
  stellarInvoiceId: string;
  providerRef: string;
  matchType: "exact" | "amount_match" | "reference_match" | "unmatched";
  confidence: number; // 0-1
  amountDifference: number;
}

export interface ReconciliationReport {
  provider: AccountingProvider;
  generatedAt: number;
  totalStellarInvoices: number;
  totalProviderInvoices: number;
  matched: ReconciliationMatch[];
  unmatched: string[];
  discrepancies: Array<{
    invoiceId: string;
    field: string;
    stellarValue: string;
    providerValue: string;
  }>;
}

// ─── Error types ──────────────────────────────────────────────────────────────

export class AccountingIntegrationError extends Error {
  constructor(
    message: string,
    public readonly provider: AccountingProvider,
    public readonly code: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "AccountingIntegrationError";
  }
}

export class TokenExpiredError extends AccountingIntegrationError {
  constructor(provider: AccountingProvider) {
    super("OAuth token has expired. Re-authorise the integration.", provider, "TOKEN_EXPIRED", false);
    this.name = "TokenExpiredError";
  }
}

export class RateLimitError extends AccountingIntegrationError {
  constructor(provider: AccountingProvider, public readonly retryAfterMs: number) {
    super(`Rate limit exceeded. Retry after ${retryAfterMs}ms.`, provider, "RATE_LIMIT", true);
    this.name = "RateLimitError";
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const STROOP_SCALE = 10_000_000;

function stroopsToDecimal(stroops: bigint): number {
  return Number(stroops) / STROOP_SCALE;
}

function isoDate(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 10);
}

function validateCredentials(creds: AccountingCredentials): void {
  if (Date.now() >= creds.tokenExpiresAt) {
    throw new TokenExpiredError(creds.provider);
  }
  if (!creds.accessToken) {
    throw new AccountingIntegrationError(
      "Missing access token",
      creds.provider,
      "MISSING_TOKEN"
    );
  }
}

// ─── Data mapping ─────────────────────────────────────────────────────────────

/**
 * Map a StellarSplit invoice to the provider-agnostic AccountingInvoice format.
 * Amounts are converted from stroops to decimal.
 */
export function mapInvoiceToAccounting(
  invoice: StellarInvoice,
  contactName: string
): AccountingInvoice {
  const totalDecimal = stroopsToDecimal(invoice.totalAmount);
  const paidDecimal = stroopsToDecimal(invoice.paidAmount);
  const amountDue = Math.max(0, totalDecimal - paidDecimal);

  const lineItems: AccountingLineItem[] = invoice.recipients.map((r) => ({
    description: r.label ?? `Payment to ${r.address.slice(0, 8)}…`,
    quantity: 1,
    unitAmount: stroopsToDecimal(r.amount),
    accountCode: "4000", // Default revenue account
  }));

  if (lineItems.length === 0) {
    lineItems.push({
      description: invoice.description || "StellarSplit Invoice",
      quantity: 1,
      unitAmount: totalDecimal,
      accountCode: "4000",
    });
  }

  const providerStatus = ((): AccountingInvoice["status"] => {
    switch (invoice.status) {
      case "draft": return "draft";
      case "pending":
      case "partial": return "authorised";
      case "paid": return "paid";
      case "cancelled": return "voided";
      default: return "submitted";
    }
  })();

  return {
    externalId: invoice.id,
    invoiceNumber: `SS-${invoice.id}`,
    issueDate: isoDate(invoice.createdAt),
    dueDate: invoice.dueAt ? isoDate(invoice.dueAt) : null,
    description: invoice.description,
    currency: invoice.currency,
    lineItems,
    totalAmount: totalDecimal,
    amountDue,
    status: providerStatus,
    contact: { name: contactName, externalRef: invoice.creatorAddress },
    reference: `stellar:${invoice.id}`,
  };
}

/**
 * Map a transaction payment back into the accounting format.
 */
export function mapPaymentToAccounting(params: {
  invoiceId: string;
  txHash: string;
  amount: bigint;
  currency: string;
  settledAt: number;
  providerInvoiceRef: string;
}): AccountingPayment {
  return {
    externalId: params.txHash,
    invoiceRef: params.providerInvoiceRef,
    amount: stroopsToDecimal(params.amount),
    currency: params.currency,
    date: isoDate(params.settledAt),
    reference: `tx:${params.txHash.slice(0, 12)}`,
    account: "1000", // Default bank/clearing account
  };
}

// ─── QuickBooks integration ───────────────────────────────────────────────────

const QB_API_BASE = "https://quickbooks.api.intuit.com/v3";

/**
 * Create or update an invoice in QuickBooks Online.
 *
 * Uses the QBO REST API v3. The `realmId` is required (company ID).
 * https://developer.intuit.com/app/developer/qbo/docs/api/accounting/invoices
 */
export async function syncInvoiceToQuickBooks(
  invoice: AccountingInvoice,
  creds: AccountingCredentials
): Promise<{ providerRef: string; created: boolean }> {
  validateCredentials(creds);

  if (!creds.realmId) {
    throw new AccountingIntegrationError(
      "realmId (QuickBooks company ID) is required",
      "quickbooks",
      "MISSING_REALM_ID"
    );
  }

  const qbInvoice = {
    DocNumber: invoice.invoiceNumber,
    TxnDate: invoice.issueDate,
    DueDate: invoice.dueDate ?? undefined,
    CustomerRef: { value: invoice.contact.externalRef ?? "1", name: invoice.contact.name },
    PrivateNote: invoice.reference,
    Line: invoice.lineItems.map((item, i) => ({
      LineNum: i + 1,
      Description: item.description,
      Amount: item.unitAmount * item.quantity,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        Qty: item.quantity,
        UnitPrice: item.unitAmount,
      },
    })),
    CurrencyRef: { value: invoice.currency.toUpperCase() },
  };

  const url = invoice.providerRef
    ? `${QB_API_BASE}/company/${creds.realmId}/invoice`
    : `${QB_API_BASE}/company/${creds.realmId}/invoice`;

  const body = invoice.providerRef
    ? { ...qbInvoice, Id: invoice.providerRef, sparse: true }
    : qbInvoice;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ Invoice: body }),
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10) * 1000;
    throw new RateLimitError("quickbooks", retryAfter);
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({})) as { Fault?: { Error?: Array<{ Message?: string }> } };
    const message =
      errorData.Fault?.Error?.[0]?.Message ?? `QuickBooks API error ${res.status}`;
    throw new AccountingIntegrationError(message, "quickbooks", `QB_${res.status}`);
  }

  const data = await res.json() as { Invoice?: { Id?: string } };
  const providerRef = data.Invoice?.Id ?? "";

  return { providerRef, created: !invoice.providerRef };
}

/**
 * Record a payment against a QuickBooks invoice.
 */
export async function recordPaymentInQuickBooks(
  payment: AccountingPayment,
  creds: AccountingCredentials
): Promise<{ providerRef: string }> {
  validateCredentials(creds);

  if (!creds.realmId) {
    throw new AccountingIntegrationError(
      "realmId is required",
      "quickbooks",
      "MISSING_REALM_ID"
    );
  }

  const qbPayment = {
    TotalAmt: payment.amount,
    CustomerRef: { value: "1" },
    Line: [
      {
        Amount: payment.amount,
        LinkedTxn: [{ TxnId: payment.invoiceRef, TxnType: "Invoice" }],
      },
    ],
    TxnDate: payment.date,
    PrivateNote: payment.reference,
    CurrencyRef: { value: payment.currency.toUpperCase() },
  };

  const res = await fetch(
    `${QB_API_BASE}/company/${creds.realmId}/payment`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ Payment: qbPayment }),
    }
  );

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10) * 1000;
    throw new RateLimitError("quickbooks", retryAfter);
  }
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({})) as { Fault?: { Error?: Array<{ Message?: string }> } };
    const message =
      errorData.Fault?.Error?.[0]?.Message ?? `QuickBooks API error ${res.status}`;
    throw new AccountingIntegrationError(message, "quickbooks", `QB_${res.status}`);
  }

  const data = await res.json() as { Payment?: { Id?: string } };
  return { providerRef: data.Payment?.Id ?? "" };
}

// ─── Xero integration ─────────────────────────────────────────────────────────

const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";

/**
 * Create or update an invoice in Xero.
 *
 * Uses the Xero Accounting API v2.
 * https://developer.xero.com/documentation/api/accounting/invoices
 */
export async function syncInvoiceToXero(
  invoice: AccountingInvoice,
  creds: AccountingCredentials
): Promise<{ providerRef: string; created: boolean }> {
  validateCredentials(creds);

  if (!creds.tenantId) {
    throw new AccountingIntegrationError(
      "tenantId (Xero organisation ID) is required",
      "xero",
      "MISSING_TENANT_ID"
    );
  }

  const xeroStatusMap: Record<AccountingInvoice["status"], string> = {
    draft: "DRAFT",
    submitted: "SUBMITTED",
    authorised: "AUTHORISED",
    paid: "AUTHORISED", // Paid status is set via payment recording
    voided: "VOIDED",
  };

  const xeroInvoice: Record<string, unknown> = {
    Type: "ACCREC",
    InvoiceNumber: invoice.invoiceNumber,
    Date: invoice.issueDate,
    DueDate: invoice.dueDate ?? invoice.issueDate,
    Status: xeroStatusMap[invoice.status],
    Reference: invoice.reference,
    CurrencyCode: invoice.currency.toUpperCase(),
    Contact: {
      Name: invoice.contact.name,
      ...(invoice.contact.email ? { EmailAddress: invoice.contact.email } : {}),
    },
    LineItems: invoice.lineItems.map((item) => ({
      Description: item.description,
      Quantity: item.quantity,
      UnitAmount: item.unitAmount,
      AccountCode: item.accountCode ?? "200",
      TaxType: item.taxType ?? "NONE",
    })),
  };

  if (invoice.providerRef) {
    xeroInvoice.InvoiceID = invoice.providerRef;
  }

  const res = await fetch(`${XERO_API_BASE}/Invoices`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "xero-tenant-id": creds.tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ Invoices: [xeroInvoice] }),
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10) * 1000;
    throw new RateLimitError("xero", retryAfter);
  }
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({})) as {
      Elements?: Array<{ ValidationErrors?: Array<{ Message?: string }> }>;
    };
    const message =
      errorData.Elements?.[0]?.ValidationErrors?.[0]?.Message ??
      `Xero API error ${res.status}`;
    throw new AccountingIntegrationError(message, "xero", `XERO_${res.status}`);
  }

  const data = await res.json() as {
    Invoices?: Array<{ InvoiceID?: string }>;
  };
  const providerRef = data.Invoices?.[0]?.InvoiceID ?? "";

  return { providerRef, created: !invoice.providerRef };
}

/**
 * Record a payment against a Xero invoice.
 */
export async function recordPaymentInXero(
  payment: AccountingPayment,
  creds: AccountingCredentials
): Promise<{ providerRef: string }> {
  validateCredentials(creds);

  if (!creds.tenantId) {
    throw new AccountingIntegrationError(
      "tenantId is required",
      "xero",
      "MISSING_TENANT_ID"
    );
  }

  const xeroPayment = {
    Invoice: { InvoiceID: payment.invoiceRef },
    Amount: payment.amount,
    Date: payment.date,
    Reference: payment.reference,
    Account: { Code: payment.account ?? "090" },
    CurrencyRate: 1,
  };

  const res = await fetch(`${XERO_API_BASE}/Payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "xero-tenant-id": creds.tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ Payments: [xeroPayment] }),
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10) * 1000;
    throw new RateLimitError("xero", retryAfter);
  }
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({})) as {
      Elements?: Array<{ ValidationErrors?: Array<{ Message?: string }> }>;
    };
    const message =
      errorData.Elements?.[0]?.ValidationErrors?.[0]?.Message ??
      `Xero API error ${res.status}`;
    throw new AccountingIntegrationError(message, "xero", `XERO_${res.status}`);
  }

  const data = await res.json() as { Payments?: Array<{ PaymentID?: string }> };
  return { providerRef: data.Payments?.[0]?.PaymentID ?? "" };
}

// ─── Sync engine ──────────────────────────────────────────────────────────────

/**
 * Bulk sync a list of StellarSplit invoices to the accounting platform.
 *
 * Processes invoices sequentially to respect API rate limits.
 * Returns a SyncResult summarising what happened.
 */
export async function syncInvoices(
  invoices: StellarInvoice[],
  creds: AccountingCredentials,
  providerRefMap: Map<string, string> = new Map()
): Promise<SyncResult> {
  validateCredentials(creds);

  let invoicesCreated = 0;
  let invoicesUpdated = 0;
  const errors: SyncError[] = [];

  for (const invoice of invoices) {
    const mapped = mapInvoiceToAccounting(
      invoice,
      `Creator ${invoice.creatorAddress.slice(0, 8)}`
    );
    mapped.providerRef = providerRefMap.get(invoice.id);

    try {
      if (creds.provider === "quickbooks") {
        const result = await syncInvoiceToQuickBooks(mapped, creds);
        providerRefMap.set(invoice.id, result.providerRef);
        result.created ? invoicesCreated++ : invoicesUpdated++;
      } else {
        const result = await syncInvoiceToXero(mapped, creds);
        providerRefMap.set(invoice.id, result.providerRef);
        result.created ? invoicesCreated++ : invoicesUpdated++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable = err instanceof AccountingIntegrationError ? err.retryable : false;
      errors.push({
        entityId: invoice.id,
        entityType: "invoice",
        message,
        retryable,
      });

      // Stop immediately on non-retryable credential / config errors
      if (
        err instanceof TokenExpiredError ||
        (err instanceof AccountingIntegrationError && !err.retryable)
      ) {
        break;
      }
    }
  }

  return {
    provider: creds.provider,
    syncedAt: Date.now(),
    invoicesCreated,
    invoicesUpdated,
    paymentsCreated: 0,
    errors,
  };
}

// ─── Reconciliation ───────────────────────────────────────────────────────────

/**
 * Reconcile StellarSplit invoices against invoices returned from the accounting
 * platform.
 *
 * `providerInvoices` is the raw list from QB/Xero (already mapped to
 * AccountingInvoice shape). This function computes match confidence and flags
 * discrepancies.
 */
export function reconcileInvoices(
  stellarInvoices: StellarInvoice[],
  providerInvoices: AccountingInvoice[],
  provider: AccountingProvider
): ReconciliationReport {
  const matches: ReconciliationMatch[] = [];
  const unmatched: string[] = [];
  const discrepancies: ReconciliationReport["discrepancies"] = [];

  const providerByRef = new Map<string, AccountingInvoice>(
    providerInvoices
      .filter((pi) => pi.reference)
      .map((pi) => [pi.reference, pi])
  );

  for (const stellarInv of stellarInvoices) {
    const ref = `stellar:${stellarInv.id}`;
    const provider_inv = providerByRef.get(ref);

    if (!provider_inv) {
      // Try amount-based match as fallback
      const totalDecimal = stroopsToDecimal(stellarInv.totalAmount);
      const amountMatch = providerInvoices.find(
        (pi) => Math.abs(pi.totalAmount - totalDecimal) < 0.001
      );

      if (amountMatch) {
        matches.push({
          stellarInvoiceId: stellarInv.id,
          providerRef: amountMatch.providerRef ?? amountMatch.invoiceNumber,
          matchType: "amount_match",
          confidence: 0.7,
          amountDifference: 0,
        });
      } else {
        unmatched.push(stellarInv.id);
      }
      continue;
    }

    // Exact reference match — now check for discrepancies
    const totalDecimal = stroopsToDecimal(stellarInv.totalAmount);
    const amountDifference = Math.abs(provider_inv.totalAmount - totalDecimal);

    matches.push({
      stellarInvoiceId: stellarInv.id,
      providerRef: provider_inv.providerRef ?? provider_inv.invoiceNumber,
      matchType: "exact",
      confidence: amountDifference < 0.001 ? 1 : 0.9,
      amountDifference,
    });

    if (amountDifference >= 0.001) {
      discrepancies.push({
        invoiceId: stellarInv.id,
        field: "totalAmount",
        stellarValue: totalDecimal.toFixed(7),
        providerValue: provider_inv.totalAmount.toFixed(2),
      });
    }

    // Check due date
    if (stellarInv.dueAt) {
      const stellarDue = isoDate(stellarInv.dueAt);
      if (provider_inv.dueDate && provider_inv.dueDate !== stellarDue) {
        discrepancies.push({
          invoiceId: stellarInv.id,
          field: "dueDate",
          stellarValue: stellarDue,
          providerValue: provider_inv.dueDate,
        });
      }
    }
  }

  return {
    provider,
    generatedAt: Date.now(),
    totalStellarInvoices: stellarInvoices.length,
    totalProviderInvoices: providerInvoices.length,
    matched: matches,
    unmatched,
    discrepancies,
  };
}
