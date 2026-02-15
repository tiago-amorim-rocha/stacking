type ConsoleLevel = 'log' | 'warn' | 'error';

interface VersionInfo {
  timestamp?: number;
  date?: string;
  buildId?: string;
  gitHash?: string;
  commitMessage?: string;
}

const VERSION_ENDPOINT = './version.json';
const VERSION_CHECK_INTERVAL_MS = 5_000;
const MAX_MESSAGES = 200;

const messages: { level: ConsoleLevel; text: string; time: string }[] = [];
const levelFilters: Record<ConsoleLevel, boolean> = {
  log: true,
  warn: true,
  error: true,
};

const originalConsole = {
  log: console.log,
  info: console.info,
  debug: console.debug,
  warn: console.warn,
  error: console.error,
};

let outputEl: HTMLDivElement | null = null;
let statusEl: HTMLSpanElement | null = null;
let versionTextEl: HTMLSpanElement | null = null;
let updateButtonEl: HTMLButtonElement | null = null;
let isOpen = false;
let currentVersion: VersionInfo | null = (window as Window & { __BUILD_INFO?: VersionInfo }).__BUILD_INFO ?? null;
let updateAvailable = false;

const serializeArg = (arg: unknown): string => {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`;
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg, null, 2);
    } catch {
      return '[Unserializable object]';
    }
  }
  return String(arg);
};

const escapeHtml = (text: string): string => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

const addMessage = (level: ConsoleLevel, args: unknown[]): void => {
  messages.push({
    level,
    text: args.map(serializeArg).join(' '),
    time: new Date().toLocaleTimeString(),
  });

  if (messages.length > MAX_MESSAGES) {
    messages.shift();
  }

  if (isOpen) {
    renderMessages();
  }
};

const renderMessages = (): void => {
  if (!outputEl) return;

  const filtered = messages.filter((entry) => levelFilters[entry.level]);
  outputEl.innerHTML = filtered
    .map(
      (entry) => `
      <div class="dbg-msg dbg-msg--${entry.level}">
        <span class="dbg-time">[${entry.time}]</span>
        <span>${escapeHtml(entry.text)}</span>
      </div>`,
    )
    .join('');

  outputEl.scrollTop = outputEl.scrollHeight;

  if (statusEl) {
    statusEl.textContent = `Showing ${filtered.length}/${messages.length}`;
  }
};

const toggleLevel = (level: ConsoleLevel, button: HTMLButtonElement): void => {
  levelFilters[level] = !levelFilters[level];
  button.classList.toggle('is-active', levelFilters[level]);
  renderMessages();
};

const formatVersionLabel = (version: VersionInfo | null): string => {
  if (!version) return 'Version: unknown';
  const hash = version.gitHash ?? 'no-hash';
  const build = version.buildId?.slice(0, 8) ?? 'no-build';
  const date = version.date ? new Date(version.date).toLocaleString() : null;
  const commit = version.commitMessage?.trim();

  const parts = [`Version: ${hash} (${build})`];
  if (date) parts.push(`• ${date}`);
  if (commit) parts.push(`• ${commit}`);
  return parts.join(' ');
};

const setVersionLabel = (version: VersionInfo | null): void => {
  if (versionTextEl) {
    versionTextEl.textContent = formatVersionLabel(version);
  }
};

const showUpdateButton = (nextVersion: VersionInfo): void => {
  if (!updateButtonEl || updateAvailable) return;

  updateAvailable = true;
  updateButtonEl.classList.add('is-visible');
  if (nextVersion.gitHash) {
    updateButtonEl.title = `New build ${nextVersion.gitHash} available. Tap to refresh.`;
  }
};

const reloadApp = async (): Promise<void> => {
  try {
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    }
  } catch (error) {
    console.warn('Failed to clear cache before reload:', error);
  } finally {
    window.location.reload();
  }
};

const fetchVersion = async (): Promise<VersionInfo> => {
  const response = await fetch(VERSION_ENDPOINT, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch version.json (${response.status})`);
  }

  return response.json() as Promise<VersionInfo>;
};

const monitorVersion = async (): Promise<void> => {
  try {
    const latest = await fetchVersion();

    if (!currentVersion) {
      currentVersion = latest;
      setVersionLabel(currentVersion);
      return;
    }

    const hasUpdate = latest.buildId !== currentVersion.buildId || latest.timestamp !== currentVersion.timestamp;

    if (hasUpdate) {
      console.warn('🔄 New version detected', {
        current: currentVersion,
        latest,
      });
      showUpdateButton(latest);
    }

    currentVersion = latest;
    setVersionLabel(currentVersion);
  } catch (error) {
    console.debug('Version monitor skipped:', error);
  }
};

