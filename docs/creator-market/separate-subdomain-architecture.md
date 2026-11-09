# Separate Creator Market application architecture

## Decision
Creator Market will be a separately deployed application at:
- Dating: https://elysiandate.site
- Creator Market: https://market.elysiandate.site
The dating application links to Creator Market from its navigation. The two applications remain separate deployments and route trees. Do not embed Creator Market pages into the dating SPA or reuse dating membership route guards.

## Access policy
- Any authenticated account in good standing may enter Creator Market, regardless of dating membership tier or payment status.
- Newly approved accounts that have not paid the dating entry fee may use Creator Market but cannot use dating features.
- Accounts whose Trial, Standard, Elite, or Vault membership has expired retain Creator Market access and lose only dating entitlements.
- Adult content viewing requires independent 18+ verification.
- Browsing/buying content is distinct from creator publishing: publishing and creator payouts require a separate creator application and admin approval.
- Platform moderation, bans, and applicable safety/legal restrictions apply across both applications where necessary.

## Authentication / SSO
1. User clicks Creator Market in DateVault.
2. DateVault backend verifies the current authenticated session and account standing, then creates a cryptographically random, single-use authorization code with a short expiry and intended audience market.elysiandate.site.
3. Browser is redirected to the market callback with the code (never a long-lived access token or Firebase refresh token).
4. Market backend redeems the code server-to-server, validates audience, expiry, and one-time use, then establishes its own secure, HttpOnly, Secure, SameSite cookie session.
5. Remove the code from browser history immediately after redemption.
6. Direct visits to the market use its own login flow or a fresh SSO handoff. Logout/revocation behavior must be explicitly designed and tested.
Never place Firebase ID tokens, refresh tokens, service credentials, or reusable session secrets in query strings, localStorage, or postMessage without a strict origin-checked protocol. Do not assume Firebase client auth automatically shares sessions across subdomains.

## Identity and authorization boundaries
- Keep the existing identity provider / user identity as the source of truth, but create market-specific profile, creator application, content, purchase, rental, entitlement, earnings, and moderation records.
- Market authorization checks authentication, account standing, 18+ viewer verification, and market-specific entitlements. It must not query or require an active dating plan.
- Creator publishing and payout authorization additionally requires approved creator verification.
- Dating continues to enforce dating membership independently.
- Account bans and safety suspensions must be respected by both systems through a narrowly scoped shared account-status contract.

## Payments and wallet
- Reuse existing payment rails only through documented server-side interfaces; never couple market pages to dating checkout routes.
- Keep market purchases, hourly timed-view passes, rentals, permanent purchases (if offered), refunds, platform fees, creator earnings, and withdrawals in distinct auditable ledger entries.
- Platform commission: 15%; creator share: 85%.
- Minimum creator withdrawal: 3,000 available creator-earning tokens.
- Creator earnings must not silently become ordinary spendable/purchased wallet tokens.
- Payment, token deduction, entitlement creation, and ledger posting must be idempotent and transactionally consistent.

## Content privacy and monetization
- Private object storage; no public originals or predictable public URLs.
- Preview assets may be watermarked/low-resolution.
- Full media access requires server-side entitlement checks on every request.
- Download permission is disabled by default and can be enabled per item by the owner. When enabled, use short-lived scoped download authorization.
- Clearly distinguish hourly timed viewing from rentals measured in days, custom days, weeks, or months. Creator sets price and duration. Server time controls expiry.
- Explain that screenshots and screen recording cannot be fully prevented after content is displayed.

## Deployment and domain
- Deploy the new market application independently (recommended separate repository) and configure the host custom domain market.elysiandate.site.
- Add the DNS record required by the selected hosting provider only after the market deployment target is known. Do not guess a CNAME/A record.
- Configure TLS/HTTPS, canonical URL, allowed origins, CSP, callback URLs, and environment secrets separately for each application.
- Add the Creator Market navigation link in DateVault only after the market preview is available. It should open the subdomain in the same tab unless product UX later requires otherwise.
- Keep production DNS and production navigation unchanged until preview authentication and access tests pass and the owner approves cutover.

## Rollout sequence
1. Audit current DateVault auth/session and account-status source of truth. Fix expired membership and approved-but-unpaid navigation without broadening dating access.
2. Create and deploy a standalone Creator Market application to a preview URL.
3. Implement one-time SSO and independent market sessions.
4. Test all account states: newly approved unpaid, active Trial/Standard/Elite/Vault, expired Trial/Standard/Elite/Vault, age-unverified, age-verified, creator pending/approved/suspended, banned.
5. Implement creator identity/verification, private media, hourly access, rentals, ledger/commission, withdrawals, and admin moderation in isolated stages.
6. Configure market.elysiandate.site DNS and TLS once the hosting provider supplies exact records.
7. Add the dating navigation link and perform a controlled cutover only after approval.

## Non-negotiable regression tests
- Market is reachable for authenticated accounts regardless of dating plan state.
- Dating chats, likes, swipes, matches and other plan-gated features remain blocked when entry payment is unpaid or membership expired.
- Creator Market direct visit does not redirect to dating checkout.
- SSO code is single-use, short-lived, audience-bound, and cannot be replayed.
- Logout and switching accounts cannot reuse the previous account's market session.
- Market session revocation/ban state is enforced.
- Market purchases and rental entitlements never grant dating privileges.
- Creator application approval is required before publishing or payout.
- No production DNS, payment, or navigation changes occur before explicit approval.