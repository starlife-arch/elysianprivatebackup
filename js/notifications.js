import { db } from './firebase.js';
import { collection, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Combines chat, admin-message, and announcement signals for the Chat nav badge.
export function listenForNotifications(uid, onChange) {
  let unreadChats = false, unreadAdminDMs = false, unseenAnnouncement = false;
  const notify = () => onChange(unreadChats || unreadAdminDMs || unseenAnnouncement);

  const unsubChats = onSnapshot(
    query(collection(db, 'matches'), where('users', 'array-contains', uid)),
    snap => { unreadChats = snap.docs.some(d => d.data()[`hasUnread_${uid}`] === true); notify(); }
  );
  const unsubAdmin = onSnapshot(
    query(collection(db, 'admin_messages'), where('toUID', '==', uid), where('read', '==', false)),
    snap => { unreadAdminDMs = !snap.empty; notify(); }
  );
  const unsubAnnouncements = onSnapshot(
    query(collection(db, 'announcements')),
    snap => {
      const lastSeen = parseInt(localStorage.getItem('lastSeenAnnouncement') || '0', 10);
      unseenAnnouncement = snap.docs.some(d => {
        const createdAt = d.data().createdAt;
        const ms = createdAt?.toMillis ? createdAt.toMillis() : new Date(createdAt).getTime();
        return ms > lastSeen;
      });
      notify();
    }
  );

  return () => { unsubChats(); unsubAdmin(); unsubAnnouncements(); };
}
