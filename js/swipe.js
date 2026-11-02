import { db } from "./auth.js";
import {
  collection, query, where, getDocs, doc, setDoc,
  getDoc, serverTimestamp, runTransaction, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

function matchesInterestedIn(myProfile = {}, candidate = {}) {
  const choice = myProfile.interestedIn;
  if (!choice || choice === "Everyone") return true;
  if (choice === "Women") return candidate.gender === "Woman";
  if (choice === "Men") return candidate.gender === "Man";
  return true;
}

function subscriptionRank(profile = {}) {
  const sub = profile.subscription || {};
  if (sub.status !== 'active') return 0;
  return ({ vault: 2, elite: 1, standard: 0, free_trial: -1 })[sub.plan] ?? 0;
}

function createdAtMillis(profile = {}) {
  const createdAt = profile.createdAt;
  if (!createdAt) return 0;
  if (typeof createdAt.toMillis === "function") return createdAt.toMillis();
  if (typeof createdAt.toDate === "function") return createdAt.toDate().getTime();
  return new Date(createdAt).getTime() || 0;
}

export function isBoosted(profile = {}) {
  const expires = profile.boostExpiresAt;
  if (!profile.boostActive || !expires) return false;
  const ms = typeof expires.toMillis === 'function' ? expires.toMillis() : new Date(expires).getTime();
  return ms > Date.now();
}

// ── Fetch all eligible profiles to swipe ──
export async function fetchProfiles(currentUser, profile) {
  const swipedSnap = await getDocs(collection(db, "users", currentUser.uid, "swipes"));
  const swipedUIDs = new Set(swipedSnap.docs.map(d => d.id));
  swipedUIDs.add(currentUser.uid);

  // Query active members only, then filter banned users client-side so older member
  // records that do not have an explicit banned:false field can still appear.
  const q = query(
    collection(db, "users"),
    where("status", "==", "active_member")
  );

  const snap = await getDocs(q);
  const profiles = [];
  snap.forEach(d => {
    if (swipedUIDs.has(d.id)) return;
    const data = d.data();
    if (data.banned === true) return;
    if (!matchesInterestedIn(profile, data)) return;
    profiles.push({ id: d.id, ...data, _doc: d });
  });

  // Subscription tier always wins; boosts only break ties inside a tier.
  return profiles.sort((a, b) => subscriptionRank(b) - subscriptionRank(a) || (isBoosted(b) - isBoosted(a)) || createdAtMillis(a) - createdAtMillis(b));
}

// ── Swipe allowances ──
// Free Trial: one like total (including a Super Like); passes are unlimited.
// Paid Standard: likes AND passes share the configured daily allowance.
// Elite/Vault: unlimited regular swipes. Super Likes follow their pack rules.
export class SwipeLimitError extends Error {
  constructor(message = "You've used all your daily swipes.") {
    super(message);
    this.name = "SwipeLimitError";
    this.code = "SWIPE_LIMIT_REACHED";
  }
}

function isFreeTrialActive(user = {}) {
  const trial = user.freeTrial || {};
  return trial.status === 'active' && toMillis(trial.expiresAt) > Date.now();
}

function isPaidStandard(user = {}) {
  const plan = user.plan || user.subscription?.plan;
  const paid = user.hasPaid === true || user.paid === true
    || (user.status === "active_member" && !user.freeTrial);
  return paid && plan === "standard" && !isFreeTrialActive(user);
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  return new Date(value).getTime() || 0;
}

// ── Record a swipe and check for match ──
// Super likes count as likes everywhere in the app (likes tab, profile stats,
// match logic); the `isSuperLike` flag is only used to show a "Super Like" badge.
// Throws SwipeLimitError when a Standard member has no swipes left today.
export async function recordSwipe(myUID, theirUID, direction) {
  const isSuperLike = direction === "superlike";
  const storedDirection = isSuperLike ? "like" : direction;

  const userRef = doc(db, "users", myUID);
  const swipeRef = doc(db, "users", myUID, "swipes", theirUID);
  const pricingRef = doc(db, "config", "pricing");

  // Check the allowance, use one swipe (if Standard) and save the swipe in one
  // transaction, so fast taps cannot go over the limit and a failed save never
  // costs the user a swipe.
  await runTransaction(db, async (tx) => {
    const [userSnap, swipeSnap, pricingSnap] = await Promise.all([
      tx.get(userRef), tx.get(swipeRef), tx.get(pricingRef)
    ]);
    const user = userSnap.exists() ? userSnap.data() : {};
    const alreadySwiped = swipeSnap.exists();

    if (!alreadySwiped && isFreeTrialActive(user) && storedDirection === 'like') {
      const remaining = Math.max(0, Number(user.likesRemaining ?? 1));
      if (remaining < 1) throw new SwipeLimitError("Your free trial includes exactly one like. Upgrade to continue liking profiles.");
      tx.update(userRef, {
        likesRemaining: remaining - 1,
        'freeTrial.likesUsed': Math.min(1, Number(user.freeTrial?.likesUsed || 0) + 1),
        lastLikeAt: serverTimestamp()
      });
    }

    if (!isSuperLike && !alreadySwiped && isPaidStandard(user)) {
      const cfg = pricingSnap.exists() ? pricingSnap.data() : {};
      const dailyLimit = Math.max(1, Number(cfg.standardDailyLikes) || 5);
      const resetMs = toMillis(user.likesResetAt);
      const windowExpired = !resetMs || resetMs <= Date.now();

      const remaining = windowExpired
        ? dailyLimit
        : Number(user.likesRemaining ?? dailyLimit);
      const resetAt = windowExpired
        ? Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000)
        : user.likesResetAt;

      if (remaining <= 0) throw new SwipeLimitError();

      tx.update(userRef, {
        likesRemaining: remaining - 1,
        likesResetAt: resetAt,
        lastLikeAt: serverTimestamp()
      });
    }

    tx.set(swipeRef, {
      direction: storedDirection,
      isSuperLike,
      swipedAt: serverTimestamp()
    });
  });

  // Save to top-level swipes_index for reverse lookup ("who liked me")
  await setDoc(doc(db, "swipes_index", `${myUID}_${theirUID}`), {
    myUID,
    theirUID,
    direction: storedDirection,
    isSuperLike,
    swipedAt: serverTimestamp()
  });

  if (direction !== "like" && direction !== "superlike") return false;

  // Check if they liked me back
  const theirSwipe = await getDoc(doc(db, "users", theirUID, "swipes", myUID));
  if (theirSwipe.exists() &&
      (theirSwipe.data().direction === "like" || theirSwipe.data().direction === "superlike")) {
    const matchId = [myUID, theirUID].sort().join("_");
    await setDoc(doc(db, "matches", matchId), {
      users: [myUID, theirUID],
      matchedAt: serverTimestamp(),
      lastMessage: null,
      lastMessageAt: serverTimestamp(),
      [`hasUnread_${myUID}`]: false,
      [`hasUnread_${theirUID}`]: false
    });
    await setDoc(doc(db, "users", myUID, "matches", theirUID), {
      matchId, matchedAt: serverTimestamp()
    });
    await setDoc(doc(db, "users", theirUID, "matches", myUID), {
      matchId, matchedAt: serverTimestamp()
    });
    return true;
  }
  return false;
}
