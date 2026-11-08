// Lightweight same-origin navigation prefetch. Nothing is fetched until a member
// shows intent by hovering, focusing, or touching a normal navigation link.
const prefetched = new Set();
const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
const saveData = connection?.saveData === true;
const slowConnection = /(^|-)2g$/.test(connection?.effectiveType || '');

function eligibleLink(anchor) {
  if (!anchor || anchor.hasAttribute('download') || anchor.target && anchor.target !== '_self') return null;
  if (anchor.relList?.contains('nofollow')) return null;
  let url;
  try { url = new URL(anchor.href, location.href); } catch (_) { return null; }
  if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return null;
  if (url.pathname === location.pathname && url.search === location.search) return null;
  if (url.pathname.startsWith('/api/') || /\.(?:pdf|zip|mp4|webm)$/i.test(url.pathname)) return null;
  return url;
}

function prefetch(anchor) {
  if (saveData || slowConnection) return;
  const url = eligibleLink(anchor);
  if (!url || prefetched.has(url.href)) return;
  prefetched.add(url.href);
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'document';
  link.href = url.href;
  link.referrerPolicy = 'same-origin';
  link.onerror = () => prefetched.delete(url.href);
  document.head.appendChild(link);
}

document.addEventListener('pointerover', event => {
  const anchor = event.target.closest?.('a[href]');
  if (anchor && !anchor.contains(event.relatedTarget)) prefetch(anchor);
}, { passive: true });
document.addEventListener('focusin', event => {
  const anchor = event.target.closest?.('a[href]');
  if (anchor) prefetch(anchor);
});
document.addEventListener('touchstart', event => {
  const anchor = event.target.closest?.('a[href]');
  if (anchor) prefetch(anchor);
}, { passive: true });
