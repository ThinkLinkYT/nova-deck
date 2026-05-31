const childProcess = require("child_process");
const fs = require("fs");
const https = require("https");
const path = require("path");

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const RELEASES_API_URL = "https://api.github.com/repos/ThinkLinkYT/nova-deck/releases/latest";
const USER_AGENT = "Nova Deck Updater";

let electronApp = null;
let getMainWindow = null;
let updateCheckTimer = null;
let pendingUpdate = null;
let applyingUpdate = false;

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
  pendingUpdate = readPendingUpdate();

  if (pendingUpdate && compareVersions(pendingUpdate.version, electronApp.getVersion()) <= 0) {
    clearPendingUpdateManifest();
    pendingUpdate = null;
  }

  electronApp.on("before-quit", () => {
    if (pendingUpdate && !applyingUpdate) {
      applyStagedUpdate({ relaunch: false });
    }
  });

  if (pendingUpdate) {
    setUpdateState({
      status: "downloaded",
      message: `Version ${pendingUpdate.version} is ready and will apply when Nova Deck restarts.`,
      canCheck: false,
      canInstall: true,
      percent: 100,
      version: pendingUpdate.version
    });
  }

  if (electronApp.isPackaged) {
    scheduleBackgroundUpdateChecks();
  } else {
    setUpdateState({
      status: "development",
      message: "Background ZIP updates run in packaged consumer builds.",
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
  if (["checking", "available", "downloading", "staging", "downloaded", "installing"].includes(updateState.status)) {
    return getUpdateStatus();
  }

  if (!electronApp || !electronApp.isPackaged) {
    return setUpdateState({
      status: "development",
      message: "Background ZIP updates run in packaged consumer builds.",
      canCheck: false,
      canInstall: false,
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0
    });
  }

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

  try {
    const release = await fetchJson(RELEASES_API_URL);
    const latestVersion = normalizeVersion(release.tag_name || release.name);
    const currentVersion = normalizeVersion(electronApp.getVersion());

    if (!latestVersion || compareVersions(latestVersion, currentVersion) <= 0) {
      pendingUpdate = null;
      clearPendingUpdateManifest();
      return setUpdateState({
        status: "current",
        message: "Nova Deck is up to date.",
        canCheck: true,
        canInstall: false,
        percent: 0,
        version: "",
        transferredBytes: 0,
        totalBytes: 0
      });
    }

    const asset = findUpdateAsset(release.assets);
    if (!asset) {
      return setUpdateState({
        status: "error",
        message: `Version ${latestVersion} is live, but its ZIP update package is missing.`,
        canCheck: true,
        canInstall: false,
        percent: 0,
        version: latestVersion,
        transferredBytes: 0,
        totalBytes: 0
      });
    }

    setUpdateState({
      status: "available",
      message: `Version ${latestVersion} is available. Downloading app files in the background...`,
      canCheck: false,
      canInstall: false,
      percent: 0,
      version: latestVersion,
      transferredBytes: 0,
      totalBytes: normalizeByteCount(asset.size)
    });

    downloadAndStageUpdate(release, asset, latestVersion).catch((error) => {
      setUpdateState({
        status: "error",
        message: `Update failed: ${error.message}`,
        canCheck: true,
        canInstall: false,
        percent: 0,
        transferredBytes: 0,
        totalBytes: 0
      });
    });
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
  if (!pendingUpdate || !updateState.canInstall) {
    return false;
  }

  setUpdateState({
    status: "installing",
    message: "Restarting Nova Deck to apply the downloaded update...",
    canCheck: false,
    canInstall: false,
    percent: 100
  });

  applyStagedUpdate({ relaunch: true });
  setTimeout(() => {
    electronApp.quit();
  }, 250);
  return true;
}

async function downloadAndStageUpdate(release, asset, version) {
  const updateRoot = getUpdatesRoot();
  const zipPath = path.join(updateRoot, `nova-deck-${version}.zip`);
  const extractRoot = path.join(updateRoot, `pending-${version}`);
  const payloadRoot = path.join(extractRoot, "payload");

  fs.rmSync(extractRoot, { recursive: true, force: true });
  fs.mkdirSync(payloadRoot, { recursive: true });

  await downloadFile(asset.browser_download_url, zipPath, asset.size);

  setUpdateState({
    status: "staging",
    message: "Preparing downloaded app files...",
    canCheck: false,
    canInstall: false,
    percent: 100,
    version,
    transferredBytes: normalizeByteCount(asset.size),
    totalBytes: normalizeByteCount(asset.size)
  });

  await extractZip(zipPath, payloadRoot);
  const sourceRoot = findPayloadRoot(payloadRoot);

  pendingUpdate = {
    version,
    releaseName: release.name || release.tag_name || version,
    sourceRoot,
    zipPath,
    createdAt: new Date().toISOString()
  };
  writePendingUpdate(pendingUpdate);

  setUpdateState({
    status: "downloaded",
    message: `Version ${version} is ready. Nova Deck will replace its app files on restart.`,
    canCheck: false,
    canInstall: true,
    percent: 100,
    version,
    transferredBytes: normalizeByteCount(asset.size),
    totalBytes: normalizeByteCount(asset.size)
  });
}

function applyStagedUpdate({ relaunch }) {
  if (!pendingUpdate || applyingUpdate) {
    return false;
  }

  applyingUpdate = true;

  const scriptPath = path.join(getUpdatesRoot(), "apply-update.ps1");
  const logPath = path.join(getUpdatesRoot(), "apply-update.log");
  const manifestPath = getPendingManifestPath();
  const installDir = path.dirname(process.execPath);
  const exePath = process.execPath;
  const processId = process.pid;

  fs.writeFileSync(scriptPath, buildApplyScript({
    processId,
    sourceRoot: pendingUpdate.sourceRoot,
    installDir,
    exePath,
    logPath,
    manifestPath,
    relaunch: Boolean(relaunch)
  }), "utf8");

  const child = childProcess.spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath
  ], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });

  child.unref();
  return true;
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

function buildApplyScript(options) {
  return [
    "$ErrorActionPreference = \"Stop\"",
    `$processIdToWait = ${options.processId}`,
    `$sourceRoot = ${toPowerShellString(options.sourceRoot)}`,
    `$installDir = ${toPowerShellString(options.installDir)}`,
    `$exePath = ${toPowerShellString(options.exePath)}`,
    `$logPath = ${toPowerShellString(options.logPath)}`,
    `$manifestPath = ${toPowerShellString(options.manifestPath)}`,
    `$shouldRelaunch = ${options.relaunch ? "$true" : "$false"}`,
    "",
    "try {",
    "  Wait-Process -Id $processIdToWait -Timeout 45 -ErrorAction SilentlyContinue",
    "  Start-Sleep -Seconds 2",
    "  if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot \"Nova Deck.exe\"))) {",
    "    throw \"The staged update is missing Nova Deck.exe.\"",
    "  }",
    "  $robocopyArgs = @($sourceRoot, $installDir, \"/E\", \"/COPY:DAT\", \"/R:5\", \"/W:1\", \"/NFL\", \"/NDL\", \"/NJH\", \"/NJS\")",
    "  $robocopy = Start-Process -FilePath \"robocopy.exe\" -ArgumentList $robocopyArgs -Wait -PassThru -WindowStyle Hidden",
    "  if ($robocopy.ExitCode -ge 8) {",
    "    throw \"File update failed with robocopy exit code $($robocopy.ExitCode).\"",
    "  }",
    "  Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue",
    "  if ($shouldRelaunch -and (Test-Path -LiteralPath $exePath)) {",
    "    Start-Process -FilePath $exePath -WorkingDirectory $installDir",
    "  }",
    "} catch {",
    "  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null",
    "  \"[$(Get-Date -Format o)] $($_.Exception.Message)\" | Out-File -FilePath $logPath -Append -Encoding utf8",
    "  if ($shouldRelaunch -and (Test-Path -LiteralPath $exePath)) {",
    "    Start-Process -FilePath $exePath -WorkingDirectory $installDir",
    "  }",
    "}"
  ].join("\r\n");
}

function fetchJson(url) {
  return request(url, {
    "Accept": "application/vnd.github+json",
    "User-Agent": USER_AGENT
  }).then((buffer) => JSON.parse(buffer.toString("utf8")));
}

function downloadFile(url, destinationPath, expectedSize) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destinationPath);
    let transferredBytes = 0;

    requestStream(url, {
      "Accept": "application/octet-stream",
      "User-Agent": USER_AGENT
    }, (response) => {
      const totalBytes = normalizeByteCount(response.headers["content-length"]) || normalizeByteCount(expectedSize);
      response.on("data", (chunk) => {
        transferredBytes += chunk.length;
        const percent = totalBytes > 0 ? (transferredBytes / totalBytes) * 100 : 0;
        setUpdateState({
          status: "downloading",
          message: `Downloading update ${Math.round(clampPercent(percent))}%...`,
          canCheck: false,
          canInstall: false,
          percent,
          transferredBytes,
          totalBytes
        });
      });
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
    }).catch((error) => {
      file.close(() => {
        fs.rmSync(destinationPath, { force: true });
        reject(error);
      });
    });
  });
}

