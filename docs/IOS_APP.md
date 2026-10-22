# StellarSplit iOS App Integration

This document describes the iOS mobile integration layer added to the StellarSplit Next.js web app. The layer bridges the web application and a native Swift iOS app via Universal Links, deep links, and App Store utilities.

---

## Overview

| Component | Path | Purpose |
|-----------|------|---------|
| `mobileios.ts` | `src/lib/mobileios.ts` | iOS utilities library |
| iOS metadata API | `src/app/api/mobile/ios/route.ts` | App metadata + deep link endpoint |
| AASA API route | `src/app/api/apple-app-site-association/route.ts` | Universal Links configuration |
| iOS Banner | `src/components/MobileIOSBanner.tsx` | Smart app banner for iOS users |

---

## Universal Links

Universal Links allow the native iOS app to open HTTPS URLs that belong to the web app, providing a seamless transition between web and native experiences.

### Configuration

The `apple-app-site-association` (AASA) file is served via:

```
GET /apple-app-site-association
GET /.well-known/apple-app-site-association
```

The file is generated dynamically by `buildAppleAppSiteAssociation()` in `src/lib/mobileios.ts`.

#### URL patterns handled by the native app

| Pattern | Screen |
|---------|--------|
| `/invoice/*` | Invoice detail & payment |
| `/verify/*` | On-chain verification |
| `/dashboard` | User dashboard |
| `/invoice/new` | Create invoice |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_IOS_APP_STORE_ID` | Numeric App Store app ID | `0000000000` |
| `NEXT_PUBLIC_IOS_BUNDLE_ID` | iOS bundle identifier | `com.stellarsplit.app` |
| `NEXT_PUBLIC_IOS_TEAM_ID` | Apple Developer Team ID | `XXXXXXXXXX` |
| `NEXT_PUBLIC_APP_URL` | Web app base URL | `https://stellarsplit-dapp.vercel.app` |

Set these in `.env.local` (development) and in the Vercel dashboard (production).

---

## Deep Link API

### `GET /api/mobile/ios`

Returns iOS app metadata. Optionally generates a typed deep link.

#### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `deeplink=invoice&id=<invoiceId>` | Generate an invoice deep link |
| `deeplink=dashboard` | Generate a dashboard deep link |

#### Example Response

```json
{
  "metadata": {
    "appStoreId": "1234567890",
    "bundleId": "com.stellarsplit.app",
    "teamId": "ABCDE12345",
    "appName": "StellarSplit",
    "appStoreUrl": "https://apps.apple.com/app/id1234567890",
    "minimumOSVersion": "16.0",
    "supportedFeatures": ["invoice_creation", "payment_splitting", "blockchain_verification"]
  },
  "appStoreUrl": "https://apps.apple.com/app/id1234567890",
  "deepLink": {
    "universalLink": "https://stellarsplit-dapp.vercel.app/invoice/INV-42",
    "customSchemeLink": "stellarsplit://invoice/INV-42",
    "path": "/invoice/INV-42"
  }
}
```

---

## `src/lib/mobileios.ts` API Reference

### Deep link generation

```ts
generateInvoiceDeepLink(invoiceId: string): IOSDeepLink
generatePaymentDeepLink(invoiceId: string, amount?: bigint): IOSDeepLink
generateDashboardDeepLink(): IOSDeepLink
generateVerificationDeepLink(invoiceId: string): IOSDeepLink
generateCustomDeepLink(screen: string, params?: Record<string, string>): IOSDeepLink
```

### App Store helpers

```ts
getAppStoreUrl(): string
getAppStoreUrlWithCampaign(campaignToken: string, providerToken?: string): string
getAppStoreReviewUrl(): string
```

### Detection utilities

```ts
isIOSUserAgent(userAgent?: string): boolean
parseIOSVersion(userAgent?: string): { major: number; minor: number } | null
```

### Universal Links config

```ts
buildAppleAppSiteAssociation(): AppleAppSiteAssociation
```

---

## MobileIOSBanner Component

`MobileIOSBanner` is a client component that shows an App Store download prompt to iOS users. It:

- Only renders on iOS devices (detected via `navigator.userAgent`)
- Persists dismissal to `localStorage` so it does not reappear
- Appends a campaign token to the App Store URL for attribution
- Is fully keyboard-accessible and ARIA-labelled

### Usage

```tsx
import MobileIOSBanner from "@/components/MobileIOSBanner";

// In your root layout or page:
<MobileIOSBanner campaignToken="invoice_detail" />
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `campaignToken` | `string` | `"web_banner"` | App Store UTM campaign token |
| `onDismiss` | `() => void` | — | Callback when user dismisses |

---

## Custom URL Scheme

The native app registers the `stellarsplit://` scheme as a fallback. URLs using the custom scheme will only work when the app is already installed.

| Deep Link | Destination |
|-----------|------------|
| `stellarsplit://invoice/<id>` | Invoice detail |
| `stellarsplit://invoice/<id>/pay` | Payment screen |
| `stellarsplit://dashboard` | Dashboard |
| `stellarsplit://verify/<id>` | Verification screen |

---

## Native iOS App — Implementation Notes

The native iOS app (Swift/SwiftUI) must:

1. Add the web domain to the **Associated Domains** entitlement:
   ```
   applinks:stellarsplit-dapp.vercel.app
   webcredentials:stellarsplit-dapp.vercel.app
   ```

2. Implement `scene(_:continue:)` / `application(_:continue:restorationHandler:)` to handle incoming Universal Link `NSUserActivity` instances.

3. Register the `stellarsplit` custom URL scheme in `Info.plist`:
   ```xml
   <key>CFBundleURLTypes</key>
   <array>
     <dict>
       <key>CFBundleURLSchemes</key>
       <array><string>stellarsplit</string></array>
     </dict>
   </array>
   ```

4. Minimum deployment target: **iOS 16.0**.
