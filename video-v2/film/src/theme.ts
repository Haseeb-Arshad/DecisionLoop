// One palette and one type scale for every renderer (HyperFrames, Motion Canvas, Remotion):
// the product's own colors, system type, nothing decorative.
export const C = {
  paper: "#ffffff",
  ink: "#0a0a0a",
  soft: "#4d4d4d",
  muted: "#8c8c8c",
  hair: "#e4e4e4",
  blue: "#1d4ed8",
  red: "#b42318",
  redMark: "#d92d20",
  water: "#dbe5ff",
};

export const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';
export const MONO = 'Consolas, ui-monospace, monospace';
export const FPS = 30;

// Scene lengths in frames, and where each starts on the master timeline.
// Neighbouring scenes overlap by XFADE frames and cross-fade.
export const XFADE = 15;
export const LEN = {
  opening: 300,
  builds: 450,
  rise: 450,
  engine: 816,
  asks: 420,
  decide: 420,
  closing: 330,
};
const order = ["opening", "builds", "rise", "engine", "asks", "decide", "closing"] as const;
export const START = order.reduce<Record<(typeof order)[number], number>>(
  (acc, name, i) => {
    acc[name] = i === 0 ? 0 : acc[order[i - 1]] + LEN[order[i - 1]] - XFADE;
    return acc;
  },
  {} as Record<(typeof order)[number], number>,
);
export const TOTAL = START.closing + LEN.closing;
