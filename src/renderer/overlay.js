const api = window.nova;

const state = {
  context: null,
  system: null,
  status: "Ready.",
  loadingStats: false,
  focusedKey: "",
  lastButtons: new Map(),
  navDirection: "",
  navLastAt: 0,
  navRepeats: 0
};

const root = document.querySelector("#overlayRoot");

init();

async function init() {
  bindEvents();
  if (api && api.onOverlayContext) {
    api.onOverlayContext((context) => {
      state.context = normalizeContext(context);
      render();
    });
  }

  await loadContext();
  await refreshStats();
  setInterval(refreshStats, 2500);
  startGamepadLoop();
}

function bindEvents() {
  root.addEventListener("click", handleClick);
  window.addEventListener("keydown", handleKeyDown);
}

async function loadContext() {
  try {
    state.context = normalizeContext(await api.getOverlayContext());
  } catch {
    state.context = normalizeContext();
  }
  render();
}

async function refreshStats() {
  if (state.loadingStats || !api || !api.getSystemSnapshot) {
    return;
  }

  state.loadingStats = true;
  try {
    state.system = normalizeSystemSnapshot(await api.getSystemSnapshot());
  } catch {
    state.status = "System stats unavailable.";
  } finally {
    state.loadingStats = false;
  }
  render();
}

function render() {
  const context = state.context || normalizeContext();
  const game = context.currentGame;
  const profile = context.currentProfile || {};
  const system = state.system || getEmptySystemSnapshot();
  const usage = system.usage || {};
  const memory = usage.memory || {};
  const cpuPercent = clampNumber(usage.cpuPercent, 0, 0, 100);
  const memoryPercent = clampNumber(memory.percent, 0, 0, 100);
  const novaMemory = usage.novaMemoryBytes || 0;
  const update = context.updateStatus || {};
  const gameTitle = game ? game.title : "Nova Deck";
  const sourceLabel = game ? game.source : "System";
  const artworkClass = game && game.artworkUrl ? " has-image" : "";

  root.innerHTML = `
    <section class="overlay-panel">
      <header class="overlay-head">
        <div>
          <span>Nova Overlay</span>
          <strong>${escapeHtml(gameTitle)}</strong>
        </div>
        <button class="icon-button" data-action="close" aria-label="Close overlay">X</button>
      </header>

      <section class="game-strip">
        <div class="game-art${artworkClass}">
          ${game && game.artworkUrl ? `<img src="${escapeHtml(game.artworkUrl)}" alt="">` : `<b>${escapeHtml(getInitials(gameTitle))}</b>`}
        </div>
        <div class="game-copy">
          <p>${escapeHtml(sourceLabel)}</p>
          <strong>${escapeHtml(gameTitle)}</strong>
          <span>${escapeHtml(profile.accountLabel || profile.profileName || "Default profile")}</span>
        </div>
      </section>

      <section class="usage-grid">
        ${renderUsageTile("CPU", cpuPercent, `${Math.round(cpuPercent)}%`)}
        ${renderUsageTile("Memory", memoryPercent, `${Math.round(memoryPercent)}%`)}
        ${renderInfoTile("Nova", novaMemory ? formatBytes(novaMemory) : "Live")}
        ${renderInfoTile("Apps", String(context.libraryCount || 0))}
      </section>

      <section class="status-grid">
        ${renderStatusTile("Controller", context.controllerLabel)}
        ${renderStatusTile("Wheel", context.wheelLabel)}
        ${renderStatusTile("Input", context.inputLabel)}
        ${renderStatusTile("Audio", context.audioLabel)}
      </section>

      <section class="action-grid">
        <button class="overlay-action primary" data-action="play"${game ? "" : " disabled"}>Play</button>
        <button class="overlay-action" data-action="main" data-main-action="home">Home</button>
        <button class="overlay-action" data-action="main" data-main-action="library">Apps</button>
        <button class="overlay-action" data-action="main" data-main-action="settings">Settings</button>
        <button class="overlay-action" data-action="main" data-main-action="task-manager">Task Manager</button>
        <button class="overlay-action" data-action="main" data-main-action="scan">Scan</button>
        <button class="overlay-action" data-action="main" data-main-action="fullscreen">Fullscreen</button>
        <button class="overlay-action" data-action="refresh">Refresh</button>
      </section>

      <section class="power-row">
        <button class="overlay-action compact" data-action="power" data-power-action="restart-app">Restart App</button>
        <button class="overlay-action compact" data-action="power" data-power-action="sleep">Sleep</button>
        <button class="overlay-action compact" data-action="close">Hide</button>
      </section>

      <footer class="overlay-foot">
        <span>${escapeHtml(state.status)}</span>
        <b>${escapeHtml(getUpdateLabel(update))}</b>
      </footer>
    </section>
  `;

  restoreFocus();
}

