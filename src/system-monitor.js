const os = require("os");
const { execFile } = require("child_process");

let previousCpuSample = null;
let gpuInfoCache = null;
let powerShellCache = null;
let powerShellCacheAt = 0;

async function getSystemSnapshot(app) {
  const [gpuInfo, windowsInfo] = await Promise.all([
    getGpuInfo(app),
    getWindowsInfo()
  ]);
  const memory = getMemoryUsage();
  const processMemory = process.getProcessMemoryInfo ? await process.getProcessMemoryInfo().catch(() => null) : null;

  return {
    timestamp: Date.now(),
    specs: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      uptimeSeconds: Math.round(os.uptime()),
      cpu: getCpuSpecs(),
      memoryTotalBytes: os.totalmem(),
      gpu: gpuInfo,
      windows: windowsInfo.system
    },
    usage: {
      cpuPercent: getCpuPercent(),
      memory,
      novaMemoryBytes: processMemory ? processMemory.privateBytes : process.memoryUsage().rss,
      drives: windowsInfo.drives,
      processes: windowsInfo.processes
    }
  };
}

function getCpuSpecs() {
  const cpus = os.cpus();
  const first = cpus[0] || {};
  return {
    model: first.model || "Unknown CPU",
    logicalCores: cpus.length,
    speedMhz: first.speed || 0
  };
}

function getMemoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  return {
    totalBytes: total,
    freeBytes: free,
    usedBytes: used,
    percent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0
  };
}

function getCpuPercent() {
  const cpus = os.cpus();
  const sample = cpus.map((cpu) => ({ ...cpu.times }));
  if (!previousCpuSample || previousCpuSample.length !== sample.length) {
    previousCpuSample = sample;
    return 0;
  }

  let idleDelta = 0;
  let totalDelta = 0;
  sample.forEach((times, index) => {
    const previous = previousCpuSample[index];
    const idle = times.idle - previous.idle;
    const total = Object.keys(times).reduce((sum, key) => sum + (times[key] - previous[key]), 0);
    idleDelta += idle;
    totalDelta += total;
  });
  previousCpuSample = sample;

  if (totalDelta <= 0) {
    return 0;
  }
  return Math.round((1 - idleDelta / totalDelta) * 1000) / 10;
}

async function getGpuInfo(app) {
  if (gpuInfoCache) {
    return gpuInfoCache;
  }

  try {
    const info = await app.getGPUInfo("basic");
    const devices = Array.isArray(info.gpuDevice) ? info.gpuDevice : [];
    gpuInfoCache = devices.map((device) => ({
      vendor: device.vendorString || device.vendorId || "Unknown vendor",
      device: device.deviceString || device.deviceId || "Unknown GPU",
      active: device.active === true
    }));
  } catch {
    gpuInfoCache = [];
  }
  return gpuInfoCache;
}

async function getWindowsInfo() {
  const now = Date.now();
  if (powerShellCache && now - powerShellCacheAt < 4000) {
    return powerShellCache;
  }

  try {
    const output = await runPowerShell(`
$system = Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model,TotalPhysicalMemory
$os = Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,LastBootUpTime
$drives = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 } | Select-Object DeviceID,VolumeName,Size,FreeSpace
$processes = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 12 Name,Id,CPU,WorkingSet64,MainWindowTitle
[pscustomobject]@{
  system = $system
  os = $os
  drives = $drives
  processes = $processes
} | ConvertTo-Json -Depth 4 -Compress
`);
    const parsed = JSON.parse(output);
    powerShellCache = normalizeWindowsInfo(parsed);
    powerShellCacheAt = now;
    return powerShellCache;
  } catch {
    powerShellCache = {
      system: {},
      drives: [],
      processes: []
    };
    powerShellCacheAt = now;
    return powerShellCache;
  }
}

function normalizeWindowsInfo(info) {
  const system = info && info.system ? info.system : {};
  const osInfo = info && info.os ? info.os : {};
  const drives = normalizeArray(info && info.drives).map((drive) => {
    const size = Number(drive.Size || 0);
    const free = Number(drive.FreeSpace || 0);
    const used = Math.max(0, size - free);
    return {
      id: String(drive.DeviceID || ""),
      name: String(drive.VolumeName || "Local Disk"),
      totalBytes: size,
      freeBytes: free,
      usedBytes: used,
      percent: size > 0 ? Math.round((used / size) * 1000) / 10 : 0
    };
  });
  const processes = normalizeArray(info && info.processes).map((entry) => ({
    name: String(entry.Name || "Process"),
    id: Number(entry.Id || 0),
    cpuSeconds: Number(entry.CPU || 0),
    memoryBytes: Number(entry.WorkingSet64 || 0),
    title: String(entry.MainWindowTitle || "")
  }));

  return {
    system: {
      manufacturer: String(system.Manufacturer || ""),
      model: String(system.Model || ""),
      osName: String(osInfo.Caption || ""),
      osVersion: String(osInfo.Version || ""),
      buildNumber: String(osInfo.BuildNumber || ""),
      lastBoot: String(osInfo.LastBootUpTime || "")
    },
    drives,
    processes
  };
}

function normalizeArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script
    ], {
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 1024 * 1024
    }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
}

module.exports = {
  getSystemSnapshot
};
