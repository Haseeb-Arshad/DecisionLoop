import { AbsoluteFill, Sequence } from "remotion";
import { Caption, Footnote, Highlight, Reveal, Screen } from "../parts";
import { C } from "../theme";

/**
 * Scene 6, "People decide". Three real screens: the flagged decision with
 * its evidence, the review where a person accepts or dismisses, and the
 * record of what each agent was told and when.
 */
const SCREEN = { left: 320, top: 280, width: 1280 };
const BEAT = 140;

export function Decide() {
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <Sequence durationInFrames={BEAT + 10}>
        <Caption at={4} out={BEAT - 8}>
          A person sees the evidence, and where it came from.
        </Caption>
        <Reveal at={10} out={BEAT - 8}>
          <Screen src="ui/decision.png" {...SCREEN} from={{ x: 960, y: 540, scale: 1 }} to={{ x: 1010, y: 480, scale: 1.3 }} moveAt={30} moveFor={70} />
        </Reveal>
      </Sequence>
      <Sequence from={BEAT} durationInFrames={BEAT + 10}>
        <Caption at={4} out={BEAT - 8}>
          They decide: accept the evidence, or dismiss it.
        </Caption>
        <Reveal at={8} out={BEAT - 8}>
          <Screen src="ui/reviews.png" {...SCREEN} from={{ x: 1010, y: 420, scale: 1.25 }} to={{ x: 980, y: 420, scale: 1.45 }} moveAt={20} moveFor={90} />
        </Reveal>
      </Sequence>
      <Sequence from={BEAT * 2} durationInFrames={BEAT}>
        <Caption at={4}>
          And it is on record: what each agent was told, <span style={{ color: C.blue }}>and when.</span>
        </Caption>
        <Reveal at={8}>
          <Screen src="ui/agent.png" {...SCREEN} from={{ x: 960, y: 500, scale: 1.15 }} to={{ x: 1010, y: 450, scale: 1.3 }} moveAt={14} moveFor={50} />
        </Reveal>
        {/* "active when given (now at risk)" / "at risk when given" in agent.png (x 1100–1440, y 365–600). */}
        <Highlight at={70} left={1030} top={564} width={320} height={224} color={C.blue} />
      </Sequence>
      <Footnote>The real product, running on a fictional city's data.</Footnote>
    </AbsoluteFill>
  );
}
