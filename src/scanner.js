const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

async function scanGames() {
  const [
    steamGames,
    epicGames,
    shortcutGames,
    startMenuGames,
    uninstallGames,
    folderGames,
    launcherMetadataGames,
    knownLauncherGames,
    minecraftApps,
    knownMinecraftGames
  ] = await Promise.all([
    scanSteamGames(),
    scanEpicGames(),
    scanShortcutGames(),
    scanStartMenuGames(),
    scanUninstallGames(),
    scanCommonGameFolders(),
    scanLauncherMetadataGames(),
    scanKnownLauncherInstallations(),
    scanMinecraftApps(),
    scanKnownMinecraftInstallations()
  ]);

  return dedupeGames([
    ...steamGames,
    ...epicGames,
    ...shortcutGames,
    ...startMenuGames,
    ...uninstallGames,
    ...folderGames,
    ...launcherMetadataGames,
    ...knownLauncherGames,
    ...minecraftApps,
    ...knownMinecraftGames
  ]);
}

async function scanSteamGames() {
  const roots = await getSteamRoots();
  const libraries = new Set();

  for (const root of roots) {
    if (!root || !fs.existsSync(root)) {
      continue;
    }

    libraries.add(root);
    const libraryFile = path.join(root, "steamapps", "libraryfolders.vdf");
    for (const libraryPath of parseSteamLibraryFolders(libraryFile)) {
      libraries.add(libraryPath);
    }
  }

  const games = [];
  for (const libraryPath of libraries) {
    const steamappsPath = path.join(libraryPath, "steamapps");
    if (!fs.existsSync(steamappsPath)) {
      continue;
    }

    const manifestFiles = safeReadDir(steamappsPath)
      .filter((file) => /^appmanifest_\d+\.acf$/i.test(file))
      .map((file) => path.join(steamappsPath, file));

    for (const manifestFile of manifestFiles) {
      const manifest = parseValveKeyValues(safeReadFile(manifestFile));
      const appId = manifest.appid || getAppIdFromManifestName(manifestFile);
      const title = cleanTitle(manifest.name);

      if (!appId || !title) {
        continue;
      }

      const installDir = manifest.installdir || "";
      const installPath = installDir
        ? path.join(steamappsPath, "common", installDir)
        : path.join(steamappsPath, "common");
      const exePath = findLikelyExecutable(installPath, title);
      const hasExe = exePath && fs.existsSync(exePath);

      games.push({
        id: `steam:${appId}`,
        title,
        source: "Steam",
        launchType: hasExe ? "exe" : "steam",
        launchTarget: hasExe ? exePath : `steam://rungameid/${appId}`,
        appId,
        installPath,
        executablePath: exePath,
        artworkPath: findSteamArtwork(appId, roots),
        iconPath: exePath,
        focusProcess: exePath ? path.basename(exePath, path.extname(exePath)) : null,
        lastSeen: Date.now()
      });
    }
  }

  return games;
}

async function scanEpicGames() {
  const manifestsPath = path.join(
    process.env.ProgramData || "C:\\ProgramData",
    "Epic",
    "EpicGamesLauncher",
    "Data",
    "Manifests"
  );

  if (!fs.existsSync(manifestsPath)) {
    return [];
  }

  const games = [];
  const manifestFiles = safeReadDir(manifestsPath)
    .filter((file) => file.toLowerCase().endsWith(".item"))
    .map((file) => path.join(manifestsPath, file));

  for (const manifestFile of manifestFiles) {
    const manifest = safeParseJson(safeReadFile(manifestFile));
    if (!manifest) {
      continue;
    }

    const title = cleanTitle(manifest.DisplayName || manifest.AppName);
    const installPath = manifest.InstallLocation || "";
    const launchExecutable = manifest.LaunchExecutable
      ? path.join(installPath, manifest.LaunchExecutable)
      : findLikelyExecutable(installPath, title);
    const hasExe = fs.existsSync(launchExecutable || "");

    if (!title || !installPath) {
      continue;
    }

    const launchUrl = buildEpicLaunchUrl(manifest);
    games.push({
      id: `epic:${manifest.AppName || manifest.CatalogItemId || title}`,
      title,
      source: "Epic",
      launchType: hasExe ? "exe" : launchUrl ? "epic" : "exe",
      launchTarget: hasExe ? launchExecutable : launchUrl || launchExecutable,
      installPath,
      executablePath: hasExe ? launchExecutable : null,
      iconPath: hasExe ? launchExecutable : null,
      focusProcess: launchExecutable ? path.basename(launchExecutable, path.extname(launchExecutable)) : null,
      appId: manifest.AppName || manifest.CatalogItemId || null,
      lastSeen: Date.now()
    });
  }

  return games;
}

