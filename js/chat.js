import { db } from "./auth.js";
import {
  collection, addDoc, query, orderBy, onSnapshot,
  doc, updateDoc, serverTimestamp, getDoc, getDocs, where, limit
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
export async function sendMessage(myUID, theirUID, text, imageURL = null) {
  const matchId = getMatchId(myUID, theirUID);
  const blocks = await blockStatus(myUID, theirUID);
  if (blocks.blockedByMe || blocks.blockedMe) throw new Error("Messaging is blocked for this conversation.");
  const msg = {
    senderUID: myUID,
    text: text || null,
    imageURL: imageURL || null,
    sentAt: serverTimestamp(),
    read: false
  };
  await addDoc(collection(db, "matches", matchId, "messages"), msg);
  // Update last message on match doc
  await updateDoc(doc(db, "matches", matchId), {
    lastMessage: text || "Photo",
    lastMessageAt: serverTimestamp(),
    [`hasUnread_${theirUID}`]: true
  });
}

// ── Listen to messages in real-time ──
export function listenMessages(myUID, theirUID, callback) {
  const matchId = getMatchId(myUID, theirUID);
  const q = query(collection(db, "matches", matchId, "messages"), orderBy("sentAt", "asc"));
  return onSnapshot(q, snap => {
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(msgs);
    // Mark incoming messages as read for Elite/Vault read receipts.
    snap.docs.forEach(d => {
      const m = d.data();
      if (m.senderUID !== myUID && m.read !== true) updateDoc(doc(db, "matches", matchId, "messages", d.id), { read: true }).catch(()=>{});
    });
    updateDoc(doc(db, "matches", matchId), { [`hasUnread_${myUID}`]: false }).catch(()=>{});
  });
}

// ── Fetch all conversations for a user ──
export async function fetchConversations(myUID) {
  const q = query(collection(db, "matches"), where("users", "array-contains", myUID), orderBy("lastMessageAt", "desc"), limit(50));
  const snap = await getDocs(q);
  const conversations = [];
  for (const d of snap.docs) {
    const data = d.data();
    const theirUID = data.users.find(u => u !== myUID);
    const blocks = await blockStatus(myUID, theirUID);
    if (blocks.blockedByMe) continue;
    const theirSnap = await getDoc(doc(db, "users", theirUID));
    const them = theirSnap.exists() ? theirSnap.data() : {};
    conversations.push({
      matchId: d.id,
      theirUID,
      theirName: them.displayName || them.name || "Member",
      theirPhoto: them.photos && them.photos[0] ? them.photos[0] : null,
      lastMessage: data.lastMessage,
      lastMessageAt: data.lastMessageAt,
      hasUnread: data[`hasUnread_${myUID}`] || false,
      unavailable: blocks.blockedMe
    });
  }
  return conversations;
}
