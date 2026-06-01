const DEFAULT_CONTROLLER_SETTINGS = {
  deadzone: 0.55,
  repeatDelay: 180,
  mappings: {
    confirm: { label: "Confirm / Launch", buttons: [0] },
    back: { label: "Back / Clear Search", buttons: [1] },
    search: { label: "Focus Search", buttons: [2] },
    scan: { label: "Rescan Library", buttons: [3] },
    fullscreen: { label: "Toggle Fullscreen", buttons: [9] },
    home: { label: "Home View", buttons: [8] },
    library: { label: "Apps View", buttons: [4] },
    settings: { label: "Settings View", buttons: [5] }
  }
};

const CONTROLLER_BUTTON_NAMES = {
  0: "A / Cross",
  1: "B / Circle",
  2: "X / Square",
  3: "Y / Triangle",
  4: "LB / L1",
  5: "RB / R1",
  6: "LT / L2",
  7: "RT / R2",
  8: "View / Share",
  9: "Menu / Options",
  10: "Left Stick",
  11: "Right Stick",
  12: "D-pad Up",
  13: "D-pad Down",
  14: "D-pad Left",
  15: "D-pad Right",
  16: "Guide"
};

const VIRTUAL_KEY_CODES = {
  "key:W": 0x57,
  "key:A": 0x41,
  "key:S": 0x53,
  "key:D": 0x44,
  "key:Space": 0x20,
  "key:Shift": 0x10,
  "key:Control": 0x11,
  "key:Tab": 0x09,
  "key:Enter": 0x0d,
  "key:E": 0x45,
  "key:Q": 0x51,
  "key:R": 0x52,
  "key:F": 0x46,
  "key:C": 0x43,
  "key:X": 0x58,
  "key:Z": 0x5a,
  "key:I": 0x49,
  "key:M": 0x4d,
  "key:F3": 0x72,
  "key:F5": 0x74,
  "key:Escape": 0x1b,
  "key:Up": 0x26,
  "key:Down": 0x28,
  "key:Left": 0x25,
  "key:Right": 0x27,
  "key:1": 0x31,
  "key:2": 0x32,
  "key:3": 0x33,
  "key:4": 0x34,
  "key:5": 0x35,
  "key:6": 0x36,
  "key:7": 0x37,
  "key:8": 0x38,
  "key:9": 0x39
};

const DEFAULT_APP_SETTINGS = {
  audioOutputId: "default",
  audioOutputLabel: "System default",
  startView: "home",
  rescanOnStart: true,
  reduceMotion: false,
  showHiddenLaunchers: false
};

const INPUT_BRIDGE_KINDS = new Set(["minecraft-java-bridge", "universal-controller-bridge"]);
const INPUT_BRIDGE_PREFIXES = ["java_bridge.", "universal_bridge."];

const state = {
  games: [],
  filteredGames: [],
  selectedIndex: 0,
  activeView: "home",
  sourceFilter: "All",
  search: "",
  scanning: false,
  controllerName: "",
  controllerSettings: cloneControllerSettings(DEFAULT_CONTROLLER_SETTINGS),
  appSettings: cloneSettings(DEFAULT_APP_SETTINGS),
  startupEnabled: false,
  audioOutputs: [],
  updateStatus: {
    status: "idle",
    message: "Updates have not been checked yet.",
    canCheck: true,
    canInstall: false,
    percent: 0,
    version: "",
    transferredBytes: 0,
    totalBytes: 0
  },
  appPreferences: null,
  javaBridgeProfile: null,
  javaBridgeNativeActive: false,
  javaBridgeHeldInputs: new Map(),
  javaBridgeButtonStates: new Map(),
  javaBridgeLookX: 0,
  javaBridgeLookY: 0,
  javaBridgeMouseCarryX: 0,
  javaBridgeMouseCarryY: 0,
  mappingCaptureAction: "",
  capturePrimedButtons: new Set(),
  captureStartedAt: 0,
  controllerSaveTimer: null,
  appSettingsSaveTimer: null,
  gamePreferenceSaveTimer: null,
  isFullscreen: false,
  meta: null,
  lastButtons: new Map(),
  lastAxisMove: 0,
  controllerFocusKey: "",
  toastTimer: null
};

const api = window.nova || createPreviewApi();

const elements = {
  systemLine: document.querySelector("#systemLine"),
  heroPanel: document.querySelector("#heroPanel"),
  heroSource: document.querySelector("#heroSource"),
  heroTitle: document.querySelector("#heroTitle"),
  heroPath: document.querySelector("#heroPath"),
  launchButton: document.querySelector("#launchButton"),
  removeButton: document.querySelector("#removeButton"),
  gameGrid: document.querySelector("#gameGrid"),
  searchInput: document.querySelector("#searchInput"),
  scanButton: document.querySelector("#scanButton"),
  addButton: document.querySelector("#addButton"),
  fullscreenButton: document.querySelector("#fullscreenButton"),
  libraryCount: document.querySelector("#libraryCount"),
  viewTitle: document.querySelector("#viewTitle"),
  controllerStatus: document.querySelector("#controllerStatus"),
  sourceStatus: document.querySelector("#sourceStatus"),
  activityText: document.querySelector("#activityText"),
  clockText: document.querySelector("#clockText"),
  toast: document.querySelector("#toast")
};

init();

async function init() {
  bindEvents();
  startClock();
  startGamepadLoop();
  await loadMeta();
  await loadControllerSettings();
  await loadAppSettings();
  await loadStartupState();
  await loadAudioOutputs();
  await loadUpdateStatus();
  state.isFullscreen = await api.isFullscreen();
  renderFullscreenButton();
  if (state.appSettings.startView !== "home") {
    state.activeView = state.appSettings.startView;
    document.querySelectorAll(".rail-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === state.activeView);
    });
  }
  await scanLibrary();
}

function bindEvents() {
  elements.scanButton.addEventListener("click", scanLibrary);
  elements.addButton.addEventListener("click", addGame);
  elements.fullscreenButton.addEventListener("click", toggleFullscreen);
  elements.launchButton.addEventListener("click", launchSelectedGame);
  elements.removeButton.addEventListener("click", removeSelectedGame);

  elements.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    state.selectedIndex = 0;
    applyFilters();
    render();
  });

  document.querySelectorAll(".rail-button").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  elements.gameGrid.addEventListener("click", handleContentClick);
  elements.gameGrid.addEventListener("input", handleContentInput);
  elements.gameGrid.addEventListener("change", handleContentChange);
  elements.gameGrid.addEventListener("dblclick", (event) => {
    if (event.target.closest(".game-card")) {
      launchSelectedGame();
    }
  });
  elements.gameGrid.addEventListener("error", handleImageError, true);

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("gamepadconnected", (event) => {
    state.controllerName = event.gamepad.id;
    renderController();
  });
  window.addEventListener("gamepaddisconnected", () => {
    state.controllerName = "";
    releaseJavaBridgeInputs();
    renderController();
  });
  window.addEventListener("beforeunload", () => {
    releaseJavaBridgeInputs();
    if (api.clearInputBridgeProfile) {
      api.clearInputBridgeProfile();
    }
  });

  api.onFullscreenChanged((isFullscreen) => {
    state.isFullscreen = isFullscreen;
    renderFullscreenButton();
  });

  api.onUpdateStatus((status) => {
    state.updateStatus = normalizeUpdateStatus(status);
    if (state.activeView === "settings") {
      render();
    }
  });
}

async function loadMeta() {
  const meta = await api.getMeta();
  state.meta = meta;
  elements.systemLine.textContent = `v${meta.version}`;
}

async function loadControllerSettings() {
  try {
    const settings = await api.getControllerSettings();
    state.controllerSettings = normalizeControllerSettings(settings);
  } catch {
    state.controllerSettings = cloneControllerSettings(DEFAULT_CONTROLLER_SETTINGS);
  }
}

async function loadAppSettings() {
  try {
    const settings = await api.getAppSettings();
    state.appSettings = normalizeAppSettings(settings);
  } catch {
    state.appSettings = cloneSettings(DEFAULT_APP_SETTINGS);
  }
}

async function loadStartupState() {
  try {
    state.startupEnabled = await api.getStartupEnabled();
  } catch {
    state.startupEnabled = false;
  }
}

async function loadAudioOutputs() {
  const fallback = [{ deviceId: "default", label: "System default" }];
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    state.audioOutputs = fallback;
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices
      .filter((device) => device.kind === "audiooutput")
      .map((device) => ({
        deviceId: device.deviceId || "default",
        label: device.label || (device.deviceId === "default" ? "System default" : "Audio output")
      }));
    state.audioOutputs = ensureDefaultAudioOutput(outputs.length ? outputs : fallback);
  } catch {
    state.audioOutputs = fallback;
  }
}

async function loadUpdateStatus() {
  try {
    state.updateStatus = normalizeUpdateStatus(await api.getUpdateStatus());
  } catch {
    state.updateStatus = normalizeUpdateStatus();
  }
}

async function scanLibrary() {
  state.scanning = true;
  elements.activityText.textContent = "Scanning local library...";
  renderLoading();

  try {
    state.games = await api.scanLibrary();
    state.scanning = false;
    state.selectedIndex = 0;
    applyFilters();
    render();
    elements.activityText.textContent = "Ready.";
    showToast(`Found ${state.games.length} local games.`);
  } catch (error) {
    state.scanning = false;
    elements.activityText.textContent = "Scan failed.";
    showToast(error.message || "Scan failed.");
    render();
  }
}

async function addGame() {
  const game = await api.addGame();
  if (!game) {
    return;
  }

  state.games = await api.scanLibrary();
  state.search = "";
  elements.searchInput.value = "";
  applyFilters();
  state.selectedIndex = Math.max(0, state.filteredGames.findIndex((entry) => entry.id === game.id));
  render();
  showToast(`${game.title} added.`);
}

async function removeSelectedGame() {
  const game = getSelectedGame();
  if (!game || !game.custom) {
    return;
  }

  await api.removeCustomGame(game.id);
  state.games = state.games.filter((entry) => entry.id !== game.id);
  state.selectedIndex = Math.max(0, state.selectedIndex - 1);
  applyFilters();
  render();
  showToast(`${game.title} removed.`);
}

async function launchSelectedGame() {
  const game = getSelectedGame();
  if (!game || state.activeView === "settings") {
    return;
  }

  elements.launchButton.disabled = true;
  elements.activityText.textContent = `Launching ${game.title}...`;
  await loadGameBridgeProfile(game);
  const result = await api.launchGame(game);
  elements.launchButton.disabled = false;

  if (result.ok) {
    showToast(result.message);
    elements.activityText.textContent = "Launch request sent.";
  } else {
    showToast(result.message || "Launch failed.");
    elements.activityText.textContent = "Launch failed.";
  }
}

async function toggleFullscreen() {
  state.isFullscreen = await api.toggleFullscreen();
  renderFullscreenButton();
}

