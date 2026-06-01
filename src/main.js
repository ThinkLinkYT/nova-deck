const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { scanGames, gameFromFile } = require("./scanner");
const { launchGame } = require("./launcher");
const { createStore } = require("./storage");
const { enrichGamesWithArtwork, pathToFileUrl } = require("./icon-cache");
const { getGamePreferences, updateGamePreference } = require("./game-preferences");
const {
  setupInputBridge,
  sendVirtualInput,
  setInputBridgeProfile,
  clearInputBridgeProfile,
  stopInputBridge
} = require("./input-bridge");
const { setupUpdater, getUpdateStatus, checkForUpdates, installUpdate } = require("./updater");

let mainWindow;
let store;

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
  stopInputBridge();
});

ipcMain.handle("library:scan", async () => {
  const customGames = store.getCustomGames();
  const detectedGames = await scanGames();
  return enrichGamesWithArtwork(mergeGames(detectedGames, customGames), app.getPath("userData"));
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
  return fs.existsSync(getStartupScriptPath());
}

function setStartupEnabled(enabled) {
  const startupScriptPath = getStartupScriptPath();
  if (!enabled) {
    fs.rmSync(startupScriptPath, { force: true });
    return false;
  }

  fs.mkdirSync(path.dirname(startupScriptPath), { recursive: true });
  fs.writeFileSync(startupScriptPath, buildStartupScript(), "utf8");
  return true;
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

function buildStartupScript() {
  const electronPath = process.execPath;
  const appRoot = app.getAppPath();
  return [
    "@echo off",
    `set "APP_DIR=${appRoot}"`,
    `start "" "${electronPath}" "%APP_DIR%"`
  ].join("\r\n");
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
