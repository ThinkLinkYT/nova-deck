const fs = require("fs");
const os = require("os");
const path = require("path");

const BEDROCK_PACKAGE_ID = "Microsoft.MinecraftUWP_8wekyb3d8bbwe";
const BEDROCK_CONTROL_KEYS = [
  { key: "ctrl_type_0_key.attack", label: "Attack / Destroy" },
  { key: "ctrl_type_0_key.use", label: "Use / Place" },
  { key: "ctrl_type_0_key.jump", label: "Jump" },
  { key: "ctrl_type_0_key.sneak", label: "Sneak / Fly Down" },
  { key: "ctrl_type_0_key.sprint", label: "Sprint" },
  { key: "ctrl_type_0_key.inventory", label: "Inventory" },
  { key: "ctrl_type_0_key.drop", label: "Drop Item" },
  { key: "ctrl_type_0_key.cycleItemLeft", label: "Cycle Left" },
  { key: "ctrl_type_0_key.cycleItemRight", label: "Cycle Right" },
  { key: "ctrl_type_0_key.togglePerspective", label: "Perspective" },
  { key: "ctrl_type_0_key.chat", label: "Chat" },
  { key: "ctrl_type_0_key.emote", label: "Emote" }
];

const BEDROCK_TOGGLE_KEYS = [
  { key: "ctrl_swap_gamepad_ab_buttons", label: "Swap A/B" },
  { key: "ctrl_swap_gamepad_xy_buttons", label: "Swap X/Y" },
  { key: "ctrl_swapjumpandsneak", label: "Swap jump/sneak" },
  { key: "ctrl_autojump_gamepad", label: "Auto-jump" },
  { key: "ctrl_togglecrouch_gamepad", label: "Toggle crouch" },
  { key: "ctrl_invertmouse_gamepad", label: "Invert look" },
  { key: "feedback_destroy_vibration_gamepad", label: "Destroy vibration" },
  { key: "feedback_split_vibration_gamepad", label: "Split vibration" }
];

const BEDROCK_SLIDER_KEYS = [
  { key: "ctrl_sensitivity2_gamepad", label: "Look sensitivity", min: 0, max: 1, step: 0.05 },
  { key: "gfx_gamepad_cursor_sensitivity", label: "Cursor sensitivity", min: 0.25, max: 3, step: 0.05 },
  { key: "ctrl_spyglassdamp_gamepad", label: "Spyglass damping", min: 0, max: 1, step: 0.05 }
];

const BEDROCK_BUTTON_OPTIONS = [
  { value: "-100", label: "Left Trigger / L2" },
  { value: "-99", label: "Right Trigger / R2" },
  { value: "0", label: "Unassigned" },
  { value: "1", label: "A / Cross" },
  { value: "2", label: "B / Circle" },
  { value: "3", label: "X / Square" },
  { value: "4", label: "Y / Triangle" },
  { value: "5", label: "Button 5" },
  { value: "6", label: "Button 6" },
  { value: "7", label: "Button 7" },
  { value: "8", label: "Button 8" },
  { value: "9", label: "Left Stick" },
  { value: "10", label: "Right Stick" },
  { value: "11", label: "Left Bumper / L1" },
  { value: "12", label: "Right Bumper / R1" },
  { value: "13", label: "Button 13" }
];

const JAVA_BRIDGE_DEFAULTS = {
  enabled: false,
  deadzone: 0.24,
  lookSensitivity: 1,
  controls: {}
};

const JAVA_BRIDGE_CONTROLS = [
  { key: "java_bridge.button0", buttonIndex: 0, label: "A / Cross", defaultValue: "key:Space" },
  { key: "java_bridge.button1", buttonIndex: 1, label: "B / Circle", defaultValue: "key:Shift" },
  { key: "java_bridge.button2", buttonIndex: 2, label: "X / Square", defaultValue: "key:E" },
  { key: "java_bridge.button3", buttonIndex: 3, label: "Y / Triangle", defaultValue: "key:Q" },
  { key: "java_bridge.button4", buttonIndex: 4, label: "LB / L1", defaultValue: "wheel:up" },
  { key: "java_bridge.button5", buttonIndex: 5, label: "RB / R1", defaultValue: "wheel:down" },
  { key: "java_bridge.button6", buttonIndex: 6, label: "LT / L2", defaultValue: "mouse:right" },
  { key: "java_bridge.button7", buttonIndex: 7, label: "RT / R2", defaultValue: "mouse:left" },
  { key: "java_bridge.button8", buttonIndex: 8, label: "View / Share", defaultValue: "key:F3" },
  { key: "java_bridge.button9", buttonIndex: 9, label: "Menu / Options", defaultValue: "key:Escape" },
  { key: "java_bridge.button10", buttonIndex: 10, label: "Left Stick", defaultValue: "key:Control" },
  { key: "java_bridge.button11", buttonIndex: 11, label: "Right Stick", defaultValue: "key:F5" },
  { key: "java_bridge.button12", buttonIndex: 12, label: "D-pad Up", defaultValue: "key:1" },
  { key: "java_bridge.button13", buttonIndex: 13, label: "D-pad Down", defaultValue: "key:2" },
  { key: "java_bridge.button14", buttonIndex: 14, label: "D-pad Left", defaultValue: "key:3" },
  { key: "java_bridge.button15", buttonIndex: 15, label: "D-pad Right", defaultValue: "key:4" }
];

