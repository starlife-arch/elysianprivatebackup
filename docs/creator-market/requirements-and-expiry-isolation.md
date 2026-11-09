# Creator Market: rentals, creator discovery, and membership isolation

## Confirmed product requirements

- Creator Market is a distinct 18+ area, separate from DateVault dating.
- It must not create, influence, or expose dating matches, likes, passes, swipes, recommendations, or dating-profile ranking.
- Creator handles are unique, case-insensitive usernames. Public creator lookup supports exact and partial handle search; reserve/validate handles server-side and prevent impersonation of admin/system names.
- Each creator has a market-only profile and content catalogue. A dating profile is not required to expose creator content.
- Platform commission is 15%; creator share is 85% of the amount actually collected. Show the split before confirming a listing and record immutable gross, fee, and net ledger entries.
- Creator earnings are separate from ordinary purchased/spendable tokens. Withdrawal minimum remains 3,000 available creator-earning tokens.
- Market access, creator management, purchased content, rental access, creator earnings, and withdrawal history remain available after a dating membership expires, subject to age, account-standing, and safety checks.
- Adult access requires reliable 18+ verification for both creators and viewers. Never infer age from profile text or date-of-birth alone where stronger verification is required by applicable policy/law.

## Content access and download controls

- Content is private by default. Originals must be stored in private object storage; no public bucket, predictable public URL, or client-controlled storage path.
- Preview assets may be shown as low-resolution/watermarked previews. Full-resolution media is delivered only after a server-side authorization check.
- Download permission is an explicit per-content owner setting and defaults to disabled. When disabled, provide an authenticated streaming/view route and do not expose original storage URLs or download endpoints.
- When the owner enables downloads, issue short-lived, scoped download authorization and log the event.
- Explain honestly that browser controls cannot fully prevent screenshots, screen recording, external capture, or copying by an authorized viewer.
- Removing content stops new purchases and access grants; preserve the financial/audit records needed for refunds, disputes, and compliance.

## Two distinct pricing models

A listing can offer one or both models, configured by the creator:

1. **Timed viewing (hourly or other duration):** creator chooses a duration and price (for example 1 hour, 6 hours, 24 hours, or a custom number of minutes/hours). Access starts at successful payment and expires at the exact server-recorded expiry timestamp.
2. **Rental:** creator chooses a rental duration and price (for example 1 day, custom days, 1 or more weeks, or 1 or more months). Weeks/months are calendar-aware durations; calculate and persist the exact expiry timestamp server-side. Rental is a distinct offer type, not a label for hourly access.

A creator may also optionally offer a permanent purchase price. If enabled, permanent purchase does not expire unless access is revoked for safety/legal reasons or a refund is processed. Do not assume permanent purchase is required.

- Before payment, clearly show offer type, duration, price, expiry behavior, and download permission.
- Each entitlement is tied to the buyer, content, offer, payment transaction, start time, and expiry time.
- Server time is authoritative. Never trust client clocks or client-supplied expiry timestamps.
- Re-purchase/extension behavior must be explicit: either create a new entitlement or extend the existing one atomically; never silently double-charge.
- Access checks must happen on every media request, not only in the UI.
- Payment confirmation, token deduction, entitlement creation, and ledger posting must be atomic/idempotent to prevent duplicate charges and unlocks.

## Critical membership-expiry and account-switching isolation

The current reported behavior is a high-priority regression to investigate: when a Trial membership expires, a payment/upgrade page appears to trap the whole application, hiding logout and preventing a user from switching to another account.

Required behavior:
- Authentication/session controls must remain reachable regardless of membership state. Logout and account switching must never be hidden or blocked by an expired-plan redirect.
- Membership expiry may restrict only dating features that require an active plan. It must not redirect globally from the application shell or intercept unrelated routes.
- The upgrade page must be a dismissible, normal route or inline notice, not a modal/guard that traps navigation.
- After expiry, a user can still reach login/logout, account settings, support, wallet history, Creator Market, owned purchases/rentals, creator studio, earnings, and withdrawals (subject to account safety and 18+ eligibility).
- Separate authorization checks: authentication, account safety/ban state, 18+ verification, dating-plan entitlement, and Creator Market entitlement. Do not conflate them into one global `hasActivePlan` gate.
- Switching accounts must clear user-scoped caches, listeners, selected profile, pending route state, and stale membership state before loading the next account. Ensure Firebase auth state and app state settle before route guards run.
- A banned/suspended account may be restricted according to admin action, but membership expiry alone must not lock the user out of account switching or unrelated paid entitlements.

## Admin controls and auditability

- Admins can review reports, hide/remove individual media, ban content, suspend creators, and reinstate after review.
- Every moderation action records actor, target, reason, timestamp, prior/new state, and related reports.
- Moderation removal must stop new sales and invalidate unsafe access where appropriate; retain auditable transaction history.
- Add report/block workflows and an admin review queue. Do not expose private creator media to unauthorized staff; use role-based review access and log access.

## Implementation sequence

1. Audit existing auth/session routing and all membership-expiry guards. Reproduce the Trial-expired lockout and account-switch failure before changing behavior.
2. Implement the narrow auth/route-guard correction with regression tests for Trial-expired users, logout, and switching between two accounts. Keep existing dating payment flows intact.
3. Implement Creator Market identity/username search, independent access gates, and private creator profiles.
4. Implement private media storage and owner-controlled download permission.
5. Implement hourly timed-view offers and separate day/week/month/custom rentals with server-enforced entitlements.
6. Implement token payment, 15%/85% ledger split, creator earnings, and 3,000-token withdrawals.
7. Implement admin moderation/reporting and audit logs.

## Non-regression acceptance tests

- Expired Trial user can still open Creator Market (if age-verified and account is in good standing), wallet, account settings, support, and owned purchases.
- Expired Trial user can log out and then sign into a different account without being redirected back to the previous account's payment page.
- Active-plan user and expired-plan user can both search creator usernames without creating dating relationships or matches.
- An unpurchased viewer cannot fetch original media; a paid viewer can view only within the purchased time window.
- Download is unavailable by default and becomes available only when the owner explicitly enables it.
- Hourly timed viewing and rental durations expire at server-calculated times; one cannot be used as a substitute for the other.
- Concurrent purchases cannot double-charge or create inconsistent entitlements.
- Creator receives 85%, platform ledger receives 15%, and creator earnings cannot be spent as ordinary wallet tokens.
- Admin takedown prevents new access/sales and leaves a complete moderation and financial audit trail.
