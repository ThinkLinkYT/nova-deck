const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen, shell } = require("electron");
const { scanGames, gameFromFile } = require("./scanner");
const { launchGame } = require("./launcher");
const { createStore } = require("./storage");
const { enrichGamesWithArtwork, pathToFileUrl } = require("./icon-cache");
const { getGamePreferences, updateGamePreference } = require("./game-preferences");
const { getSystemSnapshot } = require("./system-monitor");
const {
  setupInputBridge,
  sendVirtualInput,
  setInputBridgeProfile,
  clearInputBridgeProfile,
  stopInputBridge
} = require("./input-bridge");
const { setupUpdater, getUpdateStatus, checkForUpdates, installUpdate } = require("./updater");

let mainWindow;
let overlayWindow;
let store;
let overlayContext = {};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#07080b",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "renderer", "assets", "nova-deck-icon.ico"),
    title: "Nova Deck",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.on("enter-full-screen", () => {
    mainWindow.webContents.send("app:fullscreen-changed", true);
  });

  mainWindow.on("leave-full-screen", () => {
    mainWindow.webContents.send("app:fullscreen-changed", false);
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId("local.nova.deck");
  store = createStore(app.getPath("userData"));
  createWindow();
  migrateLegacyStartupSetting();
  registerOverlayShortcuts();
  setupInputBridge({ app });
  setupUpdater({
    app,
    getMainWindow: () => mainWindow
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  globalShortcut.unregisterAll();
  stopInputBridge();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

ipcMain.handle("library:scan", async () => {
  const detectedGames = await scanGames();
  const enrichedDetectedGames = await enrichGamesWithArtwork(detectedGames, app.getPath("userData"));
  const libraryState = store.updateDetectedGames(enrichedDetectedGames);
  return buildLibraryPayload(libraryState.detectedGames, libraryState.libraryScannedAt);
});

ipcMain.handle("library:get", async () => {
  return buildLibraryPayload(store.getDetectedGames(), store.getLibraryScannedAt());
});

ipcMain.handle("library:get-custom", () => {
  return store.getCustomGames();
});

ipcMain.handle("library:add-game", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Add Game",
    properties: ["openFile"],
    filters: [
      { name: "Games and shortcuts", extensions: ["exe", "lnk", "url"] },
      { name: "Executable", extensions: ["exe"] },
      { name: "Shortcut", extensions: ["lnk", "url"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const game = await gameFromFile(result.filePaths[0]);
  if (!game) {
    return null;
  }

  return store.upsertCustomGame(game);
});

ipcMain.handle("library:remove-custom", (_event, gameId) => {
  return store.removeCustomGame(gameId);
});

ipcMain.handle("library:choose-artwork", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose Game Icon",
    properties: ["openFile"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "ico"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const artworkPath = result.filePaths[0];
  return {
    artworkPath,
    artworkUrl: pathToFileUrl(artworkPath)
  };
});

ipcMain.handle("settings:get-controller", () => {
  return store.getControllerSettings();
});

ipcMain.handle("settings:update-controller", (_event, settings) => {
  return store.updateControllerSettings(settings);
});

ipcMain.handle("settings:get-app", () => {
  return store.getAppSettings();
});

ipcMain.handle("settings:update-app", (_event, settings) => {
  return store.updateAppSettings(settings);
});

ipcMain.handle("system:get-snapshot", () => {
  return getSystemSnapshot(app);
});

ipcMain.handle("overlay:set-context", (_event, context) => {
  overlayContext = normalizeOverlayContext(context);
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("overlay:context", buildOverlayPayload());
  }
  return true;
});

ipcMain.handle("overlay:get-context", () => {
  return buildOverlayPayload();
});

ipcMain.handle("overlay:toggle", () => {
  return toggleOverlay();
});

ipcMain.handle("overlay:hide", () => {
  hideOverlay();
  return true;
});

ipcMain.handle("overlay:main-action", (_event, action) => {
  return runOverlayMainAction(action);
});

ipcMain.handle("overlay:launch-current", () => {
  return launchOverlayGame();
});

ipcMain.handle("profiles:get-all", () => {
  return store.getGameProfiles();
});

ipcMain.handle("profiles:update", (_event, gameId, update) => {
  return store.updateGameProfile(gameId, update);
});

ipcMain.handle("settings:get-startup-enabled", () => {
  return isStartupEnabled();
});

ipcMain.handle("settings:set-startup-enabled", (_event, enabled) => {
  return setStartupEnabled(Boolean(enabled));
});

ipcMain.handle("updates:get-status", () => {
  return getUpdateStatus();
});

ipcMain.handle("updates:check", () => {
  return checkForUpdates();
});

ipcMain.handle("updates:install", () => {
  return installUpdate();
});

ipcMain.handle("game:get-preferences", (_event, game) => {
  return getGamePreferences(game, store.getGamePreferenceSettings(game && game.id));
});

ipcMain.handle("game:update-preference", (_event, game, update) => {
  const result = updateGamePreference(game, update, store.getGamePreferenceSettings(game && game.id));
  if (result.settings) {
    store.updateGamePreferenceSettings(game && game.id, result.settings);
  }
  return result.preferences;
});

ipcMain.handle("input:send", (_event, events) => {
  return sendVirtualInput(events);
});

ipcMain.handle("input:set-profile", (_event, profile) => {
  return setInputBridgeProfile(profile);
});

ipcMain.handle("input:clear-profile", () => {
  return clearInputBridgeProfile();
});

ipcMain.handle("input:stop", () => {
  return stopInputBridge();
});

ipcMain.handle("game:launch", async (_event, game) => {
  const profile = store.getGameProfile(game && game.id);
  const result = await launchGame({
    ...game,
    launchArgs: profile.launchArgs || game.launchArgs || ""
  }, shell);

  if (result.ok && game && game.id) {
    store.updateGameProfile(game.id, {
      ...profile,
      playCount: Number(profile.playCount || 0) + 1,
      lastPlayedAt: Date.now()
    });
  }

  return result;
});

ipcMain.handle("app:toggle-fullscreen", () => {
  if (!mainWindow) {
    return false;
  }

  const nextState = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(nextState);
  return nextState;
});

ipcMain.handle("app:is-fullscreen", () => {
  return mainWindow ? mainWindow.isFullScreen() : false;
});

ipcMain.handle("app:get-meta", () => {
  return {
    appName: "Nova Deck",
    appPath: app.getAppPath(),
    userDataPath: app.getPath("userData"),
    version: app.getVersion()
  };
});

ipcMain.handle("app:open-path", async (_event, targetPath) => {
  if (!targetPath) {
    return false;
  }
  await shell.openPath(targetPath);
  return true;
});

ipcMain.handle("app:power-action", async (_event, action) => {
  return runPowerAction(action);
});

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 560,
    height: 760,
    minWidth: 440,
    minHeight: 560,
    maxWidth: 700,
    maxHeight: 920,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    backgroundColor: "#00000000",
    icon: path.join(__dirname, "renderer", "assets", "nova-deck-icon.ico"),
    title: "Nova Overlay",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.loadFile(path.join(__dirname, "renderer", "overlay.html"));

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

function registerOverlayShortcuts() {
  globalShortcut.register("CommandOrControl+Shift+N", () => {
    toggleOverlay();
  });
}

function toggleOverlay() {
  if (overlayWindow && overlayWindow.isVisible()) {
    hideOverlay();
    return false;
  }

  return showOverlay();
}

function showOverlay() {
  if (!isOverlayEnabled()) {
    return false;
  }

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
  }

  positionOverlayWindow();
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.show();
  overlayWindow.focus();
  overlayWindow.webContents.send("overlay:context", buildOverlayPayload());
  return true;
}

function hideOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
}

function positionOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) || screen.getPrimaryDisplay();
  const workArea = display.workArea || display.bounds;
  const bounds = overlayWindow.getBounds();
  const x = Math.round(workArea.x + workArea.width - bounds.width - 28);
  const y = Math.round(workArea.y + Math.max(24, (workArea.height - bounds.height) / 2));
  overlayWindow.setPosition(x, y, false);
}

function isOverlayEnabled() {
  if (!store) {
    return true;
  }

  return store.getAppSettings().overlayEnabled !== false;
}

function buildOverlayPayload() {
  return {
    ...overlayContext,
    appName: "Nova Deck",
    version: app.getVersion(),
    overlayEnabled: isOverlayEnabled(),
    updateStatus: getUpdateStatus(),
    timestamp: Date.now()
  };
}

function normalizeOverlayContext(context) {
  const input = context && typeof context === "object" && !Array.isArray(context) ? context : {};
  return {
    activeView: normalizeOverlayText(input.activeView, "home", 40),
    libraryCount: normalizeOverlayInteger(input.libraryCount),
    controllerLabel: normalizeOverlayText(input.controllerLabel, "Disconnected", 120),
    wheelLabel: normalizeOverlayText(input.wheelLabel, "No wheel", 120),
    inputLabel: normalizeOverlayText(input.inputLabel, "Game default", 120),
    themeLabel: normalizeOverlayText(input.themeLabel, "Nova", 80),
    audioLabel: normalizeOverlayText(input.audioLabel, "System default", 180),
    currentGame: normalizeOverlayGame(input.currentGame),
    currentProfile: normalizeOverlayProfile(input.currentProfile)
  };
}

function normalizeOverlayGame(game) {
  if (!game || typeof game !== "object" || Array.isArray(game)) {
    return null;
  }

  return {
    id: normalizeOverlayText(game.id, "", 180),
    title: normalizeOverlayText(game.title, "Selected Game", 180),
    source: normalizeOverlayText(game.source, "Local", 80),
    installPath: normalizeOverlayText(game.installPath, "", 520),
    launchTarget: normalizeOverlayText(game.launchTarget, "", 520),
    executablePath: normalizeOverlayText(game.executablePath, "", 520),
    focusProcess: normalizeOverlayText(game.focusProcess, "", 120),
    launchType: normalizeOverlayText(game.launchType, "", 80),
    launchArgs: normalizeOverlayText(game.launchArgs, "", 260),
    artworkUrl: normalizeOverlayText(game.artworkUrl, "", 900),
    custom: Boolean(game.custom)
  };
}

function normalizeOverlayProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return {};
  }

  return {
    favorite: Boolean(profile.favorite),
    accountLabel: normalizeOverlayText(profile.accountLabel, "", 80),
    profileName: normalizeOverlayText(profile.profileName, "", 80),
    launchArgs: normalizeOverlayText(profile.launchArgs, "", 260),
    playCount: normalizeOverlayInteger(profile.playCount),
    lastPlayedAt: normalizeOverlayInteger(profile.lastPlayedAt)
  };
}

