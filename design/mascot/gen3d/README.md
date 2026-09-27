# 3D Seally frames (Gemini)

Needs `GEMINI_API_KEY` in the environment (cloud env settings; a running session keeps the value it
started with, so a changed key needs a new session). `pip install pillow opencv-python-headless numpy`.

1. `python design/mascot/gen3d/generate.py --probe` — one cheap call, checks key/model.
2. `python design/mascot/gen3d/generate.py` — all 28 frames into `raw/` (gitignored, resumable;
   `--only <name> --force` redoes one).
3. `python design/mascot/gen3d/key.py` — keys the green out, aligns every frame on one canvas, writes
   `public/mascot3d/<name>.webp` + `<name>.sm.webp`, `src/components/mascot/seal3d-frames.ts` and
   `preview.jpg`. Watch for "touches the canvas edge" warnings (cut-off flipper → regenerate that frame).
4. Show `preview.jpg` to the owner for approval **before** the site uses the frames.

## Site integration (next step, after approval)

Replace the 2D `Seal` with a new `Seal3D` only on marketing pages: Hero (also swap the SVG ice floe for
`ice.webp`), Method, Programs, TrialForm, LevelQuiz, SealLost, `/level-test`, `/en`. Cabinet (`/app`) and
login/auth stay 2D.

Planned `Seal3D` (same props as `Seal` + `hop`, `preload`):
- pose from props: `wave` → wave, `reading` → read, else stand; emotion → frame `<pose>-<emotion>` with
  fallbacks (similar emotion in the same pose, then the emotion in another pose, then `<pose>-happy`);
- frames stacked as `<img>` layers: the new frame fades in on top of the fully opaque old one, then the
  old one fades out (no see-through dip mid cross-fade); decode() before showing;
- blink: swap to `<frame>-blink` for ~130 ms every 2–6 s; wave: alternate `<frame>`/`<frame>-b` in
  bursts (3 flaps, then a pause), not forever;
- breathing (scaleY ~1.2 % around the feet), hop on click / `jumpKey` (squash & stretch + shadow),
  lean + slight rotateY/rotateX toward the cursor (mouse/pen only; `look` prop overrides);
- crops `full` / `bust` / `head` from `SEAL3D_CANVAS` landmarks, bottom fade mask for bust/head;
  `.sm.webp` when the rendered size is small;
- `prefers-reduced-motion` → static frames; pause timers off-screen;
- empty `SEAL3D_FRAMES` → render the 2D `Seal` (safe fallback).
