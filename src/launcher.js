const path = require("path");
const { spawn, execFile } = require("child_process");

async function launchGame(game, electronShell) {
  if (!game || !game.launchTarget) {
    return {
      ok: false,
      message: "No launch target available."
    };
  }

  const launchType = game.launchType || inferLaunchType(game.launchTarget);

  try {
    if (launchType === "steam" || launchType === "epic" || launchType === "url") {
      await electronShell.openExternal(game.launchTarget);
    } else if (launchType === "appx") {
      const child = spawn("explorer.exe", [`shell:AppsFolder\\${game.launchTarget}`], {
        detached: true,
        stdio: "ignore",
        windowsHide: false
      });
      child.unref();
    } else {
      const executable = game.executablePath || game.launchTarget;
      const launchArgs = splitWindowsArgs(game.launchArgs || "");
      const child = spawn(executable, launchArgs, {
        cwd: game.installPath || path.dirname(executable),
        detached: true,
        stdio: "ignore",
        windowsHide: false
      });
      child.unref();
    }

    scheduleQuietMode(game);
    return {
      ok: true,
      message: `Launching ${game.title}.`
    };
  } catch (error) {
    return {
      ok: false,
      message: error.message
    };
  }
}

function inferLaunchType(target) {
  if (/^steam:/i.test(target)) {
    return "steam";
  }
  if (/^com\.epicgames\.launcher:/i.test(target)) {
    return "epic";
  }
  if (/^[a-z][a-z0-9+.-]+:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) {
    return "url";
  }
  return "exe";
}

function splitWindowsArgs(value) {
  const input = String(value || "").trim();
  if (!input) {
    return [];
  }

  const args = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (/\s/.test(char) && !inQuotes) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

function scheduleQuietMode(game) {
  const attempts = [900, 2000, 3500, 5500, 8000, 12000];
  for (const delay of attempts) {
    setTimeout(() => {
      minimizeLaunchers();
      if (game.focusProcess) {
        focusProcess(game.focusProcess);
      }
    }, delay);
  }
}

function minimizeLaunchers() {
  const script = `
    $names = @(
      "steam",
      "steamwebhelper",
      "EpicGamesLauncher",
      "EpicWebHelper",
      "EADesktop",
      "Battle.net",
      "GalaxyClient",
      "UbisoftConnect"
    )
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Quiet {
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
    Get-Process | Where-Object { $names -contains $_.ProcessName } | ForEach-Object {
      if ($_.MainWindowHandle -ne 0) {
        [Win32Quiet]::ShowWindowAsync($_.MainWindowHandle, 6) | Out-Null
      }
    }
  `;

  execPowerShell(script).catch(() => {});
}

function focusProcess(processName) {
  const safeName = String(processName || "").replace(/[^a-zA-Z0-9_. -]/g, "");
  if (!safeName) {
    return;
  }

  const script = `
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Focus {
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
    Get-Process -Name ${JSON.stringify(safeName)} -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.MainWindowHandle -ne 0) {
        [Win32Focus]::ShowWindowAsync($_.MainWindowHandle, 9) | Out-Null
        [Win32Focus]::SetForegroundWindow($_.MainWindowHandle) | Out-Null
      }
    }
  `;

  execPowerShell(script).catch(() => {});
}

function execPowerShell(command) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { windowsHide: true, timeout: 8000 },
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

module.exports = {
  launchGame,
  inferLaunchType,
  splitWindowsArgs
};
