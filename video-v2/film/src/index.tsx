import { Composition, registerRoot } from "remotion";
import { Film, Loop, LOOP_TOTAL } from "./Film";
import { FPS, TOTAL } from "./theme";

function Root() {
  return (
    <>
      <Composition id="Film" component={Film} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
      <Composition id="Loop" component={Loop} durationInFrames={LOOP_TOTAL} fps={FPS} width={1920} height={1080} />
    </>
  );
}

registerRoot(Root);
