importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');
importScripts('/js/firebase-config.js');

firebase.initializeApp(self.DATEVAULT_FIREBASE_CONFIG);

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  self.registration.showNotification(payload.notification?.title || 'DateVault', {
    body: payload.notification?.body || '',
    icon: '/icon-192.png',
    data: payload.data
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/app/dashboard/'));
});