const JAVA_BRIDGE_OUTPUT_OPTIONS = [
  { value: "none", label: "Unassigned" },
  { value: "mouse:left", label: "Left click / Attack" },
  { value: "mouse:right", label: "Right click / Use" },
  { value: "wheel:up", label: "Mouse wheel up" },
  { value: "wheel:down", label: "Mouse wheel down" },
  { value: "key:Space", label: "Space / Jump" },
  { value: "key:Shift", label: "Shift / Sneak" },
  { value: "key:Control", label: "Control / Sprint" },
  { value: "key:E", label: "E / Inventory" },
  { value: "key:Q", label: "Q / Drop" },
  { value: "key:F3", label: "F3 / Debug" },
  { value: "key:F5", label: "F5 / Perspective" },
  { value: "key:Escape", label: "Escape / Menu" },
  { value: "key:1", label: "Hotbar 1" },
  { value: "key:2", label: "Hotbar 2" },
  { value: "key:3", label: "Hotbar 3" },
  { value: "key:4", label: "Hotbar 4" },
  { value: "key:5", label: "Hotbar 5" },
  { value: "key:6", label: "Hotbar 6" },
  { value: "key:7", label: "Hotbar 7" },
  { value: "key:8", label: "Hotbar 8" },
  { value: "key:9", label: "Hotbar 9" }
];

const JAVA_CLIENT_TERMS = [
  "minecraft launcher",
  "minecraftlauncher",
  "java edition",
  ".minecraft",
  "lunar client",
  "badlion",
  "feather client",
  "prism launcher",
  "prismlauncher",
  "multimc",
  "atlauncher",
  "modrinth",
  "curseforge",
  "technic launcher",
  "gdlauncher"
];

const BEDROCK_UPDATE_KEYS = new Set([
  ...BEDROCK_CONTROL_KEYS.map((item) => item.key),
  ...BEDROCK_TOGGLE_KEYS.map((item) => item.key),
  ...BEDROCK_SLIDER_KEYS.map((item) => item.key)
]);

const JAVA_CONTROL_KEYS = new Set(JAVA_BRIDGE_CONTROLS.map((item) => item.key));
const JAVA_OUTPUT_VALUES = new Set(JAVA_BRIDGE_OUTPUT_OPTIONS.map((item) => item.value));

function getGamePreferences(game, storedSettings = {}) {
  if (isMinecraftBedrockGame(game)) {
    return getBedrockPreferences();
  }

  if (isMinecraftJavaGame(game)) {
    return getJavaBridgePreferences(storedSettings);
  }

  return {
    supported: false,
    kind: "generic",
    title: "Preferences",
    message: "Nova Deck does not have a settings editor for this app yet."
  };
}

function updateGamePreference(game, update, storedSettings = {}) {
  if (isMinecraftBedrockGame(game)) {
    updateBedrockPreference(update);
    return {
      preferences: getGamePreferences(game, storedSettings),
      settings: storedSettings
    };
  }

  if (isMinecraftJavaGame(game)) {
    const nextSettings = {
      ...storedSettings,
      javaBridge: updateJavaBridgeSettings(storedSettings.javaBridge, update)
    };
    return {
      preferences: getGamePreferences(game, nextSettings),
      settings: nextSettings
    };
  }

  return {
    preferences: getGamePreferences(game, storedSettings),
    settings: storedSettings
  };
}

