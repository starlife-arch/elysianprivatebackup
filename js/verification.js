import { auth, db, onAuthStateChanged } from "./auth.js";
import { CLOUDINARY_CLOUD, CLOUDINARY_PRESET } from "./firebase.js";
import { doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Upload file to Cloudinary ──
export async function uploadToCloudinary(file, folder = "datevault") {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", CLOUDINARY_PRESET);
  fd.append("folder", folder);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, {
    method: "POST", body: fd
  });
  const data = await res.json();
  if (data.secure_url) return data.secure_url;
  throw new Error("Upload failed: " + JSON.stringify(data));
}

// Upload chat video clips to Cloudinary's video resource type.
export async function uploadVideoToCloudinary(file, folder = "datevault/chat") {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", CLOUDINARY_PRESET);
  fd.append("folder", folder);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/video/upload`, { method: "POST", body: fd });
  const data = await res.json();
  if (data.secure_url) return data.secure_url;
  throw new Error("Video upload failed: " + (data.error?.message || "Please try again."));
}

// ── Save verification data to Firestore ──
export async function submitVerification(uid, verificationData) {
  await updateDoc(doc(db, "users", uid), {
    ...verificationData,
    status: "pending_admin_review",
    profileComplete: true,
    photosUploaded: (verificationData.photos || []).length > 0,
    verificationSubmitted: true,
    stage: "verificationSubmitted",
    reminderCount: 0,
    lastReminderSent: null,
    reminderType: null,
    verificationSubmittedAt: serverTimestamp()
  });
  try {
    await fetch('/api/telegram-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'verification_submitted',
        uid,
        memberId: verificationData.memberId || '',
        name: verificationData.displayName || verificationData.name,
        email: verificationData.email || '',
        country: verificationData.country || ''
      })
    });
  } catch(e) {}
  if (verificationData.email) {
    try {
      await fetch('/api/send-member-notification-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'verification_submitted',
          email: verificationData.email,
          name: verificationData.displayName || verificationData.name || 'Member',
          memberId: verificationData.memberId || ''
        })
      });
    } catch(e) {}
  }
}
