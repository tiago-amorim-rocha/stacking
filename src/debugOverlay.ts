type ConsoleLevel = 'log' | 'warn' | 'error';

interface VersionInfo {
  timestamp?: number;
  date?: string;
  buildId?: string;
  gitHash?: string;
}

const VERSION_CHECK_INTERVAL = 5000;
const VERSION_ENDPOINT = `${import.meta.env.BASE_URL}version.json`;
let versionFetchWarned = false;
const MAX_MESSAGES = 200;

let isOpen = false;
const messages: { type: ConsoleLevel; text: string; time: string }[] = [];

const originalLog = console.log;
const originalInfo = console.info;
const originalDebug = console.debug;
const originalWarn = console.warn;
const originalError = console.error;

let output: HTMLDivElement | null = null;
let versionLabel: HTMLSpanElement | null = null;
let currentVersion: VersionInfo | null = null;
let reloadScheduled = false;
let headerDebugLogged = false;

const serializeArg = (arg: unknown): string => {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`;
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg);
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

const renderMessages = (): void => {
  if (!output) return;

  const visibleMessages = messages;
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
  const versionUrl = new URL(VERSION_ENDPOINT, window.location.href);
  versionUrl.searchParams.set('t', String(Date.now()));

  const response = await fetch(versionUrl.toString(), {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });

  if (!response.ok) {
    throw new Error(`version request failed (${response.status})`);
  }

  if (!headerDebugLogged) {
    headerDebugLogged = true;
    console.log('🛰️ Version response headers', {
      url: versionUrl.toString(),
      cacheControl: response.headers.get('cache-control'),
      age: response.headers.get('age'),
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      xCache: response.headers.get('x-cache') ?? response.headers.get('cf-cache-status'),
    });
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

      if (!reloadScheduled) {
        reloadScheduled = true;
        window.setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!versionFetchWarned) {
      console.warn('Version metadata unavailable; keeping current label.', message);
      versionFetchWarned = true;
    }
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
      #console-version-text {
        margin-right: 4px;
        padding: 4px 6px;
        border-radius: 6px;
        background: rgb(8 12 22 / 82%);
        color: #d1fae5;
        border: 1px solid rgb(52 211 153 / 35%);
        font: 600 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .console-toolbar button {
        border: 0;
        border-radius: 6px;
        padding: 6px 8px;
        background: #374151;
        color: #f9fafb;
      }
      #console-output { overflow: auto; white-space: pre-wrap; word-break: break-word; }
      .console-message { padding: 2px 0; }
      .console-time { color: #94a3b8; margin-right: 6px; }
      .console-warn { color: #fbbf24; }
      .console-error { color: #f87171; }
    </style>
    <button id="console-toggle" type="button" aria-label="Toggle debug console">🐛</button>
    <section id="console-panel">
      <div class="console-toolbar">
        <span id="console-version-text">📦 loading…</span>
        <button id="console-clear" type="button">Clear</button>
        <button id="console-copy" type="button">Copy</button>
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
  const copy = document.getElementById('console-copy');
  versionLabel = document.getElementById('console-version-text') as HTMLSpanElement | null;

  if (!toggle || !panel || !output || !clear || !copy) {
    originalWarn('Debug console UI not found; skipping initialization');
    return;
  }

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

  copy.addEventListener('click', async () => {
    const text = messages
      .map((msg) => `[${msg.time}] [${msg.type.toUpperCase()}] ${msg.text}`)
      .join('\n');

    if (!text) {
      console.log('ℹ️ Nothing to copy from debug console.');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      console.log(`📋 Copied ${messages.length} console messages to clipboard.`);
    } catch (error) {
      console.warn('Unable to copy console output to clipboard.', error);
    }
  });

  interceptConsole();
  updateVersionLabel();
  void checkForUpdates();
  window.setInterval(() => {
    void checkForUpdates();
  }, VERSION_CHECK_INTERVAL);
};