function getBedrockPreferences() {
  const candidates = findBedrockOptionsFiles();
  const optionsFile = candidates[0] || null;

  if (!optionsFile) {
    return {
      supported: true,
      kind: "minecraft-bedrock",
      title: "Minecraft for Windows",
      status: "missing",
      message: "No editable Bedrock options.txt file was found yet.",
      searchPaths: getBedrockOptionsSearchRoots()
    };
  }

  const parsed = readOptionsFile(optionsFile.fullName);

  return {
    supported: true,
    kind: "minecraft-bedrock",
    title: "Minecraft for Windows",
    status: "ready",
    message: "Editing Bedrock controller options. Close Minecraft before saving changes.",
    optionsPath: optionsFile.fullName,
    folderPath: path.dirname(optionsFile.fullName),
    profileName: getProfileName(optionsFile.fullName),
    controlTitle: "Gamepad Buttons",
    toggleTitle: "Gamepad Toggles",
    sliderTitle: "Feel",
    updatedAt: optionsFile.lastWriteTime,
    controls: BEDROCK_CONTROL_KEYS.map((control) => ({
      ...control,
      value: getOptionValue(parsed, control.key, "0"),
      options: BEDROCK_BUTTON_OPTIONS
    })),
    toggles: BEDROCK_TOGGLE_KEYS.map((toggle) => ({
      ...toggle,
      enabled: getOptionValue(parsed, toggle.key, "0") === "1"
    })),
    sliders: BEDROCK_SLIDER_KEYS.map((slider) => ({
      ...slider,
      value: Number(getOptionValue(parsed, slider.key, slider.min))
    }))
  };
}

function getJavaBridgePreferences(storedSettings = {}) {
  const bridge = normalizeJavaBridgeSettings(storedSettings.javaBridge);

  return {
    supported: true,
    kind: "minecraft-java-bridge",
    title: "Minecraft Java",
    status: "ready",
    message: "After Minecraft is focused, Nova Deck converts controller input into keyboard and mouse input for the game window.",
    profileName: "Vanilla input bridge",
    controlTitle: "Button Mapping",
    toggleTitle: "Bridge",
    sliderTitle: "Sticks",
    bridge,
    controls: JAVA_BRIDGE_CONTROLS.map((control) => ({
      ...control,
      value: bridge.controls[control.key],
      options: JAVA_BRIDGE_OUTPUT_OPTIONS
    })),
    toggles: [
      {
        key: "java_bridge.enabled",
        label: "Java input bridge",
        enabled: bridge.enabled
      }
    ],
    sliders: [
      {
        key: "java_bridge.deadzone",
        label: "Stick deadzone",
        min: 0.1,
        max: 0.7,
        step: 0.05,
        value: bridge.deadzone
      },
      {
        key: "java_bridge.lookSensitivity",
        label: "Look sensitivity",
        min: 0.2,
        max: 3,
        step: 0.1,
        value: bridge.lookSensitivity
      }
    ]
  };
}

function updateBedrockPreference(update) {
  const targetPath = normalizeOptionsPath(update && update.optionsPath);
  const nextValues = normalizeBedrockPreferenceUpdates(update);

  if (!targetPath || nextValues.length === 0) {
    return;
  }

  const candidates = findBedrockOptionsFiles();
  const allowedPath = candidates.some((candidate) => candidate.fullName.toLowerCase() === targetPath.toLowerCase());
  if (!allowedPath) {
    return;
  }

  writeOptions(targetPath, nextValues);
}

function updateJavaBridgeSettings(existingSettings, update) {
  const current = normalizeJavaBridgeSettings(existingSettings);
  const key = update && update.key;

  if (key === "java_bridge.enabled") {
    return {
      ...current,
      enabled: update.value === "1" || update.value === true
    };
  }

  if (key === "java_bridge.deadzone") {
    return {
      ...current,
      deadzone: clampNumber(update.value, current.deadzone, 0.1, 0.7)
    };
  }

  if (key === "java_bridge.lookSensitivity") {
    return {
      ...current,
      lookSensitivity: clampNumber(update.value, current.lookSensitivity, 0.2, 3)
    };
  }

  if (JAVA_CONTROL_KEYS.has(key)) {
    const value = String(update.value || "none");
    if (!JAVA_OUTPUT_VALUES.has(value)) {
      return current;
    }
    return {
      ...current,
      controls: {
        ...current.controls,
        [key]: value
      }
    };
  }

  return current;
}

function normalizeJavaBridgeSettings(settings = {}) {
  const input = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  const inputControls = input.controls && typeof input.controls === "object" ? input.controls : {};
  const controls = {};

  for (const control of JAVA_BRIDGE_CONTROLS) {
    const value = String(inputControls[control.key] || control.defaultValue);
    controls[control.key] = JAVA_OUTPUT_VALUES.has(value) ? value : control.defaultValue;
  }

  return {
    enabled: input.enabled === true,
    deadzone: clampNumber(input.deadzone, JAVA_BRIDGE_DEFAULTS.deadzone, 0.1, 0.7),
    lookSensitivity: clampNumber(input.lookSensitivity, JAVA_BRIDGE_DEFAULTS.lookSensitivity, 0.2, 3),
    controls
  };
}

