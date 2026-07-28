// /js/main.js
(function () {
  // 1. Shared core scripts loaded on EVERY page
  const globalScripts = [
    '/js/firebase.js'
  ];

  // 2. Map routes to their specific JS files
  const routeMap = {
    '/auth/login': ['/js/auth.js', '/js/otp.js'],
    '/auth/signup': ['/js/auth.js', '/js/otp.js', '/js/location.js'],
    '/app/chat': ['/js/chat.js', '/js/dialog.js'],
    '/app/explore': ['/js/swipe.js', '/js/location.js'],
    '/account/payment': ['/js/payment.js', '/js/subscription.js'],
    '/account/verification': ['/js/verification.js', '/js/verification_calls.js'],
    '/admin': ['/js/admin.js', '/js/reports.js']
  };

  // Helper to append script
  function loadScript(src) {
    const s = document.createElement('script');
    s.src = src;
    s.defer = true;
    document.head.appendChild(s);
  }

  // Load global scripts first
  globalScripts.forEach(loadScript);

  // Load route-specific scripts based on current URL path
  const currentPath = window.location.pathname.replace(/\/$/, ''); // strip trailing slash
  if (routeMap[currentPath]) {
    routeMap[currentPath].forEach(loadScript);
  }
})();
