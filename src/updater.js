const fs = require("fs");
const path = require("path");
const { autoUpdater } = require("electron-updater");

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let electronApp = null;
let getMainWindow = null;
let updateCheckTimer = null;
let updaterReady = false;
let downloadedUpdate = null;

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
  cleanupLegacyZipUpdaterState();

  if (!electronApp.isPackaged) {
    setUpdateState({
      status: "development",
      message: "Background updates run in packaged consumer builds.",
      canCheck: false,
      canInstall: false,
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0
    });
    return;
  }

  configureAutoUpdater();
  scheduleBackgroundUpdateChecks();
}

function getUpdateStatus() {
  return { ...updateState };
}

async function checkForUpdates() {
  if (!electronApp || !electronApp.isPackaged) {
    return setUpdateState({
      status: "development",
      message: "Background updates run in packaged consumer builds.",
      canCheck: false,
      canInstall: false,
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0
    });
  }

  if (["checking", "available", "downloading", "installing"].includes(updateState.status)) {
    return getUpdateStatus();
  }

  if (updateState.status === "downloaded" && downloadedUpdate) {
    return getUpdateStatus();
  }

  configureAutoUpdater();
  setUpdateState({
    status: "checking",
    message: "Checking for updates...",
    canCheck: false,
    canInstall: false,
    percent: 0,
    transferredBytes: 0,
    totalBytes: 0
  });

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    setUpdaterError(error);
  }

  return getUpdateStatus();
}

function installUpdate() {
  if (!downloadedUpdate || updateState.status !== "downloaded") {
    return false;
  }

  setUpdateState({
    status: "installing",
    message: "Restarting Nova Deck to apply the downloaded update...",
    canCheck: false,
    canInstall: false,
    percent: 100
  });

  try {
    autoUpdater.quitAndInstall(true, true);
    return true;
  } catch (error) {
    setUpdaterError(error);
    return false;
  }
}

function configureAutoUpdater() {
  if (updaterReady) {
    return;
  }

  updaterReady = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
  };

  autoUpdater.on("checking-for-update", () => {
    setUpdateState({
      status: "checking",
      message: "Checking for updates...",
      canCheck: false,
      canInstall: false,
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0
    });
  });

  autoUpdater.on("update-available", (info) => {
    downloadedUpdate = null;
    setUpdateState({
      status: "available",
      message: `Version ${normalizeVersion(info && info.version)} is available. Downloading in the background...`,
      canCheck: false,
      canInstall: false,
      percent: 0,
      version: normalizeVersion(info && info.version),
      transferredBytes: 0,
      totalBytes: 0
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdateState({
      status: "downloading",
      message: `Downloading update ${Math.round(clampPercent(progress && progress.percent))}%...`,
      canCheck: false,
      canInstall: false,
      percent: progress && progress.percent,
      transferredBytes: progress && progress.transferred,
      totalBytes: progress && progress.total
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    downloadedUpdate = info || {};
    setUpdateState({
      status: "downloaded",
      message: `Version ${normalizeVersion(info && info.version)} is ready. Restart Nova Deck to apply it.`,
      canCheck: false,
      canInstall: true,
      percent: 100,
      version: normalizeVersion(info && info.version),
      transferredBytes: updateState.totalBytes,
      totalBytes: updateState.totalBytes
    });
  });

  autoUpdater.on("update-not-available", () => {
    downloadedUpdate = null;
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

  autoUpdater.on("error", setUpdaterError);
}

function setUpdaterError(error) {
  downloadedUpdate = null;
  setUpdateState({
    status: "error",
    message: `Update failed: ${getErrorMessage(error)}`,
    canCheck: true,
    canInstall: false,
    percent: 0,
    transferredBytes: 0,
    totalBytes: 0
  });
}

function scheduleBackgroundUpdateChecks() {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
  }

  setTimeout(() => {
    checkForUpdates();
  }, 5000);

  updateCheckTimer = setInterval(() => {
    checkForUpdates();
  }, UPDATE_CHECK_INTERVAL_MS);
}

function cleanupLegacyZipUpdaterState() {
  if (!electronApp) {
    return;
  }

  try {
    const updateRoot = path.join(electronApp.getPath("userData"), "updates");
    fs.rmSync(path.join(updateRoot, "pending-update.json"), { force: true });
    fs.rmSync(path.join(updateRoot, "apply-update.ps1"), { force: true });
    fs.rmSync(path.join(updateRoot, "extract-update.ps1"), { force: true });
  } catch {
    // Legacy updater cleanup is best-effort.
  }
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

function normalizeVersion(value) {
  return String(value || "")
    .trim()
    .replace(/^v/i, "");
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

function getErrorMessage(error) {
  return String(error && (error.message || error.stack) || "Unknown updater error.")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

module.exports = {
  setupUpdater,
  getUpdateStatus,
  checkForUpdates,
  installUpdate
};
