// Enhanced in-page debug console for mobile-friendly diagnostics
// Captures console output, timestamps it, and supports quick filtering.

let isOpen = false;
const messages = [];
const MAX_MESSAGES = 200;

const levels = {
  log: true,
  warn: true,
  error: true
};

const originalLog = console.log;
const originalInfo = console.info;
const originalDebug = console.debug;
const originalWarn = console.warn;
const originalError = console.error;

let output;
let levelStatus;

function serializeArg(arg) {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack || ''}`;
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg, null, 2);
    } catch {
      return '[Unserializable object]';
    }
  }
  return String(arg);
}

function addMessage(type, args) {
  const text = args.map(serializeArg).join(' ');
  messages.push({ type, text, time: new Date().toLocaleTimeString() });

  if (messages.length > MAX_MESSAGES) {
    messages.shift();
  }

  if (isOpen && output) {
    renderMessages();
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function filteredMessages() {
  return messages.filter((msg) => levels[msg.type]);
}

function renderMessages() {
  if (!output) return;

  const visibleMessages = filteredMessages();
  output.innerHTML = visibleMessages.map((msg) => `
    <div class="console-message console-${msg.type}">
      <span class="console-time">[${msg.time}]</span>
      <span class="console-text">${escapeHtml(msg.text)}</span>
    </div>
  `).join('');

  output.scrollTop = output.scrollHeight;

  if (levelStatus) {
    levelStatus.textContent = `Showing ${visibleMessages.length}/${messages.length}`;
  }
}

function toggleLevel(level) {
  levels[level] = !levels[level];
  const btn = document.querySelector(`[data-level="${level}"]`);
  if (btn) {
    btn.classList.toggle('active', levels[level]);
  }
  renderMessages();
}

function interceptConsole() {
  console.log = (...args) => {
    originalLog(...args);
    addMessage('log', args);
  };

  console.info = (...args) => {
    originalInfo(...args);
    addMessage('log', args);
  };

  console.debug = (...args) => {
    originalDebug(...args);
    addMessage('log', args);
  };

  console.warn = (...args) => {
    originalWarn(...args);
    addMessage('warn', args);
  };

  console.error = (...args) => {
    originalError(...args);
    addMessage('error', args);
  };
}

function init() {
  const toggle = document.getElementById('console-toggle');
  const panel = document.getElementById('console-panel');
  output = document.getElementById('console-output');
  const clear = document.getElementById('console-clear');

  if (!toggle || !panel || !output || !clear) {
    originalWarn('Debug console UI not found; skipping initialization');
    return;
  }

  levelStatus = document.getElementById('console-level-status');

  const levelButtons = document.querySelectorAll('[data-level]');
  levelButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const level = button.getAttribute('data-level');
      if (level) toggleLevel(level);
    });
    button.classList.add('active');
  });

  toggle.addEventListener('click', () => {
    isOpen = !isOpen;
    panel.style.display = isOpen ? 'flex' : 'none';
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
}

export { init };