async function scanStartMenuGames() {
  const command = `
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress
  `;

  try {
    const output = await execPowerShell(command, 20000);
    return normalizeArray(JSON.parse(output || "[]"))
      .filter((app) => app.Name && app.AppID && isLikelyGameName(app.Name))
      .map((app) => startAppToGame(app))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function scanUninstallGames() {
  const command = `
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $keys = @(
      'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
    )
    Get-ItemProperty $keys -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName } |
      Select-Object DisplayName,DisplayIcon,InstallLocation,Publisher |
      ConvertTo-Json -Compress
  `;

  try {
    const output = await execPowerShell(command, 20000);
    return normalizeArray(JSON.parse(output || "[]"))
      .map((entry) => uninstallEntryToGame(entry))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function scanCommonGameFolders() {
  const folders = getCommonGameFolders().filter((folder) => fs.existsSync(folder));
  const games = [];

  for (const root of folders) {
    for (const entry of safeReadDir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const installPath = path.join(root, entry.name);
      const exePath = findLikelyExecutable(installPath, entry.name);
      if (!exePath) {
        continue;
      }

      games.push({
        id: `folder:${stableId(installPath)}`,
        title: cleanTitle(entry.name),
        source: getFolderSource(root),
        launchType: "exe",
        launchTarget: exePath,
        executablePath: exePath,
        iconPath: exePath,
        installPath,
        focusProcess: path.basename(exePath, path.extname(exePath)),
        lastSeen: Date.now()
      });
    }
  }

  return games;
}

async function scanLauncherMetadataGames() {
  return [
    ...scanRiotMetadataGames(),
    ...scanItchGames(),
    ...scanBattleNetProductDb()
  ];
}

function scanRiotMetadataGames() {
  const root = path.join(process.env.ProgramData || "C:\\ProgramData", "Riot Games", "Metadata");
  const games = [];
  if (!fs.existsSync(root)) {
    return games;
  }

  walkFiles(root, 3, (filePath) => {
    if (!/\.(ya?ml|json)$/i.test(filePath)) {
      return;
    }

    const text = safeReadFile(filePath);
    const installPath = firstMatch(text, [
      /product_install_full_path:\s*"?([^"\r\n]+)"?/i,
      /install_full_path:\s*"?([^"\r\n]+)"?/i,
      /install_location:\s*"?([^"\r\n]+)"?/i,
      /"install_location"\s*:\s*"([^"]+)"/i
    ]);

    if (!installPath || !fs.existsSync(installPath)) {
      return;
    }

    const title = cleanTitle(firstMatch(text, [
      /product_display_name:\s*"?([^"\r\n]+)"?/i,
      /product_name:\s*"?([^"\r\n]+)"?/i,
      /"name"\s*:\s*"([^"]+)"/i
    ]) || path.basename(installPath));
    const exePath = findLikelyExecutable(installPath, title);
    if (!exePath) {
      return;
    }

    games.push(createExeGame({
      id: `riot-metadata:${stableId(installPath)}`,
      title,
      source: "Riot",
      exePath,
      installPath
    }));
  });

  return games;
}

function scanItchGames() {
  const roots = [
    path.join(process.env.APPDATA || "", "itch", "apps"),
    path.join(process.env.LOCALAPPDATA || "", "itch", "apps")
  ].filter((root) => root && fs.existsSync(root));
  const games = [];

  for (const root of roots) {
    for (const entry of safeReadDir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const installPath = path.join(root, entry.name);
      const title = cleanTitle(entry.name);
      const exePath = findLikelyExecutable(installPath, title);
      if (!exePath) {
        continue;
      }

      games.push(createExeGame({
        id: `itch:${stableId(installPath)}`,
        title,
        source: "itch.io",
        exePath,
        installPath
      }));
    }
  }

  return games;
}

function scanBattleNetProductDb() {
  const productDb = path.join(process.env.ProgramData || "C:\\ProgramData", "Battle.net", "Agent", "product.db");
  if (!fs.existsSync(productDb)) {
    return [];
  }

  let text = "";
  try {
    const buffer = fs.readFileSync(productDb);
    text = `${buffer.toString("utf8")}\n${buffer.toString("utf16le")}`;
  } catch {
    return [];
  }

  const paths = new Set();
  const regexes = [
    /install[_-]?path["'\s:=]+([A-Z]:\\[^"\r\n\0]+)/gi,
    /install[_-]?dir["'\s:=]+([A-Z]:\\[^"\r\n\0]+)/gi,
    /([A-Z]:\\(?:Program Files(?: \(x86\))?|Games|Battle\.net Games|Blizzard Games)\\[^"\r\n\0]+(?:World of Warcraft|Overwatch|Diablo|Hearthstone|StarCraft|Heroes of the Storm|Call of Duty)[^"\r\n\0]*)/gi
  ];

  for (const regex of regexes) {
    let match;
    while ((match = regex.exec(text))) {
      const installPath = cleanExecutablePath(match[1]);
      if (installPath && fs.existsSync(installPath)) {
        paths.add(installPath);
      }
    }
  }

  return Array.from(paths)
    .map((installPath) => gameFromInstallFolder(installPath, getSourceForName(installPath), `battlenet-db:${stableId(installPath)}`))
    .filter(Boolean);
}

async function scanKnownLauncherInstallations() {
  return getKnownLauncherInstallFolders()
    .map((installPath) => gameFromInstallFolder(installPath, getSourceForName(installPath), `known-launcher:${stableId(installPath)}`))
    .filter(Boolean);
}

async function scanShortcutGames() {
  const shortcutFiles = getShortcutRoots()
    .flatMap((root) => listShortcutFiles(root))
    .filter(uniqueByPath);

  const urlGames = shortcutFiles
    .filter((filePath) => path.extname(filePath).toLowerCase() === ".url")
    .map((filePath) => shortcutUrlToGame(filePath))
    .filter(Boolean);

  const lnkFiles = shortcutFiles.filter((filePath) => path.extname(filePath).toLowerCase() === ".lnk");
  const shortcuts = await resolveShortcuts(lnkFiles);
  const lnkGames = shortcuts
    .map((shortcut) => shortcutToGame(shortcut))
    .filter(Boolean);

  return [...urlGames, ...lnkGames];
}

