const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

let electronApp = null;
let helperProcess = null;
let helperScriptPath = null;
let bridgeProcess = null;
let bridgeScriptPath = null;
let bridgeProfilePath = null;
let activeBridgeProfile = null;

const ALLOWED_KEY_OUTPUTS = new Set([
  "key:W",
  "key:A",
  "key:S",
  "key:D",
  "key:Space",
  "key:Shift",
  "key:Control",
  "key:Tab",
  "key:Escape",
  "key:Enter",
  "key:E",
  "key:Q",
  "key:R",
  "key:F",
  "key:C",
  "key:X",
  "key:Z",
  "key:I",
  "key:M",
  "key:F3",
  "key:F5",
  "key:Up",
  "key:Down",
  "key:Left",
  "key:Right",
  "key:1",
  "key:2",
  "key:3",
  "key:4",
  "key:5",
  "key:6",
  "key:7",
  "key:8",
  "key:9"
]);

function setupInputBridge(options) {
  electronApp = options.app;
  helperScriptPath = path.join(electronApp.getPath("userData"), "input-bridge.ps1");
  bridgeScriptPath = path.join(electronApp.getPath("userData"), "java-input-bridge.ps1");
  bridgeProfilePath = path.join(electronApp.getPath("userData"), "java-input-bridge-profile.json");
}

function sendVirtualInput(events) {
  const normalizedEvents = normalizeEvents(events);
  if (normalizedEvents.length === 0) {
    return false;
  }

  const helper = ensureHelperProcess();
  if (!helper || !helper.stdin || helper.stdin.destroyed) {
    return false;
  }

  helper.stdin.write(`${JSON.stringify({ events: normalizedEvents })}\n`);
  return true;
}

function stopInputBridge() {
  clearInputBridgeProfile();
  if (helperProcess) {
    helperProcess.kill();
    helperProcess = null;
  }
  return true;
}

function setInputBridgeProfile(profile) {
  const normalizedProfile = normalizeBridgeProfile(profile);

  if (!normalizedProfile || !normalizedProfile.enabled) {
    return false;
  }

  ensureBridgeScript();
  if (activeBridgeProfile && bridgeControlsChanged(activeBridgeProfile.controls, normalizedProfile.controls)) {
    sendVirtualInput(getReleaseEvents(activeBridgeProfile));
  }

  fs.writeFileSync(bridgeProfilePath, JSON.stringify(normalizedProfile, null, 2), "utf8");

  activeBridgeProfile = normalizedProfile;
  if (bridgeProcess && !bridgeProcess.killed) {
    return true;
  }

  stopStaleBridgeProcesses(bridgeScriptPath);
  bridgeProcess = childProcess.spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    bridgeScriptPath,
    "-ProfilePath",
    bridgeProfilePath
  ], {
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true
  });

  bridgeProcess.on("exit", () => {
    bridgeProcess = null;
  });

  return true;
}

function clearInputBridgeProfile() {
  if (activeBridgeProfile) {
    sendVirtualInput(getReleaseEvents(activeBridgeProfile));
  }

  if (bridgeProcess) {
    bridgeProcess.kill();
    bridgeProcess = null;
  }
  stopStaleBridgeProcesses(bridgeScriptPath);

  activeBridgeProfile = null;
  return true;
}

function ensureHelperProcess() {
  if (helperProcess && !helperProcess.killed) {
    return helperProcess;
  }

  ensureHelperScript();
  helperProcess = childProcess.spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    helperScriptPath
  ], {
    stdio: ["pipe", "ignore", "ignore"],
    windowsHide: true
  });

  helperProcess.on("exit", () => {
    helperProcess = null;
  });

  return helperProcess;
}

function ensureHelperScript() {
  fs.mkdirSync(path.dirname(helperScriptPath), { recursive: true });
  fs.writeFileSync(helperScriptPath, buildHelperScript(), "utf8");
}

function ensureBridgeScript() {
  fs.mkdirSync(path.dirname(bridgeScriptPath), { recursive: true });
  fs.writeFileSync(bridgeScriptPath, buildBridgeScript(), "utf8");
}

function normalizeEvents(events) {
  return (Array.isArray(events) ? events : [])
    .map((event) => {
      if (!event || typeof event !== "object") {
        return null;
      }

      if (event.type === "key") {
        const vk = Number(event.vk);
        return Number.isInteger(vk) && vk > 0 && vk <= 255
          ? { type: "key", vk, down: Boolean(event.down) }
          : null;
      }

      if (event.type === "mouseButton") {
        const button = event.button === "right" ? "right" : "left";
        return { type: "mouseButton", button, down: Boolean(event.down) };
      }

      if (event.type === "mouseMove") {
        const dx = clampInteger(event.dx, -120, 120);
        const dy = clampInteger(event.dy, -120, 120);
        return dx || dy ? { type: "mouseMove", dx, dy } : null;
      }

      if (event.type === "wheel") {
        const delta = clampInteger(event.delta, -120, 120);
        return delta ? { type: "wheel", delta } : null;
      }

      return null;
    })
    .filter(Boolean)
    .slice(0, 64);
}

function normalizeBridgeProfile(profile) {
  if (!profile || typeof profile !== "object" || !profile.bridge || !profile.bridge.enabled) {
    return null;
  }

  const controls = (Array.isArray(profile.controls) ? profile.controls : [])
    .map((control) => {
      const buttonIndex = Number(control && control.buttonIndex);
      const value = String(control && control.value || "none");
      if (!Number.isInteger(buttonIndex) || buttonIndex < 0 || buttonIndex > 31 || !isAllowedOutput(value)) {
        return null;
      }
      return { buttonIndex, value };
    })
    .filter(Boolean)
    .slice(0, 32);

  const targetProcessNames = normalizeTargetTerms(profile.bridgeTargets && profile.bridgeTargets.processNames);
  const targetTitleTerms = normalizeTargetTerms(profile.bridgeTargets && profile.bridgeTargets.titleTerms);

  return {
    enabled: true,
    deadzone: clampNumber(profile.bridge.deadzone, 0.24, 0.1, 0.7),
    lookSensitivity: clampNumber(profile.bridge.lookSensitivity, 1, 0.2, 3),
    menuCursorSensitivity: clampNumber(profile.bridge.menuCursorSensitivity, 1, 0.4, 3),
    targetProcessNames,
    targetTitleTerms,
    controls
  };
}

