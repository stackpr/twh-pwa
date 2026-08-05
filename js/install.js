// install.js — PWA install + service worker lifecycle.
//
// Pattern follows the conventional dependency-free PWA template: register a
// service worker scoped to the page's own directory (so it works from a GitHub
// Pages project subpath), capture `beforeinstallprompt` to drive our own button,
// and fall back to printed instructions on iOS, which never fires that event.
//
// NOTE: the service worker caches the APP SHELL ONLY — the HTML, CSS, JS,
// manifest and icons enumerated in sw.js. Transaction data is never fetched
// over the network and is never written to the Cache API. See sw.js.

let deferredPrompt = null;

export function initInstall({ button, status, version }) {
  const setStatus = msg => { if (status) status.textContent = msg; };
  showShellVersion(version);
  // On a first visit no worker controls the page yet; one claims it moments
  // later, and the label should follow rather than wait for a reload.
  navigator.serviceWorker?.addEventListener('controllerchange', () => showShellVersion(version));

  // --- install prompt ---
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (button) { button.hidden = false; button.disabled = false; }
    setStatus('This app can be installed for offline use.');
  });

  if (button) {
    button.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      button.disabled = true;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      button.hidden = outcome === 'accepted';
      setStatus(outcome === 'accepted' ? 'Installed.' : 'Install dismissed.');
    });
  }

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    if (button) button.hidden = true;
    setStatus('Installed.');
  });

  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if (standalone) {
    if (button) button.hidden = true;
    setStatus('Running as an installed app.');
  } else if (isIOS() && !standalone) {
    setStatus('To install on iOS: Share \u2192 Add to Home Screen.');
  }

  registerSW(setStatus);
}

/**
 * Show which app shell is serving this page: the service worker's own cache
 * version, asked for over a message channel rather than duplicated in the page.
 * With no worker in control there is no cached shell — everything came from the
 * network this second — and it says so.
 */
async function showShellVersion(node) {
  if (!node) return;
  const sw = navigator.serviceWorker;
  if (!sw || !sw.controller) { node.textContent = 'not installed'; return; }
  try {
    const version = await new Promise((resolve, reject) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = e => resolve(e.data);
      setTimeout(() => reject(new Error('timeout')), 2000);
      sw.controller.postMessage('version', [ch.port2]);
    });
    node.textContent = `shell ${version}`;
  } catch {
    node.textContent = 'shell version unavailable';
  }
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function registerSW(setStatus) {
  if (!('serviceWorker' in navigator)) return;
  // file:// has no service worker support; skip silently so local use still works.
  if (location.protocol === 'file:') return;

  window.addEventListener('load', async () => {
    try {
      // Relative path keeps the scope correct under /<repo-name>/ on GitHub Pages.
      const reg = await navigator.serviceWorker.register('./sw.js');

      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            setStatus('An update is available — reload to apply.');
            document.dispatchEvent(new CustomEvent('sw-update-ready'));
          }
        });
      });

      // Check for a new deployment each time the app is opened.
      reg.update().catch(() => {});
    } catch (err) {
      console.warn('Service worker registration failed:', err);
    }
  });
}

/** Purge the app-shell cache and unregister. Used by "Reset app" in the UI. */
export async function purgeAppCache() {
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('troopfin-')).map(k => caches.delete(k)));
  }
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
  }
}
