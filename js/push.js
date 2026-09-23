import { app, db } from './firebase.js';
import { doc, getDoc, updateDoc, arrayUnion, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const VAPID_KEY = 'BNK8xkS7M-5WqNVwohcR6PulT4PT5wPBz3d4jrd4Oa5bpvy4pDHnIKG7MeAv3wvHW-x025kG7gzJ2rKW6YqTVvY';

function waitForServiceWorkerReady() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Notification service setup timed out.')), 8000))
  ]);
}

export async function enablePushNotifications(uid) {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  const { getMessaging, getToken, isSupported, onMessage } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js');
  if (!(await isSupported())) return false;
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
  await waitForServiceWorkerReady();
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) return false;
  await updateDoc(doc(db, 'users', uid), {
    fcmTokens: arrayUnion(token),
    fcmTokensUpdatedAt: serverTimestamp(),
    pushNotificationsEnabledAt: serverTimestamp()
  });
  onMessage(messaging, () => {});
  return true;
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export async function showPushNotificationNudge(uid, showToast) {
  const userRef = doc(db, 'users', uid);
  const profile = await getDoc(userRef);
  if (!profile.exists() || profile.data().seenAddToHomeScreenPrompt === true) return;
  const dismiss = async banner => {
    banner.remove();
    await updateDoc(userRef, { seenAddToHomeScreenPrompt: true, seenAddToHomeScreenPromptAt: serverTimestamp() });
  };
  const banner = document.createElement('div');
  banner.className = 'glass-card';
  banner.style.cssText = 'margin:0.75rem 1rem;padding:0.9rem;display:flex;gap:0.75rem;align-items:center;justify-content:space-between;position:relative;z-index:5;';
  if (isIOS() && !isStandalone()) {
    banner.innerHTML = '<span style="font-size:13px;line-height:1.45">For call and message alerts, add DateVault to your home screen — tap the Share icon, then Add to Home Screen.</span><button type="button" class="btn btn-outline btn-sm">Dismiss</button>';
    banner.querySelector('button').addEventListener('click', () => dismiss(banner).catch(() => showToast('Could not save notification preference.')));
  } else {
    banner.innerHTML = '<span style="font-size:13px;line-height:1.45">Enable notifications for call, message, and announcement alerts.</span><span style="display:flex;gap:0.5rem"><button type="button" class="btn btn-gold btn-sm">Enable</button><button type="button" class="btn btn-outline btn-sm">Not now</button></span>';
    const [enable, notNow] = banner.querySelectorAll('button');
    enable.addEventListener('click', async () => {
      try {
        const enabled = await enablePushNotifications(uid);
        showToast(enabled ? 'Notifications enabled.' : 'Notifications are unavailable or blocked in this browser.');
        if (enabled) await dismiss(banner);
      } catch (error) { console.error('Could not enable push notifications', error); showToast('Could not enable notifications.'); }
    });
    notNow.addEventListener('click', () => dismiss(banner).catch(() => showToast('Could not save notification preference.')));
  }
  document.body.insertBefore(banner, document.body.firstChild);
}
