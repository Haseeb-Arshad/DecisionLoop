import type { ReactNode } from "react";
import { AbsoluteFill, Audio, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Asks } from "./scenes/Asks";
import { Builds } from "./scenes/Builds";
import { Decide } from "./scenes/Decide";
import { C, LEN, START, TOTAL, XFADE } from "./theme";

/**
 * "The Line on the Wall". Seven scenes from three renderers:
 *   HyperFrames  — opening, rise, closing (the river and the title)
 *   Motion Canvas — engine (what DecisionLoop does with one new study)
 *   Remotion      — builds, asks, decide (decisions, the product's own screens), and this assembly
 */

/** Fades a scene in over its first XFADE frames (the previous scene sits underneath). */
function Fade({ children, fadeIn = true }: { length: number; children: ReactNode; fadeIn?: boolean }) {
  const frame = useCurrentFrame();
  const opacity = fadeIn ? interpolate(frame, [0, XFADE], [0, 1], { extrapolateRight: "clamp" }) : 1;
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

const clip = (name: string) => <OffthreadVideo src={staticFile(`clips/${name}.mp4`)} muted />;

export function Film() {
  const frame = useCurrentFrame();
  const fadeOut = interpolate(frame, [TOTAL - 20, TOTAL], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <Sequence from={START.opening} durationInFrames={LEN.opening}>
        <Fade length={LEN.opening} fadeIn={false}>{clip("opening")}</Fade>
      </Sequence>
      <Sequence from={START.builds} durationInFrames={LEN.builds}>
        <Fade length={LEN.builds}>
          <Builds />
        </Fade>
      </Sequence>
      <Sequence from={START.rise} durationInFrames={LEN.rise}>
        <Fade length={LEN.rise}>{clip("rise")}</Fade>
      </Sequence>
      <Sequence from={START.engine} durationInFrames={LEN.engine}>
        <Fade length={LEN.engine}>{clip("engine")}</Fade>
      </Sequence>
      <Sequence from={START.asks} durationInFrames={LEN.asks}>
        <Fade length={LEN.asks}>
          <Asks />
        </Fade>
      </Sequence>
      <Sequence from={START.decide} durationInFrames={LEN.decide}>
        <Fade length={LEN.decide}>
          <Decide />
        </Fade>
      </Sequence>
      <Sequence from={START.closing} durationInFrames={LEN.closing}>
        <Fade length={LEN.closing}>{clip("closing")}</Fade>
      </Sequence>
      <AbsoluteFill style={{ background: C.paper, opacity: 1 - fadeOut, pointerEvents: "none" }} />
      <Audio src={staticFile("audio/score.wav")} />
    </AbsoluteFill>
  );
}

/**
 * A 25-second silent loop for the top of the landing page: the water rises,
 * the engine finds and flags, the agent is told to stop, the title.
 */
export const LOOP_SEGMENTS: Array<{ name: string; from: number; length: number }> = [
  { name: "rise", from: 60, length: 210 }, // water rises past the line
  { name: "engine", from: 120, length: 150 }, // Find: every decision that relied on 2.4 m
  { name: "engine", from: 640, length: 120 }, // Flag: four decisions at risk
  { name: "asks", from: 200, length: 120 }, // Stop. This needs a person.
  { name: "closing", from: 180, length: 150 }, // title
];
export const LOOP_TOTAL = LOOP_SEGMENTS.reduce((n, s) => n + s.length, 0);

export function Loop() {
  let at = 0;
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      {LOOP_SEGMENTS.map((s, i) => {
        const from = at;
        at += s.length;
        return (
          <Sequence key={i} from={from} durationInFrames={s.length}>
            <Fade length={s.length} fadeIn={i > 0}>
              {s.name === "asks" ? (
                <Sequence from={-s.from}>
                  <Asks />
                </Sequence>
              ) : (
                <OffthreadVideo src={staticFile(`clips/${s.name}.mp4`)} startFrom={s.from} muted />
              )}
            </Fade>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