function isMinecraftBedrockGame(game) {
  const text = getGameText(game);
  const title = String(game && game.title || "").toLowerCase();
  const target = String(game && game.launchTarget || "").toLowerCase();
  return title.includes("minecraft for windows")
    || target.includes(BEDROCK_PACKAGE_ID.toLowerCase())
    || text.includes("minecraftuwp");
}

function isMinecraftJavaGame(game) {
  const text = getGameText(game);
  if (isMinecraftBedrockGame(game)) {
    return false;
  }
  return text.includes("minecraft") || JAVA_CLIENT_TERMS.some((term) => text.includes(term));
}

function getGameText(game) {
  return `${game && game.title} ${game && game.source} ${game && game.launchType} ${game && game.launchTarget} ${game && game.installPath}`.toLowerCase();
}

function findBedrockOptionsFiles() {
  const files = [];

  for (const rootPath of getBedrockOptionsSearchRoots()) {
    collectOptionsFiles(rootPath, files);
  }

  return files
    .sort((left, right) => {
      const leftShared = left.fullName.toLowerCase().includes(`${path.sep}shared${path.sep}`) ? 1 : 0;
      const rightShared = right.fullName.toLowerCase().includes(`${path.sep}shared${path.sep}`) ? 1 : 0;
      return leftShared - rightShared || right.lastWriteTimeMs - left.lastWriteTimeMs;
    });
}

function getBedrockOptionsSearchRoots() {
  const roots = [];
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");

  roots.push(path.join(appData, "Minecraft Bedrock", "Users"));
  roots.push(path.join(appData, "Minecraft Bedrock", "games", "com.mojang"));
  roots.push(path.join(localAppData, "Packages", BEDROCK_PACKAGE_ID, "LocalState", "games", "com.mojang"));

  return roots;
}

function collectOptionsFiles(rootPath, files) {
  if (!rootPath || !fs.existsSync(rootPath)) {
    return;
  }

  const stack = [rootPath];
  while (stack.length > 0) {
    const currentPath = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name.toLowerCase() === "options.txt") {
        const stats = fs.statSync(entryPath);
        files.push({
          fullName: entryPath,
          lastWriteTime: stats.mtime.toISOString(),
          lastWriteTimeMs: stats.mtimeMs
        });
      }
    }
  }
}

function readOptionsFile(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const values = new Map();

  lines.forEach((line, index) => {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      return;
    }

    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    values.set(key, { value, index });
  });

  return { lines, values };
}

function writeOptions(filePath, updates) {
  const parsed = readOptionsFile(filePath);
  const backupPath = `${filePath}.novadeck-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
  fs.copyFileSync(filePath, backupPath);

  for (const update of updates) {
    const existing = parsed.values.get(update.key);
    const nextLine = `${update.key}:${update.value}`;
    if (existing) {
      parsed.lines[existing.index] = nextLine;
    } else {
      parsed.lines.push(nextLine);
    }
  }

  fs.writeFileSync(filePath, parsed.lines.join("\r\n"), "utf8");
}

function normalizeBedrockPreferenceUpdates(update) {
  if (!update || typeof update !== "object" || !update.key || !BEDROCK_UPDATE_KEYS.has(update.key)) {
    return [];
  }

  if (BEDROCK_CONTROL_KEYS.some((item) => item.key === update.key)) {
    const allowedValues = new Set(BEDROCK_BUTTON_OPTIONS.map((option) => option.value));
    const value = String(update.value);
    return allowedValues.has(value) ? [{ key: update.key, value }] : [];
  }

  if (BEDROCK_TOGGLE_KEYS.some((item) => item.key === update.key)) {
    return [{ key: update.key, value: update.value === "1" || update.value === true ? "1" : "0" }];
  }

  const slider = BEDROCK_SLIDER_KEYS.find((item) => item.key === update.key);
  if (slider) {
    const number = Number(update.value);
    if (!Number.isFinite(number)) {
      return [];
    }
    const value = Math.min(slider.max, Math.max(slider.min, number));
    return [{ key: update.key, value: String(Number(value.toFixed(2))) }];
  }

  return [];
}

function normalizeOptionsPath(filePath) {
  return typeof filePath === "string" && filePath.endsWith("options.txt") ? path.normalize(filePath) : "";
}

function getOptionValue(parsed, key, fallback) {
  const entry = parsed.values.get(key);
  return entry ? entry.value : String(fallback);
}

function getProfileName(filePath) {
  const parts = filePath.split(path.sep);
  const usersIndex = parts.findIndex((part) => part.toLowerCase() === "users");
  if (usersIndex >= 0 && parts[usersIndex + 1]) {
    return parts[usersIndex + 1];
  }
  return "Local profile";
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

module.exports = {
  getGamePreferences,
  updateGamePreference
};
