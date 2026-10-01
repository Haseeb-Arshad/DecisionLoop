import { defineConfig } from "vite";
import motionCanvasModule from "@motion-canvas/vite-plugin";

// The plugin ships as CommonJS; unwrap the default export when Vite loads it as ESM.
const motionCanvas = (motionCanvasModule as unknown as { default?: typeof motionCanvasModule }).default ?? motionCanvasModule;

export default defineConfig({
  plugins: [motionCanvas({ project: ["./src/engine.ts"] })],
  server: { port: 9100, strictPort: true },
});
