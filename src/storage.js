const fs = require("fs");
const path = require("path");

const STORE_FILE = "library.json";
const DEFAULT_APP_SETTINGS = {
  audioOutputId: "default",
  audioOutputLabel: "System default",
  startView: "home",
  rescanOnStart: true,
  reduceMotion: false,
  showHiddenLaunchers: false,
  theme: "nova"
};

const DEFAULT_CONTROLLER_SETTINGS = {
  deadzone: 0.55,
  repeatDelay: 180,
  mappings: {
    confirm: { label: "Confirm / Launch", buttons: [0] },
    back: { label: "Back / Clear Search", buttons: [1] },
    search: { label: "Focus Search", buttons: [2] },
    scan: { label: "Rescan Library", buttons: [3] },
    fullscreen: { label: "Toggle Fullscreen", buttons: [9] },
    home: { label: "Home View", buttons: [8] },
    library: { label: "All Games View", buttons: [4] },
    settings: { label: "Settings View", buttons: [5] },
    quickMenu: { label: "Quick Menu", buttons: [16] }
  }
};

function createStore(userDataPath) {
  const filePath = path.join(userDataPath, STORE_FILE);
  ensureDirectory(userDataPath);

  function readStore() {
    try {
      if (!fs.existsSync(filePath)) {
        return {
          customGames: [],
          controllerSettings: normalizeControllerSettings(),
          appSettings: normalizeAppSettings(),
          gamePreferences: {},
          gameProfiles: {}
        };
      }

      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return {
        customGames: Array.isArray(parsed.customGames) ? parsed.customGames : [],
        controllerSettings: normalizeControllerSettings(parsed.controllerSettings),
        appSettings: normalizeAppSettings(parsed.appSettings),
        gamePreferences: normalizeGamePreferences(parsed.gamePreferences),
        gameProfiles: normalizeGameProfiles(parsed.gameProfiles)
      };
    } catch {
      return {
        customGames: [],
        controllerSettings: normalizeControllerSettings(),
        appSettings: normalizeAppSettings(),
        gamePreferences: {},
        gameProfiles: {}
      };
    }
  }

  function writeStore(nextStore) {
    fs.writeFileSync(filePath, JSON.stringify(nextStore, null, 2), "utf8");
  }

  return {
    getCustomGames() {
      return readStore().customGames;
    },

    getControllerSettings() {
      return readStore().controllerSettings;
    },

    getAppSettings() {
      return readStore().appSettings;
    },

    getGamePreferenceSettings(gameId) {
      return readStore().gamePreferences[normalizePreferenceId(gameId)] || {};
    },

    getGameProfiles() {
      return readStore().gameProfiles;
    },

    getGameProfile(gameId) {
      return readStore().gameProfiles[normalizePreferenceId(gameId)] || normalizeGameProfile();
    },

    updateAppSettings(settings) {
      const current = readStore();
      const appSettings = normalizeAppSettings(settings);
      writeStore({
        ...current,
        appSettings
      });
      return appSettings;
    },

    updateControllerSettings(settings) {
      const current = readStore();
      const controllerSettings = normalizeControllerSettings(settings);
      writeStore({
        ...current,
        controllerSettings
      });
      return controllerSettings;
    },

    updateGamePreferenceSettings(gameId, settings) {
      const current = readStore();
      const preferenceId = normalizePreferenceId(gameId);
      if (!preferenceId) {
        return {};
      }

      const gamePreferences = {
        ...current.gamePreferences,
        [preferenceId]: normalizeStoredPreferenceSettings(settings)
      };

      writeStore({
        ...current,
        gamePreferences
      });
      return gamePreferences[preferenceId];
    },

    updateGameProfile(gameId, update) {
      const current = readStore();
      const profileId = normalizePreferenceId(gameId);
      if (!profileId) {
        return normalizeGameProfile();
      }

      const currentProfile = current.gameProfiles[profileId] || {};
      const nextProfile = normalizeGameProfile({
        ...currentProfile,
        ...(update && typeof update === "object" && !Array.isArray(update) ? update : {})
      });
      const gameProfiles = {
        ...current.gameProfiles,
        [profileId]: nextProfile
      };

      writeStore({
        ...current,
        gameProfiles
      });
      return nextProfile;
    },

    upsertCustomGame(game) {
      const current = readStore();
      const customGames = current.customGames.filter((entry) => entry.id !== game.id);
      const nextGame = {
        ...game,
        source: "Custom",
        custom: true
      };

      customGames.push(nextGame);
      customGames.sort((a, b) => a.title.localeCompare(b.title));
      writeStore({ ...current, customGames });
      return nextGame;
    },

    removeCustomGame(gameId) {
      const current = readStore();
      const customGames = current.customGames.filter((entry) => entry.id !== gameId);
      writeStore({ ...current, customGames });
      return customGames;
    }
  };
}