async function scanMinecraftApps() {
  const command = `
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Get-StartApps |
      Where-Object { $_.Name -match 'Minecraft|Lunar|Badlion|Prism|Modrinth|CurseForge|Feather|MultiMC|ATLauncher|GDLauncher' } |
      Select-Object Name,AppID |
      ConvertTo-Json -Compress
  `;

  try {
    const output = await execPowerShell(command);
    const apps = normalizeArray(JSON.parse(output || "[]"));
    return apps
      .filter((app) => app.Name && app.AppID)
      .map((app) => ({
        id: `appx:${stableId(app.AppID)}`,
        title: cleanTitle(app.Name),
        source: getMinecraftSource(app.Name),
        launchType: "appx",
        launchTarget: app.AppID,
        installPath: "Windows Apps",
        executablePath: null,
        focusProcess: null,
        lastSeen: Date.now()
      }));
  } catch {
    return [];
  }
}

async function scanKnownMinecraftInstallations() {
  const candidates = [
    [process.env.ProgramFiles, "Minecraft Launcher", "MinecraftLauncher.exe"],
    [process.env["ProgramFiles(x86)"], "Minecraft Launcher", "MinecraftLauncher.exe"],
    [process.env.ProgramFiles, "Feather Launcher", "Feather Launcher.exe"],
    [process.env.LOCALAPPDATA, "Modrinth App", "Modrinth App.exe"],
    [process.env.LOCALAPPDATA, "Programs", "Modrinth App", "Modrinth App.exe"],
    [process.env.LOCALAPPDATA, "Programs", "PrismLauncher", "prismlauncher.exe"],
    [process.env.LOCALAPPDATA, "Programs", "Prism Launcher", "prismlauncher.exe"],
    [process.env.ProgramFiles, "PrismLauncher", "prismlauncher.exe"],
    [process.env.LOCALAPPDATA, "Programs", "ATLauncher", "ATLauncher.exe"],
    [process.env.ProgramFiles, "MultiMC", "MultiMC.exe"],
    [process.env.LOCALAPPDATA, "Programs", "GDLauncher", "GDLauncher.exe"],
    [process.env.ProgramFiles, "Badlion Client", "Badlion Client.exe"],
    [process.env.LOCALAPPDATA, "Programs", "Lunar Client", "Lunar Client.exe"],
    [process.env.ProgramFiles, "Lunar Client", "Lunar Client.exe"]
  ];

  return candidates
    .filter((parts) => parts[0])
    .map((parts) => path.join(...parts))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => ({
      id: `minecraft-known:${stableId(filePath)}`,
      title: cleanTitle(path.basename(filePath, path.extname(filePath))),
      source: getMinecraftSource(filePath),
      launchType: "exe",
      launchTarget: filePath,
      executablePath: filePath,
      installPath: path.dirname(filePath),
      focusProcess: path.basename(filePath, path.extname(filePath)),
      lastSeen: Date.now()
    }));
}

async function gameFromFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".exe") {
    return {
      id: `custom:${stableId(filePath)}`,
      title: cleanTitle(path.basename(filePath, extension)),
      source: "Custom",
      launchType: "exe",
      launchTarget: filePath,
      executablePath: filePath,
      iconPath: filePath,
      installPath: path.dirname(filePath),
      focusProcess: path.basename(filePath, extension),
      custom: true,
      lastSeen: Date.now()
    };
  }

  if (extension === ".lnk" || extension === ".url") {
    const shortcut = await resolveShortcut(filePath);
    if (!shortcut) {
      return null;
    }

    const game = shortcutToGame({ ...shortcut, filePath }, true);
    return game
      ? {
          ...game,
          id: `custom:${stableId(filePath)}`,
          source: "Custom",
          custom: true
        }
      : null;
  }

  return null;
}

async function getSteamRoots() {
  const candidates = new Set([
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Steam"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Steam"),
    ...getSteamDriveCandidates()
  ]);

  const registryValues = await Promise.all([
    getRegistryValue("HKCU:\\Software\\Valve\\Steam", "SteamPath"),
    getRegistryValue("HKCU:\\Software\\Valve\\Steam", "InstallPath"),
    getRegistryValue("HKLM:\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"),
    getRegistryValue("HKLM:\\SOFTWARE\\Valve\\Steam", "InstallPath")
  ]);

  for (const registryPath of registryValues) {
    if (registryPath) {
      candidates.add(registryPath.replace(/\//g, "\\"));
    }
  }

  return Array.from(candidates);
}

function getSteamDriveCandidates() {
  const candidates = [];
  for (const drive of getFileSystemDrives()) {
    candidates.push(
      path.join(drive, "Steam"),
      path.join(drive, "SteamLibrary"),
      path.join(drive, "Games", "SteamLibrary"),
      path.join(drive, "Program Files (x86)", "Steam"),
      path.join(drive, "Program Files", "Steam")
    );
  }
  return candidates;
}

function getFileSystemDrives() {
  const drives = [];
  for (let code = 67; code <= 90; code += 1) {
    const drive = `${String.fromCharCode(code)}:\\`;
    if (fs.existsSync(drive)) {
      drives.push(drive);
    }
  }
  return drives;
}

function parseSteamLibraryFolders(libraryFile) {
  if (!fs.existsSync(libraryFile)) {
    return [];
  }

  const text = safeReadFile(libraryFile);
  const paths = [];
  const pathRegex = /"path"\s+"([^"]+)"/gi;
  let match;

  while ((match = pathRegex.exec(text))) {
    paths.push(match[1].replace(/\\\\/g, "\\"));
  }

  return paths;
}

