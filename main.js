// Main application entry point
// Loaded with cache busting via index.html

import * as debugConsole from './console.js';

const VERSION_CHECK_INTERVAL = 5000;
const VERSION_ENDPOINT = './version.json';

let currentVersion = window.__BUILD_INFO || null;
let checkCounter = 0;

function formatVersion(version) {
  if (!version) return 'unknown';
  const hash = version.gitHash || 'no-hash';
  const date = version.date ? new Date(version.date).toLocaleString() : 'no-date';
  return `${hash} @ ${date}`;
}

async function fetchVersionInfo() {
  const res = await fetch(VERSION_ENDPOINT, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache'
    }
  });

  if (!res.ok) {
    throw new Error(`version request failed (${res.status})`);
  }

  return res.json();
}

function showReloadButton(nextVersion) {
  const reloadBtn = document.getElementById('reload-button');
  if (!reloadBtn) return;

  reloadBtn.classList.add('show');
  if (nextVersion?.gitHash) {
    reloadBtn.title = `New build ${nextVersion.gitHash} available. Tap to reload.`;
  }
}

function forceReload() {
  console.log('🔄 Reloading application for latest version...');
  window.location.reload();
}

async function checkForUpdates() {
  try {
    checkCounter += 1;
    const latestVersion = await fetchVersionInfo();

    if (checkCounter % 6 === 0) {
      console.log(`👁️ Version check #${checkCounter}`, {
        current: currentVersion?.buildId,
        latest: latestVersion?.buildId
      });
    }

    if (!currentVersion) {
      currentVersion = latestVersion;
      return;
    }

    const hasUpdate =
      latestVersion.buildId !== currentVersion.buildId ||
      latestVersion.timestamp !== currentVersion.timestamp;

    if (hasUpdate) {
      console.warn('🔄 New version detected', {
        current: formatVersion(currentVersion),
        latest: formatVersion(latestVersion)
      });
      showReloadButton(latestVersion);
    }
  } catch (err) {
    console.debug('Version check failed:', err.message);
  }
}

function initVersionCheck() {
  const reloadBtn = document.getElementById('reload-button');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', forceReload);
  }

  setInterval(checkForUpdates, VERSION_CHECK_INTERVAL);
  checkForUpdates();

  console.log(`👁️ Version monitoring started (${VERSION_CHECK_INTERVAL / 1000}s interval)`);
}

function init() {
  debugConsole.init();

  console.log('🚀 Application loaded!');
  console.log('📦 Build version:', formatVersion(currentVersion));

  initVersionCheck();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { init };
