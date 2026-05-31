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
  canInstall: false,
  percent: 0,
  version: "",
  transferredBytes: 0,
  totalBytes: 0
};

function setupUpdater(options) {
  electronApp = options.app;
  getMainWindow = options.getMainWindow;

  if (!autoUpdater) {
    setUpdateState({
      status: "unavailable",
      message: "Updater is not installed in this build.",
      canCheck: false,
      canInstall: false,
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0
    });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => {
    setUpdateState({
      status: "checking",
      message: "Checking for updates...",
      canCheck: false,
      canInstall: false,
      percent: 0,
      version: "",
      transferredBytes: 0,
      totalBytes: 0
    });
  });

  autoUpdater.on("update-available", (info) => {
    setUpdateState({
      status: "available",
      message: `Version ${info.version} is available. Downloading in Nova Deck...`,
      canCheck: false,
      canInstall: false,
      percent: 0,
      version: info.version || "",
      transferredBytes: 0,
      totalBytes: 0
    });
  });

  autoUpdater.on("update-not-available", () => {
    setUpdateState({
      status: "current",
      message: "Nova Deck is up to date.",
      canCheck: true,
      canInstall: false,
      percent: 0,
      version: "",
      transferredBytes: 0,
      totalBytes: 0
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = clampPercent(progress.percent);
    setUpdateState({
      status: "downloading",
      message: `Downloading update ${Math.round(percent)}%...`,
      canCheck: false,
      canInstall: false,
      percent,
      transferredBytes: normalizeByteCount(progress.transferred),
      totalBytes: normalizeByteCount(progress.total)
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState({
      status: "downloaded",
      message: `Version ${info.version} is ready. Restart Nova Deck to install.`,
      canCheck: true,
      canInstall: true,
      percent: 100,
      version: info.version || ""
    });
  });

  autoUpdater.on("error", () => {
    setUpdateState({
      status: "error",
      message: "Update check failed.",
      canCheck: true,
      canInstall: false,
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0
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
      canInstall: false,
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0
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
      canInstall: false,
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0
    });
  }

  if (!electronApp || !electronApp.isPackaged) {
    return setUpdateState({
      status: "development",
      message: "Auto-updates run in packaged consumer builds.",
      canCheck: false,
      canInstall: false,
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0
    });
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch {
    return setUpdateState({
      status: "error",
      message: "Update check failed.",
      canCheck: true,
      canInstall: false,
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0
    });
  }

  return getUpdateStatus();
}

function installUpdate() {
  if (!autoUpdater || !updateState.canInstall) {
    return false;
  }

  setUpdateState({
    status: "installing",
    message: "Restarting Nova Deck to finish the update...",
    canCheck: false,
    canInstall: false,
    percent: 100
  });

  setImmediate(() => {
    autoUpdater.quitAndInstall(true, true);
  });
  return true;
}

function setUpdateState(nextState) {
  updateState = {
    ...updateState,
    ...nextState,
    percent: clampPercent(nextState.percent ?? updateState.percent),
    transferredBytes: normalizeByteCount(nextState.transferredBytes ?? updateState.transferredBytes),
    totalBytes: normalizeByteCount(nextState.totalBytes ?? updateState.totalBytes)
  };

  const mainWindow = getMainWindow ? getMainWindow() : null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    updateTaskbarProgress(mainWindow);
    mainWindow.webContents.send("updates:status", getUpdateStatus());
  }

  return getUpdateStatus();
}

function updateTaskbarProgress(mainWindow) {
  if (typeof mainWindow.setProgressBar !== "function") {
    return;
  }

  if (updateState.status === "downloading") {
    mainWindow.setProgressBar(updateState.percent / 100);
    return;
  }

  mainWindow.setProgressBar(-1);
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.min(100, Math.max(0, number));
}

function normalizeByteCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }
  return Math.round(number);
}

module.exports = {
  setupUpdater,
  getUpdateStatus,
  checkForUpdates,
  installUpdate
};
