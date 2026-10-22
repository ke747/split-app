import { NextRequest, NextResponse } from "next/server";
import {
  getIOSAppMetadata,
  generateInvoiceDeepLink,
  generateDashboardDeepLink,
  getAppStoreUrl,
} from "@/lib/mobileios";

/**
 * GET /api/mobile/ios
 *
 * Returns iOS app metadata and optionally generates a deep link.
 *
 * Query params:
 *   - deeplink=invoice&id=<invoiceId>  — generate an invoice deep link
 *   - deeplink=dashboard               — generate a dashboard deep link
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const deeplinkType = searchParams.get("deeplink");
  const id = searchParams.get("id");

  const metadata = getIOSAppMetadata();

  let deepLink: ReturnType<typeof generateInvoiceDeepLink> | null = null;

  if (deeplinkType === "invoice") {
    if (!id) {
      return NextResponse.json(
        { error: "id query parameter required for invoice deep link" },
        { status: 400 }
      );
    }
    deepLink = generateInvoiceDeepLink(id);
  } else if (deeplinkType === "dashboard") {
    deepLink = generateDashboardDeepLink();
  }

  return NextResponse.json(
    {
      metadata,
      appStoreUrl: getAppStoreUrl(),
      ...(deepLink ? { deepLink } : {}),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    }
  );
}
