/* DateVault persistent install action. The browser controls whether a native prompt is available. */
(function () {
  let deferredPrompt = window.__dateVaultInstallPrompt || null;
  const button = document.getElementById('installAppButton');
  if (!button) return;

  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const hideButton = () => { button.hidden = true; };
  if (isStandalone()) { hideButton(); return; }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    window.__dateVaultInstallPrompt = event;
    button.hidden = false;
    button.textContent = 'Install App';
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.__dateVaultInstallPrompt = null;
    hideButton();
  });

  button.hidden = false;
  button.addEventListener('click', async () => {
    if (deferredPrompt) {
      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      window.__dateVaultInstallPrompt = null;
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice?.outcome === 'accepted') hideButton();
      } catch (error) {
        console.warn('Native install prompt could not be opened', error);
        showInstallHelp();
      }
      return;
    }
    showInstallHelp();
  });

  function showInstallHelp() {
    let overlay = document.getElementById('installHelpModal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'installHelpModal';
      overlay.className = 'modal-overlay open';
      overlay.style.zIndex = '10020';
      overlay.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="installHelpTitle" style="max-width:380px;">
          <div class="modal-handle"></div>
          <div class="modal-title" id="installHelpTitle">Install DateVault</div>
          <p style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:1rem;">You can add DateVault to your home screen at any time. The exact option depends on your browser.</p>
          <div style="font-size:13px;line-height:1.65;margin-bottom:1rem;">
            <strong>iPhone / iPad (Safari)</strong><br>Tap Share, then choose <strong>Add to Home Screen</strong>.<br><br>
            <strong>Android (Chrome)</strong><br>Tap the browser menu (⋮), then choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.<br><br>
            <strong>Computer (Chrome / Edge)</strong><br>Use the install icon in the address bar, or open the browser menu and choose <strong>Install DateVault</strong>.
          </div>
          <button type="button" class="btn btn-gold btn-full" id="closeInstallHelp">Got it</button>
        </div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', event => { if (event.target === overlay) overlay.classList.remove('open'); });
      overlay.querySelector('#closeInstallHelp').addEventListener('click', () => overlay.classList.remove('open'));
    } else overlay.classList.add('open');
  }
}());