const interceptConsole = (): void => {
  console.log = (...args: unknown[]) => {
    originalConsole.log(...args);
    addMessage('log', args);
  };

  console.info = (...args: unknown[]) => {
    originalConsole.info(...args);
    addMessage('log', args);
  };

  console.debug = (...args: unknown[]) => {
    originalConsole.debug(...args);
    addMessage('log', args);
  };

  console.warn = (...args: unknown[]) => {
    originalConsole.warn(...args);
    addMessage('warn', args);
  };

  console.error = (...args: unknown[]) => {
    originalConsole.error(...args);
    addMessage('error', args);
  };

  window.addEventListener('error', (event) => {
    addMessage('error', [`Unhandled: ${event.message} at ${event.filename}:${event.lineno}`]);
  });

  window.addEventListener('unhandledrejection', (event) => {
    addMessage('error', [`Unhandled Promise: ${serializeArg(event.reason)}`]);
  });
};

const createUi = (): void => {
  const root = document.createElement('div');
  root.innerHTML = `
    <style>
      .dbg-version {
        position: fixed;
        top: calc(10px + env(safe-area-inset-top));
        left: 10px;
        right: 10px;
        z-index: 1001;
        padding: 6px 10px;
        border-radius: 8px;
        background: rgb(17 24 39 / 78%);
        color: #e5e7eb;
        font: 500 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbg-toggle,
      .dbg-update {
        position: fixed;
        bottom: calc(12px + env(safe-area-inset-bottom));
        z-index: 1002;
        border: 0;
        border-radius: 999px;
        padding: 10px 12px;
        color: #f9fafb;
        font: 600 14px system-ui;
      }
      .dbg-toggle { right: 12px; background: #111827; }
      .dbg-update {
        right: 62px;
        background: #7c2d12;
        display: none;
      }
      .dbg-update.is-visible { display: inline-block; }
      .dbg-panel {
        position: fixed;
        inset: auto 0 0 0;
        z-index: 1003;
        display: none;
        flex-direction: column;
        gap: 8px;
        max-height: 48vh;
        padding: 10px;
        background: rgb(0 0 0 / 88%);
        color: #f9fafb;
        font: 12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .dbg-toolbar { display: flex; align-items: center; gap: 6px; }
      .dbg-toolbar button { border: 0; border-radius: 6px; padding: 6px 8px; background: #374151; color: #f9fafb; }
      .dbg-toolbar button.is-active { background: #059669; }
      .dbg-toolbar .dbg-status { margin-left: auto; color: #9ca3af; }
      .dbg-output { overflow: auto; white-space: pre-wrap; word-break: break-word; }
      .dbg-msg { padding: 2px 0; }
      .dbg-msg--warn { color: #fbbf24; }
      .dbg-msg--error { color: #f87171; }
      .dbg-time { color: #9ca3af; margin-right: 6px; }
    </style>
    <div class="dbg-version"><span id="dbg-version-text">Version: loading...</span></div>
    <button id="dbg-update" class="dbg-update" type="button" aria-label="Refresh to latest version">↻ Update</button>
    <button id="dbg-toggle" class="dbg-toggle" type="button" aria-label="Toggle debug console">🐛</button>
    <section id="dbg-panel" class="dbg-panel" aria-live="polite">
      <div class="dbg-toolbar">
        <button type="button" data-level="log" class="is-active">Log</button>
        <button type="button" data-level="warn" class="is-active">Warn</button>
        <button type="button" data-level="error" class="is-active">Error</button>
        <button type="button" id="dbg-clear">Clear</button>
        <span id="dbg-status" class="dbg-status"></span>
      </div>
      <div id="dbg-output" class="dbg-output"></div>
    </section>
  `;

  document.body.append(root);

  outputEl = root.querySelector<HTMLDivElement>('#dbg-output');
  statusEl = root.querySelector<HTMLSpanElement>('#dbg-status');
  versionTextEl = root.querySelector<HTMLSpanElement>('#dbg-version-text');
  updateButtonEl = root.querySelector<HTMLButtonElement>('#dbg-update');

  const toggleButton = root.querySelector<HTMLButtonElement>('#dbg-toggle');
  const panel = root.querySelector<HTMLElement>('#dbg-panel');
  const clearButton = root.querySelector<HTMLButtonElement>('#dbg-clear');
  const levelButtons = root.querySelectorAll<HTMLButtonElement>('[data-level]');

  toggleButton?.addEventListener('click', () => {
    isOpen = !isOpen;
    if (panel) {
      panel.style.display = isOpen ? 'flex' : 'none';
    }
    if (toggleButton) {
      toggleButton.textContent = isOpen ? '✕' : '🐛';
    }
    if (isOpen) {
      renderMessages();
    }
  });

  updateButtonEl?.addEventListener('click', () => {
    console.log('🔄 Refreshing app to load latest build');
    void reloadApp();
  });

  clearButton?.addEventListener('click', () => {
    messages.length = 0;
    renderMessages();
  });

  levelButtons.forEach((button) => {
    const level = button.dataset.level as ConsoleLevel | undefined;
    if (!level) return;
    button.addEventListener('click', () => toggleLevel(level, button));
  });
};

export const initDebugOverlay = (): void => {
  createUi();
  interceptConsole();
  void monitorVersion();
  window.setInterval(() => {
    void monitorVersion();
  }, VERSION_CHECK_INTERVAL_MS);
};
