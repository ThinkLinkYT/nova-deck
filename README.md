# Nova Deck

Nova Deck is a local-first Windows console shell for PC games. It scans local Steam and Epic installs, supports adding standalone executables, works with Xbox, PlayStation, and Nintendo-style controllers through the Gamepad API, and launches games without any backend service.

Steam and Epic games may still require their launchers for licensing. Nova Deck uses launcher quiet mode to minimize known launcher windows after launch and keep the game experience in front.

## Run

Install or update it like a normal Windows app:

```text
Install or Update Nova Deck.cmd
```

That creates Start Menu and Desktop shortcuts. Run the same installer again after you make changes.

Double-click:

```text
Launch Nova Deck.cmd
```

From PowerShell:

```powershell
npm start
```

Or run Electron directly:

```powershell
.\.vendor\electron\electron.exe .
```

If your terminal is not already in this folder, use:

```powershell
& "C:\Users\linco\Documents\Codex\2026-05-30\hello-i-want-to-make-a\.vendor\electron\electron.exe" "C:\Users\linco\Documents\Codex\2026-05-30\hello-i-want-to-make-a"
```

## Controls

- Arrow keys or D-pad/left stick: move selection
- Enter or controller primary button: launch
- Backspace or controller secondary button: clear search
- F11: toggle fullscreen
- F5 or controller top button: rescan library

## What It Detects

- Steam games from local `appmanifest_*.acf` files
- Epic games from local launcher manifests
- Custom `.exe`, `.lnk`, and `.url` entries added inside the app

All settings and custom entries are stored locally in Electron's user data folder.
