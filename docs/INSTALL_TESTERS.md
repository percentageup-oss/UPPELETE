# KathaCut test build: install notes

Everything the app needs (FFmpeg, the speech engine, GPU support) is inside the installer.
The only download is the speech model, once, from inside the app.

## Windows (64-bit)
1. Run `KathaCut-Setup-<version>-win-x64.exe`.
2. Windows SmartScreen will say "Windows protected your PC" because the test build is unsigned.
   Click **More info**, then **Run anyway**.
3. Works on any PC. An NVIDIA card is used automatically when present (fast); otherwise it
   runs on the CPU (slower, same results).

## macOS (Apple Silicon only: M1 or newer)
1. Open `KathaCut-<version>-mac-arm64.dmg` and drag KathaCut to Applications.
2. The first launch is blocked because the build is unsigned. Try to open it once, then go to
   **System Settings, Privacy & Security** and click **Open Anyway**. If macOS says the app is
   damaged, run `xattr -dr com.apple.quarantine /Applications/KathaCut.app` in Terminal.
3. Intel Macs are not supported by this build.

## First run
- Click **Models** and download **large-v3-turbo** (1.6 GB) for the best Malayalam/English
  quality, or **small** (488 MB) for a quick try. This needs internet once; after that the app
  works offline.
- Nothing is uploaded: media and transcripts stay on the computer.

## If something goes wrong
- Windows logs: `%APPDATA%\caption-studio\logs`
- macOS logs: `~/Library/Application Support/caption-studio/logs`
- Send the log file plus a description of what you clicked.
- Known limit: transcription on Windows can fail if the Windows username contains
  non-English characters, because the speech engine reads paths in the ANSI code page.
