import { NextRequest, NextResponse } from "next/server";
import {
  verifyPayment,
  getAuditTrail,
  getVerificationAnalytics,
} from "@/lib/blockchainVerification";
import type { PaymentVerificationRequest } from "@/lib/blockchainVerification";

/**
 * GET /api/blockchain/verify?txHash=…&invoiceId=…
 *
 * Returns the audit trail and current analytics for a transaction.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const txHash = searchParams.get("txHash");
  const invoiceId = searchParams.get("invoiceId");

  if (!txHash && !invoiceId) {
    return NextResponse.json(
      { error: "At least one of txHash or invoiceId is required" },
      { status: 400 }
    );
  }

  const audit = getAuditTrail({
    txHash: txHash ?? undefined,
    invoiceId: invoiceId ?? undefined,
    limit: 100,
  });

  const analytics = getVerificationAnalytics();

  return NextResponse.json({ audit, analytics });
}

/**
 * POST /api/blockchain/verify
 *
 * Body: { txHash, invoiceId, recipient, expectedAmount }
 *
 * Verifies the payment against the Stellar ledger and returns a structured result.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { txHash, invoiceId, recipient, expectedAmount } = body as Record<string, unknown>;

  if (
    typeof txHash !== "string" ||
    typeof invoiceId !== "string" ||
    typeof recipient !== "string" ||
    (typeof expectedAmount !== "string" && typeof expectedAmount !== "number")
  ) {
    return NextResponse.json(
      {
        error:
          "Required fields: txHash (string), invoiceId (string), recipient (string), expectedAmount (string | number)",
      },
      { status: 400 }
    );
  }

  if (!/^[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json(
      { error: "txHash must be a 64-character hex string" },
      { status: 400 }
    );
  }

  const request: PaymentVerificationRequest = {
    txHash,
    invoiceId,
    recipient,
    expectedAmount: BigInt(expectedAmount),
  };

  try {
    const result = await verifyPayment(request);
    const status = result.status === "verified" ? 200 : 422;
    return NextResponse.json({ success: result.status === "verified", result }, { status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
