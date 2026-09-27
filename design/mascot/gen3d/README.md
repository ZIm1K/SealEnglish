# 3D Seally frames (Gemini)

Needs `GEMINI_API_KEY` in the environment (cloud env settings; a running session keeps the value it
started with, so a changed key needs a new session). `pip install pillow opencv-python-headless numpy`.

1. `python design/mascot/gen3d/generate.py --probe` — one cheap call, checks key/model.
2. `python design/mascot/gen3d/generate.py` — all 28 frames into `raw/` (gitignored, resumable;
   `--only <name> --force` redoes one).
3. `python design/mascot/gen3d/key.py` — keys the green out (un-mixing the edge pixels, so no fringe on light
   pages), aligns every frame on one canvas, keeps only the eyes / the flipper from blink and second-wave frames,
   bakes a contact shadow per pose and writes `public/mascot3d/*.webp`, `src/components/mascot/seal3d-frames.ts`
   and `preview.jpg` (gitignored). Watch for "touches the canvas edge" warnings (cut-off flipper → regenerate).
4. Look through `preview.jpg`: an off-model frame (e.g. blown-up cheeks) → tweak its prompt, `--only … --force`
   it and the frames edited from it (`<name>-b`, `<name>-blink`), re-run `key.py`.

## On the site

`Seal3D` (`src/components/mascot/Seal3D.tsx`) replaces the 2D `Seal` on the marketing pages only: Hero (on the
3D ice floe), Method, Programs, TrialForm, LevelQuiz, SealLost (404), `/level-test`, `/en`. The cabinet (`/app`)
and login/auth keep the 2D rig. Same props as `Seal`, plus `hop` (hop on click), `preload` (warm the other
emotions of the pose) and `ice`.

- pose from props: `wave` → wave, `reading` → read, else stand; emotion → frame `<pose>-<emotion>` with
  fallbacks (a similar emotion in the same pose, then the emotion in another pose, then `<pose>-happy`);
- a new frame is decoded first, fades in over the fully opaque old one, then the old one fades out;
- blink: `<frame>-blink` over the frame for 130 ms every 2–6 s; wave: `<frame>`/`<frame>-b` in bursts of 3 flaps;
- breathing, hop on click / `jumpKey` (squash & stretch; the contact shadow stays on the ground), lean toward the
  cursor (mouse/pen only; `look` overrides);
- crops `full` / `bust` / `head` from the `SEAL3D_CANVAS` landmarks; `.sm.webp` when it renders small;
- `prefers-reduced-motion` → static frames; timers pause off-screen and in background tabs;
- an empty `SEAL3D_FRAMES` renders the 2D `Seal` (the Hero then keeps its SVG floe).
