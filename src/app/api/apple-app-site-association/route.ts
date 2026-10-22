import { NextResponse } from "next/server";
import { buildAppleAppSiteAssociation } from "@/lib/mobileios";

/**
 * GET /apple-app-site-association
 *
 * Serves the Apple App Site Association (AASA) file required for iOS
 * Universal Links. Apple's servers fetch this during app installation to
 * determine which HTTPS URLs the app should handle natively.
 *
 * Must be served with Content-Type: application/json (no .json extension),
 * without redirects, over HTTPS.
 *
 * https://developer.apple.com/documentation/bundleresources/applinks
 */
export async function GET() {
  const aasa = buildAppleAppSiteAssociation();

  return new NextResponse(JSON.stringify(aasa, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Apple crawls this periodically; allow aggressive CDN caching
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
