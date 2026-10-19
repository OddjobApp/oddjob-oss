# Monetization & Scaling

## Overview
Monetization in Oddjob allows developers to earn from their apps and organizations to manage their subscriptions. This system is integrated with Stripe.

## Key Concepts

### 💳 Subscriptions (Organizations)
- Organizations must have an **active subscription** to launch paid apps.
- Subscriptions are managed via Stripe Checkout and handled by `StripeService`.
- Status is synced via webhooks to the `orgs` table.

### 💰 Developer Payouts
- App developers earn a percentage of the launch price for their apps.
- Payouts are recorded automatically via `PayoutService` upon mission completion.
- Threshold: Accrued earnings must reach **$50.00** before a payout is initiated.
- Payout tracking is handled in the background to ensure system performance.

### 📊 App Analytics (Phase 7)
- Usage metrics are tracked daily per app deployment.
- Metrics include `launchCount` and `uniqueUserCount`.
- Captured via `AnalyticsService.recordLaunch`.

## Common Queries for Assistans

| Scenario | Response |
|----------|----------|
| "Why can't I launch this app?" | Check the organization's subscription status. |
| "How much have I earned?" | Refer to the App Earnings dashboard or check `app_payouts`. |
| "Is my app performing well?" | View the analytics metrics for the specific deployment. |

## Technical Implementation
- **Schema**: See `shared/schema/apps.ts`, `shared/schema/auth.ts`, and `shared/schema/analytics.ts`.
- **Services**:
    - `StripeService`: Billing and webhooks.
    - `PayoutService`: Earnings accrual.
    - `AnalyticsService`: Usage tracking.
    - `AppRegistryService`: Deployment management.
