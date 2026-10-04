# "The Line on the Wall": DecisionLoop film

A 1 min 43 s motion-graphics film that explains what DecisionLoop is for, without showing code. It follows a
fictional city, Riverton: four teams make four decisions on one assumption about a river's 100-year flood
level; years later a national study shows the assumption is no longer true; DecisionLoop finds every
decision that relied on it, and the permit agent is told to stop before it approves a care home on the
flood plain. The [storyboard](STORYBOARD.md) has the beats and the exact on-screen words.

Outputs (committed to the app so the landing page needs no video tooling):

| File | What |
|---|---|
| `public/demo/the-line-on-the-wall.mp4` | The film, 1920 × 1080, 30 fps, with sound |
| `public/demo/the-line-on-the-wall-720p.mp4` | The same at 1280 × 720, smaller |
| `public/demo/the-line-on-the-wall-loop.mp4` | A 25 s silent loop for the top of the landing page |
| `public/demo/the-line-on-the-wall.png` | Poster |
| `public/demo/the-line-on-the-wall.vtt` | Captions (the on-screen text) |
| `docs/media/the-line-on-the-wall.gif` | The loop as a 1280 px GIF, for the GitHub README (GitHub does not play videos stored in a repository) |

## What is real

Every value and status on screen came from the real engine running this scenario: the four decisions, the
forum post that could only challenge (trust 0.30), the national study that invalidated (trust 0.95 against
the assumption's 0.80), the four decisions flagged at risk, and the agent's **Stop**. The product screens are
captures of the running app. Riverton, its decisions and its people are fictional; the film says so on screen.

Running the scenario surfaced two engine bugs, both fixed and covered by tests before the film was made:
one observation becoming several facts when several profiles were loaded, and an at-risk decision keeping a
weak source's explanation after a strong source invalidated it.

## How it is built

Three renderers, one palette and one set of coordinates:

| Tool | Scenes | Source |
|---|---|---|
| [HyperFrames](https://hyperframes.heygen.com) | The river (opening, the flood rising) and the closing | `hyperframes/` (HTML + GSAP; `shared/river.js` draws the cross-section) |
| [Motion Canvas](https://motioncanvas.io) | The engine: read, find, compare, weigh, flag | `motion-canvas/src/scenes/engine.tsx` |
| [Remotion](https://www.remotion.dev) | Decisions growing from the line, the product screens, and the final assembly with the score | `film/` |

`scenario/` creates the Riverton workspace, runs the story through a live DecisionLoop server and captures the
product screens into `film/public/ui/`. `film/scripts/make-audio.mjs` synthesizes the score from code.

## Rebuild

Requires Node 22+, FFmpeg and the repository's Playwright browsers.

```bash
# 1. Data and screens (optional; the captures are committed)
bash scenario/setup.sh /tmp/riverton
(cd /tmp/riverton && decisionloop serve --web) &
node scenario/run.mjs /tmp/riverton http://127.0.0.1:4520 "$(cat /tmp/riverton/hydrology.key)" "$(cat /tmp/riverton/forum.key)"
node scenario/capture-ui.mjs http://localhost:4520

# 2. Film
(cd motion-canvas && npm install && npm run editor) &   # HyperFrames runs through npx; nothing to install
(cd film && npm install)
bash build.sh
```

Motion Canvas only renders from its editor, so `motion-canvas/render.mjs` opens the editor headlessly and
presses Render. HyperFrames renders are run with `DO_NOT_TRACK=1` and `HYPERFRAMES_SKIP_SKILLS=1`.

The original 36-second film is unchanged in `video/` and `public/demo/decisionloop.mp4`.
