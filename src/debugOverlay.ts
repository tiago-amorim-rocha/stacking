type ConsoleLevel = 'log' | 'warn' | 'error';

interface VersionInfo {
  timestamp?: number;
  date?: string;
  buildId?: string;
  gitHash?: string;
}

const VERSION_CHECK_INTERVAL = 5000;
const VERSION_ENDPOINT = new URL('version.json', window.location.href).toString();
const MAX_MESSAGES = 200;

let isOpen = false;
const messages: { type: ConsoleLevel; text: string; time: string }[] = [];

const levels: Record<ConsoleLevel, boolean> = {
  log: true,
  warn: true,
  error: true,
};

const originalLog = console.log;
const originalInfo = console.info;
const originalDebug = console.debug;
const originalWarn = console.warn;
const originalError = console.error;

let output: HTMLDivElement | null = null;
let levelStatus: HTMLSpanElement | null = null;
let versionLabel: HTMLSpanElement | null = null;
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

const escapeHtml = (text: string): string => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

const addMessage = (type: ConsoleLevel, args: unknown[]): void => {
  const text = args.map(serializeArg).join(' ');
  messages.push({ type, text, time: new Date().toLocaleTimeString() });

  if (messages.length > MAX_MESSAGES) {
    messages.shift();
  }

  if (isOpen && output) {
    renderMessages();
  }
};

const filteredMessages = (): { type: ConsoleLevel; text: string; time: string }[] => {
  return messages.filter((msg) => levels[msg.type]);
};

const renderMessages = (): void => {
  if (!output) return;

  const visibleMessages = filteredMessages();
  output.innerHTML = visibleMessages
    .map(
      (msg) => `
    <div class="console-message console-${msg.type}">
      <span class="console-time">[${msg.time}]</span>
      <span class="console-text">${escapeHtml(msg.text)}</span>
    </div>
  `,
    )
    .join('');

  output.scrollTop = output.scrollHeight;

  if (levelStatus) {
    levelStatus.textContent = `Showing ${visibleMessages.length}/${messages.length}`;
  }
};

const toggleLevel = (level: ConsoleLevel): void => {
  levels[level] = !levels[level];
  const btn = document.querySelector<HTMLButtonElement>(`[data-level="${level}"]`);
  if (btn) {
    btn.classList.toggle('active', levels[level]);
  }
  renderMessages();
};

const formatVersion = (version: VersionInfo | null): string => {
  if (!version) return 'unknown';
  const hash = version.gitHash ?? 'no-hash';
  const date = version.date ? new Date(version.date).toLocaleString() : 'no-date';
  return `${hash} @ ${date}`;
};

const updateVersionLabel = (): void => {
  if (!versionLabel) return;
  versionLabel.textContent = `📦 ${formatVersion(currentVersion)}`;
};

const fetchVersionInfo = async (): Promise<VersionInfo> => {
  const response = await fetch(VERSION_ENDPOINT, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });

  if (!response.ok) {
    throw new Error(`version request failed (${response.status})`);
  }

  return response.json() as Promise<VersionInfo>;
};

const checkForUpdates = async (): Promise<void> => {
  try {
    const latestVersion = await fetchVersionInfo();

    if (!currentVersion) {
      currentVersion = latestVersion;
      updateVersionLabel();
      return;
    }

    const hasUpdate =
      latestVersion.buildId !== currentVersion.buildId || latestVersion.timestamp !== currentVersion.timestamp;

    if (hasUpdate) {
      console.warn('🔄 New version detected', {
        current: formatVersion(currentVersion),
        latest: formatVersion(latestVersion),
      });
      currentVersion = latestVersion;
      updateVersionLabel();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.debug('Version check failed:', message);
  }
};

const interceptConsole = (): void => {
  console.log = (...args: unknown[]) => {
    originalLog(...args);
    addMessage('log', args);
  };

  console.info = (...args: unknown[]) => {
    originalInfo(...args);
    addMessage('log', args);
  };

  console.debug = (...args: unknown[]) => {
    originalDebug(...args);
    addMessage('log', args);
  };

  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    addMessage('warn', args);
  };

  console.error = (...args: unknown[]) => {
    originalError(...args);
    addMessage('error', args);
  };
};

