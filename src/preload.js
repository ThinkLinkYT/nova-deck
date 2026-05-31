const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nova", {
  scanLibrary: () => ipcRenderer.invoke("library:scan"),
  getCustomGames: () => ipcRenderer.invoke("library:get-custom"),
  addGame: () => ipcRenderer.invoke("library:add-game"),
  removeCustomGame: (gameId) => ipcRenderer.invoke("library:remove-custom", gameId),
  getControllerSettings: () => ipcRenderer.invoke("settings:get-controller"),
  updateControllerSettings: (settings) => ipcRenderer.invoke("settings:update-controller", settings),
  getAppSettings: () => ipcRenderer.invoke("settings:get-app"),
  updateAppSettings: (settings) => ipcRenderer.invoke("settings:update-app", settings),
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
  onFullscreenChanged: (callback) => {
    const listener = (_event, isFullscreen) => callback(Boolean(isFullscreen));
    ipcRenderer.on("app:fullscreen-changed", listener);
    return () => ipcRenderer.removeListener("app:fullscreen-changed", listener);
  },
  getMeta: () => ipcRenderer.invoke("app:get-meta")
});
