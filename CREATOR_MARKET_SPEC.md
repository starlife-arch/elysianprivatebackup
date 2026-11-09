# Creator Market — Product and Security Specification

Status: proposal / implementation foundation only
Target repository: `starlife-arch/elysianprivatebackup`
Product: DateVault Creator Market (separate from dating)

## Confirmed product decisions

- Creator Market is a distinct product area inside DateVault, not a dating feature.
- Access is strictly for adults aged 18 or older. Age eligibility must be established using the platform's approved age/identity verification process; a user-entered date of birth alone is not sufficient.
- The Creator Market is private. Creator content must not be exposed through public profile pages, public media URLs, search-engine indexing, dating discovery, or unauthenticated endpoints.
- Creator Market content, purchases, creator follows, and viewing activity must never create or influence dating matches, likes, passes, swipes, dating recommendations, or dating-profile ranking.
- Membership tier or membership expiry must not by itself remove access to Creator Market records, previously purchased content, creator earnings, or withdrawal history. Account bans, age restrictions, fraud controls, and safety enforcement still apply.
- Platform commission: 15% of each successful paid-content transaction. Creator share: 85%.
- Minimum creator withdrawal: 3,000 available creator-earning tokens.
- Admins need dedicated moderation controls to review reports, remove or disable photos/videos, suspend creator-market privileges, and ban accounts where warranted.

## Accounting rules

For a 100-token purchase:
- Buyer debit: 100 tokens.
- Platform fee: 15 tokens.
- Creator gross earnings: 85 tokens.

Use integer token amounts and a single authoritative server-side calculation. Never trust a client-supplied fee, creator share, wallet balance, or purchase status.

Creator earnings are a separate ledger/balance from ordinary purchased or promotional wallet tokens. They are not transferable into the buyer's spendable wallet. Track each event with immutable references: purchase, creator, content, buyer, gross amount, platform fee, creator share, status, timestamps, refund/reversal, and withdrawal. Use idempotency keys and Firestore transactions to prevent duplicate charges or credits.

Recommended earning states:
1. Pending — sale recorded but still inside the settlement / fraud-review window.
2. Available — eligible for withdrawal.
3. Reversed — refunded or charged back; linked to the original earning.
4. Paid — included in a completed payout.

The settlement period and payout provider/process must be agreed before enabling real withdrawals. The 3,000-token minimum applies only to available creator earnings, not pending amounts.

## Privacy and media security

- Store original paid media in private storage, never in a public bucket.
- Persist storage object identifiers, not permanent public download URLs.
- Grant short-lived, authenticated access only after the server verifies an eligible 18+ viewer and a completed purchase.
- Preview media should be separate, lower-resolution and/or visibly watermarked. Do not expose the original through HTML, API responses, logs, or predictable paths.
- A purchase unlock is per buyer and per content item. Verify payment and write purchase/unlock records atomically.
- Do not promise screenshot or screen-recording prevention; explain that technical controls reduce unauthorized distribution but cannot eliminate capture by a viewer.
- Admin moderation access must be role-checked and audited. Restrict access to the minimum staff roles needed.

## Separation from dating

Creator Market must use its own routes, data collections, authorization helpers, and moderation state. Do not reuse dating match, swipe, like, pass, chat, or profile-discovery collections as a content-distribution mechanism.

A Creator Market creator profile is not a dating profile. Following or buying from a creator must not send a dating like, create a match, reveal dating preferences, or modify dating recommendations. Dating profile visibility settings must not expose creator content, and Creator Market privacy settings must not change dating visibility.

Membership expiry is not a Creator Market ban. Enforce separate account-level gates:
- adult eligibility and verification;
- account safety / suspension status;
- creator-market-specific moderation status;
- membership state only where a future explicit business rule requires it.

## Admin moderation requirements

Provide a dedicated Creator Market admin workspace with:
- report queue and report reasons;
- content preview available only to authorized moderators;
- actions to hide/disable content immediately, remove content, restore content, and record a reason;
- creator-market suspension / reinstatement, separate from dating membership expiry;
- account-wide ban escalation for serious safety violations;
- audit history (moderator, action, reason, target, timestamp);
- review of purchase/refund impacts before destructive actions.

Removing content must not erase financial records. If a purchased item is removed, apply the published refund policy and record any refund/reversal against the original purchase and creator earning. Do not silently confiscate already-settled creator earnings.

## Safety and prohibited content

- No content involving minors, including simulated or ambiguous depictions of minors.
- No non-consensual intimate imagery, sexual exploitation, trafficking, blackmail, doxxing, or content shared without the depicted person's informed permission.
- Require creators to confirm they own or have rights to upload the content and have documented consent from every identifiable participant.
- Provide report/block tools and a prompt takedown path for urgent safety reports.
- Apply local legal requirements for age assurance, privacy, content classification, record retention, consumer refunds, and creator payouts before launch. Do not launch adult-content categories in jurisdictions or payment channels where prohibited.

## Suggested phased delivery (all changes preview-only until explicitly approved)

1. **Foundation and access isolation:** route shell, independent Creator Market authorization, adult eligibility gate, navigation entry point, Firestore schema/rules, tests proving no dating/matching side effects. No real uploads or token transfers yet.
2. **Creator profiles and private uploads:** creator onboarding, upload management, private storage, safe previews, admin content review and takedown.
3. **Paid unlocks:** server-authoritative token debit, atomic unlock, duplicate/concurrency protection, purchased library, refunds.
4. **Creator ledger and withdrawals:** 15%/85% split, pending/available accounting, 3,000-token minimum, payout workflow, reconciliation and audit.
5. **Discovery and operational hardening:** private Creator Market browsing, reports, blocks, analytics, rate limits, abuse monitoring, full regression tests.

## Non-goals for the first phase

- No changes to dating match/swipe/chat logic.
- No changes to Trial, Standard, Elite, or Vault membership pricing or benefits.
- No automatic payout provider integration until the payout provider and compliance requirements are confirmed.
- No production deployment or merging without explicit owner approval.

## Acceptance criteria

- An unverified or under-18 account cannot view Creator Market content or upload.
- Expired dating membership alone does not erase Creator Market purchases, earnings, or creator tools.
- A banned/suspended account cannot bypass safety controls through Creator Market routes or direct API calls.
- Creator Market activity produces zero dating likes, matches, swipes, or recommendation changes.
- Paid originals cannot be fetched from public/guessable URLs; access is server-authorized and time-limited.
- A 100-token sale records exactly 100 buyer debit, 15 platform fee, and 85 creator earnings, once only.
- Pending earnings cannot be withdrawn; only available earnings count toward the 3,000-token threshold.
- Admin takedown is immediate, role-protected, reasoned, and audited; related refunds/reversals are traceable.
- Existing dating, membership, wallet, chat, KYC, and payment flows pass regression tests unchanged.
