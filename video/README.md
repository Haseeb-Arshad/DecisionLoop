# DecisionLoop product film

Editable Remotion source for the 36-second, 1920 × 1080, 24 fps product film. The project is isolated from the Next.js application dependencies.

```bash
cd video
npm ci
npm run typecheck
npm run render
npm run poster
npm run verify
```

Rendering writes `public/demo/decisionloop.mp4` and `public/demo/poster.png` in the application. Those deliverables are committed so the landing page works without video tools. The browser renderer may download its supported Chrome binary on first use. Run `npm run studio` to edit and preview the composition.

The [approved storyboard](STORYBOARD.md) fixes the story and timing. `npm run render` regenerates local sound effects before rendering. The asset script is a portable implementation of the launch-video skill's synthesized typing/click approach, using WAV instead of MP3. Generated sound assets, tooling dependencies and verification stills are ignored.

`src/scenes/BrowserWindow.tsx` is the reusable BrowserWindow scene from the local launch-video skill. The film uses that scene with actual application pixels and original product-specific panels. The screenshot is synthetic local data, and enlarged context/review panels illustrate the workflow rather than claim a recorded live external agent or cloud integration.

Verification stills cover every beat. See [Remotion rendering](https://www.remotion.dev/docs/cli/render) and [still rendering](https://www.remotion.dev/docs/cli/still) for CLI options.

The delivered MP4 was decoded successfully and inspected with FFprobe: 1920 × 1080, H.264, 864 frames at 24 fps, 36-second video, with AAC audio. Detected sound windows match the typing and click beats. The landing-page player loaded it without a media error. See the [verification receipt](../docs/media/film-verification.json).