function isAllowedOutput(value) {
  return value === "none"
    || value === "mouse:left"
    || value === "mouse:right"
    || value === "wheel:up"
    || value === "wheel:down"
    || ALLOWED_KEY_OUTPUTS.has(value);
}

function normalizeTargetTerms(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => value.length >= 2 && value.length <= 80 && /^[a-z0-9_. -]+$/.test(value))
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(0, 16);
}

function bridgeControlsChanged(leftControls, rightControls) {
  const left = JSON.stringify(Array.isArray(leftControls) ? leftControls : []);
  const right = JSON.stringify(Array.isArray(rightControls) ? rightControls : []);
  return left !== right;
}

function stopStaleBridgeProcesses(scriptPath) {
  if (!scriptPath) {
    return;
  }

  const quotedPath = scriptPath.replace(/'/g, "''");
  const command = `$scriptPath = '${quotedPath}'; Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($scriptPath) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;

  childProcess.spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command
  ], {
    stdio: "ignore",
    windowsHide: true
  });
}

function getReleaseEvents(profile) {
  const events = new Map();
  const addKey = (vk) => events.set(`key:${vk}`, { type: "key", vk, down: false });
  const addMouse = (button) => events.set(`mouse:${button}`, { type: "mouseButton", button, down: false });

  [0x57, 0x41, 0x53, 0x44].forEach(addKey);

  for (const control of profile.controls || []) {
    const output = control.value;
    const vk = getVirtualKey(output);
    if (vk) {
      addKey(vk);
    } else if (output === "mouse:left") {
      addMouse("left");
    } else if (output === "mouse:right") {
      addMouse("right");
    }
  }

  return Array.from(events.values());
}

function getVirtualKey(output) {
  const keys = {
    "key:W": 0x57,
    "key:A": 0x41,
    "key:S": 0x53,
    "key:D": 0x44,
    "key:Space": 0x20,
    "key:Shift": 0x10,
    "key:Control": 0x11,
    "key:Tab": 0x09,
    "key:E": 0x45,
    "key:Q": 0x51,
    "key:R": 0x52,
    "key:F": 0x46,
    "key:C": 0x43,
    "key:X": 0x58,
    "key:Z": 0x5a,
    "key:I": 0x49,
    "key:M": 0x4d,
    "key:F3": 0x72,
    "key:F5": 0x74,
    "key:Escape": 0x1b,
    "key:Enter": 0x0d,
    "key:Up": 0x26,
    "key:Down": 0x28,
    "key:Left": 0x25,
    "key:Right": 0x27,
    "key:1": 0x31,
    "key:2": 0x32,
    "key:3": 0x33,
    "key:4": 0x34,
    "key:5": 0x35,
    "key:6": 0x36,
    "key:7": 0x37,
    "key:8": 0x38,
    "key:9": 0x39
  };
  return keys[output] || 0;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function clampInteger(value, min, max) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.min(max, Math.max(min, number));
}

function buildBridgeScript() {
  return String.raw`
param([string]$ProfilePath)
$ErrorActionPreference = "SilentlyContinue"

Add-Type @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

public static class NovaNativeInputBridge {
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public UInt32 type;
    public InputUnion U;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)]
    public MOUSEINPUT mi;
    [FieldOffset(0)]
    public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public Int32 dx;
    public Int32 dy;
    public Int32 mouseData;
    public UInt32 dwFlags;
    public UInt32 time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public UInt16 wVk;
    public UInt16 wScan;
    public UInt32 dwFlags;
    public UInt32 time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct XINPUT_STATE {
    public UInt32 dwPacketNumber;
    public XINPUT_GAMEPAD Gamepad;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct XINPUT_GAMEPAD {
    public UInt16 wButtons;
    public Byte bLeftTrigger;
    public Byte bRightTrigger;
    public Int16 sThumbLX;
    public Int16 sThumbLY;
    public Int16 sThumbRX;
    public Int16 sThumbRY;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public Int32 x;
    public Int32 y;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct CURSORINFO {
    public Int32 cbSize;
    public Int32 flags;
    public IntPtr hCursor;
    public POINT ptScreenPos;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct JOYINFOEX {
    public UInt32 dwSize;
    public UInt32 dwFlags;
    public UInt32 dwXpos;
    public UInt32 dwYpos;
    public UInt32 dwZpos;
    public UInt32 dwRpos;
    public UInt32 dwUpos;
    public UInt32 dwVpos;
    public UInt32 dwButtons;
    public UInt32 dwButtonNumber;
    public UInt32 dwPOV;
    public UInt32 dwReserved1;
    public UInt32 dwReserved2;
  }

  [DllImport("user32.dll", SetLastError=true)]
  public static extern UInt32 SendInput(UInt32 nInputs, INPUT[] pInputs, Int32 cbSize);

  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  private static extern UInt32 GetWindowThreadProcessId(IntPtr hWnd, out UInt32 processId);

  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  private static extern Int32 GetWindowText(IntPtr hWnd, StringBuilder text, Int32 count);

  [DllImport("user32.dll")]
  private static extern bool GetCursorInfo(out CURSORINFO cursorInfo);

  [DllImport("xinput1_4.dll", EntryPoint="XInputGetState")]
  private static extern UInt32 XInputGetState14(UInt32 dwUserIndex, out XINPUT_STATE pState);

  [DllImport("xinput9_1_0.dll", EntryPoint="XInputGetState")]
  private static extern UInt32 XInputGetState910(UInt32 dwUserIndex, out XINPUT_STATE pState);

  [DllImport("winmm.dll")]
  private static extern UInt32 timeBeginPeriod(UInt32 uPeriod);

  [DllImport("winmm.dll")]
  private static extern UInt32 timeEndPeriod(UInt32 uPeriod);

  [DllImport("winmm.dll")]
  private static extern UInt32 joyGetNumDevs();

  [DllImport("winmm.dll")]
  private static extern UInt32 joyGetPosEx(UInt32 uJoyID, ref JOYINFOEX pji);

  private const UInt32 INPUT_MOUSE = 0;
  private const UInt32 INPUT_KEYBOARD = 1;
  private const UInt32 KEYEVENTF_KEYUP = 0x0002;
  private const UInt32 MOUSEEVENTF_MOVE = 0x0001;
  private const UInt32 MOUSEEVENTF_LEFTDOWN = 0x0002;
  private const UInt32 MOUSEEVENTF_LEFTUP = 0x0004;
  private const UInt32 MOUSEEVENTF_RIGHTDOWN = 0x0008;
  private const UInt32 MOUSEEVENTF_RIGHTUP = 0x0010;
  private const UInt32 MOUSEEVENTF_WHEEL = 0x0800;
  private const UInt32 JOY_RETURNALL = 0x000000FF;
  private const UInt32 JOYERR_NOERROR = 0;
  private const UInt32 JOY_POVCENTERED = 0xFFFF;
  private const Int32 CURSOR_SHOWING = 0x00000001;
  private static readonly string[] DefaultTargetNames = new string[] { "minecraft", "minecraftlauncher", "javaw", "java", "lunarclient", "badlionclient", "feather", "prismlauncher", "multimc", "atlauncher", "curseforge", "modrinth" };
  private static readonly string[] DefaultTargetTitleTerms = new string[] { "minecraft", "lunar client", "badlion", "feather client", "prism launcher", "multimc", "atlauncher", "curseforge", "modrinth" };

  private sealed class BridgeProfile {
    public double Deadzone = 0.24;
    public double LookSensitivity = 1.0;
    public double MenuCursorSensitivity = 1.0;
    public string[] TargetNames = DefaultTargetNames;
    public string[] TargetTitleTerms = DefaultTargetTitleTerms;
    public DateTime LastWriteUtc = DateTime.MinValue;
    public Dictionary<int, string> ButtonMap = new Dictionary<int, string>();
  }

  private sealed class ControllerState {
    public string Source = "";
    public double LeftX = 0.0;
    public double LeftY = 0.0;
    public double RightX = 0.0;
    public double RightY = 0.0;
    public bool[] Buttons = new bool[32];
  }

  public static bool GetState(UInt32 index, out XINPUT_STATE state) {
    try {
      return XInputGetState14(index, out state) == 0;
    } catch {
      try {
        return XInputGetState910(index, out state) == 0;
      } catch {
        state = new XINPUT_STATE();
        return false;
      }
    }
  }

  public static string ForegroundProcessName() {
    try {
      UInt32 processId;
      GetWindowThreadProcessId(GetForegroundWindow(), out processId);
      return Process.GetProcessById((Int32)processId).ProcessName;
    } catch {
      return "";
    }
  }

  public static string ForegroundWindowTitle() {
    try {
      StringBuilder title = new StringBuilder(256);
      GetWindowText(GetForegroundWindow(), title, title.Capacity);
      return title.ToString();
    } catch {
      return "";
    }
  }

  public static void Key(UInt16 vk, bool down) {
    INPUT[] inputs = new INPUT[1];
    inputs[0].type = INPUT_KEYBOARD;
    inputs[0].U.ki.wVk = vk;
    inputs[0].U.ki.wScan = 0;
    inputs[0].U.ki.dwFlags = down ? 0 : KEYEVENTF_KEYUP;
    inputs[0].U.ki.time = 0;
    inputs[0].U.ki.dwExtraInfo = IntPtr.Zero;
    SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void MouseButton(string button, bool down) {
    UInt32 flags = button == "right"
      ? (down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP)
      : (down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP);
    Mouse(0, 0, 0, flags);
  }

  public static void MouseMove(Int32 dx, Int32 dy) {
    Mouse(dx, dy, 0, MOUSEEVENTF_MOVE);
  }

  public static void Wheel(Int32 delta) {
    Mouse(0, 0, delta, MOUSEEVENTF_WHEEL);
  }

  private static void Mouse(Int32 dx, Int32 dy, Int32 mouseData, UInt32 flags) {
    INPUT[] inputs = new INPUT[1];
    inputs[0].type = INPUT_MOUSE;
    inputs[0].U.mi.dx = dx;
    inputs[0].U.mi.dy = dy;
    inputs[0].U.mi.mouseData = mouseData;
    inputs[0].U.mi.dwFlags = flags;
    inputs[0].U.mi.time = 0;
    inputs[0].U.mi.dwExtraInfo = IntPtr.Zero;
    SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void Run(string profilePath) {
    BridgeProfile profile = new BridgeProfile();
    Dictionary<string, string> heldOutputs = new Dictionary<string, string>();
    Dictionary<int, bool> buttonStates = new Dictionary<int, bool>();
    Stopwatch watch = Stopwatch.StartNew();
    long lastTicks = Stopwatch.GetTimestamp();
    long nextProfileReadMs = 0;
    long nextTargetCheckMs = 0;
    bool targetActive = false;
    bool menuMode = false;
    bool lastMenuMode = false;
    double smoothLookX = 0.0;
    double smoothLookY = 0.0;
    double mouseCarryX = 0.0;
    double mouseCarryY = 0.0;
    double menuCarryX = 0.0;
    double menuCarryY = 0.0;

    timeBeginPeriod(1);
    try {
      while (true) {
        long nowTicks = Stopwatch.GetTimestamp();
        double dt = (nowTicks - lastTicks) / (double)Stopwatch.Frequency;
        lastTicks = nowTicks;
        if (dt <= 0.0 || dt > 0.05) {
          dt = 0.004;
        }

        long nowMs = watch.ElapsedMilliseconds;
        if (nowMs >= nextProfileReadMs) {
          profile = LoadProfile(profilePath, profile);
          nextProfileReadMs = nowMs + 80;
        }
        if (nowMs >= nextTargetCheckMs) {
          targetActive = IsTargetActive(profile);
          nextTargetCheckMs = nowMs + 45;
        }

        ControllerState controller;
        bool connected = TryGetController(out controller);
        if (!connected || !targetActive) {
          ReleaseAll(heldOutputs);
          buttonStates.Clear();
          smoothLookX = 0.0;
          smoothLookY = 0.0;
          mouseCarryX = 0.0;
          mouseCarryY = 0.0;
          menuCarryX = 0.0;
          menuCarryY = 0.0;
          Thread.Sleep(4);
          continue;
        }

        menuMode = IsCursorVisible();
        if (menuMode != lastMenuMode) {
          ReleaseAll(heldOutputs);
          buttonStates.Clear();
          smoothLookX = 0.0;
          smoothLookY = 0.0;
          mouseCarryX = 0.0;
          mouseCarryY = 0.0;
          menuCarryX = 0.0;
          menuCarryY = 0.0;
          lastMenuMode = menuMode;
        }

        double leftX = controller.LeftX;
        double leftY = controller.LeftY;
        double rightX = controller.RightX;
        double rightY = controller.RightY;
        double moveThreshold = Math.Min(0.85, profile.Deadzone + 0.06);

        if (menuMode) {
          SetHeldOutput(heldOutputs, "move:forward", false, "key:W");
          SetHeldOutput(heldOutputs, "move:back", false, "key:S");
          SetHeldOutput(heldOutputs, "move:left", false, "key:A");
          SetHeldOutput(heldOutputs, "move:right", false, "key:D");

          double cursorX = Math.Abs(rightX) > Math.Abs(leftX) ? rightX : leftX;
          double cursorY = Math.Abs(rightY) > Math.Abs(leftY) ? rightY : leftY;
          cursorX = ApplyLookCurve(ApplyScaledDeadzone(cursorX, Math.Min(0.35, profile.Deadzone)));
          cursorY = ApplyLookCurve(ApplyScaledDeadzone(cursorY, Math.Min(0.35, profile.Deadzone)));
          menuCarryX += cursorX * 1650.0 * profile.MenuCursorSensitivity * dt;
          menuCarryY += cursorY * 1650.0 * profile.MenuCursorSensitivity * dt;
          int mdx = (int)Math.Truncate(menuCarryX);
          int mdy = (int)Math.Truncate(menuCarryY);
          if (mdx != 0) menuCarryX -= mdx;
          if (mdy != 0) menuCarryY -= mdy;
          if (mdx != 0 || mdy != 0) {
            MouseMove(Clamp(mdx, -90, 90), Clamp(mdy, -90, 90));
          }

          SetHeldOutput(heldOutputs, "menu:accept-click", IsPressed(controller, 0) || IsPressed(controller, 7), "mouse:left");
          SetHeldOutput(heldOutputs, "menu:accept-enter", IsPressed(controller, 0), "key:Enter");
          SetHeldOutput(heldOutputs, "menu:back", IsPressed(controller, 1) || IsPressed(controller, 9), "key:Escape");
          SetHeldOutput(heldOutputs, "menu:right-click", IsPressed(controller, 6), "mouse:right");
          SetHeldOutput(heldOutputs, "menu:up", IsPressed(controller, 12), "key:Up");
          SetHeldOutput(heldOutputs, "menu:down", IsPressed(controller, 13), "key:Down");
          SetHeldOutput(heldOutputs, "menu:left", IsPressed(controller, 14), "key:Left");
          SetHeldOutput(heldOutputs, "menu:right", IsPressed(controller, 15), "key:Right");
        } else {
          SetHeldOutput(heldOutputs, "move:forward", leftY < -moveThreshold, "key:W");
          SetHeldOutput(heldOutputs, "move:back", leftY > moveThreshold, "key:S");
          SetHeldOutput(heldOutputs, "move:left", leftX < -moveThreshold, "key:A");
          SetHeldOutput(heldOutputs, "move:right", leftX > moveThreshold, "key:D");

          double targetLookX = ApplyLookCurve(ApplyScaledDeadzone(rightX, profile.Deadzone));
          double targetLookY = ApplyLookCurve(ApplyScaledDeadzone(rightY, profile.Deadzone));
          double response = 1.0 - Math.Exp(-dt * 24.0);
          smoothLookX += (targetLookX - smoothLookX) * response;
          smoothLookY += (targetLookY - smoothLookY) * response;
          if (Math.Abs(smoothLookX) < 0.0025) smoothLookX = 0.0;
          if (Math.Abs(smoothLookY) < 0.0025) smoothLookY = 0.0;

          mouseCarryX += smoothLookX * 1350.0 * profile.LookSensitivity * dt;
          mouseCarryY += smoothLookY * 1350.0 * profile.LookSensitivity * dt;
          int dx = (int)Math.Truncate(mouseCarryX);
          int dy = (int)Math.Truncate(mouseCarryY);
          if (dx != 0) mouseCarryX -= dx;
          if (dy != 0) mouseCarryY -= dy;
          if (dx != 0 || dy != 0) {
            MouseMove(Clamp(dx, -80, 80), Clamp(dy, -80, 80));
          }

          foreach (KeyValuePair<int, string> entry in profile.ButtonMap) {
            bool pressed = IsPressed(controller, entry.Key);
            bool wasPressed = buttonStates.ContainsKey(entry.Key) && buttonStates[entry.Key];
            string output = entry.Value;
            if (output == "wheel:up" || output == "wheel:down") {
              if (pressed && !wasPressed) {
                Wheel(output == "wheel:up" ? 120 : -120);
              }
            } else if (output != "none") {
              SetHeldOutput(heldOutputs, "button:" + entry.Key.ToString(), pressed, output);
            }
            buttonStates[entry.Key] = pressed;
          }
        }

        Thread.Sleep(2);
      }
    } finally {
      ReleaseAll(heldOutputs);
      timeEndPeriod(1);
    }
  }

  private static bool TryGetController(out ControllerState controller) {
    XINPUT_STATE xInputState;
    if (GetState(0, out xInputState)) {
      controller = FromXInput(xInputState.Gamepad);
      return true;
    }

    UInt32 deviceCount = Math.Min(16, joyGetNumDevs());
    for (UInt32 index = 0; index < deviceCount; index++) {
      JOYINFOEX joyInfo = new JOYINFOEX();
      joyInfo.dwSize = (UInt32)Marshal.SizeOf(typeof(JOYINFOEX));
      joyInfo.dwFlags = JOY_RETURNALL;
      if (joyGetPosEx(index, ref joyInfo) == JOYERR_NOERROR) {
        controller = FromJoystick(joyInfo);
        return true;
      }
    }

    controller = null;
    return false;
  }

  private static ControllerState FromXInput(XINPUT_GAMEPAD gamepad) {
    ControllerState controller = new ControllerState();
    controller.Source = "XInput";
    controller.LeftX = NormalizeStick(gamepad.sThumbLX);
    controller.LeftY = -NormalizeStick(gamepad.sThumbLY);
    controller.RightX = NormalizeStick(gamepad.sThumbRX);
    controller.RightY = -NormalizeStick(gamepad.sThumbRY);
    int buttons = gamepad.wButtons;
    controller.Buttons[0] = (buttons & 0x1000) != 0;
    controller.Buttons[1] = (buttons & 0x2000) != 0;
    controller.Buttons[2] = (buttons & 0x4000) != 0;
    controller.Buttons[3] = (buttons & 0x8000) != 0;
    controller.Buttons[4] = (buttons & 0x0100) != 0;
    controller.Buttons[5] = (buttons & 0x0200) != 0;
    controller.Buttons[6] = gamepad.bLeftTrigger > 30;
    controller.Buttons[7] = gamepad.bRightTrigger > 30;
    controller.Buttons[8] = (buttons & 0x0020) != 0;
    controller.Buttons[9] = (buttons & 0x0010) != 0;
    controller.Buttons[10] = (buttons & 0x0040) != 0;
    controller.Buttons[11] = (buttons & 0x0080) != 0;
    controller.Buttons[12] = (buttons & 0x0001) != 0;
    controller.Buttons[13] = (buttons & 0x0002) != 0;
    controller.Buttons[14] = (buttons & 0x0004) != 0;
    controller.Buttons[15] = (buttons & 0x0008) != 0;
    return controller;
  }

  private static ControllerState FromJoystick(JOYINFOEX joyInfo) {
    ControllerState controller = new ControllerState();
    controller.Source = "Joystick";
    controller.LeftX = NormalizeJoyAxis(joyInfo.dwXpos);
    controller.LeftY = NormalizeJoyAxis(joyInfo.dwYpos);
    controller.RightX = NormalizeJoyAxis(joyInfo.dwRpos);
    controller.RightY = NormalizeJoyAxis(joyInfo.dwUpos);
    if (Math.Abs(controller.RightX) < 0.04 && Math.Abs(controller.RightY) < 0.04) {
      controller.RightX = NormalizeJoyAxis(joyInfo.dwZpos);
      controller.RightY = NormalizeJoyAxis(joyInfo.dwRpos);
    }

    for (int index = 0; index < 32; index++) {
      controller.Buttons[index] = (joyInfo.dwButtons & (1u << index)) != 0;
    }

    if (joyInfo.dwPOV != JOY_POVCENTERED) {
      UInt32 pov = joyInfo.dwPOV;
      controller.Buttons[12] = pov >= 31500 || pov <= 4500;
      controller.Buttons[15] = pov >= 4500 && pov <= 13500;
      controller.Buttons[13] = pov >= 13500 && pov <= 22500;
      controller.Buttons[14] = pov >= 22500 && pov <= 31500;
    }

    return controller;
  }

  private static bool IsPressed(ControllerState controller, int buttonIndex) {
    return controller != null
      && buttonIndex >= 0
      && buttonIndex < controller.Buttons.Length
      && controller.Buttons[buttonIndex];
  }

  private static bool IsCursorVisible() {
    CURSORINFO cursorInfo = new CURSORINFO();
    cursorInfo.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
    return GetCursorInfo(out cursorInfo) && (cursorInfo.flags & CURSOR_SHOWING) != 0;
  }

  private static BridgeProfile LoadProfile(string profilePath, BridgeProfile current) {
    try {
      FileInfo info = new FileInfo(profilePath);
      if (!info.Exists || info.LastWriteTimeUtc <= current.LastWriteUtc) {
        return current;
      }

      string json = File.ReadAllText(profilePath);
      BridgeProfile next = new BridgeProfile();
      next.LastWriteUtc = info.LastWriteTimeUtc;
      next.Deadzone = Clamp(ReadDouble(json, "deadzone", current.Deadzone), 0.1, 0.7);
      next.LookSensitivity = Clamp(ReadDouble(json, "lookSensitivity", current.LookSensitivity), 0.2, 3.0);
      next.MenuCursorSensitivity = Clamp(ReadDouble(json, "menuCursorSensitivity", current.MenuCursorSensitivity), 0.4, 3.0);
      next.TargetNames = ReadStringArray(json, "targetProcessNames", current.TargetNames);
      next.TargetTitleTerms = ReadStringArray(json, "targetTitleTerms", current.TargetTitleTerms);

      MatchCollection controls = Regex.Matches(json, "\\{\\s*\"buttonIndex\"\\s*:\\s*(\\d+)\\s*,\\s*\"value\"\\s*:\\s*\"([^\"]*)\"\\s*\\}");
      foreach (Match match in controls) {
        int buttonIndex;
        if (Int32.TryParse(match.Groups[1].Value, out buttonIndex) && buttonIndex >= 0 && buttonIndex <= 31) {
          string output = match.Groups[2].Value;
          if (IsAllowedOutput(output)) {
            next.ButtonMap[buttonIndex] = output;
          }
        }
      }

      return next;
    } catch {
      return current;
    }
  }

  private static double ReadDouble(string json, string key, double fallback) {
    Match match = Regex.Match(json, "\"" + key + "\"\\s*:\\s*([-0-9.]+)");
    double value;
    return match.Success && Double.TryParse(match.Groups[1].Value, out value) ? value : fallback;
  }

  private static string[] ReadStringArray(string json, string key, string[] fallback) {
    Match match = Regex.Match(json, "\"" + key + "\"\\s*:\\s*\\[(.*?)\\]", RegexOptions.Singleline);
    if (!match.Success) {
      return fallback != null && fallback.Length > 0 ? fallback : new string[0];
    }

    List<string> values = new List<string>();
    foreach (Match valueMatch in Regex.Matches(match.Groups[1].Value, "\"([^\"]+)\"")) {
      string value = valueMatch.Groups[1].Value.Trim().ToLowerInvariant();
      if (value.Length >= 2 && value.Length <= 80 && Regex.IsMatch(value, "^[a-z0-9_. -]+$") && !values.Contains(value)) {
        values.Add(value);
      }
      if (values.Count >= 16) {
        break;
      }
    }

    return values.ToArray();
  }

  private static bool IsAllowedOutput(string output) {
    if (output == "none" || output == "mouse:left" || output == "mouse:right" || output == "wheel:up" || output == "wheel:down") {
      return true;
    }
    return GetVk(output) > 0;
  }

  private static void SetHeldOutput(Dictionary<string, string> heldOutputs, string id, bool pressed, string output) {
    bool held = heldOutputs.ContainsKey(id);
    if (pressed && !held) {
      PressOutput(output);
      heldOutputs[id] = output;
    } else if (!pressed && held) {
      ReleaseOutput(heldOutputs[id]);
      heldOutputs.Remove(id);
    }
  }

  private static void ReleaseAll(Dictionary<string, string> heldOutputs) {
    foreach (string id in new List<string>(heldOutputs.Keys)) {
      ReleaseOutput(heldOutputs[id]);
      heldOutputs.Remove(id);
    }
  }

  private static void PressOutput(string output) {
    if (output == "mouse:left") {
      MouseButton("left", true);
    } else if (output == "mouse:right") {
      MouseButton("right", true);
    } else {
      int vk = GetVk(output);
      if (vk > 0) Key((UInt16)vk, true);
    }
  }

  private static void ReleaseOutput(string output) {
    if (output == "mouse:left") {
      MouseButton("left", false);
    } else if (output == "mouse:right") {
      MouseButton("right", false);
    } else {
      int vk = GetVk(output);
      if (vk > 0) Key((UInt16)vk, false);
    }
  }

  private static int GetVk(string output) {
    switch (output) {
      case "key:W": return 0x57;
      case "key:A": return 0x41;
      case "key:S": return 0x53;
      case "key:D": return 0x44;
      case "key:Space": return 0x20;
      case "key:Shift": return 0x10;
      case "key:Control": return 0x11;
      case "key:Tab": return 0x09;
      case "key:E": return 0x45;
      case "key:Q": return 0x51;
      case "key:R": return 0x52;
      case "key:F": return 0x46;
      case "key:C": return 0x43;
      case "key:X": return 0x58;
      case "key:Z": return 0x5a;
      case "key:I": return 0x49;
      case "key:M": return 0x4d;
      case "key:F3": return 0x72;
      case "key:F5": return 0x74;
      case "key:Escape": return 0x1b;
      case "key:Enter": return 0x0d;
      case "key:Up": return 0x26;
      case "key:Down": return 0x28;
      case "key:Left": return 0x25;
      case "key:Right": return 0x27;
      case "key:1": return 0x31;
      case "key:2": return 0x32;
      case "key:3": return 0x33;
      case "key:4": return 0x34;
      case "key:5": return 0x35;
      case "key:6": return 0x36;
      case "key:7": return 0x37;
      case "key:8": return 0x38;
      case "key:9": return 0x39;
      default: return 0;
    }
  }

  private static bool TestButton(int index, XINPUT_GAMEPAD gamepad) {
    int buttons = gamepad.wButtons;
    switch (index) {
      case 0: return (buttons & 0x1000) != 0;
      case 1: return (buttons & 0x2000) != 0;
      case 2: return (buttons & 0x4000) != 0;
      case 3: return (buttons & 0x8000) != 0;
      case 4: return (buttons & 0x0100) != 0;
      case 5: return (buttons & 0x0200) != 0;
      case 6: return gamepad.bLeftTrigger > 30;
      case 7: return gamepad.bRightTrigger > 30;
      case 8: return (buttons & 0x0020) != 0;
      case 9: return (buttons & 0x0010) != 0;
      case 10: return (buttons & 0x0040) != 0;
      case 11: return (buttons & 0x0080) != 0;
      case 12: return (buttons & 0x0001) != 0;
      case 13: return (buttons & 0x0002) != 0;
      case 14: return (buttons & 0x0004) != 0;
      case 15: return (buttons & 0x0008) != 0;
      default: return false;
    }
  }

  private static bool IsTargetActive(BridgeProfile profile) {
    string name = ForegroundProcessName().ToLowerInvariant();
    string title = ForegroundWindowTitle().ToLowerInvariant();
    string[] targetNames = profile != null && profile.TargetNames != null ? profile.TargetNames : DefaultTargetNames;
    string[] targetTitleTerms = profile != null && profile.TargetTitleTerms != null ? profile.TargetTitleTerms : DefaultTargetTitleTerms;
    foreach (string targetName in targetNames) {
      if (name == targetName) return true;
    }
    foreach (string term in targetTitleTerms) {
      if (title.Contains(term)) return true;
    }
    return false;
  }

  private static double NormalizeStick(short value) {
    return value >= 0 ? value / 32767.0 : value / 32768.0;
  }

  private static double NormalizeJoyAxis(UInt32 value) {
    return Clamp(((double)value - 32767.5) / 32767.5, -1.0, 1.0);
  }

  private static double ApplyScaledDeadzone(double value, double zone) {
    double absolute = Math.Abs(value);
    if (absolute <= zone) return 0.0;
    double scaled = (absolute - zone) / (1.0 - zone);
    return Math.Sign(value) * Math.Min(1.0, scaled);
  }

  private static double ApplyLookCurve(double value) {
    return value == 0.0 ? 0.0 : Math.Sign(value) * Math.Pow(Math.Abs(value), 1.35);
  }

  private static int Clamp(int value, int min, int max) {
    return Math.Min(max, Math.Max(min, value));
  }

  private static double Clamp(double value, double min, double max) {
    return Math.Min(max, Math.Max(min, value));
  }
}
"@

[NovaNativeInputBridge]::Run($ProfilePath)
exit

$script:deadzone = 0.24
$script:lookSensitivity = 1.0
$script:buttonMap = @{}
$script:profileLastWrite = [datetime]::MinValue
$heldOutputs = @{}
$buttonStates = @{}
$smoothLookX = 0.0
$smoothLookY = 0.0
$mouseCarryX = 0.0
$mouseCarryY = 0.0
$targetNames = @("minecraft", "minecraftlauncher", "lunarclient", "badlionclient", "feather", "prismlauncher", "multimc", "atlauncher", "curseforge", "modrinth")
$targetTitleTerms = @("minecraft", "lunar client", "badlion", "feather client", "prism launcher", "multimc", "atlauncher", "curseforge", "modrinth")

function Update-Profile {
  try {
    $item = Get-Item -LiteralPath $ProfilePath
    if ($item.LastWriteTimeUtc -le $script:profileLastWrite) {
      return
    }

    $loadedProfile = Get-Content -LiteralPath $ProfilePath -Raw | ConvertFrom-Json
    $nextButtonMap = @{}
    foreach ($control in $loadedProfile.controls) {
      $nextButtonMap[[int]$control.buttonIndex] = [string]$control.value
    }

    $script:deadzone = [Math]::Min(0.7, [Math]::Max(0.1, [double]$loadedProfile.deadzone))
    $script:lookSensitivity = [Math]::Min(3.0, [Math]::Max(0.2, [double]$loadedProfile.lookSensitivity))
    $script:buttonMap = $nextButtonMap
    $script:profileLastWrite = $item.LastWriteTimeUtc
  } catch {}
}

function Get-Vk([string]$output) {
  switch ($output) {
    "key:W" { return 0x57 }
    "key:A" { return 0x41 }
    "key:S" { return 0x53 }
    "key:D" { return 0x44 }
    "key:Space" { return 0x20 }
    "key:Shift" { return 0x10 }
    "key:Control" { return 0x11 }
    "key:E" { return 0x45 }
    "key:Q" { return 0x51 }
    "key:F3" { return 0x72 }
    "key:F5" { return 0x74 }
    "key:Escape" { return 0x1b }
    "key:1" { return 0x31 }
    "key:2" { return 0x32 }
    "key:3" { return 0x33 }
    "key:4" { return 0x34 }
    "key:5" { return 0x35 }
    "key:6" { return 0x36 }
    "key:7" { return 0x37 }
    "key:8" { return 0x38 }
    "key:9" { return 0x39 }
    default { return 0 }
  }
}

function Press-Output([string]$output) {
  if ($output -eq "mouse:left") {
    [NovaNativeInputBridge]::MouseButton("left", $true)
  } elseif ($output -eq "mouse:right") {
    [NovaNativeInputBridge]::MouseButton("right", $true)
  } else {
    $vk = Get-Vk $output
    if ($vk -gt 0) {
      [NovaNativeInputBridge]::Key([UInt16]$vk, $true)
    }
  }
}

function Release-Output([string]$output) {
  if ($output -eq "mouse:left") {
    [NovaNativeInputBridge]::MouseButton("left", $false)
  } elseif ($output -eq "mouse:right") {
    [NovaNativeInputBridge]::MouseButton("right", $false)
  } else {
    $vk = Get-Vk $output
    if ($vk -gt 0) {
      [NovaNativeInputBridge]::Key([UInt16]$vk, $false)
    }
  }
}

function Set-HeldOutput([string]$id, [bool]$pressed, [string]$output) {
  $held = $heldOutputs.ContainsKey($id)
  if ($pressed -and -not $held) {
    Press-Output $output
    $heldOutputs[$id] = $output
  } elseif (-not $pressed -and $held) {
    Release-Output ([string]$heldOutputs[$id])
    $heldOutputs.Remove($id)
  }
}

function Release-All {
  foreach ($id in @($heldOutputs.Keys)) {
    Release-Output ([string]$heldOutputs[$id])
    $heldOutputs.Remove($id)
  }
}

function Normalize-Stick([int]$value) {
  if ($value -ge 0) {
    return [double]$value / 32767.0
  }
  return [double]$value / 32768.0
}

function Apply-ScaledDeadzone([double]$value, [double]$zone) {
  $absolute = [Math]::Abs($value)
  if ($absolute -le $zone) {
    return 0.0
  }

  $scaled = ($absolute - $zone) / (1.0 - $zone)
  return [Math]::Sign($value) * [Math]::Min(1.0, $scaled)
}

function Apply-LookCurve([double]$value) {
  if ($value -eq 0.0) {
    return 0.0
  }
  return [Math]::Sign($value) * [Math]::Pow([Math]::Abs($value), 1.45)
}

function Test-TargetActive {
  $name = ([string][NovaNativeInputBridge]::ForegroundProcessName()).ToLowerInvariant()
  $title = ([string][NovaNativeInputBridge]::ForegroundWindowTitle()).ToLowerInvariant()
  if ($targetNames -contains $name) {
    return $true
  }
  foreach ($term in $targetTitleTerms) {
    if ($title.Contains($term)) {
      return $true
    }
  }
  return $false
}

function Test-Button([int]$index, $gamepad) {
  $buttons = [int]$gamepad.wButtons
  switch ($index) {
    0 { return ($buttons -band 0x1000) -ne 0 }
    1 { return ($buttons -band 0x2000) -ne 0 }
    2 { return ($buttons -band 0x4000) -ne 0 }
    3 { return ($buttons -band 0x8000) -ne 0 }
    4 { return ($buttons -band 0x0100) -ne 0 }
    5 { return ($buttons -band 0x0200) -ne 0 }
    6 { return ([int]$gamepad.bLeftTrigger) -gt 30 }
    7 { return ([int]$gamepad.bRightTrigger) -gt 30 }
    8 { return ($buttons -band 0x0020) -ne 0 }
    9 { return ($buttons -band 0x0010) -ne 0 }
    10 { return ($buttons -band 0x0040) -ne 0 }
    11 { return ($buttons -band 0x0080) -ne 0 }
    12 { return ($buttons -band 0x0001) -ne 0 }
    13 { return ($buttons -band 0x0002) -ne 0 }
    14 { return ($buttons -band 0x0004) -ne 0 }
    15 { return ($buttons -band 0x0008) -ne 0 }
    default { return $false }
  }
}

Update-Profile

while ($true) {
  Start-Sleep -Milliseconds 16
  Update-Profile
  $state = New-Object NovaNativeInputBridge+XINPUT_STATE
  $connected = [NovaNativeInputBridge]::GetState(0, [ref]$state)
  if (-not $connected -or -not (Test-TargetActive)) {
    Release-All
    $buttonStates.Clear()
    $smoothLookX = 0.0
    $smoothLookY = 0.0
    $mouseCarryX = 0.0
    $mouseCarryY = 0.0
    continue
  }

  $gamepad = $state.Gamepad
  $leftX = Normalize-Stick ([int]$gamepad.sThumbLX)
  $leftY = -(Normalize-Stick ([int]$gamepad.sThumbLY))
  $rightX = Normalize-Stick ([int]$gamepad.sThumbRX)
  $rightY = -(Normalize-Stick ([int]$gamepad.sThumbRY))

  $moveThreshold = [Math]::Min(0.85, $script:deadzone + 0.06)
  Set-HeldOutput "move:forward" ($leftY -lt -$moveThreshold) "key:W"
  Set-HeldOutput "move:back" ($leftY -gt $moveThreshold) "key:S"
  Set-HeldOutput "move:left" ($leftX -lt -$moveThreshold) "key:A"
  Set-HeldOutput "move:right" ($leftX -gt $moveThreshold) "key:D"

  $targetLookX = Apply-LookCurve (Apply-ScaledDeadzone $rightX $script:deadzone)
  $targetLookY = Apply-LookCurve (Apply-ScaledDeadzone $rightY $script:deadzone)
  $smoothLookX = $smoothLookX + (($targetLookX - $smoothLookX) * 0.38)
  $smoothLookY = $smoothLookY + (($targetLookY - $smoothLookY) * 0.38)

  if ([Math]::Abs($smoothLookX) -lt 0.003) { $smoothLookX = 0.0 }
  if ([Math]::Abs($smoothLookY) -lt 0.003) { $smoothLookY = 0.0 }

  $mouseCarryX += $smoothLookX * 22.0 * $script:lookSensitivity
  $mouseCarryY += $smoothLookY * 22.0 * $script:lookSensitivity
  $dx = [int][Math]::Truncate($mouseCarryX)
  $dy = [int][Math]::Truncate($mouseCarryY)
  if ($dx -ne 0) { $mouseCarryX -= $dx }
  if ($dy -ne 0) { $mouseCarryY -= $dy }
  if ($dx -ne 0 -or $dy -ne 0) {
    [NovaNativeInputBridge]::MouseMove($dx, $dy)
  }

  foreach ($entry in $script:buttonMap.GetEnumerator()) {
    $id = "button:" + [string]$entry.Key
    $output = [string]$entry.Value
    $pressed = Test-Button ([int]$entry.Key) $gamepad
    $wasPressed = $buttonStates.ContainsKey($id) -and [bool]$buttonStates[$id]

    if ($output -eq "wheel:up" -or $output -eq "wheel:down") {
      if ($pressed -and -not $wasPressed) {
        [NovaNativeInputBridge]::Wheel($(if ($output -eq "wheel:up") { 120 } else { -120 }))
      }
    } elseif ($output -ne "none") {
      Set-HeldOutput $id $pressed $output
    }

    $buttonStates[$id] = $pressed
  }
}
`;
}

function buildHelperScript() {
  return String.raw`
$ErrorActionPreference = "SilentlyContinue"

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class NovaInputBridge {
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public UInt32 type;
    public InputUnion U;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)]
    public MOUSEINPUT mi;
    [FieldOffset(0)]
    public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public Int32 dx;
    public Int32 dy;
    public Int32 mouseData;
    public UInt32 dwFlags;
    public UInt32 time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public UInt16 wVk;
    public UInt16 wScan;
    public UInt32 dwFlags;
    public UInt32 time;
    public IntPtr dwExtraInfo;
  }

  [DllImport("user32.dll", SetLastError=true)]
  public static extern UInt32 SendInput(UInt32 nInputs, INPUT[] pInputs, Int32 cbSize);

  private const UInt32 INPUT_MOUSE = 0;
  private const UInt32 INPUT_KEYBOARD = 1;
  private const UInt32 KEYEVENTF_KEYUP = 0x0002;
  private const UInt32 MOUSEEVENTF_MOVE = 0x0001;
  private const UInt32 MOUSEEVENTF_LEFTDOWN = 0x0002;
  private const UInt32 MOUSEEVENTF_LEFTUP = 0x0004;
  private const UInt32 MOUSEEVENTF_RIGHTDOWN = 0x0008;
  private const UInt32 MOUSEEVENTF_RIGHTUP = 0x0010;
  private const UInt32 MOUSEEVENTF_WHEEL = 0x0800;

  public static void Key(UInt16 vk, bool down) {
    INPUT[] inputs = new INPUT[1];
    inputs[0].type = INPUT_KEYBOARD;
    inputs[0].U.ki.wVk = vk;
    inputs[0].U.ki.wScan = 0;
    inputs[0].U.ki.dwFlags = down ? 0 : KEYEVENTF_KEYUP;
    inputs[0].U.ki.time = 0;
    inputs[0].U.ki.dwExtraInfo = IntPtr.Zero;
    SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void MouseButton(string button, bool down) {
    UInt32 flags = button == "right"
      ? (down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP)
      : (down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP);
    Mouse(0, 0, 0, flags);
  }

  public static void MouseMove(Int32 dx, Int32 dy) {
    Mouse(dx, dy, 0, MOUSEEVENTF_MOVE);
  }

  public static void Wheel(Int32 delta) {
    Mouse(0, 0, delta, MOUSEEVENTF_WHEEL);
  }

  private static void Mouse(Int32 dx, Int32 dy, Int32 mouseData, UInt32 flags) {
    INPUT[] inputs = new INPUT[1];
    inputs[0].type = INPUT_MOUSE;
    inputs[0].U.mi.dx = dx;
    inputs[0].U.mi.dy = dy;
    inputs[0].U.mi.mouseData = mouseData;
    inputs[0].U.mi.dwFlags = flags;
    inputs[0].U.mi.time = 0;
    inputs[0].U.mi.dwExtraInfo = IntPtr.Zero;
    SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@

while (($line = [Console]::In.ReadLine()) -ne $null) {
  try {
    $message = $line | ConvertFrom-Json
    foreach ($event in $message.events) {
      if ($event.type -eq "key") {
        [NovaInputBridge]::Key([UInt16]$event.vk, [bool]$event.down)
      } elseif ($event.type -eq "mouseButton") {
        [NovaInputBridge]::MouseButton([string]$event.button, [bool]$event.down)
      } elseif ($event.type -eq "mouseMove") {
        [NovaInputBridge]::MouseMove([Int32]$event.dx, [Int32]$event.dy)
      } elseif ($event.type -eq "wheel") {
        [NovaInputBridge]::Wheel([Int32]$event.delta)
      }
    }
  } catch {}
}
`;
}

module.exports = {
  setupInputBridge,
  sendVirtualInput,
  setInputBridgeProfile,
  clearInputBridgeProfile,
  stopInputBridge
};