function renderUsageTile(label, percent, value) {
  const safePercent = clampNumber(percent, 0, 0, 100);
  return `
    <div class="usage-tile" style="--value:${safePercent}%">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <i></i>
    </div>
  `;
}

function renderInfoTile(label, value) {
  return `
    <div class="usage-tile static">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <i></i>
    </div>
  `;
}

function renderStatusTile(label, value) {
  return `
    <div class="status-tile">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "Default")}</strong>
    </div>
  `;
}

async function handleClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) {
    return;
  }

  const action = button.dataset.action;
  if (action === "close") {
    await api.hideOverlay();
  } else if (action === "play") {
    await playCurrentGame();
  } else if (action === "main") {
    await api.runOverlayAction(button.dataset.mainAction || "home");
  } else if (action === "refresh") {
    state.status = "Refreshing.";
    await refreshStats();
  } else if (action === "power") {
    await api.runPowerAction(button.dataset.powerAction || "");
  }
}

async function playCurrentGame() {
  state.status = "Launching.";
  render();
  const result = await api.launchOverlayGame();
  state.status = result && result.message ? result.message : "Launch request sent.";
  render();
}

function handleKeyDown(event) {
  if (event.key === "Escape" || event.key === "Backspace") {
    event.preventDefault();
    api.hideOverlay();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    const focused = getFocusedElement() || getFocusableElements()[0];
    if (focused) {
      setFocus(focused);
      focused.click();
    }
    return;
  }

  const directions = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right"
  };
  if (directions[event.key]) {
    event.preventDefault();
    moveFocus(directions[event.key]);
  }
}