function request(url, headers) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    requestStream(url, headers, (response) => {
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
    }).catch(reject);
  });
}

function requestStream(url, headers, onResponse, redirects = 0) {
  return new Promise((resolve, reject) => {
    const requestOptions = new URL(url);
    requestOptions.headers = headers;

    const req = https.get(requestOptions, (response) => {
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && location) {
        response.resume();
        if (redirects >= 5) {
          reject(new Error("Too many update download redirects."));
          return;
        }
        requestStream(new URL(location, url).toString(), headers, onResponse, redirects + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Update request failed with HTTP ${response.statusCode}.`));
        return;
      }

      onResponse(response);
      resolve();
    });

    req.on("error", reject);
  });
}

function extractZip(zipPath, destinationPath) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    let stdout = "";
    const scriptPath = path.join(path.dirname(destinationPath), "extract-update.ps1");
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, buildExtractScript(), "utf8");

    const child = childProcess.spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-ZipPath",
      zipPath,
      "-DestinationPath",
      destinationPath
    ], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = normalizePowerShellOutput(stderr || stdout);
      reject(new Error(`Could not unpack update ZIP. PowerShell exited with ${code}${detail ? `: ${detail}` : "."}`));
    });
  });
}

function buildExtractScript() {
  return [
    "param(",
    "  [Parameter(Mandatory=$true)][string]$ZipPath,",
    "  [Parameter(Mandatory=$true)][string]$DestinationPath",
    ")",
    "$ErrorActionPreference = \"Stop\"",
    "$ProgressPreference = \"SilentlyContinue\"",
    "New-Item -ItemType Directory -Force -Path $DestinationPath | Out-Null",
    "Expand-Archive -LiteralPath $ZipPath -DestinationPath $DestinationPath -Force"
  ].join("\r\n");
}

function findUpdateAsset(assets) {
  const updateAssets = Array.isArray(assets) ? assets : [];
  return updateAssets.find((asset) => {
    const name = String(asset.name || "").toLowerCase();
    return name.endsWith(".zip") && name.includes("win");
  }) || updateAssets.find((asset) => String(asset.name || "").toLowerCase().endsWith(".zip"));
}

function findPayloadRoot(rootPath) {
  const stack = [rootPath];

  while (stack.length > 0) {
    const currentPath = stack.shift();
    if (fs.existsSync(path.join(currentPath, "Nova Deck.exe")) && fs.existsSync(path.join(currentPath, "resources"))) {
      return currentPath;
    }

    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        stack.push(path.join(currentPath, entry.name));
      }
    }
  }

  throw new Error("The update ZIP did not contain a packaged Nova Deck app.");
}

function readPendingUpdate() {
  try {
    const manifestPath = getPendingManifestPath();
    if (!fs.existsSync(manifestPath)) {
      return null;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!manifest || !manifest.version || !manifest.sourceRoot || !fs.existsSync(manifest.sourceRoot)) {
      return null;
    }
    return manifest;
  } catch {
    return null;
  }
}

function writePendingUpdate(manifest) {
  fs.mkdirSync(getUpdatesRoot(), { recursive: true });
  fs.writeFileSync(getPendingManifestPath(), JSON.stringify(manifest, null, 2), "utf8");
}

function clearPendingUpdateManifest() {
  fs.rmSync(getPendingManifestPath(), { force: true });
}

function getPendingManifestPath() {
  return path.join(getUpdatesRoot(), "pending-update.json");
}

function getUpdatesRoot() {
  const updateRoot = path.join(electronApp.getPath("userData"), "updates");
  fs.mkdirSync(updateRoot, { recursive: true });
  return updateRoot;
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

  if (updateState.status === "downloading" || updateState.status === "staging") {
    mainWindow.setProgressBar(updateState.percent / 100);
    return;
  }

  mainWindow.setProgressBar(-1);
}

function compareVersions(leftVersion, rightVersion) {
  const left = normalizeVersionParts(leftVersion);
  const right = normalizeVersionParts(rightVersion);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index] || 0;
    const rightPart = right[index] || 0;
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  return 0;
}

function normalizeVersion(value) {
  return String(value || "")
    .trim()
    .replace(/^v/i, "");
}

function normalizeVersionParts(value) {
  return normalizeVersion(value)
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
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

function normalizePowerShellOutput(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function toPowerShellString(value) {
  return `@'\r\n${String(value).replaceAll("'", "''")}\r\n'@`;
}

module.exports = {
  setupUpdater,
  getUpdateStatus,
  checkForUpdates,
  installUpdate
};