const injectUi = (): void => {
  const root = document.createElement('div');
  root.id = 'debug-console-root';
  root.innerHTML = `
    <style>
      #console-version-label {
        position: fixed;
        left: 12px;
        top: calc(12px + env(safe-area-inset-top));
        z-index: 1000;
        padding: 8px 10px;
        border-radius: 8px;
        background: rgb(8 12 22 / 82%);
        color: #d1fae5;
        border: 1px solid rgb(52 211 153 / 35%);
        font: 600 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      #console-toggle {
        position: fixed;
        right: 12px;
        bottom: calc(12px + env(safe-area-inset-bottom));
        z-index: 1001;
        border: 0;
        border-radius: 999px;
        width: 44px;
        height: 44px;
        background: #111827;
        color: #f9fafb;
        font-size: 18px;
      }
      #console-panel {
        position: fixed;
        inset: auto 0 0 0;
        max-height: 46vh;
        z-index: 1000;
        display: none;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        background: rgb(0 0 0 / 88%);
        color: #f8fafc;
        font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .console-toolbar { display: flex; align-items: center; gap: 6px; }
      .console-toolbar button {
        border: 0;
        border-radius: 6px;
        padding: 6px 8px;
        background: #374151;
        color: #f9fafb;
      }
      .console-toolbar button.active { background: #059669; }
      #console-level-status { margin-left: auto; color: #94a3b8; }
      #console-output { overflow: auto; white-space: pre-wrap; word-break: break-word; }
      .console-message { padding: 2px 0; }
      .console-time { color: #94a3b8; margin-right: 6px; }
      .console-warn { color: #fbbf24; }
      .console-error { color: #f87171; }
    </style>
    <div id="console-version-label"><span id="console-version-text">📦 loading…</span></div>
    <button id="console-toggle" type="button" aria-label="Toggle debug console">🐛</button>
    <section id="console-panel">
      <div class="console-toolbar">
        <button type="button" data-level="log">Log</button>
        <button type="button" data-level="warn">Warn</button>
        <button type="button" data-level="error">Error</button>
        <button id="console-clear" type="button">Clear</button>
        <span id="console-level-status"></span>
      </div>
      <div id="console-output"></div>
    </section>
  `;

  document.body.append(root);
};

export const initDebugOverlay = (): void => {
  injectUi();

  const toggle = document.getElementById('console-toggle');
  const panel = document.getElementById('console-panel');
  output = document.getElementById('console-output') as HTMLDivElement | null;
  const clear = document.getElementById('console-clear');
  levelStatus = document.getElementById('console-level-status') as HTMLSpanElement | null;
  versionLabel = document.getElementById('console-version-text') as HTMLSpanElement | null;

  if (!toggle || !panel || !output || !clear) {
    originalWarn('Debug console UI not found; skipping initialization');
    return;
  }

  const levelButtons = document.querySelectorAll<HTMLButtonElement>('[data-level]');
  levelButtons.forEach((button) => {
    button.classList.add('active');
    button.addEventListener('click', () => {
      const level = button.getAttribute('data-level') as ConsoleLevel | null;
      if (level) toggleLevel(level);
    });
  });

  toggle.addEventListener('click', () => {
    isOpen = !isOpen;
    (panel as HTMLElement).style.display = isOpen ? 'flex' : 'none';
    toggle.textContent = isOpen ? '✕' : '🐛';

    if (isOpen) {
      renderMessages();
    }
  });

  clear.addEventListener('click', () => {
    messages.length = 0;
    renderMessages();
  });

  interceptConsole();
  updateVersionLabel();
  void checkForUpdates();
  window.setInterval(() => {
    void checkForUpdates();
  }, VERSION_CHECK_INTERVAL);
};
