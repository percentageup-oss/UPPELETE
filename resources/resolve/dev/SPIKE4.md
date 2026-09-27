# Resolve Character Level Styling spike (4) — instructions

This is the fourth spike script. Emphasis, and full-line active-word highlight / word pop, need Text+
**Character Level Styling** (CLS): styling a character range inside one Text+ clip. Nobody knows how
Resolve stores that — two earlier attempts came back with no data because a hand-styled clip was never
prepared. This spike gets data even without that hand prep, and gets much better data with it.

It only creates and edits its own new timeline (`KathaCut CLS spike <numbers>`) and its own Text+ clips
there. If you did the optional hand prep below, it only **reads** that clip — it never touches it.

## 1. Install the script

Copy `resources/resolve/dev/cls-spike.lua` into Resolve's Scripts folder, same place as the earlier
spikes:

- **Windows:** `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility\`
- **macOS:** `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/`

Restart Resolve if it was already running, so the new script shows up under Workspace → Scripts.

## 2. Optional hand prep (strongly recommended)

This is the **only** way to see how Resolve itself stores Character Level Styling — everything else in
this spike is an educated guess. It takes a few minutes and is well worth doing if you have the time.

Open a **throwaway** Resolve project with any timeline open (the script reads whatever timeline is
current when it starts). Then:

1. Add a **Text+** title to a video track (Effects → Titles → Text+, or drag one from the Media Pool).
2. Open it in the Inspector → **Text+** tab. Set **Font** to **Anek Malayalam** (so Malayalam renders
   instead of tofu boxes). Paste this exact test string into **Styled Text**:

   ```
   പ്രൈം മിനിസ്റ്റർ Sam ആൾട്ട്മാൻ
   വിളിച്ചിട്ട് പറഞ്ഞത്
   ```

   Take a screenshot now, before styling anything.
3. Go to the **Fusion** page. Right-click the Text+ tool's **Styled Text** field (or the input in the
   Inspector) → **Character Level Styling**. Take a screenshot of this step.
4. With the Text+ tool selected and the CLS modifier active, select characters in the viewer with the
   text tool (or however this version of Resolve exposes it) and style, one at a time, taking a
   screenshot after each:
   - `ആൾട്ട്മാൻ` (the Malayalam word after "Sam") — color it **red**, and set its size to **150%**.
   - `Sam` — make it **underlined**.
   - `പറഞ്ഞത്` (the last word, after the line break) — give it a **different font weight** (e.g. Bold).
5. Write down, as precisely as you can, exactly which characters each style covers (e.g. "red starts at
   the first character after the space following Sam, ends at the line break").

If you skip this, the script still runs and still produces useful data — R0/R2/W1-W4 below don't need
it. Only R1 needs it, and it will just log "skipped" if it's missing.

## 3. Run it

Go to **Workspace → Scripts → cls-spike**. Open **Workspace → Console** first so you can watch the
output live.

The script pauses once, partway through, and prints "Switch to the Edit page now." — **switch to the
Edit page** and wait; it pauses about 8 seconds before it starts exporting still images. After that it
runs to completion on its own.

It creates a new timeline named `KathaCut CLS spike <numbers>` with several Text+ clips on it and leaves
it in the project when it's done; you don't need to delete it.

## 4. Send back

Please send back all of the following, from the temp folder the script prints (`%TEMP%\...` on Windows,
`$TMPDIR/...` or `/tmp/...` on macOS):

- `kathacut-cls-spike.txt` — the full console report.
- Every `.setting` file in that folder: `kathacut-cls-R0.setting`, and `kathacut-cls-R1-1.setting`
  through `kathacut-cls-R1-5.setting` if you did the hand prep.
- Every `.png` file in that folder (the W1/W2/W3 stills).
- If you did the hand prep: your screenshots of each step, and your written notes on exactly which
  characters each style covers.
- For the two W3 stills (`kathacut-cls-W3-frame5.png`, `kathacut-cls-W3-frame15.png`): say **which word
  looks red** in each one (the first marked word, "Sam", or the second, "ആൾട്ട്മാൻ") — that confirms
  whether the keyframed style change actually took effect between the two frames.

If anything logged `FAIL` or `missing`, send the report anyway — that's useful information too.