function normalizeAppSettings(settings = {}) {
  const startView = ["home", "library", "settings"].includes(settings.startView)
    ? settings.startView
    : DEFAULT_APP_SETTINGS.startView;
  const theme = ["nova", "ember", "ocean", "light"].includes(settings.theme)
    ? settings.theme
    : DEFAULT_APP_SETTINGS.theme;

  return {
    audioOutputId: normalizeString(settings.audioOutputId, DEFAULT_APP_SETTINGS.audioOutputId, 180),
    audioOutputLabel: normalizeString(settings.audioOutputLabel, DEFAULT_APP_SETTINGS.audioOutputLabel, 180),
    startView,
    rescanOnStart: normalizeBoolean(settings.rescanOnStart, DEFAULT_APP_SETTINGS.rescanOnStart),
    reduceMotion: normalizeBoolean(settings.reduceMotion, DEFAULT_APP_SETTINGS.reduceMotion),
    showHiddenLaunchers: normalizeBoolean(settings.showHiddenLaunchers, DEFAULT_APP_SETTINGS.showHiddenLaunchers),
    theme
  };
}

function normalizeControllerSettings(settings = {}) {
  const mappings = {};
  const inputMappings = settings && typeof settings === "object" ? settings.mappings || {} : {};

  for (const [action, defaults] of Object.entries(DEFAULT_CONTROLLER_SETTINGS.mappings)) {
    const input = inputMappings[action] || {};
    mappings[action] = {
      label: defaults.label,
      buttons: normalizeButtons(input.buttons, defaults.buttons)
    };
  }

  return {
    deadzone: normalizeNumber(settings.deadzone, DEFAULT_CONTROLLER_SETTINGS.deadzone, 0.1, 0.95),
    repeatDelay: normalizeNumber(settings.repeatDelay, DEFAULT_CONTROLLER_SETTINGS.repeatDelay, 90, 500),
    mappings
  };
}

function normalizeGamePreferences(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, settings]) => [normalizePreferenceId(key), normalizeStoredPreferenceSettings(settings)])
      .filter(([key]) => Boolean(key))
  );
}

function normalizeStoredPreferenceSettings(settings) {
  return settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
}

function normalizeGameProfiles(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, profile]) => [normalizePreferenceId(key), normalizeGameProfile(profile)])
      .filter(([key]) => Boolean(key))
  );
}

function normalizeGameProfile(profile = {}) {
  return {
    favorite: normalizeBoolean(profile.favorite, false),
    hidden: normalizeBoolean(profile.hidden, false),
    profileName: normalizeOptionalString(profile.profileName, 80),
    accountLabel: normalizeOptionalString(profile.accountLabel, 80),
    launchArgs: normalizeOptionalString(profile.launchArgs, 260),
    artworkPath: normalizeOptionalString(profile.artworkPath, 520),
    lastPlayedAt: normalizePositiveInteger(profile.lastPlayedAt),
    playCount: normalizePositiveInteger(profile.playCount)
  };
}

function normalizePreferenceId(value) {
  return typeof value === "string" ? value.trim().slice(0, 180) : "";
}

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function normalizeString(value, fallback, maxLength) {
  if (typeof value !== "string") {
    return fallback;
  }
  const text = value.trim();
  return text ? text.slice(0, maxLength) : fallback;
}

function normalizeOptionalString(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, maxLength);
}

function normalizeButtons(value, fallback) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const buttons = value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 31);

  return buttons.length ? Array.from(new Set(buttons)) : fallback;
}

function normalizeNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

module.exports = {
  createStore,
  DEFAULT_APP_SETTINGS,
  DEFAULT_CONTROLLER_SETTINGS
};