function startGamepadLoop() {
  const step = () => {
    pollGamepad();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function pollGamepad() {
  if (!navigator.getGamepads) {
    return;
  }

  const gamepad = Array.from(navigator.getGamepads()).filter(Boolean)[0];
  if (!gamepad) {
    state.lastButtons.clear();
    resetNavigation();
    return;
  }

  const nav = readNavigation(gamepad);
  if (nav) {
    const now = performance.now();
    const changed = nav !== state.navDirection;
    const delay = changed ? 0 : state.navRepeats === 0 ? 240 : 120;
    if (changed || now - state.navLastAt >= delay) {
      moveFocus(nav);
      state.navDirection = nav;
      state.navLastAt = now;
      state.navRepeats = changed ? 0 : state.navRepeats + 1;
    }
  } else {
    resetNavigation();
  }

  onButtonPress(gamepad, 0, () => {
    const focused = getFocusedElement() || getFocusableElements()[0];
    if (focused) {
      setFocus(focused);
      focused.click();
    }
  });
  onButtonPress(gamepad, 1, () => api.hideOverlay());
  onButtonPress(gamepad, 2, refreshStats);
  onButtonPress(gamepad, 3, playCurrentGame);
}

function readNavigation(gamepad) {
  const dpadX = (isPressed(gamepad, 15) ? 1 : 0) - (isPressed(gamepad, 14) ? 1 : 0);
  const dpadY = (isPressed(gamepad, 13) ? 1 : 0) - (isPressed(gamepad, 12) ? 1 : 0);
  const axisX = applyDeadzone(Number(gamepad.axes[0] || 0), 0.45);
  const axisY = applyDeadzone(Number(gamepad.axes[1] || 0), 0.45);
  const x = dpadX || axisX;
  const y = dpadY || axisY;
  if (!x && !y) {
    return "";
  }
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : (y > 0 ? "down" : "up");
}

function onButtonPress(gamepad, buttonIndex, callback) {
  const key = `${gamepad.index}:${buttonIndex}`;
  const pressed = isPressed(gamepad, buttonIndex);
  const wasPressed = state.lastButtons.get(key) || false;
  if (pressed && !wasPressed) {
    callback();
  }
  state.lastButtons.set(key, pressed);
}

function moveFocus(direction) {
  const controls = getFocusableElements();
  if (!controls.length) {
    return;
  }

  const current = getFocusedElement() || controls[0];
  const next = findDirectionalFocus(current, controls, direction);
  setFocus(next || current);
}

function findDirectionalFocus(current, controls, direction) {
  const currentRect = current.getBoundingClientRect();
  const currentCenter = getCenter(currentRect);
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const control of controls) {
    if (control === current) {
      continue;
    }

    const rect = control.getBoundingClientRect();
    const center = getCenter(rect);
    const dx = center.x - currentCenter.x;
    const dy = center.y - currentCenter.y;
    if ((direction === "right" && dx <= 4)
      || (direction === "left" && dx >= -4)
      || (direction === "down" && dy <= 4)
      || (direction === "up" && dy >= -4)) {
      continue;
    }

    const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
    const secondary = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 1.8;
    if (score < bestScore) {
      best = control;
      bestScore = score;
    }
  }

  return best;
}

function getFocusableElements() {
  return Array.from(root.querySelectorAll("button"))
    .filter((element) => !element.disabled && element.offsetWidth > 0 && element.offsetHeight > 0);
}

function getFocusedElement() {
  return getFocusableElements().find((element) => element.dataset.focusKey === state.focusedKey) || null;
}

function setFocus(element) {
  root.querySelectorAll(".focused").forEach((control) => control.classList.remove("focused"));
  state.focusedKey = getFocusKey(element);
  element.dataset.focusKey = state.focusedKey;
  element.classList.add("focused");
  element.focus({ preventScroll: true });
}

function restoreFocus() {
  const controls = getFocusableElements();
  if (!controls.length) {
    return;
  }

  controls.forEach((control) => {
    control.dataset.focusKey = getFocusKey(control);
  });

  const preferred = controls.find((control) => control.dataset.focusKey === state.focusedKey) || controls[0];
  setFocus(preferred);
}

function getFocusKey(element) {
  if (!element) {
    return "";
  }
  return `${element.dataset.action || ""}:${element.dataset.mainAction || ""}:${element.dataset.powerAction || ""}`;
}

function resetNavigation() {
  state.navDirection = "";
  state.navLastAt = 0;
  state.navRepeats = 0;
}

function isPressed(gamepad, buttonIndex) {
  return Boolean(gamepad.buttons[buttonIndex] && gamepad.buttons[buttonIndex].pressed);
}

function applyDeadzone(value, deadzone) {
  return Math.abs(value) >= deadzone ? value : 0;
}

function normalizeContext(context = {}) {
  const input = context && typeof context === "object" ? context : {};
  return {
    currentGame: input.currentGame || null,
    currentProfile: input.currentProfile || {},
    activeView: text(input.activeView, "home"),
    libraryCount: positiveInteger(input.libraryCount),
    controllerLabel: text(input.controllerLabel, "Disconnected"),
    wheelLabel: text(input.wheelLabel, "No wheel"),
    inputLabel: text(input.inputLabel, "Game default"),
    themeLabel: text(input.themeLabel, "Nova"),
    audioLabel: text(input.audioLabel, "System default"),
    updateStatus: input.updateStatus || {},
    version: text(input.version, "")
  };
}

function normalizeSystemSnapshot(snapshot = {}) {
  const input = snapshot && typeof snapshot === "object" ? snapshot : {};
  const usage = input.usage && typeof input.usage === "object" ? input.usage : {};
  const memory = usage.memory && typeof usage.memory === "object" ? usage.memory : {};
  return {
    usage: {
      cpuPercent: clampNumber(usage.cpuPercent, 0, 0, 100),
      novaMemoryBytes: positiveInteger(usage.novaMemoryBytes),
      memory: {
        percent: clampNumber(memory.percent, 0, 0, 100)
      }
    }
  };
}

function getEmptySystemSnapshot() {
  return {
    usage: {
      cpuPercent: 0,
      novaMemoryBytes: 0,
      memory: {
        percent: 0
      }
    }
  };
}

function getUpdateLabel(update) {
  if (!update || !update.status || update.status === "idle") {
    return "Updates idle";
  }
  if (update.version) {
    return `${update.status}: ${update.version}`;
  }
  return String(update.message || update.status);
}

function getCenter(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function getInitials(title) {
  return String(title || "ND")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "ND";
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "0 MB";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function text(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
