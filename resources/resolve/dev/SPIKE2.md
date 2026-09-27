# Resolve edit spike (2) — instructions

This is the second spike script. It checks how to read a real timeline's cuts back to the original
files, how to build a timeline from files, and fills in the DaVinci Resolve Text+ questions left open
by the first spike (`docs/decisions/0008-resolve-textplus.md`, "Open items"): size/position/justification
calibration, write-on keyframes, Character Level Styling and tag persistence across a project reopen.

It only ever reads the timeline that's current when it starts, and only creates/modifies its own new
timeline (`KathaCut edit spike <time>`), its own media pool bin (`KathaCut Media`) and its own Text+
clips. It never touches anything that existed before it ran.

## 1. Install the script

Copy `resources/resolve/dev/edit-spike.lua` into Resolve's Scripts folder, same place as the first spike:

- **Windows:** `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility\`
- **macOS:** `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/`

Restart Resolve if it was already running, so the new script shows up under Workspace → Scripts.

## 2. Prepare a real, cut timeline

Open a **throwaway** Resolve project with a real, already-**cut** timeline — several clips, not a
single clip. Ideally include:

- one clip that's been **retimed** (speed change),
- one **title** (Text+ or a standard title, not a plain video clip),
- one **compound clip**,
- separate **audio** on an audio track, if the project has any.

Then, on that same timeline:

1. Add a second video track if there isn't one (right-click the track header area → Add Track →
   Video).
2. Add a Text+ clip to **video track 2** — drag a copy of the `KathaCut` bin's `Fusion Title` template
   from the Media Pool if you made one for the first spike (see `SPIKE.md`), or Effects → Titles →
   Text+.
3. Open it in the Inspector → Text+ → **Character Level Styling**. Select a Malayalam or English word
   in the viewer with the text tool and change its color (e.g. make it red).
4. Put the letters **`CLS`** somewhere in that clip's name or its text, so the script can find it.

The script's E7 test also needs the **`KathaCut`** template bin from the first spike (bin `KathaCut`,
clip `Fusion Title` — see `SPIKE.md` step 3, or `resources/resolve/kathacut-captions.drb`). If it's
missing, E7 onward (E7, E8, E9, E11) log "skipped" and the rest of the report is still useful.

## 3. First run

Go to **Workspace → Scripts → edit-spike**. Open **Workspace → Console** first so you can watch the
output live.

Partway through (test E8) the console prints "Switch to the Edit page now." — **switch to the Edit
page** and wait; the script pauses about 8 seconds before exporting three still images.

The script creates a new timeline named `KathaCut edit spike <numbers>` and leaves it in the project
when it's done; you don't need to delete it.

## 4. Persistence check (E11)

The console's last "E11" line says a clip was tagged and asks you to save, close and reopen the
project:

1. **Save** the project.
2. **Close** the project and reopen it (File → Project Manager, or close and relaunch Resolve).
3. Open `resources/resolve/dev/edit-spike.lua` in a text editor, change `local MODE = "run"` to
   `local MODE = "check"` near the top, save.
4. Run the script again from **Workspace → Scripts → edit-spike**. This run only checks whether the
   `KathaCut.key` tag survived the reopen — it doesn't recreate anything.

## 5. Send back

Please send back all of the following:

- The report file: `%TEMP%\kathacut-edit-spike.txt` on Windows, or `$TMPDIR/kathacut-edit-spike.txt`
  (or `/tmp/...`) on macOS. This should have output from both the first ("run") and second ("check")
  runs.
- The three stills from the same temp folder: `kathacut-edit-spike-still-j0.png`,
  `kathacut-edit-spike-still-j1.png`, `kathacut-edit-spike-still-j2.png`.
- For each of the three stills, roughly: **where the "H" sits** in the frame (left/center/right,
  top/middle/bottom) and **how tall the "H" is in pixels** (a rough pixel measurement, e.g. from your
  OS screenshot tool or an image editor, is fine).