function parseValveKeyValues(text) {
  const values = {};
  const regex = /"([^"]+)"\s+"([^"]*)"/g;
  let match;

  while ((match = regex.exec(text))) {
    values[match[1].toLowerCase()] = match[2];
  }

  return values;
}

function getAppIdFromManifestName(manifestFile) {
  const match = path.basename(manifestFile).match(/^appmanifest_(\d+)\.acf$/i);
  return match ? match[1] : null;
}

function buildEpicLaunchUrl(manifest) {
  if (!manifest.CatalogNamespace || !manifest.CatalogItemId || !manifest.AppName) {
    return null;
  }

  const app = encodeURIComponent(
    `${manifest.CatalogNamespace}:${manifest.CatalogItemId}:${manifest.AppName}`
  );
  return `com.epicgames.launcher://apps/${app}?action=launch&silent=true`;
}

function findSteamArtwork(appId, steamRoots) {
  const names = [
    `${appId}_library_600x900.jpg`,
    `${appId}_library_600x900.png`,
    `${appId}_header.jpg`,
    `${appId}_header.png`,
    `${appId}_hero.jpg`,
    `${appId}_hero.png`,
    `${appId}_icon.jpg`,
    `${appId}_icon.png`,
    `${appId}.jpg`,
    `${appId}.png`
  ];

  for (const root of steamRoots) {
    const cachePath = path.join(root, "appcache", "librarycache");
    for (const name of names) {
      const candidate = path.join(cachePath, name);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function isProtocolTarget(target) {
  const value = String(target || "");
  if (/^[a-z]:[\\/]/i.test(value)) {
    return false;
  }
  return /^([a-z][a-z0-9+.-]+:)?\/\//i.test(value) || /^[a-z][a-z0-9+.-]+:/i.test(value);
}

function getShortcutRoots() {
  return [
    process.env.OneDrive ? path.join(process.env.OneDrive, "Desktop") : "",
    path.join(process.env.USERPROFILE || "", "Desktop"),
    getKnownFolder("CommonDesktopDirectory"),
    getKnownFolder("StartMenu"),
    getKnownFolder("CommonStartMenu"),
    path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(process.env.ProgramData || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs")
  ].filter(Boolean);
}

function getKnownFolder(name) {
  const map = {
    CommonDesktopDirectory: path.join(process.env.PUBLIC || "C:\\Users\\Public", "Desktop"),
    StartMenu: path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu"),
    CommonStartMenu: path.join(process.env.ProgramData || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu")
  };
  return map[name] || "";
}

function listShortcutFiles(rootPath) {
  const results = [];
  walkFiles(rootPath, 5, (filePath) => {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".lnk" || extension === ".url") {
      results.push(filePath);
    }
  });
  return results;
}

function shortcutUrlToGame(filePath) {
  const text = safeReadFile(filePath);
  const match = text.match(/^URL=(.+)$/im);
  if (!match) {
    return null;
  }

  return shortcutToGame({
    filePath,
    name: path.basename(filePath, ".url"),
    target: match[1].trim(),
    url: match[1].trim(),
    arguments: "",
    workingDirectory: ""
  });
}

function shortcutToGame(shortcut, includeAnyShortcut = false) {
  const target = shortcut.target || shortcut.url || "";
  const args = shortcut.arguments || "";
  const title = cleanTitle(shortcut.name || path.basename(shortcut.filePath || target, path.extname(shortcut.filePath || target)));
  const steamAppId = getSteamAppId(target, args);
  const epicUrl = getEpicLaunchUrl(target, args);
  const isUrl = isProtocolTarget(target);
  const extension = target ? path.extname(target).toLowerCase() : "";

  if (steamAppId) {
    return {
      id: `steam-shortcut:${steamAppId}`,
      title,
      source: "Steam",
      launchType: "steam",
      launchTarget: `steam://rungameid/${steamAppId}`,
      appId: steamAppId,
      installPath: shortcut.workingDirectory || "",
      executablePath: null,
      iconPath: shortcut.iconPath || null,
      focusProcess: null,
      lastSeen: Date.now()
    };
  }

  if (epicUrl) {
    return {
      id: `epic-shortcut:${stableId(epicUrl)}`,
      title,
      source: "Epic",
      launchType: "epic",
      launchTarget: epicUrl,
      installPath: shortcut.workingDirectory || "",
      executablePath: null,
      iconPath: shortcut.iconPath || null,
      focusProcess: null,
      lastSeen: Date.now()
    };
  }

  const shouldInclude =
    includeAnyShortcut ||
    isMinecraftShortcut(title, target, args) ||
    isGameShortcutPath(target, shortcut.workingDirectory);

  if (!shouldInclude || !target) {
    return null;
  }

  return {
    id: `${getShortcutSource(title, target)}-shortcut:${stableId(shortcut.filePath || target + args)}`,
    title,
    source: getShortcutSource(title, target),
    launchType: isUrl ? "url" : "exe",
    launchTarget: target,
    launchArgs: args,
    executablePath: extension === ".exe" ? target : null,
    iconPath: shortcut.iconPath || (extension === ".exe" ? target : null),
    installPath: shortcut.workingDirectory || (target && !isUrl ? path.dirname(target) : ""),
    focusProcess: extension === ".exe" ? path.basename(target, extension) : null,
    lastSeen: Date.now()
  };
}

function getSteamAppId(target, args) {
  const combined = `${target || ""} ${args || ""}`;
  const urlMatch = combined.match(/steam:\/\/(?:rungameid|run)\/(\d+)/i);
  if (urlMatch) {
    return urlMatch[1];
  }

  const argMatch = combined.match(/(?:-applaunch|\bapplaunch\b)\s+(\d+)/i);
  return argMatch ? argMatch[1] : null;
}

function getEpicLaunchUrl(target, args) {
  const combined = `${target || ""} ${args || ""}`;
  const match = combined.match(/com\.epicgames\.launcher:\/\/\S+/i);
  return match ? match[0] : null;
}

function isMinecraftShortcut(title, target, args) {
  return /minecraft|lunar|badlion|prism|modrinth|curseforge|feather|multimc|atlauncher|gdlauncher/i.test(
    `${title || ""} ${target || ""} ${args || ""}`
  );
}

function isGameShortcutPath(target, workingDirectory) {
  return /\\(steamapps\\common|Epic Games|GOG Games|XboxGames|Games|Riot Games|Battle\.net|Blizzard Games|Ubisoft|EA Games|Origin Games|itch|itch\.io)\\/i.test(
    `${target || ""} ${workingDirectory || ""}`
  );
}

function getShortcutSource(title, target) {
  if (isMinecraftShortcut(title, target, "")) {
    return getMinecraftSource(title || target);
  }
  return "Shortcut";
}

function getMinecraftSource(value) {
  const text = String(value || "");
  if (/curseforge|modrinth|feather|lunar|badlion|prism|multimc|atlauncher|gdlauncher/i.test(text)) {
    return "Minecraft";
  }
  if (/minecraft/i.test(text)) {
    return "Minecraft";
  }
  return "Launcher";
}

function startAppToGame(app) {
  const appId = String(app.AppID || "");
  const name = cleanTitle(app.Name);
  const resolvedPath = resolveStartAppExecutable(appId);
  const launchType = resolvedPath ? "exe" : "appx";

  return {
    id: `startapp:${stableId(appId)}`,
    title: name,
    source: getSourceForName(name),
    launchType,
    launchTarget: resolvedPath || appId,
    executablePath: resolvedPath,
    iconPath: resolvedPath,
    installPath: resolvedPath ? path.dirname(resolvedPath) : "Windows Apps",
    focusProcess: resolvedPath ? path.basename(resolvedPath, path.extname(resolvedPath)) : null,
    lastSeen: Date.now()
  };
}

function uninstallEntryToGame(entry) {
  let name = cleanTitle(entry.DisplayName);
  const publisher = cleanTitle(entry.Publisher);
  if (/^roblox player\b/i.test(name)) {
    name = "Roblox Player";
  }
  if (!isLikelyGameName(name, publisher)) {
    return null;
  }

  const iconPath = cleanExecutablePath(entry.DisplayIcon);
  const installPath = cleanExecutablePath(entry.InstallLocation);
  let exePath = iconPath && path.extname(iconPath).toLowerCase() === ".exe" ? iconPath : null;

  if (exePath && /installer|uninstall|unins/i.test(path.basename(exePath))) {
    exePath = null;
  }

  if (!exePath && installPath && fs.existsSync(installPath)) {
    exePath = findLikelyExecutable(installPath, name);
  }

  if (!exePath) {
    return null;
  }

  return {
    id: `uninstall:${stableId(name + exePath)}`,
    title: name,
    source: getSourceForName(name, publisher),
    launchType: "exe",
    launchTarget: exePath,
    executablePath: exePath,
    iconPath: iconPath || exePath,
    installPath: installPath || (exePath ? path.dirname(exePath) : ""),
    focusProcess: exePath ? path.basename(exePath, path.extname(exePath)) : null,
    lastSeen: Date.now()
  };
}

function resolveStartAppExecutable(appId) {
  let value = String(appId || "").replace(/\//g, "\\");
  value = value.replace(/^\{[A-F0-9-]+\}\\?/i, "");
  if (/^[a-z]:\\/i.test(value) && fs.existsSync(value)) {
    return value;
  }

  const programFiles = [
    process.env.ProgramFiles || "C:\\Program Files",
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    process.env.LOCALAPPDATA || ""
  ].filter(Boolean);

  for (const root of programFiles) {
    const candidate = path.join(root, value);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isLikelyGameName(name, publisher = "") {
  const text = `${name || ""} ${publisher || ""}`;
  if (isBlockedAppName(text)) {
    return false;
  }

  return /roblox player|fortnite|valorant|league of legends|riot client|minecraft|curseforge|modrinth|feather|lunar|badlion|prism|multimc|atlauncher|gdlauncher|steam|epic games|xbox|battle\.net|blizzard|world of warcraft|starcraft|heroes of the storm|overwatch|call of duty|warzone|diablo|hearthstone|gog galaxy|ubisoft connect|ea app|origin|rockstar games|genshin|honkai|hoyoplay|zenless|osu!|brawlhalla|halo|forza|doom|counter-strike|apex legends|the finals|valorant|escape from tarkov|wargaming/i.test(text);
}

function isBlockedAppName(value) {
  return /studio|editor|sdk|documentation|manual|help|uninstall|installer|browser|antivirus|vpn|driver|redistributable|runtime|visual studio|code|python|java|docker|git|winrar|norton 360/i.test(value || "");
}

function getSourceForName(name, publisher = "") {
  const text = `${name || ""} ${publisher || ""}`;
  if (/minecraft|curseforge|modrinth|feather|lunar|badlion|prism|multimc|atlauncher|gdlauncher/i.test(text)) {
    return "Minecraft";
  }
  if (/roblox/i.test(text)) {
    return "Roblox";
  }
  if (/xbox|microsoft gaming/i.test(text)) {
    return "Xbox";
  }
  if (/steam/i.test(text)) {
    return "Steam";
  }
  if (/epic/i.test(text)) {
    return "Epic";
  }
  if (/riot|valorant|league of legends/i.test(text)) {
    return "Riot";
  }
  if (/battle\.net|blizzard|world of warcraft|starcraft|heroes of the storm|overwatch|diablo|hearthstone|call of duty|warzone/i.test(text)) {
    return "Battle.net";
  }
  if (/ubisoft/i.test(text)) {
    return "Ubisoft";
  }
  if (/ea app|origin|electronic arts/i.test(text)) {
    return "EA";
  }
  if (/gog/i.test(text)) {
    return "GOG";
  }
  if (/itch/i.test(text)) {
    return "itch.io";
  }
  return "Game";
}

function getCommonGameFolders() {
  const folders = [];
  for (const drive of getFileSystemDrives()) {
    folders.push(
      path.join(drive, "XboxGames"),
      path.join(drive, "Games"),
      path.join(drive, "Battle.net Games"),
      path.join(drive, "Blizzard Games"),
      path.join(drive, "Epic Games"),
      path.join(drive, "GOG Games"),
      path.join(drive, "itch"),
      path.join(drive, "itch.io"),
      path.join(drive, "Riot Games"),
      path.join(drive, "Ubisoft Games"),
      path.join(drive, "Program Files", "Epic Games"),
      path.join(drive, "Program Files", "EA Games"),
      path.join(drive, "Program Files", "Electronic Arts"),
      path.join(drive, "Program Files", "GOG Games"),
      path.join(drive, "Program Files", "Ubisoft", "Ubisoft Game Launcher", "games"),
      path.join(drive, "Program Files", "Riot Games"),
      path.join(drive, "Program Files", "ModifiableWindowsApps"),
      path.join(drive, "Program Files (x86)", "Steam", "steamapps", "common"),
      path.join(drive, "Program Files (x86)", "Battle.net Games"),
      path.join(drive, "Program Files (x86)", "Blizzard Games"),
      path.join(drive, "Program Files (x86)", "Origin Games"),
      path.join(drive, "Program Files (x86)", "Ubisoft", "Ubisoft Game Launcher", "games")
    );
  }
  return folders;
}

function getFolderSource(rootPath) {
  if (/steamapps\\common/i.test(rootPath)) return "Steam";
  if (/epic games/i.test(rootPath)) return "Epic";
  if (/xboxgames/i.test(rootPath)) return "Xbox";
  if (/gog/i.test(rootPath)) return "GOG";
  if (/itch(?:\.io)?/i.test(rootPath)) return "itch.io";
  if (/riot/i.test(rootPath)) return "Riot";
  if (/battle\.net|blizzard/i.test(rootPath)) return "Battle.net";
  if (/ubisoft/i.test(rootPath)) return "Ubisoft";
  if (/ea games|origin games/i.test(rootPath)) return "EA";
  return "Game";
}

function getKnownLauncherInstallFolders() {
  const folders = [];
  const gameFolderNames = [
    "Call of Duty",
    "Diablo III",
    "Diablo IV",
    "Diablo Immortal",
    "Hearthstone",
    "Heroes of the Storm",
    "Overwatch",
    "Overwatch 2",
    "StarCraft II",
    "World of Warcraft"
  ];

  for (const drive of getFileSystemDrives()) {
    const roots = [
      drive,
      path.join(drive, "Games"),
      path.join(drive, "Battle.net Games"),
      path.join(drive, "Blizzard Games"),
      path.join(drive, "Program Files"),
      path.join(drive, "Program Files (x86)")
    ];

    for (const root of roots) {
      for (const folderName of gameFolderNames) {
        const candidate = path.join(root, folderName);
        if (fs.existsSync(candidate)) {
          folders.push(candidate);
        }
      }
    }
  }

  return folders.filter(uniqueByPath);
}

function gameFromInstallFolder(installPath, source, id) {
  if (!installPath || !fs.existsSync(installPath)) {
    return null;
  }

  const title = cleanTitle(path.basename(installPath));
  const exePath = findLikelyExecutable(installPath, title);
  if (!exePath) {
    return null;
  }

  return createExeGame({ id, title, source, exePath, installPath });
}

function createExeGame({ id, title, source, exePath, installPath }) {
  return {
    id,
    title: cleanTitle(title),
    source: source || "Game",
    launchType: "exe",
    launchTarget: exePath,
    executablePath: exePath,
    iconPath: exePath,
    installPath,
    focusProcess: path.basename(exePath, path.extname(exePath)),
    lastSeen: Date.now()
  };
}

function findLikelyExecutable(rootPath, title) {
  if (!rootPath || !fs.existsSync(rootPath)) {
    return null;
  }

  const titleTokens = tokenize(title);
  const candidates = [];
  const ignored = new Set([
    "crashhandler.exe",
    "crashreporter.exe",
    "dxsetup.exe",
    "eacsetup.exe",
    "installer.exe",
    "launcherhelper.exe",
    "redist.exe",
    "setup.exe",
    "unins000.exe",
    "uninstall.exe",
    "unitycrashhandler64.exe",
    "vcredist_x64.exe",
    "vcredist_x86.exe"
  ]);

  walk(rootPath, 3, (filePath) => {
    if (path.extname(filePath).toLowerCase() !== ".exe") {
      return;
    }

    const fileName = path.basename(filePath).toLowerCase();
    if (ignored.has(fileName)) {
      return;
    }

    const score = scoreExecutable(filePath, titleTokens);
    candidates.push({ filePath, score });
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ? candidates[0].filePath : null;
}

function walk(rootPath, maxDepth, visit, depth = 0) {
  if (depth > maxDepth) {
    return;
  }

  for (const entry of safeReadDir(rootPath, { withFileTypes: true })) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (["binaries", "bin", "engine", "extras", "redist", "redistributables"].includes(entry.name.toLowerCase())) {
        continue;
      }
      walk(entryPath, maxDepth, visit, depth + 1);
    } else {
      visit(entryPath);
    }
  }
}

function walkFiles(rootPath, maxDepth, visit, depth = 0) {
  if (!rootPath || !fs.existsSync(rootPath) || depth > maxDepth) {
    return;
  }

  for (const entry of safeReadDir(rootPath, { withFileTypes: true })) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(entryPath, maxDepth, visit, depth + 1);
    } else {
      visit(entryPath);
    }
  }
}

function scoreExecutable(filePath, titleTokens) {
  const name = path.basename(filePath, ".exe").toLowerCase();
  const directory = path.dirname(filePath).toLowerCase();
  let score = 0;

  for (const token of titleTokens) {
    if (name.includes(token)) {
      score += 12;
    }
    if (directory.includes(token)) {
      score += 2;
    }
  }

  if (name.includes("launcher")) {
    score -= 8;
  }
  if (directory.includes("win64") || directory.includes("x64")) {
    score += 3;
  }
  if (!directory.includes("redist")) {
    score += 1;
  }

  return score;
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function dedupeGames(games) {
  const groups = [];
  const strongKeyToGroup = new Map();
  const weakKeyToGroup = new Map();

  for (const game of games) {
    const strongKeys = getStrongDedupeKeys(game);
    const weakKeys = getWeakDedupeKeys(game);
    let group = strongKeys.map((key) => strongKeyToGroup.get(key)).find(Boolean);

    if (!group) {
      group = weakKeys
        .map((key) => weakKeyToGroup.get(key))
        .find((candidate) => candidate && shouldWeakDedupe(game, candidate.game));
    }

    if (!group) {
      group = {
        game,
        strongKeys: new Set(),
        weakKeys: new Set()
      };
      groups.push(group);
    } else if (getGamePriority(game) > getGamePriority(group.game)) {
      group.game = game;
    }

    for (const key of strongKeys) {
      group.strongKeys.add(key);
      strongKeyToGroup.set(key, group);
    }

    for (const key of weakKeys) {
      group.weakKeys.add(key);
      weakKeyToGroup.set(key, group);
    }
  }

  return groups.map((group) => group.game);
}

function getStrongDedupeKeys(game) {
  const keys = [];
  const executablePath = getExecutableDedupePath(game);
  const installPath = getInstallDedupePath(game);

  if (executablePath) {
    keys.push(`exe:${executablePath}`);
  }

  if (installPath) {
    keys.push(`install:${installPath}`);
  }

  if (game.appId && (game.source === "Steam" || game.source === "Epic")) {
    keys.push(`launcher:${game.source.toLowerCase()}:${String(game.appId).toLowerCase()}`);
  }

  const steamAppId = game.launchType === "steam" ? getSteamAppId(game.launchTarget, game.launchArgs) : null;
  if (steamAppId) {
    keys.push(`launcher:steam:${steamAppId.toLowerCase()}`);
  }

  const epicUrl = game.launchType === "epic" ? getEpicLaunchUrl(game.launchTarget, game.launchArgs) : null;
  if (epicUrl) {
    keys.push(`launcher:epic:${normalizeTitle(epicUrl)}`);
  }

  return Array.from(new Set(keys));
}

function getWeakDedupeKeys(game) {
  const title = normalizeTitle(game.title);
  return title ? [`title:${title}`] : [];
}

function shouldWeakDedupe(candidate, existing) {
  if (!candidate || !existing) {
    return false;
  }

  const candidateExe = getExecutableDedupePath(candidate);
  const existingExe = getExecutableDedupePath(existing);
  const candidateInstall = getInstallDedupePath(candidate);
  const existingInstall = getInstallDedupePath(existing);
  const bothDirectExe = isDirectExecutableGame(candidate) && isDirectExecutableGame(existing);

  if (bothDirectExe && candidateExe && existingExe && candidateExe !== existingExe) {
    return false;
  }

  if (bothDirectExe && candidateInstall && existingInstall && candidateInstall !== existingInstall) {
    return false;
  }

  return true;
}

function getGamePriority(game) {
  let priority = 0;

  if (game.custom) {
    priority += 90;
  }

  if (isDirectExecutableGame(game)) {
    priority += 60;
  } else if (game.launchType === "appx") {
    priority += 24;
  } else if (isLauncherProtocolGame(game)) {
    priority += 8;
  }

  if (game.source === "Steam" || game.source === "Epic") {
    priority += 12;
  }

  if (game.launchArgs) {
    priority += 3;
  }

  if (game.executablePath && fs.existsSync(game.executablePath)) {
    priority += 10;
  }

  if (game.artworkPath) {
    priority += 6;
  }

  if (game.iconPath) {
    priority += 2;
  }

  if (getInstallDedupePath(game)) {
    priority += 4;
  }

  if (game.source === "Shortcut") {
    priority -= 4;
  }

  if (game.id && game.id.includes("known")) {
    priority -= 2;
  }

  return priority;
}

function isDirectExecutableGame(game) {
  return game && game.launchType === "exe" && Boolean(getExecutableDedupePath(game));
}

function isLauncherProtocolGame(game) {
  return game && (game.launchType === "steam" || game.launchType === "epic" || game.launchType === "url");
}

function getExecutableDedupePath(game) {
  if (!game) {
    return "";
  }

  const candidate = game.executablePath || (game.launchType === "exe" ? game.launchTarget : "");
  if (!candidate || path.extname(candidate).toLowerCase() !== ".exe") {
    return "";
  }

  return normalizePathKey(candidate);
}

function getInstallDedupePath(game) {
  const installPath = game && game.installPath ? String(game.installPath) : "";
  if (!installPath || /^windows apps$/i.test(installPath)) {
    return "";
  }

  return normalizePathKey(installPath);
}

function normalizePathKey(value) {
  return String(value || "")
    .replace(/\//g, "\\")
    .replace(/\\+$/g, "")
    .toLowerCase()
    .trim();
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

async function resolveShortcut(filePath) {
  if (path.extname(filePath).toLowerCase() === ".url") {
    const text = safeReadFile(filePath);
    const match = text.match(/^URL=(.+)$/im);
    return match
      ? {
          name: path.basename(filePath, ".url"),
          url: match[1].trim(),
          target: match[1].trim(),
          workingDirectory: ""
        }
      : null;
  }

  const command = `
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut(${JSON.stringify(filePath)})
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [PSCustomObject]@{
      name = [System.IO.Path]::GetFileNameWithoutExtension(${JSON.stringify(filePath)})
      target = $shortcut.TargetPath
      arguments = $shortcut.Arguments
      workingDirectory = $shortcut.WorkingDirectory
      iconPath = $shortcut.IconLocation
    } | ConvertTo-Json -Compress
  `;

  try {
    const output = await execPowerShell(command);
    return JSON.parse(output);
  } catch {
    return null;
  }
}

async function resolveShortcuts(filePaths) {
  if (!filePaths.length) {
    return [];
  }

  const command = `
    $files = ConvertFrom-Json @'
${JSON.stringify(filePaths)}
'@
    $shell = New-Object -ComObject WScript.Shell
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $results = foreach ($file in $files) {
      try {
        $shortcut = $shell.CreateShortcut($file)
        [PSCustomObject]@{
          filePath = $file
          name = [System.IO.Path]::GetFileNameWithoutExtension($file)
          target = $shortcut.TargetPath
          arguments = $shortcut.Arguments
          workingDirectory = $shortcut.WorkingDirectory
          iconPath = $shortcut.IconLocation
        }
      } catch {}
    }
    @($results) | ConvertTo-Json -Compress
  `;

  try {
    const output = await execPowerShell(command, 20000);
    return normalizeArray(JSON.parse(output || "[]"));
  } catch {
    return [];
  }
}

async function getRegistryValue(keyPath, valueName) {
  const command = `
    $item = Get-ItemProperty -Path ${JSON.stringify(keyPath)} -Name ${JSON.stringify(valueName)} -ErrorAction SilentlyContinue
    if ($item) { $item.${valueName} }
  `;

  try {
    return (await execPowerShell(command)).trim();
  } catch {
    return "";
  }
}

function execPowerShell(command, timeout = 12000) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { windowsHide: true, timeout },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        if (stderr && stderr.trim()) {
          reject(new Error(stderr));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function normalizeArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function uniqueByPath(filePath, index, array) {
  const normalized = String(filePath || "").toLowerCase();
  return array.findIndex((item) => String(item || "").toLowerCase() === normalized) === index;
}

function stableId(value) {
  let hash = 0;
  const input = String(value).toLowerCase();
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/\0/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanExecutablePath(value) {
  if (!value) {
    return "";
  }

  let text = String(value)
    .replace(/\0/g, "")
    .trim();

  if ((text.startsWith('"') && text.includes('"', 1))) {
    text = text.slice(1, text.indexOf('"', 1));
  }

  const commaMatch = text.match(/^(.+?\.(?:exe|ico|png|jpg|jpeg|bmp|dll)),?-?\d*$/i);
  if (commaMatch) {
    text = commaMatch[1];
  }

  return text.replace(/\//g, "\\").trim();
}

function firstMatch(text, regexes) {
  for (const regex of regexes) {
    const match = String(text || "").match(regex);
    if (match && match[1]) {
      return cleanExecutablePath(match[1]);
    }
  }
  return "";
}

function safeReadDir(directoryPath, options) {
  try {
    return fs.readdirSync(directoryPath, options);
  } catch {
    return [];
  }
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = {
  scanGames,
  gameFromFile,
  dedupeGames,
  parseValveKeyValues,
  parseSteamLibraryFolders,
  buildEpicLaunchUrl
};
