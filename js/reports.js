// This module is fully handled inside admin.js and chat.html (reportUser function)
// Reports are stored in Firestore: collection("reports")
// Structure:
//   reporterUID, reportedUID, reason, reportedAt, status("pending"|"resolved")
// Admin views and resolves via admin.html
export {};
