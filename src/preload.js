const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nova", {
  getLibrary: () => ipcRenderer.invoke("library:get"),
  scanLibrary: () => ipcRenderer.invoke("library:scan"),
  getCustomGames: () => ipcRenderer.invoke("library:get-custom"),
  addGame: () => ipcRenderer.invoke("library:add-game"),
  removeCustomGame: (gameId) => ipcRenderer.invoke("library:remove-custom", gameId),
  chooseArtwork: () => ipcRenderer.invoke("library:choose-artwork"),
  getControllerSettings: () => ipcRenderer.invoke("settings:get-controller"),
  updateControllerSettings: (settings) => ipcRenderer.invoke("settings:update-controller", settings),
  getAppSettings: () => ipcRenderer.invoke("settings:get-app"),
  updateAppSettings: (settings) => ipcRenderer.invoke("settings:update-app", settings),
  getSystemSnapshot: () => ipcRenderer.invoke("system:get-snapshot"),
  setOverlayContext: (context) => ipcRenderer.invoke("overlay:set-context", context),
  getOverlayContext: () => ipcRenderer.invoke("overlay:get-context"),
  toggleOverlay: () => ipcRenderer.invoke("overlay:toggle"),
  hideOverlay: () => ipcRenderer.invoke("overlay:hide"),
  runOverlayAction: (action) => ipcRenderer.invoke("overlay:main-action", action),
  launchOverlayGame: () => ipcRenderer.invoke("overlay:launch-current"),
  getGameProfiles: () => ipcRenderer.invoke("profiles:get-all"),
  updateGameProfile: (gameId, update) => ipcRenderer.invoke("profiles:update", gameId, update),
  getStartupEnabled: () => ipcRenderer.invoke("settings:get-startup-enabled"),
  setStartupEnabled: (enabled) => ipcRenderer.invoke("settings:set-startup-enabled", enabled),
  getUpdateStatus: () => ipcRenderer.invoke("updates:get-status"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  getGamePreferences: (game) => ipcRenderer.invoke("game:get-preferences", game),
  updateGamePreference: (game, update) => ipcRenderer.invoke("game:update-preference", game, update),
  sendVirtualInput: (events) => ipcRenderer.invoke("input:send", events),
  setInputBridgeProfile: (profile) => ipcRenderer.invoke("input:set-profile", profile),
  clearInputBridgeProfile: () => ipcRenderer.invoke("input:clear-profile"),
  stopVirtualInput: () => ipcRenderer.invoke("input:stop"),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("updates:status", listener);
    return () => ipcRenderer.removeListener("updates:status", listener);
  },
  launchGame: (game) => ipcRenderer.invoke("game:launch", game),
  toggleFullscreen: () => ipcRenderer.invoke("app:toggle-fullscreen"),
  isFullscreen: () => ipcRenderer.invoke("app:is-fullscreen"),
  openPath: (targetPath) => ipcRenderer.invoke("app:open-path", targetPath),
  runPowerAction: (action) => ipcRenderer.invoke("app:power-action", action),
  onFullscreenChanged: (callback) => {
    const listener = (_event, isFullscreen) => callback(Boolean(isFullscreen));
    ipcRenderer.on("app:fullscreen-changed", listener);
    return () => ipcRenderer.removeListener("app:fullscreen-changed", listener);
  },
  onAppAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("app:action", listener);
    return () => ipcRenderer.removeListener("app:action", listener);
  },
  onOverlayContext: (callback) => {
    const listener = (_event, context) => callback(context);
    ipcRenderer.on("overlay:context", listener);
    return () => ipcRenderer.removeListener("overlay:context", listener);
  },
  getMeta: () => ipcRenderer.invoke("app:get-meta")
});
