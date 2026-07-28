// Automatically rewrite legacy .html links to clean domain routes in real-time
document.addEventListener('DOMContentLoaded', () => {
  const linkMap = {
    'login.html': '/auth/login',
    'signup.html': '/auth/signup',
    'invite.html': '/auth/invite',
    'dashboard.html': '/app/dashboard',
    'chat.html': '/app/chat',
    'explore.html': '/app/explore',
    'discover.html': '/app/discover',
    'likes.html': '/app/likes',
    'member.html': '/app/member',
    'profile.html': '/app/profile',
    'payment.html': '/account/payment',
    'verification.html': '/account/verification',
    'status.html': '/account/status',
    'suspended.html': '/account/suspended',
    'admin.html': '/admin',
    'privacy-policy.html': '/legal/privacy',
    'terms-and-conditions.html': '/legal/terms'
  };

  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (linkMap[href]) {
      a.setAttribute('href', linkMap[href]);
    }
  });
});
