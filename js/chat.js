import { auth, db } from "./auth.js";
import {
  collection, addDoc, query, orderBy, onSnapshot,
  doc, updateDoc, serverTimestamp, getDoc, getDocs, where, limit, runTransaction, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export function getMatchId(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}


async function blockStatus(myUID, theirUID) {
  const [mine, theirs] = await Promise.all([
    getDoc(doc(db, "users", myUID, "blocked", theirUID)).catch(() => null),
    getDoc(doc(db, "users", theirUID, "blocked", myUID)).catch(() => null)
  ]);
  return { blockedByMe: !!mine?.exists?.(), blockedMe: !!theirs?.exists?.() };
}

// ── Send a message ──
export async function sendMessage(myUID, theirUID, text, imageURL = null, replyTo = null) {
  const matchId = getMatchId(myUID, theirUID);
  const blocks = await blockStatus(myUID, theirUID);
  if (blocks.blockedByMe || blocks.blockedMe) throw new Error("Messaging is blocked for this conversation.");
  const msg = {
    senderUID: myUID,
    text: text || null,
    imageURL: imageURL || null,
    replyTo: replyTo ? { id: replyTo.id, senderUID: replyTo.senderUID, text: String(replyTo.text || '').slice(0, 500), imageURL: replyTo.imageURL || null } : null,
    sentAt: serverTimestamp(),
    read: false
  };
  const matchRef = doc(db, "matches", matchId);
  const userRef = doc(db, "users", myUID);
  const messageRef = doc(collection(db, "matches", matchId, "messages"));
  const today = new Date().toISOString().slice(0, 10);
  await runTransaction(db, async transaction => {
    const [matchSnap, userSnap] = await Promise.all([transaction.get(matchRef), transaction.get(userRef)]);
    if (!matchSnap.exists() || matchSnap.data()?.unmatched) throw new Error("This match is no longer available.");
    if (!userSnap.exists()) throw new Error("Your account could not be verified.");
    const user = userSnap.data();
    const messagesSentToday = user.lastMessageDate === today ? Number(user.messagesSentToday || 0) + 1 : 1;
    transaction.set(messageRef, msg);
    transaction.update(matchRef, {
      lastMessage: text || "Photo",
      lastMessageAt: serverTimestamp(),
      [`hasUnread_${theirUID}`]: true
    });
    transaction.update(userRef, { messagesSentToday, lastMessageDate: today });
  });
  const preview = imageURL && !text ? 'Sent you a photo' : String(text || 'Sent you a message').trim().slice(0, 100);
  auth.currentUser?.getIdToken().then(token => fetch('/api/send-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      type: 'message', toUID: theirUID, matchId,
      title: 'New message', body: preview, url: `/app/chat/?uid=${encodeURIComponent(myUID)}`
    })
  })).catch(error => console.error('Could not send message push notification', error));
}

// ── Listen to messages in real-time ──
const readInSession = new Set();
export function listenMessages(myUID, theirUID, callback) {
  const matchId = getMatchId(myUID, theirUID);
  const q = query(collection(db, "matches", matchId, "messages"), orderBy("sentAt", "asc"));
  return onSnapshot(q, snap => {
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(msgs);
    // Mark incoming messages as read for Elite/Vault read receipts.
    snap.docs.forEach(d => {
      const m = d.data();
      if (m.senderUID !== myUID && m.read !== true && !readInSession.has(d.id)) { readInSession.add(d.id); updateDoc(doc(db, "matches", matchId, "messages", d.id), { read: true }).catch(error=>console.error('Could not mark message read', error)); }
    });
    updateDoc(doc(db, "matches", matchId), { [`hasUnread_${myUID}`]: false }).catch(()=>{});
  });
}

// ── Fetch all conversations for a user ──
export async function fetchConversations(myUID) {
  const q = query(collection(db, "matches"), where("users", "array-contains", myUID), orderBy("lastMessageAt", "desc"), limit(50));
  const snap = await getDocs(q);
  const results = await Promise.all(snap.docs.map(async d => { const data=d.data(), theirUID=data.users.find(u=>u!==myUID); const [blocks,theirSnap]=await Promise.all([blockStatus(myUID,theirUID),getDoc(doc(db,"users",theirUID))]); if(blocks.blockedByMe)return null; const them=theirSnap.exists()?theirSnap.data():{}; return {matchId:d.id,theirUID,theirName:them.displayName||them.name||"Member",theirPhoto:them.photos?.[0]||null,lastMessage:data.lastMessage,lastMessageAt:data.lastMessageAt,hasUnread:data[`hasUnread_${myUID}`]||false,unavailable:blocks.blockedMe}; }));
  return results.filter(Boolean);
}
