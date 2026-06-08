const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

async function enrichGamesWithArtwork(games, userDataPath) {
  const cacheDir = path.join(userDataPath, "artwork-cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const pendingExtractions = [];
  const enriched = games.map((game, index) => {
    const coverArtwork = firstExistingPath([game.artworkPath]);

    if (coverArtwork && isHighQualityArtwork(coverArtwork)) {
      return {
        ...game,
        artworkUrl: pathToFileUrl(coverArtwork),
        artworkType: "cover"
      };
    }

    const directIcon = firstExistingPath([game.iconPath]);
    if (directIcon && isHighQualityArtwork(directIcon)) {
      return {
        ...game,
        artworkUrl: pathToFileUrl(directIcon),
        artworkType: "icon"
      };
    }

    const iconSource = cleanIconPath(getIconSource(game, directIcon || coverArtwork));
    if (!iconSource || !fs.existsSync(iconSource)) {
      return game;
    }

    if (isHighQualityArtwork(iconSource)) {
      return {
        ...game,
        artworkUrl: pathToFileUrl(iconSource),
        artworkType: "icon"
      };
    }

    const outPath = getIconOutputPath(iconSource, cacheDir);
    if (fs.existsSync(outPath)) {
      return {
        ...game,
        artworkUrl: pathToFileUrl(outPath),
        artworkType: "icon"
      };
    }

    pendingExtractions.push({ index, sourcePath: iconSource, outPath });
    return game;
  });

  await batchExtractIcons(pendingExtractions);

  for (const extraction of pendingExtractions) {
    if (fs.existsSync(extraction.outPath)) {
      enriched[extraction.index] = {
        ...enriched[extraction.index],
        artworkUrl: pathToFileUrl(extraction.outPath),
        artworkType: "icon"
      };
    }
  }

  return enriched;
}

async function enrichGameWithArtwork(game, cacheDir) {
  const coverArtwork = firstExistingPath([game.artworkPath]);

  if (coverArtwork && isHighQualityArtwork(coverArtwork)) {
    return {
      ...game,
      artworkUrl: pathToFileUrl(coverArtwork),
      artworkType: "cover"
    };
  }

  const directIcon = firstExistingPath([game.iconPath]);
  if (directIcon && isHighQualityArtwork(directIcon)) {
    return {
      ...game,
      artworkUrl: pathToFileUrl(directIcon),
      artworkType: "icon"
    };
  }

  const iconSource = getIconSource(game, directIcon || coverArtwork);
  if (iconSource) {
    const extracted = await extractIcon(iconSource, cacheDir);
    if (extracted) {
      return {
        ...game,
        artworkUrl: pathToFileUrl(extracted),
        artworkType: "icon"
      };
    }
  }

  return game;
}

function getIconSource(game, directArtwork) {
  const candidates = [
    directArtwork,
    game.iconPath,
    game.executablePath,
    game.launchType === "exe" ? game.launchTarget : null
  ];

  return firstExistingPath(candidates);
}

async function extractIcon(sourcePath, cacheDir) {
  const cleanedSource = cleanIconPath(sourcePath);
  if (!cleanedSource || !fs.existsSync(cleanedSource)) {
    return null;
  }

  if (isHighQualityArtwork(cleanedSource)) {
    return cleanedSource;
  }

  const outPath = getIconOutputPath(cleanedSource, cacheDir);
  if (fs.existsSync(outPath)) {
    return outPath;
  }

  await batchExtractIcons([{ sourcePath: cleanedSource, outPath }]);
  return fs.existsSync(outPath) ? outPath : null;
}

function getIconOutputPath(sourcePath, cacheDir) {
  return path.join(cacheDir, `${stableId(sourcePath)}-256.png`);
}

async function batchExtractIcons(extractions) {
  const pending = extractions
    .filter((item) => item && item.sourcePath && item.outPath)
    .filter((item) => fs.existsSync(item.sourcePath) && !fs.existsSync(item.outPath));

  if (!pending.length) {
    return;
  }

  const tasksJson = JSON.stringify(pending.map((item) => ({
    source: item.sourcePath,
    output: item.outPath
  })));
  const command = `
    $tasks = ConvertFrom-Json @'
${tasksJson}
'@
    Add-Type -AssemblyName System.Drawing
    Add-Type -ReferencedAssemblies "System.Drawing" -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

[ComImport]
[Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IShellItemImageFactory {
  void GetImage(SIZE size, SIIGBF flags, out IntPtr phbm);
}

[StructLayout(LayoutKind.Sequential)]
public struct SIZE {
  public int cx;
  public int cy;
  public SIZE(int x, int y) {
    cx = x;
    cy = y;
  }
}

[Flags]
public enum SIIGBF {
  RESIZETOFIT = 0,
  BIGGERSIZEOK = 1,
  MEMORYONLY = 2,
  ICONONLY = 4,
  THUMBNAILONLY = 8,
  INCACHEONLY = 16,
  CROPTOSQUARE = 32,
  WIDETHUMBNAILS = 64,
  ICONBACKGROUND = 128,
  SCALEUP = 256
}

public static class ShellIconExtractor {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(
    string pszPath,
    IntPtr pbc,
    [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
    out IShellItemImageFactory ppv
  );

  [DllImport("gdi32.dll")]
  private static extern bool DeleteObject(IntPtr hObject);

  public static void SaveIcon(string source, string output, int size) {
    Guid iid = typeof(IShellItemImageFactory).GUID;
    IShellItemImageFactory factory;
    SHCreateItemFromParsingName(source, IntPtr.Zero, iid, out factory);
    IntPtr hbitmap;
    factory.GetImage(new SIZE(size, size), SIIGBF.ICONONLY | SIIGBF.BIGGERSIZEOK | SIIGBF.SCALEUP, out hbitmap);
    if (hbitmap == IntPtr.Zero) {
      throw new Exception("No icon bitmap returned.");
    }

    try {
      using (Bitmap bitmap = Image.FromHbitmap(hbitmap)) {
        bitmap.Save(output, ImageFormat.Png);
      }
    } finally {
      DeleteObject(hbitmap);
      Marshal.ReleaseComObject(factory);
    }
  }
}
"@
    foreach ($task in @($tasks)) {
      $source = [string]$task.source
      $out = [string]$task.output
      if ([string]::IsNullOrWhiteSpace($source) -or [string]::IsNullOrWhiteSpace($out) -or (Test-Path -LiteralPath $out)) {
        continue
      }

      try {
        [ShellIconExtractor]::SaveIcon($source, $out, 256)
      } catch {
        try {
          $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($source)
          if ($icon -ne $null) {
            $bitmap = New-Object System.Drawing.Bitmap 256, 256
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.DrawIcon($icon, (New-Object System.Drawing.Rectangle 0, 0, 256, 256))
            $bitmap.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
            $graphics.Dispose()
            $bitmap.Dispose()
            $icon.Dispose()
          }
        } catch {}
      }
    }
  `;

  try {
    await execPowerShell(command, Math.min(60000, 12000 + pending.length * 2500));
  } catch {
    // Missing artwork is fine; the UI falls back to initials.
  }
}

function firstExistingPath(paths) {
  for (const item of paths) {
    const cleaned = cleanIconPath(item);
    if (cleaned && fs.existsSync(cleaned)) {
      return cleaned;
    }
  }
  return null;
}

function cleanIconPath(value) {
  if (!value) {
    return "";
  }

  let text = String(value).trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }

  const commaMatch = text.match(/^(.+?\.(?:exe|ico|png|jpg|jpeg|bmp|dll)),?-?\d*$/i);
  if (commaMatch) {
    text = commaMatch[1];
  }

  return text.replace(/\//g, "\\");
}

function isHighQualityArtwork(filePath) {
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(filePath || "");
}

function pathToFileUrl(filePath) {
  return `file:///${path.resolve(filePath).replace(/\\/g, "/").replace(/ /g, "%20")}`;
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

function stableId(value) {
  let hash = 0;
  const input = String(value).toLowerCase();
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

module.exports = {
  enrichGamesWithArtwork,
  pathToFileUrl
};
