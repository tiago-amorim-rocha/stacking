type ConsoleLevel = 'log' | 'warn' | 'error';

interface VersionInfo {
  timestamp?: number;
  date?: string;
  buildId?: string;
  gitHash?: string;
}

const VERSION_ENDPOINT = './version.json';
const MAX_MESSAGES = 200;
const VERSION_CHECK_INTERVAL_MS = 10_000;

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
let isOpen = false;
let currentVersion: VersionInfo | null = null;

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
        <span>${entry.text.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</span>
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
  return `Version: ${hash} (${build})`;
};

const setVersionLabel = (version: VersionInfo | null): void => {
  if (!versionTextEl) return;
  versionTextEl.textContent = formatVersionLabel(version);
};

const fetchVersion = async (): Promise<VersionInfo> => {
  const response = await fetch(VERSION_ENDPOINT, { cache: 'no-store' });
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

    if (latest.buildId !== currentVersion.buildId || latest.timestamp !== currentVersion.timestamp) {
      console.warn('New build detected. Reload to use the latest version.', {
        current: currentVersion,
        latest,
      });
      currentVersion = latest;
      setVersionLabel(currentVersion);
    }
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
};

const createUi = (): void => {
  const root = document.createElement('div');
  root.innerHTML = `
    <style>
      .dbg-toggle {
        position: fixed;
        right: 12px;
        bottom: calc(12px + env(safe-area-inset-bottom));
        z-index: 1000;
        border: 0;
        border-radius: 999px;
        padding: 10px 12px;
        background: #111827;
        color: #f9fafb;
        font: 600 14px system-ui;
      }
      .dbg-version {
        position: fixed;
        top: calc(10px + env(safe-area-inset-top));
        left: 10px;
        z-index: 999;
        padding: 6px 10px;
        border-radius: 8px;
        background: rgb(17 24 39 / 75%);
        color: #e5e7eb;
        font: 500 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .dbg-panel {
        position: fixed;
        inset: auto 0 0 0;
        z-index: 1000;
        display: none;
        flex-direction: column;
        gap: 8px;
        max-height: 45vh;
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
  monitorVersion();
  window.setInterval(monitorVersion, VERSION_CHECK_INTERVAL_MS);
};
