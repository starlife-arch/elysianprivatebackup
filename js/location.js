// ── DateVault Location & Distance Feature ──────────────────────────
import { db } from "./firebase.js";
import {
  doc, getDoc, updateDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getSubscription } from "./subscription.js";

// ── Haversine distance (km) ────────────────────────────────────────
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(km) {
  if (km < 1) return "< 1 km away";
  if (km < 1000) return `${Math.round(km)} km away`;
  return `${(km / 1000).toFixed(1)}k km away`;
}

// ── Request & save location for current user ───────────────────────
export async function requestAndSaveLocation(uid) {
  if (!navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          updatedAt: serverTimestamp()
        };
        try {
          await updateDoc(doc(db, "users", uid), { _location: coords });
        } catch (e) { console.warn("location save:", e); }
        resolve(coords);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

// ── Visibility rules ──────────────────────────────────────────────
export function resolveVisibility(viewedProfile, viewerProfile, adminSettings = {}) {
  const sub = getSubscription(viewedProfile);
  const isStandard = !sub.plan || sub.plan === "standard";

  const adminLocationOn = adminSettings.locationEnabled !== false;
  const adminDistanceOn = adminSettings.distanceEnabled !== false;
  const adminAgeOn      = adminSettings.ageEnabled      !== false;

  const memberOverride = viewedProfile._adminOverride || {};
  const prefs          = viewedProfile._privacyPrefs  || {};

  function resolve(field, adminGlobalOn) {
    if (!adminGlobalOn)                    return false; // admin killed globally
    if (memberOverride[field] === true)    return true;  // admin forced ON
    if (memberOverride[field] === false)   return false; // admin forced OFF
    if (isStandard)                        return true;  // standard: always visible
    return prefs[field] !== false;                       // upgraded: respect pref
  }

  return {
    showLocation: resolve("location", adminLocationOn),
    showDistance: resolve("distance", adminDistanceOn),
    showAge:      resolve("age",      adminAgeOn),
  };
}

// ── Fetch admin global settings ───────────────────────────────────
export async function getAdminSettings() {
  try {
    const snap = await getDoc(doc(db, "admin", "globalSettings"));
    return snap.exists() ? snap.data() : {};
  } catch { return {}; }
}

// ── Admin: update global setting ──────────────────────────────────
export async function setAdminGlobalSetting(field, value) {
  const ref = doc(db, "admin", "globalSettings");
  try {
    await updateDoc(ref, { [field]: value, updatedAt: serverTimestamp() });
  } catch {
    await setDoc(ref, { [field]: value, updatedAt: serverTimestamp() }, { merge: true });
  }
}

// ── Admin: override a single member ──────────────────────────────
export async function setMemberOverride(uid, field, value) {
  const ref  = doc(db, "users", uid);
  const snap = await getDoc(ref);
  const current = { ...(snap.data()?._adminOverride || {}) };
  if (value === null) delete current[field];
  else current[field] = value;
  await updateDoc(ref, { _adminOverride: current });
}

// ── Member: update own privacy prefs ─────────────────────────────
export async function setMemberPrivacyPref(uid, field, value) {
  const ref  = doc(db, "users", uid);
  const snap = await getDoc(ref);
  const current = { ...(snap.data()?._privacyPrefs || {}) };
  current[field] = value;
  await updateDoc(ref, { _privacyPrefs: current });
}