function setView(view, focusPreferred = false) {
  state.activeView = view;
  if (view !== "library") {
    state.sourceFilter = "All";
  }

  document.querySelectorAll(".rail-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  state.selectedIndex = 0;
  render();
  if (focusPreferred) {
    focusPreferredControl();
  }
}

function applyFilters() {
  const query = state.search.trim().toLowerCase();

  state.filteredGames = state.games.filter((game) => {
    const matchesQuery = !query || `${game.title} ${game.source} ${game.launchType}`.toLowerCase().includes(query);
    return matchesQuery;
  });

  if (state.selectedIndex >= state.filteredGames.length) {
    state.selectedIndex = Math.max(0, state.filteredGames.length - 1);
  }
}

function renderLoading() {
  elements.heroPanel.classList.remove("has-artwork");
  elements.heroPanel.style.removeProperty("--hero-artwork");
  elements.heroSource.textContent = "Library";
  elements.heroTitle.textContent = "Scanning...";
  elements.heroPath.textContent = "Checking local launchers, shortcuts, folders, and installed apps.";
  elements.launchButton.disabled = true;
  elements.removeButton.classList.add("hidden");
  elements.libraryCount.textContent = "Scanning";
  elements.gameGrid.innerHTML = "";
}

function render() {
  applyFilters();
  document.body.classList.toggle("settings-mode", state.activeView === "settings");
  document.body.classList.toggle("apps-mode", state.activeView === "library");
  document.body.classList.toggle("reduce-motion", Boolean(state.appSettings.reduceMotion));
  renderHero();
  renderContent();
  renderController();
  renderViewTitle();
  renderFullscreenButton();
  restoreControllerFocus();
}

function renderHero() {
  if (state.activeView === "settings") {
    elements.heroPanel.classList.remove("has-artwork");
    elements.heroPanel.style.removeProperty("--hero-artwork");
    elements.heroSource.textContent = "System";
    elements.heroTitle.textContent = "Settings";
    elements.heroPath.textContent = "Tune detection, controller mapping, display, and local folders.";
    elements.launchButton.disabled = true;
    elements.removeButton.classList.add("hidden");
    elements.sourceStatus.textContent = "Local";
    return;
  }

  const game = getSelectedGame();
  elements.launchButton.disabled = !game;
  elements.removeButton.classList.toggle("hidden", !game || !game.custom);

  if (!game) {
    elements.heroPanel.classList.remove("has-artwork");
    elements.heroPanel.style.removeProperty("--hero-artwork");
    elements.heroSource.textContent = "Library";
    elements.heroTitle.textContent = state.scanning ? "Scanning..." : "No Games Found";
    elements.heroPath.textContent = state.scanning
      ? "Checking local launchers, shortcuts, folders, and installed apps."
      : "Add a game manually or rescan after installing games.";
    elements.sourceStatus.textContent = "Local";
    return;
  }

  elements.heroSource.textContent = game.source;
  elements.heroTitle.textContent = game.title;
  elements.heroPath.textContent = game.installPath || game.launchTarget || "Local game";
  elements.sourceStatus.textContent = game.source;

  if (shouldUseHeroArtwork(game)) {
    elements.heroPanel.classList.add("has-artwork");
    elements.heroPanel.style.setProperty("--hero-artwork", `url("${game.artworkUrl.replaceAll('"', '\\"')}")`);
  } else {
    elements.heroPanel.classList.remove("has-artwork");
    elements.heroPanel.style.removeProperty("--hero-artwork");
  }
}

function renderContent() {
  if (state.activeView === "settings") {
    renderSettings();
  } else if (state.activeView === "home") {
    renderHome();
  } else {
    renderLibrary();
  }
}

function renderHome() {
  elements.libraryCount.textContent = `${state.games.length} ${state.games.length === 1 ? "game" : "games"} detected`;

  if (state.games.length === 0) {
    renderEmptyState();
    return;
  }

  const sources = getSourceStats();
  const featuredGames = state.filteredGames.slice(0, 8);
  elements.gameGrid.innerHTML = `
    <div class="home-dashboard">
      <section class="summary-strip">
        ${sources.map((source) => `
          <div class="source-summary">
            <strong>${source.count}</strong>
            <span>${escapeHtml(source.name)}</span>
          </div>
        `).join("")}
      </section>
      <section class="section-block">
        <div class="section-title">
          <strong>Ready To Launch</strong>
          <span>${featuredGames.length} shown</span>
        </div>
        <div class="game-grid-inner home-grid-inner">
          ${featuredGames.map((game, index) => renderGameCard(game, index)).join("")}
        </div>
      </section>
    </div>
  `;
  scrollSelectedIntoView();
}

function renderLibrary() {
  elements.libraryCount.textContent = `${state.filteredGames.length} ${state.filteredGames.length === 1 ? "app" : "apps"}`;

  if (state.filteredGames.length === 0) {
    elements.gameGrid.innerHTML = `
      <div class="apps-screen">
        ${renderEmptyStateHtml()}
      </div>
    `;
    return;
  }

  const selectedGame = getSelectedGame() || state.filteredGames[0];
  elements.gameGrid.innerHTML = `
    <div class="apps-screen">
      ${renderSelectedAppPanel(selectedGame)}
      ${renderAppPreferencesPanel(selectedGame)}
      <div class="apps-grid-inner">
        ${state.filteredGames.map((game, index) => renderGameCard(game, index)).join("")}
      </div>
    </div>
  `;
  if (state.appPreferences && state.appPreferences.gameId === selectedGame.id) {
    scrollPreferencesIntoView();
  } else {
    scrollSelectedIntoView();
  }
}

function renderSelectedAppPanel(game) {
  const hasImage = Boolean(game && game.artworkUrl);
  const artworkType = getArtworkType(game);
  return `
    <section class="apps-feature-panel">
      <div class="apps-feature-art ${artworkType}${hasImage ? " has-image" : ""}">
        ${hasImage ? `<img src="${escapeHtml(game.artworkUrl)}" alt="">` : `<span>${escapeHtml(getInitials(game.title))}</span>`}
      </div>
      <div class="apps-feature-copy">
        <p>${escapeHtml(game.source || "App")}</p>
        <strong>${escapeHtml(game.title)}</strong>
        <span>${escapeHtml(game.installPath || game.launchTarget || "Local app")}</span>
      </div>
      <div class="apps-feature-actions">
        <button class="app-action-card play-card" data-action="play-selected">
          <span>Play</span>
          <strong>${escapeHtml(game.title)}</strong>
        </button>
        <button class="app-action-card preferences-card" data-action="app-preferences">
          <span>Preferences</span>
          <strong>Per-app settings</strong>
        </button>
      </div>
    </section>
  `;
}

function renderAppPreferencesPanel(game) {
  const preferences = state.appPreferences;
  if (!preferences || !game || preferences.gameId !== game.id) {
    return "";
  }

  if (preferences.loading) {
    return `
      <section class="app-preferences-panel">
        <div class="app-preferences-head">
          <div>
            <p>Preferences</p>
            <strong>${escapeHtml(game.title)}</strong>
          </div>
          <button class="settings-action compact" data-action="close-app-preferences">Close</button>
        </div>
        <div class="preference-empty">Loading preferences...</div>
      </section>
    `;
  }

  const data = preferences.data || {};
  if (!data.supported) {
    return `
      <section class="app-preferences-panel">
        <div class="app-preferences-head">
          <div>
            <p>Preferences</p>
            <strong>${escapeHtml(game.title)}</strong>
          </div>
          <button class="settings-action compact" data-action="close-app-preferences">Close</button>
        </div>
        <div class="preference-empty">${escapeHtml(data.message || "No preference editor is available for this app yet.")}</div>
      </section>
    `;
  }

  if (data.status !== "ready") {
    return `
      <section class="app-preferences-panel">
        <div class="app-preferences-head">
          <div>
            <p>${escapeHtml(data.title || "Preferences")}</p>
            <strong>Controls</strong>
          </div>
          <button class="settings-action compact" data-action="close-app-preferences">Close</button>
        </div>
        <div class="preference-empty">
          <strong>${escapeHtml(data.message || "Settings file not found.")}</strong>
          <span>Open Minecraft for Windows, change one setting, close it, then return here.</span>
        </div>
      </section>
    `;
  }

  const preferencePath = data.optionsPath || "";
  const folderPath = data.folderPath || data.optionsPath || "";
  return `
    <section class="app-preferences-panel">
      <div class="app-preferences-head">
        <div>
          <p>${escapeHtml(data.title || "Minecraft for Windows")}</p>
          <strong>Controller Preferences</strong>
          <span>${escapeHtml(data.profileName || "Local profile")}</span>
        </div>
        <div class="app-preferences-actions">
          ${folderPath ? `<button class="settings-action compact" data-action="open-preferences-path" data-path="${escapeHtml(folderPath)}">Open folder</button>` : ""}
          <button class="settings-action compact" data-action="close-app-preferences">Close</button>
        </div>
      </div>
      ${data.message ? `<div class="preference-note">${escapeHtml(data.message)}</div>` : ""}
      ${data.nativeBindingSupport ? renderNativeBindingSupport(data.nativeBindingSupport) : ""}
      ${preferencePath ? `<div class="preference-path">${escapeHtml(preferencePath)}</div>` : ""}
      <div class="preference-sections">
        <div class="preference-section">
          <strong>${escapeHtml(data.controlTitle || "Gamepad Buttons")}</strong>
          <div class="preference-control-grid">
            ${(data.controls || []).map(renderPreferenceControl).join("")}
          </div>
        </div>
        <div class="preference-section compact">
          <strong>${escapeHtml(data.toggleTitle || "Gamepad Toggles")}</strong>
          <div class="preference-toggle-grid">
            ${(data.toggles || []).map(renderPreferenceToggle).join("")}
          </div>
        </div>
        <div class="preference-section compact">
          <strong>${escapeHtml(data.sliderTitle || "Feel")}</strong>
          <div class="preference-slider-list">
            ${(data.sliders || []).map(renderPreferenceSlider).join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderNativeBindingSupport(support) {
  return `
    <div class="preference-note native-binding-note">
      <strong>${support.supported ? "Native bindings" : "Native bindings unavailable"}</strong><br>
      <span>${escapeHtml(support.message || "No native binding editor is available for this game yet.")}</span>
    </div>
  `;
}

function renderPreferenceControl(control) {
  return `
    <label class="preference-control">
      <span>${escapeHtml(control.label)}</span>
      <select class="pref-select" data-pref-key="${escapeHtml(control.key)}">
        ${(control.options || []).map((option) => (
          `<option value="${escapeHtml(option.value)}"${String(option.value) === String(control.value) ? " selected" : ""}>${escapeHtml(option.label)}</option>`
        )).join("")}
      </select>
    </label>
  `;
}

function renderPreferenceToggle(toggle) {
  return `
    <button class="pref-toggle${toggle.enabled ? " enabled" : ""}" data-action="toggle-game-preference" data-pref-key="${escapeHtml(toggle.key)}" data-next-value="${toggle.enabled ? "0" : "1"}" aria-pressed="${toggle.enabled ? "true" : "false"}">
      <span>${escapeHtml(toggle.label)}</span>
      <b>${toggle.enabled ? "On" : "Off"}</b>
    </button>
  `;
}

function renderPreferenceSlider(slider) {
  const percent = Math.round(Number(slider.value || 0) * 100);
  return `
    <label class="preference-slider">
      <span>${escapeHtml(slider.label)}</span>
      <input class="pref-range" type="range" min="${escapeHtml(slider.min)}" max="${escapeHtml(slider.max)}" step="${escapeHtml(slider.step)}" value="${escapeHtml(slider.value)}" data-pref-key="${escapeHtml(slider.key)}">
      <output data-pref-output="${escapeHtml(slider.key)}">${percent}%</output>
    </label>
  `;
}

function renderSettings() {
  elements.libraryCount.textContent = "System";
  const meta = state.meta || {};
  const sources = getSourceStats();
  const controllerName = state.controllerName ? trimControllerName(state.controllerName) : "No controller connected";
  elements.gameGrid.innerHTML = `
    <div class="settings-grid">
      <section class="settings-card wide settings-hero-card">
        <strong>Settings</strong>
        <p>Configure Nova Deck as a local console shell for this Windows user.</p>
      </section>
      <section class="settings-card">
        <strong>System Startup</strong>
        <p>Start Nova Deck automatically when this Windows account signs in.</p>
        ${renderToggleButton("toggle-startup", state.startupEnabled, "Start with Windows")}
      </section>
      <section class="settings-card">
        <strong>Default View</strong>
        <p>Choose the first screen Nova Deck opens after it starts.</p>
        <select class="settings-select" data-app-setting="startView">
          ${renderSelectOption("home", "Home", state.appSettings.startView)}
          ${renderSelectOption("library", "All Games", state.appSettings.startView)}
          ${renderSelectOption("settings", "Settings", state.appSettings.startView)}
        </select>
      </section>
      <section class="settings-card">
        <strong>Sound Output</strong>
        <p>Choose the preferred output for Nova Deck sounds and future system audio feedback.</p>
        <select class="settings-select" data-audio-output>
          ${renderAudioOptions()}
        </select>
      </section>
      <section class="settings-card">
        <strong>Display</strong>
        <p>Use fullscreen for a console-like shell, or windowed while tuning the app.</p>
        <button class="settings-action" data-action="fullscreen">${state.isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}</button>
      </section>
      <section class="settings-card wide controller-card">
        <div class="settings-card-head">
          <div>
            <strong>Controller Mapping</strong>
            <p>${escapeHtml(controllerName)}</p>
          </div>
          <button class="settings-action compact" data-action="reset-controller-mapping">Reset defaults</button>
        </div>
        <div class="controller-tuning">
          <label>
            <span>Stick deadzone</span>
            <input type="range" min="0.10" max="0.95" step="0.05" value="${state.controllerSettings.deadzone}" data-controller-setting="deadzone">
            <output data-setting-output="deadzone">${Math.round(state.controllerSettings.deadzone * 100)}%</output>
          </label>
          <label>
            <span>Move repeat</span>
            <input type="range" min="90" max="500" step="10" value="${state.controllerSettings.repeatDelay}" data-controller-setting="repeatDelay">
            <output data-setting-output="repeatDelay">${Math.round(state.controllerSettings.repeatDelay)}ms</output>
          </label>
        </div>
        <div class="mapping-list">
          ${renderControllerMappings()}
        </div>
      </section>
      <section class="settings-card">
        <strong>Library Scan</strong>
        <p>Detect Steam, Epic, Desktop shortcuts, Start Menu games, Xbox-style folders, common game folders, and Minecraft clients.</p>
        <button class="settings-action" data-action="scan">Rescan now</button>
      </section>
      <section class="settings-card">
        <strong>Detected Sources</strong>
        <div class="mini-list">
          ${sources.length ? sources.map((source) => `
            <div><span>${escapeHtml(source.name)}</span><b>${source.count}</b></div>
          `).join("") : "<p>No sources detected yet.</p>"}
        </div>
      </section>
      <section class="settings-card">
        <strong>Manual Games</strong>
        <p>Add a standalone .exe, .lnk, or .url when a game does not expose itself to Windows cleanly.</p>
        <button class="settings-action" data-action="add">Add game</button>
      </section>
      <section class="settings-card">
        <strong>Local Data</strong>
        <p>${escapeHtml(meta.userDataPath || "User data folder unavailable.")}</p>
        <button class="settings-action" data-action="open-user-data">Open folder</button>
      </section>
      <section class="settings-card">
        <strong>Launcher Mode</strong>
        <p>Quiet launch minimizes common launchers after starting a game and refocuses the game window when possible.</p>
        <div class="setting-pill">Quiet mode enabled</div>
      </section>
      <section class="settings-card">
        <strong>Motion</strong>
        <p>Reduce hover and focus movement for a calmer interface.</p>
        ${renderToggleButton("toggle-reduce-motion", state.appSettings.reduceMotion, "Reduce motion")}
      </section>
      <section class="settings-card">
        <strong>Updates</strong>
        <p>${escapeHtml(state.updateStatus.message)}</p>
        ${renderUpdateProgress()}
        <div class="settings-actions-row">
          <button class="settings-action" data-action="check-updates"${state.updateStatus.canCheck ? "" : " disabled"}>Check for updates</button>
          <button class="settings-action" data-action="install-update"${state.updateStatus.canInstall ? "" : " disabled"}>Restart and apply</button>
        </div>
      </section>
      <section class="settings-card wide">
        <strong>Game Input Profiles</strong>
        <p>Nova Deck remaps the shell controls above. Individual games still read controllers directly, so per-game control changes should use the game menu, Steam Input, or a virtual controller driver.</p>
        <div class="setting-pill neutral">OS mapping active</div>
      </section>
    </div>
  `;
}

function renderControllerMappings() {
  return Object.entries(state.controllerSettings.mappings).map(([action, mapping]) => {
    const isCapturing = state.mappingCaptureAction === action;
    return `
      <div class="mapping-row${isCapturing ? " capturing" : ""}">
        <div>
          <strong>${escapeHtml(mapping.label)}</strong>
          <span>${escapeHtml(formatButtons(mapping.buttons))}</span>
        </div>
        <button class="settings-action compact" data-action="capture-controller-button" data-map-action="${escapeHtml(action)}">
          ${isCapturing ? "Press button" : "Bind"}
        </button>
      </div>
    `;
  }).join("");
}

function renderToggleButton(action, enabled, label) {
  return `
    <button class="toggle-row${enabled ? " enabled" : ""}" data-action="${escapeHtml(action)}" aria-pressed="${enabled ? "true" : "false"}">
      <span>${escapeHtml(label)}</span>
      <b>${enabled ? "On" : "Off"}</b>
    </button>
  `;
}

function renderSelectOption(value, label, selectedValue) {
  return `<option value="${escapeHtml(value)}"${value === selectedValue ? " selected" : ""}>${escapeHtml(label)}</option>`;
}

function renderAudioOptions() {
  const outputs = ensureDefaultAudioOutput(state.audioOutputs);
  return outputs.map((output) => (
    `<option value="${escapeHtml(output.deviceId)}"${output.deviceId === state.appSettings.audioOutputId ? " selected" : ""}>${escapeHtml(output.label)}</option>`
  )).join("");
}

function renderUpdateProgress() {
  const percent = clampNumber(state.updateStatus.percent, 0, 0, 100);
  const activeStatuses = new Set(["available", "downloading", "downloaded", "installing"]);
  const isActive = activeStatuses.has(state.updateStatus.status);
  const totalBytes = clampNumber(state.updateStatus.totalBytes, 0, 0, Number.MAX_SAFE_INTEGER);
  const transferredBytes = clampNumber(state.updateStatus.transferredBytes, 0, 0, Number.MAX_SAFE_INTEGER);
  const detail = isActive && totalBytes > 0 ? `${formatBytes(transferredBytes)} / ${formatBytes(totalBytes)}` : getUpdateProgressDetail(state.updateStatus.status);
  return `
    <div class="update-progress${isActive ? " active" : ""}" style="--update-progress: ${percent}%">
      <div class="update-progress-track"><span></span></div>
      <div class="update-progress-meta">
        <strong>${Math.round(percent)}%</strong>
        <small>${escapeHtml(detail)}</small>
      </div>
    </div>
  `;
}

function renderGameCard(game, index) {
  const selected = index === state.selectedIndex ? " selected" : "";
  const initials = getInitials(game.title);
  const hasImage = Boolean(game.artworkUrl);
  const artworkType = getArtworkType(game);
  return `
    <button class="game-card${selected}" data-index="${index}" title="${escapeHtml(game.title)}">
      <div class="cover-art ${artworkType}${hasImage ? " has-image" : ""}">
        ${hasImage ? `<img class="cover-image" src="${escapeHtml(game.artworkUrl)}" alt="">` : ""}
        <div class="cover-glyph source-${escapeHtml(normalizeClassName(game.source))}">${escapeHtml(initials)}</div>
      </div>
      <div class="card-copy">
        <div class="card-title">${escapeHtml(game.title)}</div>
        <div class="card-meta">${escapeHtml(game.source)} - ${escapeHtml(game.launchType || "local")}</div>
      </div>
    </button>
  `;
}

function renderFilterChip(source) {
  return `
    <button class="filter-chip${state.sourceFilter === source.name ? " active" : ""}" data-source-filter="${escapeHtml(source.name)}">
      ${escapeHtml(source.name)}
      <span>${source.count}</span>
    </button>
  `;
}

function renderEmptyState() {
  elements.gameGrid.innerHTML = renderEmptyStateHtml();
}

function renderEmptyStateHtml() {
  return `
    <div class="empty-state">
      <div>
        <strong>${state.scanning ? "Scanning" : "No matches"}</strong>
        <span>${state.search ? "Try a different search." : "Add a game or scan again."}</span>
      </div>
    </div>
  `;
}

function renderViewTitle() {
  const titles = {
    home: "Home",
    library: "Apps",
    settings: "Settings"
  };
  elements.viewTitle.textContent = titles[state.activeView] || "Home";
}

function renderController() {
  const gamepads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
  const controller = gamepads[0];
  if (controller) {
    state.controllerName = controller.id;
  }

  elements.controllerStatus.textContent = state.controllerName ? trimControllerName(state.controllerName) : "Disconnected";
}

function renderFullscreenButton() {
  elements.fullscreenButton.classList.toggle("is-fullscreen", state.isFullscreen);
  elements.fullscreenButton.title = state.isFullscreen ? "Exit fullscreen" : "Fullscreen";
  elements.fullscreenButton.setAttribute("aria-label", state.isFullscreen ? "Exit fullscreen" : "Fullscreen");
}

function handleContentClick(event) {
  const card = event.target.closest(".game-card");
  if (card) {
    state.selectedIndex = Number(card.dataset.index);
    const selectedGame = getSelectedGame();
    if (state.appPreferences && selectedGame && state.appPreferences.gameId !== selectedGame.id) {
      state.appPreferences = null;
    }
    render();
    return;
  }

  const sourceButton = event.target.closest("[data-source-filter]");
  if (sourceButton) {
    state.sourceFilter = sourceButton.dataset.sourceFilter || "All";
    state.activeView = "library";
    document.querySelectorAll(".rail-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === "library");
    });
    state.selectedIndex = 0;
    render();
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) {
    return;
  }

  const action = actionButton.dataset.action;
  if (action === "scan") {
    scanLibrary();
  } else if (action === "add") {
    addGame();
  } else if (action === "fullscreen") {
    toggleFullscreen();
  } else if (action === "open-user-data" && state.meta && state.meta.userDataPath) {
    api.openPath(state.meta.userDataPath);
  } else if (action === "capture-controller-button") {
    startButtonCapture(actionButton.dataset.mapAction);
  } else if (action === "reset-controller-mapping") {
    resetControllerSettings();
  } else if (action === "toggle-startup") {
    toggleStartup();
  } else if (action === "toggle-reduce-motion") {
    updateAppSetting("reduceMotion", !state.appSettings.reduceMotion);
  } else if (action === "check-updates") {
    checkForUpdates();
  } else if (action === "install-update") {
    installUpdate();
  } else if (action === "play-selected") {
    launchSelectedGame();
  } else if (action === "app-preferences") {
    openAppPreferences();
  } else if (action === "close-app-preferences") {
    closeAppPreferences();
  } else if (action === "open-preferences-path") {
    api.openPath(actionButton.dataset.path || "");
  } else if (action === "toggle-game-preference") {
    updateSelectedGamePreference(actionButton.dataset.prefKey, actionButton.dataset.nextValue);
  }
}

function handleContentInput(event) {
  const preferenceRange = event.target.closest("[data-pref-key].pref-range");
  if (preferenceRange) {
    const key = preferenceRange.dataset.prefKey;
    updatePreferenceOutput(key, preferenceRange.value);
    if (isInputBridgePreferenceKey(key)) {
      previewJavaBridgePreference(key, preferenceRange.value);
      saveGamePreferenceSoon(key, preferenceRange.value);
    }
    return;
  }

  const target = event.target.closest("[data-controller-setting]");
  if (!target) {
    return;
  }

  const setting = target.dataset.controllerSetting;
  const nextSettings = cloneControllerSettings(state.controllerSettings);
  if (setting === "deadzone") {
    nextSettings.deadzone = Number(target.value);
    updateSettingOutput("deadzone", `${Math.round(nextSettings.deadzone * 100)}%`);
  } else if (setting === "repeatDelay") {
    nextSettings.repeatDelay = Number(target.value);
    updateSettingOutput("repeatDelay", `${Math.round(nextSettings.repeatDelay)}ms`);
  } else {
    return;
  }

  state.controllerSettings = normalizeControllerSettings(nextSettings);
  saveControllerSettingsSoon();
}

function handleContentChange(event) {
  const appSetting = event.target.closest("[data-app-setting]");
  if (appSetting) {
    updateAppSetting(appSetting.dataset.appSetting, appSetting.value);
    return;
  }

  const audioSelect = event.target.closest("[data-audio-output]");
  if (audioSelect) {
    const selectedOutput = ensureDefaultAudioOutput(state.audioOutputs)
      .find((output) => output.deviceId === audioSelect.value) || { deviceId: "default", label: "System default" };
    updateAppSettings({
      ...state.appSettings,
      audioOutputId: selectedOutput.deviceId,
      audioOutputLabel: selectedOutput.label
    });
    return;
  }

  const preferenceInput = event.target.closest("[data-pref-key]");
  if (preferenceInput) {
    updateSelectedGamePreference(preferenceInput.dataset.prefKey, preferenceInput.value);
  }
}

function handleImageError(event) {
  const image = event.target.closest(".cover-image");
  if (!image) {
    return;
  }

  const wrapper = image.closest(".cover-art");
  image.remove();
  if (wrapper) {
    wrapper.classList.remove("has-image");
  }
}

function handleKeyDown(event) {
  if (event.key === "F11") {
    event.preventDefault();
    toggleFullscreen();
    return;
  }

  if (event.key === "F5") {
    event.preventDefault();
    scanLibrary();
    return;
  }

  if (state.mappingCaptureAction && event.key === "Escape") {
    event.preventDefault();
    cancelButtonCapture();
    return;
  }

  if (isEditableTarget(event.target) && event.key !== "Escape") {
    return;
  }

  switch (event.key) {
    case "ArrowRight":
      event.preventDefault();
      moveSelection(1);
      break;
    case "ArrowLeft":
      event.preventDefault();
      moveSelection(-1);
      break;
    case "ArrowDown":
      event.preventDefault();
      moveSelection(getColumnCount());
      break;
    case "ArrowUp":
      event.preventDefault();
      moveSelection(-getColumnCount());
      break;
    case "Enter":
      event.preventDefault();
      launchSelectedGame();
      break;
    case "Backspace":
    case "Escape":
      if (state.search) {
        event.preventDefault();
        state.search = "";
        elements.searchInput.value = "";
        state.selectedIndex = 0;
        render();
      }
      break;
    default:
      break;
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
    releaseJavaBridgeInputs();
    return;
  }

  const gamepad = Array.from(navigator.getGamepads()).filter(Boolean)[0];
  if (!gamepad) {
    releaseJavaBridgeInputs();
    return;
  }

  state.controllerName = gamepad.id;
  const now = performance.now();
  if (handleMappingCapture(gamepad)) {
    return;
  }

  if (pollJavaInputBridge(gamepad)) {
    return;
  }

  const deadzone = state.controllerSettings.deadzone;
  const repeatDelay = state.controllerSettings.repeatDelay;
  const axisX = readAxis(gamepad, [0, 6]);
  const axisY = readAxis(gamepad, [1, 7]);
  const dpadLeft = isPressed(gamepad, 14);
  const dpadRight = isPressed(gamepad, 15);
  const dpadUp = isPressed(gamepad, 12);
  const dpadDown = isPressed(gamepad, 13);

  if (now - state.lastAxisMove > repeatDelay) {
    if (axisX > deadzone || dpadRight) {
      moveControllerFocus("right");
      state.lastAxisMove = now;
    } else if (axisX < -deadzone || dpadLeft) {
      moveControllerFocus("left");
      state.lastAxisMove = now;
    } else if (axisY > deadzone || dpadDown) {
      moveControllerFocus("down");
      state.lastAxisMove = now;
    } else if (axisY < -deadzone || dpadUp) {
      moveControllerFocus("up");
      state.lastAxisMove = now;
    }
  }

  onMappedActionPress(gamepad, "confirm", activateControllerFocus);
  onMappedActionPress(gamepad, "back", handleBackAction);
  onMappedActionPress(gamepad, "search", () => setControllerFocus(elements.searchInput));
  onMappedActionPress(gamepad, "scan", scanLibrary);
  onMappedActionPress(gamepad, "fullscreen", toggleFullscreen);
  onMappedActionPress(gamepad, "home", () => setView("home", true));
  onMappedActionPress(gamepad, "library", () => setView("library", true));
  onMappedActionPress(gamepad, "settings", () => setView("settings", true));
}

function onMappedActionPress(gamepad, action, handler) {
  const key = `${gamepad.index}:${action}`;
  const buttons = getMappedButtons(action);
  const pressed = buttons.some((buttonIndex) => isPressed(gamepad, buttonIndex));
  const wasPressed = state.lastButtons.get(key) || false;

  if (pressed && !wasPressed) {
    handler();
  }

  state.lastButtons.set(key, pressed);
}

function handleMappingCapture(gamepad) {
  if (!state.mappingCaptureAction) {
    return false;
  }

  const pressedButtons = getPressedButtons(gamepad);
  const newButton = pressedButtons.find((buttonIndex) => !state.capturePrimedButtons.has(buttonIndex));
  if (newButton !== undefined) {
    saveControllerMapping(state.mappingCaptureAction, newButton);
    return true;
  }

  if (pressedButtons.length === 0 && state.capturePrimedButtons.size > 0) {
    state.capturePrimedButtons.clear();
  }

  return true;
}

function isPressed(gamepad, buttonIndex) {
  return Boolean(gamepad.buttons[buttonIndex] && gamepad.buttons[buttonIndex].pressed);
}

function getPressedButtons(gamepad) {
  return gamepad.buttons
    .map((button, index) => (button && button.pressed ? index : null))
    .filter((index) => index !== null);
}

function readAxis(gamepad, indexes) {
  return indexes.reduce((best, index) => {
    const value = Number(gamepad.axes[index] || 0);
    return Math.abs(value) > Math.abs(best) ? value : best;
  }, 0);
}

function pollJavaInputBridge(gamepad) {
  const profile = getActiveJavaBridgeProfile();
  if (!profile || !profile.bridge || !profile.bridge.enabled || document.hasFocus()) {
    releaseJavaBridgeInputs();
    return false;
  }

  if (state.javaBridgeNativeActive) {
    releaseJavaBridgeInputs();
    return true;
  }

  const bridge = profile.bridge;
  const deadzone = clampNumber(bridge.deadzone, 0.24, 0.1, 0.7);
  const lookSensitivity = clampNumber(bridge.lookSensitivity, 1, 0.2, 3);
  const events = [];

  const moveX = applyBridgeDeadzone(readAxis(gamepad, [0]), deadzone);
  const moveY = applyBridgeDeadzone(readAxis(gamepad, [1]), deadzone);
  setHeldVirtualInput("java:move-forward", moveY < 0, keyEvent("key:W", true), keyEvent("key:W", false), events);
  setHeldVirtualInput("java:move-back", moveY > 0, keyEvent("key:S", true), keyEvent("key:S", false), events);
  setHeldVirtualInput("java:move-left", moveX < 0, keyEvent("key:A", true), keyEvent("key:A", false), events);
  setHeldVirtualInput("java:move-right", moveX > 0, keyEvent("key:D", true), keyEvent("key:D", false), events);

  const lookX = applyBridgeLookCurve(applyScaledBridgeDeadzone(readAxis(gamepad, [2]), deadzone));
  const lookY = applyBridgeLookCurve(applyScaledBridgeDeadzone(readAxis(gamepad, [3]), deadzone));
  state.javaBridgeLookX += (lookX - state.javaBridgeLookX) * 0.38;
  state.javaBridgeLookY += (lookY - state.javaBridgeLookY) * 0.38;
  if (Math.abs(state.javaBridgeLookX) < 0.003) {
    state.javaBridgeLookX = 0;
  }
  if (Math.abs(state.javaBridgeLookY) < 0.003) {
    state.javaBridgeLookY = 0;
  }

  state.javaBridgeMouseCarryX += state.javaBridgeLookX * 22 * lookSensitivity;
  state.javaBridgeMouseCarryY += state.javaBridgeLookY * 22 * lookSensitivity;
  const dx = Math.trunc(state.javaBridgeMouseCarryX);
  const dy = Math.trunc(state.javaBridgeMouseCarryY);
  if (dx) {
    state.javaBridgeMouseCarryX -= dx;
  }
  if (dy) {
    state.javaBridgeMouseCarryY -= dy;
  }
  if (dx || dy) {
    events.push({ type: "mouseMove", dx, dy });
  }

  for (const control of profile.controls || []) {
    const pressed = isPressed(gamepad, control.buttonIndex);
    const wasPressed = state.javaBridgeButtonStates.get(control.key) || false;
    if (pressed && !wasPressed) {
      pressVirtualOutput(control.key, control.value, events);
    } else if (!pressed && wasPressed) {
      releaseVirtualOutput(control.key, control.value, events);
    }
    state.javaBridgeButtonStates.set(control.key, pressed);
  }

  sendJavaBridgeEvents(events);
  return true;
}

function getActiveJavaBridgeProfile() {
  const game = getSelectedGame();
  if (!game || !state.javaBridgeProfile || state.javaBridgeProfile.gameId !== game.id) {
    return null;
  }

  const data = state.javaBridgeProfile.data;
  return isInputBridgePreferences(data) ? data : null;
}

function setJavaBridgeProfile(game, data) {
  if (!game || !isInputBridgePreferences(data)) {
    state.javaBridgeProfile = null;
    releaseJavaBridgeInputs();
    syncNativeJavaBridge(null);
    return;
  }

  const wasEnabled = Boolean(state.javaBridgeProfile && state.javaBridgeProfile.data && state.javaBridgeProfile.data.bridge && state.javaBridgeProfile.data.bridge.enabled);
  state.javaBridgeProfile = {
    gameId: game.id,
    data
  };

  if (wasEnabled && (!data.bridge || !data.bridge.enabled)) {
    releaseJavaBridgeInputs();
  }

  syncNativeJavaBridge(data);
}

function isInputBridgePreferences(data) {
  return Boolean(data && INPUT_BRIDGE_KINDS.has(data.kind) && data.status === "ready");
}

function isInputBridgePreferenceKey(key) {
  return INPUT_BRIDGE_PREFIXES.some((prefix) => String(key || "").startsWith(prefix));
}

function syncNativeJavaBridge(data) {
  const enabled = Boolean(data && data.bridge && data.bridge.enabled);
  if (!enabled) {
    state.javaBridgeNativeActive = false;
    if (api.clearInputBridgeProfile) {
      api.clearInputBridgeProfile().catch(() => {});
    }
    return;
  }

  if (!api.setInputBridgeProfile) {
    state.javaBridgeNativeActive = false;
    return;
  }

  api.setInputBridgeProfile(data)
    .then((isActive) => {
      state.javaBridgeNativeActive = Boolean(isActive);
    })
    .catch(() => {
      state.javaBridgeNativeActive = false;
    });
}

function applyBridgeDeadzone(value, deadzone) {
  return Math.abs(value) > deadzone ? value : 0;
}

function applyScaledBridgeDeadzone(value, deadzone) {
  const absolute = Math.abs(value);
  if (absolute <= deadzone) {
    return 0;
  }

  const scaled = (absolute - deadzone) / (1 - deadzone);
  return Math.sign(value) * Math.min(1, scaled);
}

function applyBridgeLookCurve(value) {
  return value === 0 ? 0 : Math.sign(value) * Math.abs(value) ** 1.45;
}

function pressVirtualOutput(controlKey, output, events) {
  if (output === "none") {
    return;
  }

  const stateKey = `java:button:${controlKey}`;
  if (output === "mouse:left" || output === "mouse:right") {
    const button = output === "mouse:right" ? "right" : "left";
    setHeldVirtualInput(stateKey, true, { type: "mouseButton", button, down: true }, { type: "mouseButton", button, down: false }, events);
    return;
  }

  if (output === "wheel:up" || output === "wheel:down") {
    events.push({ type: "wheel", delta: output === "wheel:up" ? 120 : -120 });
    return;
  }

  const downEvent = keyEvent(output, true);
  const upEvent = keyEvent(output, false);
  if (downEvent && upEvent) {
    setHeldVirtualInput(stateKey, true, downEvent, upEvent, events);
  }
}

function releaseVirtualOutput(controlKey, output, events) {
  if (output === "none" || output === "wheel:up" || output === "wheel:down") {
    return;
  }

  const stateKey = `java:button:${controlKey}`;
  if (output === "mouse:left" || output === "mouse:right") {
    const button = output === "mouse:right" ? "right" : "left";
    setHeldVirtualInput(stateKey, false, { type: "mouseButton", button, down: true }, { type: "mouseButton", button, down: false }, events);
    return;
  }

  const downEvent = keyEvent(output, true);
  const upEvent = keyEvent(output, false);
  if (downEvent && upEvent) {
    setHeldVirtualInput(stateKey, false, downEvent, upEvent, events);
  }
}

function setHeldVirtualInput(stateKey, pressed, pressEvent, releaseEvent, events) {
  const isHeld = state.javaBridgeHeldInputs.has(stateKey);
  if (pressed && !isHeld) {
    state.javaBridgeHeldInputs.set(stateKey, releaseEvent);
    events.push(pressEvent);
  } else if (!pressed && isHeld) {
    state.javaBridgeHeldInputs.delete(stateKey);
    events.push(releaseEvent);
  }
}

function keyEvent(key, down) {
  const vk = VIRTUAL_KEY_CODES[key];
  return vk ? { type: "key", vk, down } : null;
}

function sendJavaBridgeEvents(events) {
  if (events.length === 0 || !api.sendVirtualInput) {
    return;
  }

  api.sendVirtualInput(events).catch(() => {});
}

function releaseJavaBridgeInputs() {
  const events = Array.from(state.javaBridgeHeldInputs.values());
  state.javaBridgeHeldInputs.clear();
  state.javaBridgeButtonStates.clear();
  state.javaBridgeLookX = 0;
  state.javaBridgeLookY = 0;
  state.javaBridgeMouseCarryX = 0;
  state.javaBridgeMouseCarryY = 0;

  if (events.length > 0) {
    sendJavaBridgeEvents(events);
  }
}

function moveControllerFocus(direction) {
  let current = getControllerFocusedElement();
  if (!current) {
    current = getPreferredFocusElement();
    if (!current) {
      return;
    }
    setControllerFocus(current);
  }

  if (current && current.matches("[data-controller-setting], .pref-range") && (direction === "left" || direction === "right")) {
    adjustRangeInput(current, direction === "right" ? 1 : -1);
    return;
  }

  const controls = getFocusableControls();
  if (!controls.length) {
    return;
  }

  const next = findDirectionalFocus(current, controls, direction);
  if (next) {
    setControllerFocus(next);
  }
}

function activateControllerFocus() {
  const focused = getControllerFocusedElement() || getPreferredFocusElement();
  if (!focused) {
    return;
  }

  setControllerFocus(focused);

  if (focused.classList.contains("game-card")) {
    state.selectedIndex = Number(focused.dataset.index);
    renderHero();
    if (state.activeView === "library") {
      render();
      requestAnimationFrame(() => {
        const playButton = elements.gameGrid.querySelector("[data-action='play-selected']");
        if (playButton) {
          setControllerFocus(playButton);
        }
      });
      return;
    }
    launchSelectedGame();
    return;
  }

  if (focused === elements.searchInput) {
    elements.searchInput.focus();
    return;
  }

  if (focused.matches("[data-controller-setting], .pref-range")) {
    adjustRangeInput(focused, 1);
    return;
  }

  focused.click();
}

function handleBackAction() {
  if (state.mappingCaptureAction) {
    cancelButtonCapture();
    return;
  }

  if (state.search) {
    clearSearch();
    return;
  }

  if (document.activeElement === elements.searchInput) {
    elements.searchInput.blur();
    focusPreferredControl();
    return;
  }

  if (state.activeView !== "home") {
    setView("home", true);
  }
}

function setControllerFocus(element) {
  if (!element || isDisabledOrHidden(element)) {
    return;
  }

  clearControllerFocus();
  state.controllerFocusKey = getFocusKey(element);
  element.classList.add("controller-focused");
  element.focus({ preventScroll: true });

  if (element.classList.contains("game-card")) {
    const nextIndex = Number(element.dataset.index);
    if (Number.isInteger(nextIndex) && nextIndex !== state.selectedIndex) {
      state.selectedIndex = nextIndex;
      updateSelectedGameCards();
      renderHero();
    }
  }

  element.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function restoreControllerFocus() {
  clearControllerFocus();
  if (!state.controllerFocusKey) {
    return;
  }

  const element = findFocusByKey(state.controllerFocusKey);
  if (!element || isDisabledOrHidden(element)) {
    state.controllerFocusKey = "";
    return;
  }

  element.classList.add("controller-focused");
}

function clearControllerFocus() {
  document.querySelectorAll(".controller-focused").forEach((element) => {
    element.classList.remove("controller-focused");
  });
}

function focusPreferredControl() {
  const preferred = getPreferredFocusElement();
  if (preferred) {
    setControllerFocus(preferred);
  }
}

function getControllerFocusedElement() {
  const byKey = findFocusByKey(state.controllerFocusKey);
  if (byKey && !isDisabledOrHidden(byKey)) {
    return byKey;
  }

  const active = document.activeElement;
  if (active && getFocusableControls().includes(active)) {
    return active;
  }

  return null;
}

function getPreferredFocusElement(controls = getFocusableControls()) {
  if (!controls.length) {
    return null;
  }

  if (state.activeView !== "settings") {
    const selectedCard = elements.gameGrid.querySelector(`.game-card[data-index="${state.selectedIndex}"]`);
    if (selectedCard && !isDisabledOrHidden(selectedCard)) {
      return selectedCard;
    }
  }

  return controls.find((element) => !element.classList.contains("rail-button")) || controls[0];
}

function getFocusableControls() {
  const selectors = [
    ".rail-button",
    "#searchInput",
    "#scanButton",
    "#addButton",
    "#fullscreenButton",
    "#launchButton",
    "#removeButton",
    ".source-summary",
    ".filter-chip",
    ".game-card",
    ".app-action-card",
    ".pref-select",
    ".pref-toggle",
    ".pref-range",
    ".settings-action",
    ".toggle-row",
    ".settings-select",
    "[data-controller-setting]"
  ];

  return Array.from(document.querySelectorAll(selectors.join(",")))
    .filter((element) => !isDisabledOrHidden(element));
}

function findDirectionalFocus(current, controls, direction) {
  const currentRect = current.getBoundingClientRect();
  const currentCenter = getRectCenter(currentRect);
  const candidates = [];

  for (const element of controls) {
    if (element === current) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    const center = getRectCenter(rect);
    const dx = center.x - currentCenter.x;
    const dy = center.y - currentCenter.y;
    if (!isInDirection(dx, dy, direction)) {
      continue;
    }

    const primaryDistance = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
    const secondaryDistance = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    candidates.push({
      element,
      score: primaryDistance + secondaryDistance * 1.8
    });
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates[0] ? candidates[0].element : null;
}

function isInDirection(dx, dy, direction) {
  const threshold = 8;
  if (direction === "left") {
    return dx < -threshold;
  }
  if (direction === "right") {
    return dx > threshold;
  }
  if (direction === "up") {
    return dy < -threshold;
  }
  return dy > threshold;
}

function getRectCenter(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function adjustRangeInput(input, direction) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const step = Number(input.step || 1);
  const nextValue = clampNumber(Number(input.value) + step * direction, Number(input.value), min, max);
  input.value = String(nextValue);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function getFocusKey(element) {
  if (!element) {
    return "";
  }
  if (element.classList.contains("game-card")) {
    return `game:${element.dataset.index || "0"}`;
  }
  if (element.matches("[data-view]")) {
    return `view:${element.dataset.view || ""}`;
  }
  if (element.matches("[data-source-filter]")) {
    return `source:${element.dataset.sourceFilter || ""}`;
  }
  if (element.matches("[data-controller-setting]")) {
    return `setting:${element.dataset.controllerSetting || ""}`;
  }
  if (element.matches("[data-app-setting]")) {
    return `app-setting:${element.dataset.appSetting || ""}`;
  }
  if (element.matches("[data-audio-output]")) {
    return "audio-output";
  }
  if (element.classList.contains("app-action-card")) {
    return `app-action:${element.dataset.action || ""}`;
  }
  if (element.matches("[data-pref-key]")) {
    return `pref:${element.dataset.prefKey || ""}`;
  }
  if (element.matches("[data-action]")) {
    return `action:${element.dataset.action || ""}:${element.dataset.mapAction || ""}`;
  }
  return element.id ? `id:${element.id}` : "";
}

function findFocusByKey(key) {
  if (!key) {
    return null;
  }
  return getFocusableControls().find((element) => getFocusKey(element) === key) || null;
}

function updateSelectedGameCards() {
  elements.gameGrid.querySelectorAll(".game-card").forEach((card) => {
    card.classList.toggle("selected", Number(card.dataset.index) === state.selectedIndex);
  });
}

function isDisabledOrHidden(element) {
  if (!element || element.disabled || element.classList.contains("hidden")) {
    return true;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width === 0 || rect.height === 0 || style.visibility === "hidden" || style.display === "none";
}

function moveSelection(delta) {
  if (state.activeView === "settings" || state.filteredGames.length === 0) {
    return;
  }

  state.selectedIndex = clamp(state.selectedIndex + delta, 0, state.filteredGames.length - 1);
  state.controllerFocusKey = `game:${state.selectedIndex}`;
  render();
}

function clearSearch() {
  if (!state.search) {
    return;
  }

  state.search = "";
  elements.searchInput.value = "";
  state.selectedIndex = 0;
  render();
}

function startButtonCapture(action) {
  if (!state.controllerSettings.mappings[action]) {
    return;
  }

  const gamepad = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean)[0] : null;
  state.mappingCaptureAction = action;
  state.captureStartedAt = performance.now();
  state.capturePrimedButtons = new Set(gamepad ? getPressedButtons(gamepad) : []);
  render();
  showToast("Press a controller button to bind it.");
}

function cancelButtonCapture() {
  state.mappingCaptureAction = "";
  state.capturePrimedButtons.clear();
  render();
  showToast("Controller binding canceled.");
}

async function saveControllerMapping(action, buttonIndex) {
  const nextSettings = cloneControllerSettings(state.controllerSettings);
  nextSettings.mappings[action].buttons = [buttonIndex];
  state.mappingCaptureAction = "";
  state.capturePrimedButtons.clear();
  state.controllerSettings = normalizeControllerSettings(await api.updateControllerSettings(nextSettings));
  state.lastButtons.clear();
  render();
  showToast(`${nextSettings.mappings[action].label} set to ${formatButton(buttonIndex)}.`);
}

async function resetControllerSettings() {
  clearTimeout(state.controllerSaveTimer);
  state.mappingCaptureAction = "";
  state.capturePrimedButtons.clear();
  state.controllerSettings = normalizeControllerSettings(await api.updateControllerSettings(DEFAULT_CONTROLLER_SETTINGS));
  state.lastButtons.clear();
  render();
  showToast("Controller mapping reset.");
}

async function toggleStartup() {
  state.startupEnabled = await api.setStartupEnabled(!state.startupEnabled);
  render();
  showToast(state.startupEnabled ? "Nova Deck will start with Windows." : "Startup launch disabled.");
}

async function updateAppSetting(key, value) {
  await updateAppSettings({
    ...state.appSettings,
    [key]: value
  });
}

async function updateAppSettings(settings) {
  state.appSettings = normalizeAppSettings(await api.updateAppSettings(settings));
  render();
  showToast("Setting saved.");
}

async function checkForUpdates() {
  state.updateStatus = normalizeUpdateStatus(await api.checkForUpdates());
  render();
}

async function installUpdate() {
  const started = await api.installUpdate();
  if (!started) {
    showToast("No downloaded update is ready yet.");
  }
}

async function openAppPreferences() {
  const game = getSelectedGame();
  if (!game) {
    return;
  }

  state.appPreferences = {
    gameId: game.id,
    loading: true,
    data: null
  };
  render();

  try {
    const data = await api.getGamePreferences(game);
    state.appPreferences = {
      gameId: game.id,
      loading: false,
      data
    };
    setJavaBridgeProfile(game, data);
  } catch {
    state.appPreferences = {
      gameId: game.id,
      loading: false,
      data: {
        supported: false,
        message: "Preferences could not be loaded."
      }
    };
  }

  render();
}

async function loadGameBridgeProfile(game) {
  if (!game) {
    return;
  }

  try {
    const data = await api.getGamePreferences(game);
    setJavaBridgeProfile(game, data);
  } catch {
    releaseJavaBridgeInputs();
  }
}

function closeAppPreferences() {
  state.appPreferences = null;
  render();
}

function previewJavaBridgePreference(key, value) {
  const game = getSelectedGame();
  if (!game || !state.appPreferences || !isInputBridgePreferences(state.appPreferences.data)) {
    return;
  }

  const data = cloneSettings(state.appPreferences.data);
  if (key.endsWith(".deadzone")) {
    data.bridge.deadzone = clampNumber(value, data.bridge.deadzone, 0.1, 0.7);
  } else if (key.endsWith(".lookSensitivity")) {
    data.bridge.lookSensitivity = clampNumber(value, data.bridge.lookSensitivity, 0.2, 3);
  } else if (key.endsWith(".menuCursorSensitivity")) {
    data.bridge.menuCursorSensitivity = clampNumber(value, data.bridge.menuCursorSensitivity, 0.4, 3);
  } else {
    return;
  }

  data.sliders = (data.sliders || []).map((slider) => (
    slider.key === key ? { ...slider, value: Number(value) } : slider
  ));
  state.appPreferences.data = data;
  setJavaBridgeProfile(game, data);
}

function saveGamePreferenceSoon(key, value) {
  clearTimeout(state.gamePreferenceSaveTimer);
  state.gamePreferenceSaveTimer = setTimeout(() => {
    state.gamePreferenceSaveTimer = null;
    updateSelectedGamePreference(key, value, { render: false, silent: true, fromTimer: true });
  }, 90);
}

async function updateSelectedGamePreference(key, value, options = {}) {
  const game = getSelectedGame();
  if (!game || !state.appPreferences || !state.appPreferences.data) {
    return;
  }

  if (!options.fromTimer) {
    clearTimeout(state.gamePreferenceSaveTimer);
    state.gamePreferenceSaveTimer = null;
  }

  const data = state.appPreferences.data;
  releaseJavaBridgeInputs();
  const nextData = await api.updateGamePreference(game, {
    optionsPath: data.optionsPath,
    key,
    value
  });
  state.appPreferences.data = nextData;
  setJavaBridgeProfile(game, nextData);
  if (options.render !== false) {
    render();
  }
  if (!options.silent) {
    showToast(isInputBridgePreferences(nextData) ? "Controller preference saved." : "Minecraft preference saved. Restart Minecraft if it is open.");
  }
}

function saveControllerSettingsSoon() {
  clearTimeout(state.controllerSaveTimer);
  state.controllerSaveTimer = setTimeout(async () => {
    state.controllerSettings = normalizeControllerSettings(await api.updateControllerSettings(state.controllerSettings));
  }, 250);
}

function saveAppSettingsSoon() {
  clearTimeout(state.appSettingsSaveTimer);
  state.appSettingsSaveTimer = setTimeout(async () => {
    state.appSettings = normalizeAppSettings(await api.updateAppSettings(state.appSettings));
  }, 250);
}

function updateSettingOutput(setting, value) {
  const output = elements.gameGrid.querySelector(`[data-setting-output="${setting}"]`);
  if (output) {
    output.textContent = value;
  }
}

function updatePreferenceOutput(key, value) {
  const output = elements.gameGrid.querySelector(`[data-pref-output="${CSS.escape(key)}"]`);
  if (output) {
    output.textContent = `${Math.round(Number(value || 0) * 100)}%`;
  }
}

function getSelectedGame() {
  return state.filteredGames[state.selectedIndex] || null;
}

function getColumnCount() {
  const grid = elements.gameGrid.querySelector(".apps-grid-inner") || elements.gameGrid.querySelector(".game-grid-inner") || elements.gameGrid;
  const firstCard = grid.querySelector(".game-card");
  if (!firstCard) {
    return 1;
  }

  const gridWidth = grid.clientWidth;
  const cardWidth = firstCard.getBoundingClientRect().width;
  return Math.max(1, Math.floor(gridWidth / Math.max(1, cardWidth)));
}

function getMappedButtons(action) {
  const mapping = state.controllerSettings.mappings[action];
  return mapping && Array.isArray(mapping.buttons) ? mapping.buttons : [];
}

function scrollSelectedIntoView() {
  const selected = elements.gameGrid.querySelector(".game-card.selected");
  if (selected) {
    selected.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function scrollPreferencesIntoView() {
  const panel = elements.gameGrid.querySelector(".app-preferences-panel");
  if (panel) {
    panel.scrollIntoView({ block: "start", inline: "nearest" });
  }
}

function getSourceStats() {
  const stats = new Map();
  for (const game of state.games) {
    stats.set(game.source, (stats.get(game.source) || 0) + 1);
  }
  return Array.from(stats, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function shouldUseHeroArtwork(game) {
  return Boolean(game && game.artworkUrl && game.artworkType === "cover");
}

function getArtworkType(game) {
  return game && game.artworkType === "cover" ? "cover-artwork" : "icon-art";
}

function startClock() {
  const tick = () => {
    elements.clockText.textContent = new Intl.DateTimeFormat([], {
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date());
  };

  tick();
  setInterval(tick, 1000);
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");
  state.toastTimer = setTimeout(() => {
    elements.toast.classList.add("hidden");
  }, 3200);
}

function getInitials(title) {
  const words = String(title || "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return "ND";
  }

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function trimControllerName(value) {
  return String(value || "")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
}

function formatButtons(buttons) {
  return buttons.map(formatButton).join(", ");
}

function formatButton(buttonIndex) {
  return CONTROLLER_BUTTON_NAMES[buttonIndex] || `Button ${buttonIndex}`;
}

function normalizeControllerSettings(settings) {
  const nextSettings = cloneControllerSettings(DEFAULT_CONTROLLER_SETTINGS);
  const input = settings && typeof settings === "object" ? settings : {};
  nextSettings.deadzone = clampNumber(input.deadzone, DEFAULT_CONTROLLER_SETTINGS.deadzone, 0.1, 0.95);
  nextSettings.repeatDelay = clampNumber(input.repeatDelay, DEFAULT_CONTROLLER_SETTINGS.repeatDelay, 90, 500);

  const inputMappings = input.mappings && typeof input.mappings === "object" ? input.mappings : {};
  Object.keys(nextSettings.mappings).forEach((action) => {
    const buttons = inputMappings[action] && Array.isArray(inputMappings[action].buttons)
      ? inputMappings[action].buttons
      : nextSettings.mappings[action].buttons;
    nextSettings.mappings[action].buttons = buttons
      .map((buttonIndex) => Number(buttonIndex))
      .filter((buttonIndex) => Number.isInteger(buttonIndex) && buttonIndex >= 0 && buttonIndex <= 31)
      .slice(0, 4);
    if (nextSettings.mappings[action].buttons.length === 0) {
      nextSettings.mappings[action].buttons = DEFAULT_CONTROLLER_SETTINGS.mappings[action].buttons.slice();
    }
  });

  return nextSettings;
}

function normalizeAppSettings(settings) {
  const input = settings && typeof settings === "object" ? settings : {};
  const nextSettings = cloneSettings(DEFAULT_APP_SETTINGS);
  const startView = ["home", "library", "settings"].includes(input.startView) ? input.startView : nextSettings.startView;
  nextSettings.audioOutputId = normalizeText(input.audioOutputId, DEFAULT_APP_SETTINGS.audioOutputId);
  nextSettings.audioOutputLabel = normalizeText(input.audioOutputLabel, DEFAULT_APP_SETTINGS.audioOutputLabel);
  nextSettings.startView = startView;
  nextSettings.rescanOnStart = typeof input.rescanOnStart === "boolean" ? input.rescanOnStart : DEFAULT_APP_SETTINGS.rescanOnStart;
  nextSettings.reduceMotion = typeof input.reduceMotion === "boolean" ? input.reduceMotion : DEFAULT_APP_SETTINGS.reduceMotion;
  nextSettings.showHiddenLaunchers = typeof input.showHiddenLaunchers === "boolean" ? input.showHiddenLaunchers : DEFAULT_APP_SETTINGS.showHiddenLaunchers;
  return nextSettings;
}

function normalizeUpdateStatus(status = {}) {
  const input = status && typeof status === "object" ? status : {};
  return {
    status: normalizeText(input.status, "idle"),
    message: normalizeText(input.message, "Updates have not been checked yet."),
    canCheck: typeof input.canCheck === "boolean" ? input.canCheck : true,
    canInstall: typeof input.canInstall === "boolean" ? input.canInstall : false,
    percent: clampNumber(input.percent, 0, 0, 100),
    version: normalizeText(input.version, ""),
    transferredBytes: clampNumber(input.transferredBytes, 0, 0, Number.MAX_SAFE_INTEGER),
    totalBytes: clampNumber(input.totalBytes, 0, 0, Number.MAX_SAFE_INTEGER)
  };
}

function cloneControllerSettings(settings) {
  return JSON.parse(JSON.stringify(settings));
}

function cloneSettings(settings) {
  return JSON.parse(JSON.stringify(settings));
}

function ensureDefaultAudioOutput(outputs) {
  const normalized = Array.isArray(outputs) ? outputs.filter((output) => output && output.deviceId) : [];
  const hasDefault = normalized.some((output) => output.deviceId === "default");
  return hasDefault
    ? normalized
    : [{ deviceId: "default", label: "System default" }, ...normalized];
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function formatBytes(value) {
  const bytes = clampNumber(value, 0, 0, Number.MAX_SAFE_INTEGER);
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function getUpdateProgressDetail(status) {
  if (status === "downloaded" || status === "installing") {
    return "Ready to apply";
  }
  if (status === "available" || status === "downloading") {
    return "Downloading";
  }
  return "Idle";
}

function normalizeText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isEditableTarget(target) {
  if (!target || !target.matches) {
    return false;
  }
  return target.matches("input, textarea, select, [contenteditable='true']");
}

function normalizeClassName(value) {
  return String(value || "local")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createPreviewApi() {
  let previewControllerSettings = cloneControllerSettings(DEFAULT_CONTROLLER_SETTINGS);
  let previewAppSettings = cloneSettings(DEFAULT_APP_SETTINGS);
  let previewStartupEnabled = false;
  let previewUpdateStatus = normalizeUpdateStatus({
    status: "development",
    message: "Background ZIP updates run in packaged consumer builds.",
    canCheck: false,
    canInstall: false,
    percent: 0
  });
  let previewJavaBridge = {
    enabled: false,
    deadzone: 0.24,
    lookSensitivity: 1,
    menuCursorSensitivity: 1,
    controls: {
      "java_bridge.button0": "key:Space",
      "java_bridge.button1": "key:Shift",
      "java_bridge.button2": "key:E",
      "java_bridge.button3": "key:Q",
      "java_bridge.button4": "wheel:up",
      "java_bridge.button5": "wheel:down",
      "java_bridge.button6": "mouse:right",
      "java_bridge.button7": "mouse:left",
      "java_bridge.button8": "key:F3",
      "java_bridge.button9": "key:Escape",
      "java_bridge.button10": "key:Control",
      "java_bridge.button11": "key:F5",
      "java_bridge.button12": "key:1",
      "java_bridge.button13": "key:2",
      "java_bridge.button14": "key:3",
      "java_bridge.button15": "key:4"
    }
  };
  let previewUniversalBridge = {
    enabled: false,
    deadzone: 0.24,
    lookSensitivity: 1,
    menuCursorSensitivity: 1,
    controls: {
      "universal_bridge.button0": "key:Space",
      "universal_bridge.button1": "key:Escape",
      "universal_bridge.button2": "key:E",
      "universal_bridge.button3": "key:R",
      "universal_bridge.button4": "wheel:up",
      "universal_bridge.button5": "wheel:down",
      "universal_bridge.button6": "mouse:right",
      "universal_bridge.button7": "mouse:left",
      "universal_bridge.button8": "key:Tab",
      "universal_bridge.button9": "key:Escape",
      "universal_bridge.button10": "key:Shift",
      "universal_bridge.button11": "key:Control",
      "universal_bridge.button12": "key:Up",
      "universal_bridge.button13": "key:Down",
      "universal_bridge.button14": "key:Left",
      "universal_bridge.button15": "key:Right"
    }
  };
  const previewGames = [
    {
      id: "preview:forza",
      title: "Forza Horizon 5",
      source: "Steam",
      launchType: "steam",
      launchTarget: "steam://rungameid/1551360",
      installPath: "C:\\Games\\Steam\\Forza Horizon 5",
      focusProcess: "ForzaHorizon5",
      artworkUrl: "./assets/nova-deck-logo.svg",
      artworkType: "cover",
      custom: false
    },
    {
      id: "preview:hades",
      title: "Hades",
      source: "Epic",
      launchType: "epic",
      launchTarget: "com.epicgames.launcher://apps/example?action=launch&silent=true",
      installPath: "C:\\Games\\Epic\\Hades",
      focusProcess: "Hades",
      artworkUrl: "./assets/nova-deck-logo.svg",
      artworkType: "cover",
      custom: false
    },
    {
      id: "preview:minecraft-bedrock",
      title: "Minecraft for Windows",
      source: "Minecraft",
      launchType: "appx",
      launchTarget: "Microsoft.MinecraftUWP_8wekyb3d8bbwe!App",
      installPath: "Windows Apps",
      artworkUrl: "./assets/nova-deck-logo.svg",
      artworkType: "icon",
      custom: false
    },
    {
      id: "preview:minecraft-java",
      title: "Minecraft Launcher",
      source: "Minecraft",
      launchType: "exe",
      launchTarget: "C:\\XboxGames\\Minecraft Launcher\\Content\\Minecraft.exe",
      installPath: "C:\\Users\\Player\\AppData\\Roaming\\.minecraft",
      focusProcess: "Minecraft",
      artworkUrl: "./assets/nova-deck-logo.svg",
      artworkType: "icon",
      custom: false
    },
    {
      id: "preview:roblox",
      title: "Roblox Player",
      source: "Roblox",
      launchType: "exe",
      launchTarget: "C:\\Games\\Roblox\\RobloxPlayerBeta.exe",
      installPath: "C:\\Games\\Roblox",
      focusProcess: "RobloxPlayerBeta",
      artworkUrl: "./assets/nova-deck-logo.svg",
      artworkType: "icon",
      custom: false
    },
    {
      id: "preview:custom",
      title: "Indie Racer",
      source: "Custom",
      launchType: "exe",
      launchTarget: "C:\\Games\\Indie Racer\\Racer.exe",
      installPath: "C:\\Games\\Indie Racer",
      focusProcess: "Racer",
      artworkUrl: "./assets/nova-deck-logo.svg",
      artworkType: "icon",
      custom: true
    }
  ];
  const previewJavaControls = [
    { key: "java_bridge.button0", buttonIndex: 0, label: "A / Cross" },
    { key: "java_bridge.button1", buttonIndex: 1, label: "B / Circle" },
    { key: "java_bridge.button2", buttonIndex: 2, label: "X / Square" },
    { key: "java_bridge.button3", buttonIndex: 3, label: "Y / Triangle" },
    { key: "java_bridge.button4", buttonIndex: 4, label: "LB / L1" },
    { key: "java_bridge.button5", buttonIndex: 5, label: "RB / R1" },
    { key: "java_bridge.button6", buttonIndex: 6, label: "LT / L2" },
    { key: "java_bridge.button7", buttonIndex: 7, label: "RT / R2" },
    { key: "java_bridge.button8", buttonIndex: 8, label: "View / Share" },
    { key: "java_bridge.button9", buttonIndex: 9, label: "Menu / Options" },
    { key: "java_bridge.button10", buttonIndex: 10, label: "Left Stick" },
    { key: "java_bridge.button11", buttonIndex: 11, label: "Right Stick" },
    { key: "java_bridge.button12", buttonIndex: 12, label: "D-pad Up" },
    { key: "java_bridge.button13", buttonIndex: 13, label: "D-pad Down" },
    { key: "java_bridge.button14", buttonIndex: 14, label: "D-pad Left" },
    { key: "java_bridge.button15", buttonIndex: 15, label: "D-pad Right" }
  ];
  const previewJavaOutputOptions = [
    { value: "none", label: "Unassigned" },
    { value: "mouse:left", label: "Left click / Attack" },
    { value: "mouse:right", label: "Right click / Use" },
    { value: "wheel:up", label: "Mouse wheel up" },
    { value: "wheel:down", label: "Mouse wheel down" },
    { value: "key:Space", label: "Space / Jump" },
    { value: "key:Shift", label: "Shift / Sneak" },
    { value: "key:Control", label: "Control / Sprint" },
    { value: "key:E", label: "E / Inventory" },
    { value: "key:Q", label: "Q / Drop" },
    { value: "key:F3", label: "F3 / Debug" },
    { value: "key:F5", label: "F5 / Perspective" },
    { value: "key:Escape", label: "Escape / Menu" },
    { value: "key:1", label: "Hotbar 1" },
    { value: "key:2", label: "Hotbar 2" },
    { value: "key:3", label: "Hotbar 3" },
    { value: "key:4", label: "Hotbar 4" },
    { value: "key:5", label: "Hotbar 5" },
    { value: "key:6", label: "Hotbar 6" },
    { value: "key:7", label: "Hotbar 7" },
    { value: "key:8", label: "Hotbar 8" },
    { value: "key:9", label: "Hotbar 9" }
  ];
  const previewUniversalControls = [
    { key: "universal_bridge.button0", buttonIndex: 0, label: "A / Cross" },
    { key: "universal_bridge.button1", buttonIndex: 1, label: "B / Circle" },
    { key: "universal_bridge.button2", buttonIndex: 2, label: "X / Square" },
    { key: "universal_bridge.button3", buttonIndex: 3, label: "Y / Triangle" },
    { key: "universal_bridge.button4", buttonIndex: 4, label: "LB / L1" },
    { key: "universal_bridge.button5", buttonIndex: 5, label: "RB / R1" },
    { key: "universal_bridge.button6", buttonIndex: 6, label: "LT / L2" },
    { key: "universal_bridge.button7", buttonIndex: 7, label: "RT / R2" },
    { key: "universal_bridge.button8", buttonIndex: 8, label: "View / Share" },
    { key: "universal_bridge.button9", buttonIndex: 9, label: "Menu / Options" },
    { key: "universal_bridge.button10", buttonIndex: 10, label: "Left Stick" },
    { key: "universal_bridge.button11", buttonIndex: 11, label: "Right Stick" },
    { key: "universal_bridge.button12", buttonIndex: 12, label: "D-pad Up" },
    { key: "universal_bridge.button13", buttonIndex: 13, label: "D-pad Down" },
    { key: "universal_bridge.button14", buttonIndex: 14, label: "D-pad Left" },
    { key: "universal_bridge.button15", buttonIndex: 15, label: "D-pad Right" }
  ];
  const previewUniversalOutputOptions = [
    { value: "none", label: "Unassigned" },
    { value: "mouse:left", label: "Left click" },
    { value: "mouse:right", label: "Right click" },
    { value: "wheel:up", label: "Mouse wheel up" },
    { value: "wheel:down", label: "Mouse wheel down" },
    { value: "key:Space", label: "Space" },
    { value: "key:Shift", label: "Shift" },
    { value: "key:Control", label: "Control" },
    { value: "key:Tab", label: "Tab" },
    { value: "key:Escape", label: "Escape" },
    { value: "key:Enter", label: "Enter" },
    { value: "key:E", label: "E" },
    { value: "key:Q", label: "Q" },
    { value: "key:R", label: "R" },
    { value: "key:F", label: "F" },
    { value: "key:C", label: "C" },
    { value: "key:X", label: "X" },
    { value: "key:Z", label: "Z" },
    { value: "key:I", label: "I" },
    { value: "key:M", label: "M" },
    { value: "key:F3", label: "F3" },
    { value: "key:F5", label: "F5" },
    { value: "key:Up", label: "Arrow up" },
    { value: "key:Down", label: "Arrow down" },
    { value: "key:Left", label: "Arrow left" },
    { value: "key:Right", label: "Arrow right" },
    { value: "key:1", label: "1" },
    { value: "key:2", label: "2" },
    { value: "key:3", label: "3" },
    { value: "key:4", label: "4" },
    { value: "key:5", label: "5" },
    { value: "key:6", label: "6" },
    { value: "key:7", label: "7" },
    { value: "key:8", label: "8" },
    { value: "key:9", label: "9" }
  ];

  const getPreviewJavaPreferences = () => ({
    supported: true,
    kind: "minecraft-java-bridge",
    title: "Minecraft Java",
    status: "ready",
    message: "After Minecraft is focused, Nova Deck converts controller input into keyboard and mouse input for the game window.",
    profileName: "Vanilla input bridge",
    controlTitle: "Button Mapping",
    toggleTitle: "Bridge",
    sliderTitle: "Sticks",
    bridge: cloneSettings(previewJavaBridge),
    controls: previewJavaControls.map((control) => ({
      ...control,
      value: previewJavaBridge.controls[control.key],
      options: previewJavaOutputOptions
    })),
    toggles: [
      { key: "java_bridge.enabled", label: "Java input bridge", enabled: previewJavaBridge.enabled }
    ],
    sliders: [
      { key: "java_bridge.deadzone", label: "Stick deadzone", min: 0.1, max: 0.7, step: 0.05, value: previewJavaBridge.deadzone },
      { key: "java_bridge.lookSensitivity", label: "Look sensitivity", min: 0.2, max: 3, step: 0.1, value: previewJavaBridge.lookSensitivity },
      { key: "java_bridge.menuCursorSensitivity", label: "Menu cursor speed", min: 0.4, max: 3, step: 0.1, value: previewJavaBridge.menuCursorSensitivity }
    ]
  });

  const getPreviewUniversalPreferences = (game) => ({
    supported: true,
    kind: "universal-controller-bridge",
    title: game && game.title ? game.title : "Local Game",
    status: "ready",
    message: "For games without solid controller support, Nova Deck can convert the focused game window into keyboard and mouse input.",
    profileName: game && game.focusProcess ? game.focusProcess : "Window title targeting",
    controlTitle: "Button Mapping",
    toggleTitle: "Universal Bridge",
    sliderTitle: "Sticks",
    bridge: cloneSettings(previewUniversalBridge),
    bridgeTargets: {
      processNames: game && game.focusProcess ? [String(game.focusProcess).toLowerCase()] : [],
      titleTerms: game && game.title ? [String(game.title).toLowerCase()] : []
    },
    nativeBindingSupport: {
      supported: false,
      message: "Native in-game binding editing needs a per-game adapter because every game stores controller binds differently."
    },
    controls: previewUniversalControls.map((control) => ({
      ...control,
      value: previewUniversalBridge.controls[control.key],
      options: previewUniversalOutputOptions
    })),
    toggles: [
      { key: "universal_bridge.enabled", label: "Universal input bridge", enabled: previewUniversalBridge.enabled }
    ],
    sliders: [
      { key: "universal_bridge.deadzone", label: "Stick deadzone", min: 0.1, max: 0.7, step: 0.05, value: previewUniversalBridge.deadzone },
      { key: "universal_bridge.lookSensitivity", label: "Look sensitivity", min: 0.2, max: 3, step: 0.1, value: previewUniversalBridge.lookSensitivity },
      { key: "universal_bridge.menuCursorSensitivity", label: "Menu cursor speed", min: 0.4, max: 3, step: 0.1, value: previewUniversalBridge.menuCursorSensitivity }
    ]
  });

  return {
    async scanLibrary() {
      await delay(250);
      return previewGames;
    },
    async getCustomGames() {
      return previewGames.filter((game) => game.custom);
    },
    async addGame() {
      return null;
    },
    async removeCustomGame(gameId) {
      const index = previewGames.findIndex((game) => game.id === gameId);
      if (index >= 0) {
        previewGames.splice(index, 1);
      }
      return previewGames.filter((game) => game.custom);
    },
    async getControllerSettings() {
      return cloneControllerSettings(previewControllerSettings);
    },
    async updateControllerSettings(settings) {
      previewControllerSettings = normalizeControllerSettings(settings);
      return cloneControllerSettings(previewControllerSettings);
    },
    async getAppSettings() {
      return cloneSettings(previewAppSettings);
    },
    async updateAppSettings(settings) {
      previewAppSettings = normalizeAppSettings(settings);
      return cloneSettings(previewAppSettings);
    },
    async getStartupEnabled() {
      return previewStartupEnabled;
    },
    async setStartupEnabled(enabled) {
      previewStartupEnabled = Boolean(enabled);
      return previewStartupEnabled;
    },
    async getUpdateStatus() {
      return normalizeUpdateStatus(previewUpdateStatus);
    },
    async checkForUpdates() {
      previewUpdateStatus = normalizeUpdateStatus({
        status: "development",
        message: "Background ZIP updates run in packaged consumer builds.",
        canCheck: false,
        canInstall: false,
        percent: 0
      });
      return normalizeUpdateStatus(previewUpdateStatus);
    },
    async installUpdate() {
      return false;
    },
    async getGamePreferences(game) {
      if (game && game.id === "preview:minecraft-java") {
        return getPreviewJavaPreferences();
      }
      if (game && /minecraft/i.test(`${game.title} ${game.source}`)) {
        return {
          supported: true,
          kind: "minecraft-bedrock",
          title: "Minecraft for Windows",
          status: "ready",
          message: "Preview preferences.",
          optionsPath: "C:\\Users\\Player\\AppData\\Roaming\\Minecraft Bedrock\\Users\\Preview\\games\\com.mojang\\minecraftpe\\options.txt",
          folderPath: "C:\\Users\\Player\\AppData\\Roaming\\Minecraft Bedrock\\Users\\Preview\\games\\com.mojang\\minecraftpe",
          profileName: "Preview",
          controls: [
            { key: "ctrl_type_0_key.attack", label: "Attack / Destroy", value: "-99", options: [{ value: "-99", label: "Right Trigger / R2" }, { value: "1", label: "A / Cross" }, { value: "2", label: "B / Circle" }] },
            { key: "ctrl_type_0_key.use", label: "Use / Place", value: "-100", options: [{ value: "-100", label: "Left Trigger / L2" }, { value: "1", label: "A / Cross" }, { value: "2", label: "B / Circle" }] },
            { key: "ctrl_type_0_key.jump", label: "Jump", value: "1", options: [{ value: "1", label: "A / Cross" }, { value: "2", label: "B / Circle" }] },
            { key: "ctrl_type_0_key.sneak", label: "Sneak / Fly Down", value: "2", options: [{ value: "1", label: "A / Cross" }, { value: "2", label: "B / Circle" }] }
          ],
          toggles: [
            { key: "ctrl_autojump_gamepad", label: "Auto-jump", enabled: false },
            { key: "ctrl_swapjumpandsneak", label: "Swap jump/sneak", enabled: false }
          ],
          sliders: [
            { key: "ctrl_sensitivity2_gamepad", label: "Look sensitivity", min: 0, max: 1, step: 0.05, value: 0.5 }
          ]
        };
      }
      return getPreviewUniversalPreferences(game);
    },
    async updateGamePreference(game, update) {
      if (game && game.id === "preview:minecraft-java") {
        if (update && update.key === "java_bridge.enabled") {
          previewJavaBridge.enabled = update.value === "1" || update.value === true;
        } else if (update && update.key === "java_bridge.deadzone") {
          previewJavaBridge.deadzone = clampNumber(update.value, previewJavaBridge.deadzone, 0.1, 0.7);
        } else if (update && update.key === "java_bridge.lookSensitivity") {
          previewJavaBridge.lookSensitivity = clampNumber(update.value, previewJavaBridge.lookSensitivity, 0.2, 3);
        } else if (update && update.key === "java_bridge.menuCursorSensitivity") {
          previewJavaBridge.menuCursorSensitivity = clampNumber(update.value, previewJavaBridge.menuCursorSensitivity, 0.4, 3);
        } else if (update && update.key && update.key.startsWith("java_bridge.button")) {
          const allowedValues = new Set(previewJavaOutputOptions.map((option) => option.value));
          if (allowedValues.has(update.value)) {
            previewJavaBridge.controls[update.key] = update.value;
          }
        }
        return getPreviewJavaPreferences();
      }

      if (game && !/minecraft/i.test(`${game.title} ${game.source}`)) {
        if (update && update.key === "universal_bridge.enabled") {
          previewUniversalBridge.enabled = update.value === "1" || update.value === true;
        } else if (update && update.key === "universal_bridge.deadzone") {
          previewUniversalBridge.deadzone = clampNumber(update.value, previewUniversalBridge.deadzone, 0.1, 0.7);
        } else if (update && update.key === "universal_bridge.lookSensitivity") {
          previewUniversalBridge.lookSensitivity = clampNumber(update.value, previewUniversalBridge.lookSensitivity, 0.2, 3);
        } else if (update && update.key === "universal_bridge.menuCursorSensitivity") {
          previewUniversalBridge.menuCursorSensitivity = clampNumber(update.value, previewUniversalBridge.menuCursorSensitivity, 0.4, 3);
        } else if (update && update.key && update.key.startsWith("universal_bridge.button")) {
          const allowedValues = new Set(previewUniversalOutputOptions.map((option) => option.value));
          if (allowedValues.has(update.value)) {
            previewUniversalBridge.controls[update.key] = update.value;
          }
        }
        return getPreviewUniversalPreferences(game);
      }

      const preferences = await this.getGamePreferences(game);
      preferences.message = update && update.key ? "Preview preference saved." : preferences.message;
      return preferences;
    },
    async sendVirtualInput() {
      return true;
    },
    async setInputBridgeProfile() {
      return true;
    },
    async clearInputBridgeProfile() {
      return true;
    },
    async stopVirtualInput() {
      return true;
    },
    onUpdateStatus() {
      return () => {};
    },
    async launchGame(game) {
      return {
        ok: true,
        message: `Preview launch: ${game.title}.`
      };
    },
    async toggleFullscreen() {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        return true;
      }
      await document.exitFullscreen();
      return false;
    },
    async isFullscreen() {
      return Boolean(document.fullscreenElement);
    },
    async openPath() {
      return false;
    },
    onFullscreenChanged(callback) {
      const listener = () => callback(Boolean(document.fullscreenElement));
      document.addEventListener("fullscreenchange", listener);
      return () => document.removeEventListener("fullscreenchange", listener);
    },
    async getMeta() {
      return {
        appPath: "",
        userDataPath: "",
        version: "preview"
      };
    }
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
