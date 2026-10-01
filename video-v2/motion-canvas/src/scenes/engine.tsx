import { Line, makeScene2D, Node, Rect, Txt } from "@motion-canvas/2d";
import { all, createRef, easeInOutCubic, easeOutCubic, sequence, waitFor } from "@motion-canvas/core";

/**
 * Scene 4, "DecisionLoop connects it": what the engine does with one new
 * study, in five steps. Every value shown is what the real engine produced
 * for this scenario (video-v2/scenario/output.json): 3.1 m against 2.4 m,
 * forum trust 0.30, agency trust 0.95, the assumption's own trust 0.80.
 */

const INK = "#0a0a0a";
const MUTED = "#8c8c8c";
const SOFT = "#4d4d4d";
const HAIR = "#e4e4e4";
const BLUE = "#1d4ed8";
const RED = "#b42318";
const RED_MARK = "#d92d20";
const AMBER = "#93370d";
const FONT = "Segoe UI";

const DECISIONS = [
  { ref: "PLN-014 · Education", title: "School on the river terrace" },
  { ref: "HLT-006 · Health", title: "Hospital generators on the ground floor" },
  { ref: "EMR-003 · Emergency", title: "Evacuation over Mill Street bridge" },
  { ref: "PLN-021 · Permits", title: "East-bank homes without a flood review" },
];
const STEPS = ["Read", "Find", "Compare", "Weigh", "Flag"];

