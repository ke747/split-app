import { NextRequest, NextResponse } from "next/server";
import {
  recordSettlement,
  getSettlement,
  getSettlementsForInvoice,
  verifySettlementIntegrity,
} from "@/lib/blockchainVerification";

/**
 * GET /api/blockchain/settlement?txHash=…
 *        or ?invoiceId=…
 *
 * Returns the stored settlement record(s) for a tx hash or invoice.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const txHash = searchParams.get("txHash");
  const invoiceId = searchParams.get("invoiceId");

  if (txHash) {
    const settlement = getSettlement(txHash);
    if (!settlement) {
      return NextResponse.json({ error: "Settlement not found" }, { status: 404 });
    }
    const integrityOk = verifySettlementIntegrity(txHash);
    return NextResponse.json({ settlement, integrityOk });
  }

  if (invoiceId) {
    const settlements = getSettlementsForInvoice(invoiceId);
    const withIntegrity = settlements.map((s) => ({
      settlement: s,
      integrityOk: verifySettlementIntegrity(s.txHash),
    }));
    return NextResponse.json({ settlements: withIntegrity });
  }

  return NextResponse.json(
    { error: "Provide txHash or invoiceId as a query parameter" },
    { status: 400 }
  );
}

/**
 * POST /api/blockchain/settlement
 *
 * Body: { txHash, invoiceId, payer, recipient, amount, asset, ledger, settledAt? }
 *
 * Records a verified settlement. Idempotent for the same txHash.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    txHash,
    invoiceId,
    payer,
    recipient,
    amount,
    asset,
    ledger,
    settledAt,
  } = body as Record<string, unknown>;

  if (
    typeof txHash !== "string" ||
    typeof invoiceId !== "string" ||
    typeof payer !== "string" ||
    typeof recipient !== "string" ||
    (typeof amount !== "string" && typeof amount !== "number") ||
    typeof asset !== "string" ||
    typeof ledger !== "number"
  ) {
    return NextResponse.json(
      {
        error:
          "Required fields: txHash, invoiceId, payer, recipient, amount, asset (strings), ledger (number)",
      },
      { status: 400 }
    );
  }

  try {
    const settlement = recordSettlement({
      txHash,
      invoiceId,
      payer,
      recipient,
      amount: BigInt(amount),
      asset,
      ledger,
      settledAt: typeof settledAt === "number" ? settledAt : undefined,
    });
    return NextResponse.json({ success: true, settlement });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