function normalizeOverlayText(value, fallback, maxLength) {
  if (typeof value !== "string") {
    return fallback;
  }

  const text = value.trim();
  return (text || fallback).slice(0, maxLength);
}

function normalizeOverlayInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function runOverlayMainAction(action) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }

  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("app:action", action);
  hideOverlay();
  return true;
}

async function launchOverlayGame() {
  const game = overlayContext.currentGame;
  if (!game || !game.id) {
    return {
      ok: false,
      message: "No game is selected in Nova Deck."
    };
  }

  const profile = store.getGameProfile(game.id);
  const result = await launchGame({
    ...game,
    launchArgs: profile.launchArgs || game.launchArgs || ""
  }, shell);

  if (result.ok) {
    store.updateGameProfile(game.id, {
      ...profile,
      playCount: Number(profile.playCount || 0) + 1,
      lastPlayedAt: Date.now()
    });
  }

  return result;
}

function mergeGames(detectedGames, customGames) {
  const byId = new Map();

  for (const game of detectedGames) {
    byId.set(game.id, game);
  }

  for (const game of customGames) {
    byId.set(game.id, {
      ...game,
      custom: true
    });
  }

  return Array.from(byId.values()).sort((a, b) => {
    const sourceCompare = sourceRank(a.source) - sourceRank(b.source);
    if (sourceCompare !== 0) {
      return sourceCompare;
    }

    return a.title.localeCompare(b.title);
  });
}

