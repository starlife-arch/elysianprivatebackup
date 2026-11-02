const { json, parseBody, preflight, getAdmin } = require('./_helpers');

function bearerToken(event) {
  const headers = event.headers || {};
  const value = headers.authorization || headers.Authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

exports.handler = async event => {
  const options = preflight(event);
  if (options) return options;
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST required' });
  try {
    const admin = getAdmin();
    const token = bearerToken(event);
    if (!token) return json(401, { error: 'Authentication required.' });
    const decoded = await admin.auth().verifyIdToken(token);
    const db = admin.firestore();
    const userRef = db.collection('users').doc(decoded.uid);
    const now = admin.firestore.Timestamp.now();
    const nowMs = now.toMillis();

    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(userRef);
      if (!snap.exists) return { granted: false, reason: 'profile_missing' };
      const user = snap.data();
      if (user.role === 'admin' || user.banned === true || user.status === 'rejected' || user.status === 'pending_admin_review') {
        return { granted: false, reason: 'not_eligible' };
      }

      const existingTrial = user.freeTrial;
      if (existingTrial) {
        const expiry = existingTrial.expiresAt;
        const expiryMs = expiry?.toMillis ? expiry.toMillis() : new Date(expiry || 0).getTime();
        if (existingTrial.status === 'active' && expiryMs <= nowMs) {
          tx.update(userRef, {
            'freeTrial.status': 'expired',
            freeTrialExpiredAt: now,
            status: 'approved_pending_payment',
            stage: 'adminApproved',
            adminApproved: true,
            paid: false,
            hasPaid: false,
            plan: 'none',
            subscription: { ...(user.subscription || {}), plan: 'none', billing: null, status: 'inactive', nextBillingDate: null }
          });
          return { granted: false, expired: true };
        }
        if (existingTrial.status === 'active' && expiryMs > nowMs) {
          tx.update(userRef, { plan: 'free_trial', stage: 'trial', 'subscription.plan': 'free_trial', 'subscription.billing': 'trial', 'subscription.status': 'active', 'subscription.nextBillingDate': null });
        }
        return { granted: false, reason: 'already_granted', status: existingTrial.status };
      }

      // Never replace a paid membership or an admin-granted active membership.
      if (user.paid === true || user.hasPaid === true || user.adminOverride === true) return { granted: false, reason: 'already_paid_or_admin_granted' };
      const approvedForTrial = user.profileComplete === true && user.adminApproved === true && ['approved_pending_invite', 'approved_pending_payment'].includes(user.status);
      if (!approvedForTrial) return { granted: false, reason: 'profile_and_kyc_approval_required' };

      const expiresAt = admin.firestore.Timestamp.fromMillis(nowMs + 7 * 24 * 60 * 60 * 1000);
      tx.update(userRef, {
        status: 'active_member',
        paid: false,
        hasPaid: false,
        plan: 'free_trial',
        stage: 'trial',
        likesRemaining: 1,
        likesResetAt: null,
        freeTrial: {
          status: 'active',
          startedAt: now,
          expiresAt,
          durationDays: 7,
          likesGranted: 1,
          likesUsed: 0
        },
        subscription: {
          ...(user.subscription || {}),
          plan: 'free_trial',
          billing: 'trial',
          status: 'active',
          startDate: now,
          nextBillingDate: null,
          prioritySupportRequests: user.subscription?.prioritySupportRequests || 0
        }
      });
      return { granted: true, expiresAt: expiresAt.toDate().toISOString() };
    });

    return json(200, { success: true, ...result });
  } catch (error) {
    console.error('Free-trial activation failed:', error);
    return json(500, { error: 'Could not activate the free trial.' });
  }
};