export default makeScene2D(function* (view) {
  view.fill("#ffffff");

  // ── Step rail ────────────────────────────────────────────────────────────
  const stepRefs = STEPS.map(() => createRef<Txt>());
  const stepBar = createRef<Rect>();
  view.add(
    <Node y={-440}>
      {STEPS.map((s, i) => (
        <Txt ref={stepRefs[i]} text={`${i + 1}  ${s}`} x={-600 + i * 300} fontFamily={FONT} fontSize={30} fontWeight={600} fill={MUTED} opacity={0} />
      ))}
      <Rect ref={stepBar} y={30} x={-600} width={150} height={4} fill={BLUE} opacity={0} />
    </Node>,
  );
  function* step(i: number) {
    yield* all(
      ...stepRefs.map((r, j) => r().fill(j === i ? INK : MUTED, 0.3)),
      stepBar().opacity(1, 0.3),
      stepBar().x(-600 + i * 300, 0.5, easeInOutCubic),
    );
  }

  // ── Caption ──────────────────────────────────────────────────────────────
  const caption = createRef<Txt>();
  view.add(<Txt ref={caption} y={420} width={1600} textAlign={"center"} textWrap={true} fontFamily={FONT} fontSize={40} fontWeight={600} fill={INK} text={""} opacity={0} />);
  function* say(text: string) {
    yield* caption().opacity(0, 0.2);
    caption().text(text);
    yield* caption().opacity(1, 0.35);
  }

  // ── 1. Read ──────────────────────────────────────────────────────────────
  const doc = createRef<Rect>();
  const fact = createRef<Rect>();
  const readArrow = createRef<Line>();
  view.add(
    <Rect ref={doc} x={-660} y={-40} width={380} height={240} fill={"#ffffff"} stroke={HAIR} lineWidth={2} radius={4} opacity={0} layout direction={"column"} padding={26} gap={10}>
      <Txt text={"National Hydrology Agency"} fontFamily={FONT} fontSize={20} fill={MUTED} />
      <Txt text={"National Flood Study"} fontFamily={FONT} fontSize={28} fontWeight={600} fill={INK} />
      <Rect width={320} height={10} fill={"#eeeeee"} radius={2} marginTop={12} />
      <Rect width={290} height={10} fill={"#eeeeee"} radius={2} />
      <Rect width={310} height={10} fill={"#eeeeee"} radius={2} />
      <Rect width={200} height={10} fill={"#eeeeee"} radius={2} />
    </Rect>,
  );
  view.add(<Line ref={readArrow} points={[[-455, -40], [-360, -40]]} stroke={INK} lineWidth={3} endArrow arrowSize={12} end={0} />);
  view.add(
    <Rect ref={fact} x={-120} y={-40} width={440} height={170} fill={"#ffffff"} stroke={BLUE} lineWidth={3} radius={4} opacity={0} layout direction={"column"} padding={24} gap={6}>
      <Txt text={"One fact"} fontFamily={FONT} fontSize={20} fill={MUTED} />
      <Txt text={"East bank, 100-year flood"} fontFamily={FONT} fontSize={28} fontWeight={600} fill={INK} />
      <Txt text={"3.1 m"} fontFamily={FONT} fontSize={52} fontWeight={700} fill={RED} />
    </Rect>,
  );

  yield* step(0);
  yield* all(sequence(0.12, ...stepRefs.map((r) => r().opacity(1, 0.4))), doc().opacity(1, 0.6));
  yield* say("Read: the new study becomes one fact.");
  yield* readArrow().end(1, 0.6, easeOutCubic);
  yield* all(fact().opacity(1, 0.5), fact().scale(0.96, 0).to(1, 0.5, easeOutCubic));
  yield* waitFor(1.4);

  // ── 2. Find ──────────────────────────────────────────────────────────────
  const nodes = DECISIONS.map(() => createRef<Rect>());
  const statuses = DECISIONS.map(() => createRef<Txt>());
  const assumes = DECISIONS.map(() => createRef<Txt>());
  const links = DECISIONS.map(() => createRef<Line>());
  const ys = [-300, -120, 60, 240];
  DECISIONS.forEach((d, i) => {
    view.add(<Line ref={links[i]} points={[[100, -40], [230, ys[i]]]} stroke={BLUE} lineWidth={2} end={0} />);
    view.add(
      <Rect ref={nodes[i]} x={500} y={ys[i]} width={540} height={136} fill={"#ffffff"} stroke={HAIR} lineWidth={2} radius={4} opacity={0} layout direction={"column"} padding={[18, 24]} gap={4}>
        <Txt text={d.ref} fontFamily={"Consolas"} fontSize={20} fill={MUTED} />
        <Txt text={d.title} fontFamily={FONT} fontSize={26} fontWeight={600} fill={INK} />
        <Rect layout direction={"row"} gap={20} alignItems={"center"}>
          <Txt ref={assumes[i]} text={"Assumes flood < 2.4 m"} fontFamily={FONT} fontSize={22} fill={BLUE} />
          <Txt ref={statuses[i]} text={"■ At risk"} fontFamily={FONT} fontSize={22} fontWeight={600} fill={RED} opacity={0} />
        </Rect>
      </Rect>,
    );
  });

  yield* all(step(1), doc().opacity(0, 0.5), readArrow().opacity(0, 0.5), fact().x(-420, 0.8, easeInOutCubic));
  links.forEach((l, i) => l().points([[-190, -40], [230, ys[i]]]));
  yield* say("Find: nobody said which decisions this touches. It finds every one that relied on 2.4 m.");
  yield* sequence(0.3, ...DECISIONS.map((_, i) => all(links[i]().end(1, 0.6, easeOutCubic), nodes[i]().opacity(1, 0.5))));
  yield* sequence(0.15, ...nodes.map((n) => n().stroke(BLUE, 0.3)));
  yield* waitFor(1.6);

  // ── 3. Compare ───────────────────────────────────────────────────────────
  const compare = createRef<Node>();
  view.add(
    <Node ref={compare} y={-40} opacity={0}>
      <Txt text={"3.1 m"} x={-330} fontFamily={FONT} fontSize={150} fontWeight={700} fill={RED} />
      <Txt text={">"} x={0} fontFamily={FONT} fontSize={120} fontWeight={400} fill={INK} />
      <Txt text={"2.4 m"} x={330} fontFamily={FONT} fontSize={150} fontWeight={700} fill={BLUE} />
      <Txt text={"new study"} x={-330} y={110} fontFamily={FONT} fontSize={28} fill={MUTED} />
      <Txt text={"what the decisions assumed"} x={330} y={110} fontFamily={FONT} fontSize={28} fill={MUTED} />
    </Node>,
  );
  yield* all(
    step(2),
    ...nodes.map((n) => n().opacity(0, 0.5)),
    ...links.map((l) => l().opacity(0, 0.5)),
    fact().opacity(0, 0.5),
  );
  yield* all(compare().opacity(1, 0.6), say("Compare: checked by arithmetic. No model, no guessing."));
  yield* waitFor(2.2);

  // ── 4. Weigh ─────────────────────────────────────────────────────────────
  const weigh = createRef<Node>();
  const forum = createRef<Rect>();
  const agency = createRef<Rect>();
  const forumFill = createRef<Rect>();
  const agencyFill = createRef<Rect>();
  const forumOutcome = createRef<Txt>();
  const agencyOutcome = createRef<Txt>();
  const BAR = 560;
  const card = (ref: ReturnType<typeof createRef<Rect>>, fill: ReturnType<typeof createRef<Rect>>, outcome: ReturnType<typeof createRef<Txt>>, x: number, source: string, claim: string, trust: string, verdict: string, color: string) => (
    <Rect ref={ref} x={x} y={-40} width={700} height={330} fill={"#ffffff"} stroke={HAIR} lineWidth={2} radius={4} opacity={0} layout direction={"column"} padding={30} gap={10}>
      <Txt text={source} fontFamily={FONT} fontSize={32} fontWeight={600} fill={INK} />
      <Txt text={claim} fontFamily={FONT} fontSize={24} fill={SOFT} />
      <Txt text={trust} fontFamily={FONT} fontSize={24} fill={SOFT} marginTop={14} />
      <Rect width={BAR} height={16} fill={"#eeeeee"} radius={2}>
        <Rect ref={fill} layout={false} x={-BAR / 2} offset={[-1, 0]} width={0} height={16} fill={color} radius={2} />
        <Rect layout={false} x={-BAR / 2 + BAR * 0.8} width={3} height={34} fill={INK} />
      </Rect>
      <Txt text={"The assumption's own trust: 0.80"} fontFamily={FONT} fontSize={20} fill={MUTED} />
      <Txt ref={outcome} text={verdict} fontFamily={FONT} fontSize={28} fontWeight={600} fill={color} opacity={0} marginTop={8} />
    </Rect>
  );
  view.add(
    <Node ref={weigh}>
      {card(forum, forumFill, forumOutcome, -390, "Residents' forum post", "Claims 2.9 m", "Trust 0.30", "Can only raise a question", AMBER)}
      {card(agency, agencyFill, agencyOutcome, 390, "National Hydrology Agency", "Reports 3.1 m", "Trust 0.95", "Can overturn the assumption", RED)}
    </Node>,
  );
  yield* all(step(3), compare().opacity(0, 0.5));
  yield* say("Weigh: a rumour can only raise a question. A strong source can overturn.");
  yield* all(forum().opacity(1, 0.5));
  yield* forumFill().width(BAR * 0.3, 0.8, easeOutCubic);
  yield* forumOutcome().opacity(1, 0.4);
  yield* agency().opacity(1, 0.5);
  yield* agencyFill().width(BAR * 0.95, 0.9, easeOutCubic);
  yield* agencyOutcome().opacity(1, 0.4);
  yield* waitFor(2.0);

  // ── 5. Flag ──────────────────────────────────────────────────────────────
  const review = createRef<Rect>();
  view.add(
    <Rect ref={review} x={-440} y={-40} width={620} layout direction={"column"} gap={12} opacity={0}>
      <Txt text={"Four decisions at risk."} fontFamily={FONT} fontSize={44} fontWeight={600} fill={RED} />
      <Txt text={"Four teams, told at once."} fontFamily={FONT} fontSize={44} fontWeight={600} fill={INK} />
      <Txt text={"A person reviews each one."} fontFamily={FONT} fontSize={44} fontWeight={600} fill={INK} />
    </Rect>,
  );
  yield* all(step(4), weigh().opacity(0, 0.5));
  nodes.forEach((n) => n().stroke(HAIR));
  yield* all(...nodes.map((n) => n().opacity(1, 0.5)));
  yield* say("Flag: each one is marked at risk, for a person to decide.");
  yield* sequence(
    0.35,
    ...nodes.map((n, i) => all(n().stroke(RED_MARK, 0.3), statuses[i]().opacity(1, 0.3), assumes[i]().fill(RED, 0.3), assumes[i]().text("Assumed flood < 2.4 m", 0))),
  );
  yield* review().opacity(1, 0.6);
  yield* waitFor(1.2);
  yield* say("One fact changed. It found every decision that depended on it.");
  yield* waitFor(2.4);
});