async function buildLibraryPayload(detectedGames, scannedAt) {
  const customGames = store.getCustomGames();
  const games = await enrichGamesWithArtwork(mergeGames(detectedGames, customGames), app.getPath("userData"));
  return {
    games,
    scannedAt: Number(scannedAt || 0)
  };
}

function sourceRank(source) {
  if (source === "Steam") {
    return 0;
  }
  if (source === "Epic") {
    return 1;
  }
  if (source === "Custom") {
    return 2;
  }
  return 3;
}

function isStartupEnabled() {
  const settings = app.getLoginItemSettings(getStartupLoginItemSettings(false));
  return Boolean(settings.openAtLogin || fs.existsSync(getStartupScriptPath()));
}

function setStartupEnabled(enabled) {
  cleanupLegacyStartupScript();
  app.setLoginItemSettings(getStartupLoginItemSettings(enabled));
  return Boolean(app.getLoginItemSettings(getStartupLoginItemSettings(false)).openAtLogin);
}

function getStartupScriptPath() {
  return path.join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    "Nova Deck.cmd"
  );
}

function migrateLegacyStartupSetting() {
  if (!fs.existsSync(getStartupScriptPath())) {
    return;
  }

  cleanupLegacyStartupScript();
  app.setLoginItemSettings(getStartupLoginItemSettings(true));
}

function cleanupLegacyStartupScript() {
  fs.rmSync(getStartupScriptPath(), { force: true });
}

function getStartupLoginItemSettings(openAtLogin) {
  return {
    openAtLogin: Boolean(openAtLogin),
    path: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()]
  };
}

function runPowerAction(action) {
  if (action === "exit") {
    app.quit();
    return true;
  }

  if (action === "restart-app") {
    app.relaunch();
    app.exit(0);
    return true;
  }

  if (action === "sleep") {
    execFile("rundll32.exe", ["powrprof.dll,SetSuspendState", "0,1,0"], { windowsHide: true }, () => {});
    return true;
  }

  if (action === "shutdown") {
    execFile("shutdown.exe", ["/s", "/t", "0"], { windowsHide: true }, () => {});
    return true;
  }

  if (action === "restart-pc") {
    execFile("shutdown.exe", ["/r", "/t", "0"], { windowsHide: true }, () => {});
    return true;
  }

  return false;
}
