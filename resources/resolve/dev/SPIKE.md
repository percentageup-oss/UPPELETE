# Resolve Text+ spike — instructions

This checks the DaVinci Resolve API assumptions the KathaCut/Resolve integration plan relies on. It only
ever touches a new timeline the script creates itself (`KathaCut spike <time>`); it never modifies any
existing timeline, clip or media. Rendering (T15) only happens if you edit the script and set
`RUN_RENDER = true` at the top — leave it `false` for the first run.

## 1. Install the script

Copy `resources/resolve/dev/spike.lua` into Resolve's Scripts folder:

- **Windows:** `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility\`
- **macOS:** `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/`

Create the `Utility` folder if it doesn't exist. Restart Resolve if it was already running, so the new
script shows up under Workspace → Scripts.

## 2. Set up a throwaway project

Open (or create) a **throwaway** Resolve project — don't use a real project. Add a short timeline that has
at least one clip with audio.

## 3. Make the Text+ template bin

On any timeline in that project, add **Effects → Titles → Text+**. Drag that title clip from the timeline
into the **Media Pool**, and put it in a new bin named exactly **`KathaCut`**.

If Resolve won't let you drag a timeline title into the Media Pool, don't worry — note that in your reply,
and the script will fall back to `InsertFusionTitleIntoTimeline` instead (test T6 records which path ran).

## 4. First run

Go to **Workspace → Scripts → spike** (or whatever the file is named without its `.lua` extension). Open
**Workspace → Console** first so you can watch the output live.

The script creates a new timeline named `KathaCut spike <numbers>` and runs tests T1–T14 (T15 is skipped
by default). Partway through (test T4) it prints a message asking you to click around and scrub the
timeline for about 15 seconds — do that, and notice whether Resolve feels sluggish or stays responsive.

## 5. Style a second clip by hand, then run again

The script's T11 test reads back Resolve's Character Level Styling (CLS) data format, which needs a
clip you've styled manually:

1. In the **`KathaCut spike …`** timeline the first run created, add a second video track if there
   isn't one yet (right-click the track header area → Add Track → Video).
2. Add a Text+ clip to **video track 2** (drag another copy of the template from the Media Pool, or
   Effects → Titles → Text+ again).
3. Open it in the Inspector → Text+ → **Character Level Styling**. Select a Malayalam or English word
   in the viewer with the text tool and change its color (e.g. make it red).
4. Run the script again from Workspace → Scripts. This second run's T11 will find that clip and dump its
   CLS data.

## 6. Send back

Please send back all of the following:

- The report file: `%TEMP%\kathacut-resolve-spike.txt` on Windows, or `$TMPDIR/kathacut-resolve-spike.txt`
  (or `/tmp/...`) on macOS.
- `kathacut-spike-still.png`, from the same temp folder (test T14).
- A screenshot of the Malayalam Text+ clip in the Resolve viewer (the one T9 styled with
  `മലയാളം ക്യാപ്ഷൻ Caption ശ്രീ`), and a note on whether the Malayalam renders correctly — conjuncts
  joined, vowel signs in the right place, no dotted circles.
- Whether Resolve stayed responsive during the 15 s loop in T4.
- Your Resolve edition and version (also in the report, from `resolve:GetProductName()` /
  `GetVersionString()`), and your OS.

You don't need to do anything with the spike timeline afterwards — it's safe to leave it in the project,
or delete it yourself later.

## Optional: test rendering too (T15)

T15 exercises the render pipeline, which the later "create project from timeline" brief needs. It's off
by default. To run it: open `spike.lua` in a text editor, change `local RUN_RENDER = false` to `true` near
the top, save, and run the script again from Workspace → Scripts. It renders 5 seconds of the spike
timeline to `kathacut-spike-proxy.*` in your temp folder and deletes the render job afterwards — send that
file back too if you run this step.
