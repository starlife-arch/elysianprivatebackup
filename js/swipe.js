import { db } from "./auth.js";
import {
  collection, query, where, getDocs, doc, setDoc,
  getDoc, serverTimestamp
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
  return ({ vault: 2, elite: 1, standard: 0 })[sub.plan] || 0;
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

// ── Record a swipe and check for match ──
export async function recordSwipe(myUID, theirUID, direction) {
  // Save to user subcollection
  await setDoc(doc(db, "users", myUID, "swipes", theirUID), {
    direction, swipedAt: serverTimestamp()
  });

  // Save to top-level swipes_index for reverse lookup ("who liked me")
  await setDoc(doc(db, "swipes_index", `${myUID}_${theirUID}`), {
    myUID,
    theirUID,
    direction,
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
