# Resolve Character Level Styling write spike (5) — instructions

This is the fifth spike script. The previous one (`cls-spike.lua`, spike 4) found how Resolve **stores**
Character Level Styling (CLS) from a hand-styled clip: the ids, the value shape, and the counting unit
(see `docs/decisions/0011-resolve-character-level-styling.md`). But every write it tried used the *old*
guessed ids and shape, so none of the writes actually applied — the stills never changed.

This spike tries to **write** CLS using the confirmed shape, ids and unit. It needs no hand prep at all —
everything happens on its own scratch clips.

It only creates and edits its own new timeline (`KathaCut CLS write spike <numbers>`) and its own Text+
clips there.

**Run 2 (current script):** run 1 showed that methods A-C (Paste, LoadSettings with a table, SetInput)
return without an error but apply nothing (ADR 0011, "Write spike result"). The script now also tries
**D** (export the clip's Fusion comp, add the styling in the file, re-import it) and **E** (save the
modifier's settings to a file, add the styling, load the file back). Re-copy the script over the old one
before running it.

## 1. Install the script

Copy `resources/resolve/dev/cls-write-spike.lua` into Resolve's Scripts folder, same place as the earlier
spikes:

- **Windows:** `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility\`
- **macOS:** `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/`

Restart Resolve if it was already running, so the new script shows up under Workspace → Scripts.

## 2. Run it

Open any project (a throwaway one is fine — nothing existing gets touched). Go to **Workspace → Scripts
→ cls-write-spike**. Open **Workspace → Console** first so you can watch the output live.

The script pauses once, partway through, and prints "Switch to the Edit page now." — **switch to the Edit
page** and wait; it pauses about 8 seconds before it starts exporting still images. After that it runs to
completion on its own, trying three write methods (clips A, B, C), then a clear, a keyframe retry and a
timing retry if one of them worked.

It creates a new timeline named `KathaCut CLS write spike <numbers>` with several Text+ clips on it and
leaves it in the project when it's done; you don't need to delete it.

## 3. Look at the three stills yourself

Before sending anything back, open the temp folder the script prints and look at:

- `kathacut-cls-write-A.png` through `kathacut-cls-write-E.png` — each should show the same one-line
  caption. **Did any of them show `ആൾട്ട്മാൻ` in red, and `Sam` visibly larger than the rest of the
  text?** Note which file(s), if any. D and E are the new ones; A-C are expected to stay plain again.
- If the console log's `SUMMARY` line names a working method, also check:
  - `kathacut-cls-write-clear.png` — should be **plain again**, no red or resized word, text still
    readable.
  - `kathacut-cls-write-K-frame5.png` and `-K-frame15.png` (only if method C worked) — frame 5 should show **`Sam`** red, frame 15
    should show **`ആൾട്ട്മാൻ`** red. Say whether that's what you see, or whether it's reversed, the same,
    or neither is red.

## 4. Send back

- `kathacut-cls-write-spike.txt` — the full console report.
- Every `kathacut-cls-write-*.setting` and `kathacut-cls-write-*.comp` file in the temp folder.
- Every `kathacut-cls-write-*.png` file.
- Your answers to the "look at the three stills yourself" questions above.

If everything logged `FAIL` or `missing`, send the report anyway — knowing all three methods failed is
still useful, and it means briefs 17/18 need a different approach (possibly writing a `.setting` file to
disk and using Resolve's own import/paste-from-file UI instead of scripting the value directly).
