let autoUpdater = null;

try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch {
  autoUpdater = null;
}

let electronApp = null;
let getMainWindow = null;
let updateState = {
  status: "idle",
  message: "Updates have not been checked yet.",
  canCheck: true,
  canInstall: false
};

function setupUpdater(options) {
  electronApp = options.app;
  getMainWindow = options.getMainWindow;

  if (!autoUpdater) {
    setUpdateState({
      status: "unavailable",
      message: "Updater is not installed in this build.",
      canCheck: false,
      canInstall: false
    });
    return;
  }

  autoUpdater.autoDownload = true;

  autoUpdater.on("checking-for-update", () => {
    setUpdateState({
      status: "checking",
      message: "Checking for updates...",
      canCheck: false,
      canInstall: false
    });
  });

  autoUpdater.on("update-available", (info) => {
    setUpdateState({
      status: "available",
      message: `Version ${info.version} is available. Downloading...`,
      canCheck: false,
      canInstall: false
    });
  });

  autoUpdater.on("update-not-available", () => {
    setUpdateState({
      status: "current",
      message: "Nova Deck is up to date.",
      canCheck: true,
      canInstall: false
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdateState({
      status: "downloading",
      message: `Downloading update ${Math.round(progress.percent || 0)}%...`,
      canCheck: false,
      canInstall: false
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState({
      status: "downloaded",
      message: `Version ${info.version} is ready. Restart to install.`,
      canCheck: true,
      canInstall: true
    });
  });

  autoUpdater.on("error", () => {
    setUpdateState({
      status: "error",
      message: "Update check failed.",
      canCheck: true,
      canInstall: false
    });
  });

  if (electronApp.isPackaged) {
    setTimeout(() => {
      checkForUpdates();
    }, 5000);
  } else {
    setUpdateState({
      status: "development",
      message: "Auto-updates run in packaged consumer builds.",
      canCheck: false,
      canInstall: false
    });
  }
}

function getUpdateStatus() {
  return { ...updateState };
}

async function checkForUpdates() {
  if (!autoUpdater) {
    return setUpdateState({
      status: "unavailable",
      message: "Updater is not installed in this build.",
      canCheck: false,
      canInstall: false
    });
  }

  if (!electronApp || !electronApp.isPackaged) {
    return setUpdateState({
      status: "development",
      message: "Auto-updates run in packaged consumer builds.",
      canCheck: false,
      canInstall: false
    });
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch {
    return setUpdateState({
      status: "error",
      message: "Update check failed.",
      canCheck: true,
      canInstall: false
    });
  }

  return getUpdateStatus();
}

function installUpdate() {
  if (!autoUpdater || !updateState.canInstall) {
    return false;
  }

  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true);
  });
  return true;
}

function setUpdateState(nextState) {
  updateState = {
    ...updateState,
    ...nextState
  };

  const mainWindow = getMainWindow ? getMainWindow() : null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("updates:status", getUpdateStatus());
  }

  return getUpdateStatus();
}

module.exports = {
  setupUpdater,
  getUpdateStatus,
  checkForUpdates,
  installUpdate
};
