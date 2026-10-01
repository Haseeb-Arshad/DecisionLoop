// The river cross-section shared by the HyperFrames scenes (and mirrored in the
// Remotion scenes via film/src/river.ts). One vertical scale: y = 880 - metres * 100.
// Deterministic: no randomness, no clocks.
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const INK = "#1f1f1f";
  const GROUND = "#f3f3f3";
  const WATER = "#dbe5ff";
  const WATER_LINE = "#6f8fe8";
  const MUTED = "#8c8c8c";

  const y = (m) => 880 - m * 100;

  // Terrain: left bank slope, channel, embankment wall, the east-bank terrace, hill.
  const TERRAIN = [
    [0, 470], [240, 470], [470, 900], [1180, 900], [1180, 610], [1620, 610], [1760, 470], [1920, 470],
  ];

  function leftBankX(yw) {
    return 240 + ((yw - 470) * 230) / 430;
  }

  function waterPoints(metres) {
    const yw = y(metres);
    if (yw >= 610) {
      return [[leftBankX(yw), yw], [1180, yw], [1180, 900], [470, 900]];
    }
    const xr = 1620 + (610 - yw);
    return [[leftBankX(yw), yw], [xr, yw], [1620, 610], [1180, 610], [1180, 900], [470, 900]];
  }

  function el(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (parent) parent.appendChild(node);
    return node;
  }

  function text(parent, x, yy, content, attrs = {}) {
    const t = el("text", { x, y: yy, "font-family": "Segoe UI, system-ui, sans-serif", "font-size": 20, fill: MUTED, ...attrs }, parent);
    t.textContent = content;
    return t;
  }

  function levelMark(parent, id, metres, label, color) {
    const g = el("g", { id }, parent);
    const yy = y(metres);
    const x0 = leftBankX(yy);
    el("line", { class: "mark-line", x1: x0, y1: yy, x2: 1180, y2: yy, stroke: color, "stroke-width": 3, "stroke-dasharray": "14 10" }, g);
    // Label sits just under the line at the left bank, clear of the bridge deck above it.
    const t = text(g, x0 + 40, yy + 34, label, { "text-anchor": "start", "font-size": 26, "font-weight": 600, fill: color, class: "mark-label" });
    return { group: g, text: t };
  }

  window.buildRiver = function buildRiver(host) {
    const svg = el("svg", { width: 1920, height: 1080, viewBox: "0 0 1920 1080" });
    host.appendChild(svg);

    const ground = el("polygon", { id: "ground", points: [...TERRAIN, [1920, 1080], [0, 1080]].map((p) => p.join(",")).join(" "), fill: GROUND }, svg);
    const water = el("polygon", { id: "water", fill: WATER }, svg);
    const waterLine = el("polyline", { id: "water-line", fill: "none", stroke: WATER_LINE, "stroke-width": 3 }, svg);

    // Bridge (deck at 2.7 m, the evacuation route) and piers.
    const bridge = el("g", { id: "bridge" }, svg);
    el("line", { x1: leftBankX(610), y1: 610, x2: 1180, y2: 610, stroke: INK, "stroke-width": 5 }, bridge);
    for (const px of [640, 940]) el("line", { x1: px, y1: 610, x2: px, y2: 900, stroke: "#a3a3a3", "stroke-width": 3 }, bridge);
    text(bridge, 700, 598, "Mill Street bridge", { "text-anchor": "middle", "font-size": 18 });

    const terrain = el("polyline", { id: "terrain", points: TERRAIN.map((p) => p.join(",")).join(" "), fill: "none", stroke: INK, "stroke-width": 3, "stroke-linejoin": "round" }, svg);
    const wall = el("line", { id: "wall", x1: 1180, y1: 900, x2: 1180, y2: 600, stroke: INK, "stroke-width": 8 }, svg);

    // Gauge on the channel side of the wall.
    const gauge = el("g", { id: "gauge" }, svg);
    for (let m = 0.5; m <= 2.5; m += 0.5) {
      el("line", { x1: 1164, y1: y(m), x2: 1176, y2: y(m), stroke: INK, "stroke-width": 2 }, gauge);
    }
    for (const m of [1, 2]) text(gauge, 1156, y(m) + 7, `${m} m`, { "text-anchor": "end", "font-size": 18 });

    // The east-bank terrace: school, hospital (with ground-floor generators), homes.
    const buildings = el("g", { id: "buildings" }, svg);
    const school = el("g", { class: "building" }, buildings);
    el("rect", { x: 1212, y: 530, width: 132, height: 80, fill: "#ffffff", stroke: INK, "stroke-width": 3 }, school);
    el("polyline", { points: "1204,532 1278,488 1352,532", fill: "none", stroke: INK, "stroke-width": 3 }, school);
    el("rect", { x: 1266, y: 572, width: 24, height: 38, fill: "none", stroke: INK, "stroke-width": 2 }, school);
    text(school, 1278, 470, "School", { "text-anchor": "middle" });
    const hospital = el("g", { class: "building" }, buildings);
    el("rect", { x: 1376, y: 500, width: 150, height: 110, fill: "#ffffff", stroke: INK, "stroke-width": 3 }, hospital);
    el("rect", { x: 1440, y: 522, width: 22, height: 60, fill: INK }, hospital);
    el("rect", { x: 1421, y: 541, width: 60, height: 22, fill: INK }, hospital);
    el("rect", { x: 1530, y: 586, width: 30, height: 24, fill: "#ffffff", stroke: INK, "stroke-width": 2 }, hospital);
    text(hospital, 1451, 482, "Hospital", { "text-anchor": "middle" });
    const homes = el("g", { class: "building" }, buildings);
    el("rect", { x: 1572, y: 568, width: 40, height: 42, fill: "#ffffff", stroke: INK, "stroke-width": 2 }, homes);
    el("polyline", { points: "1568,570 1592,548 1616,570", fill: "none", stroke: INK, "stroke-width": 2 }, homes);
    text(homes, 1592, 532, "Homes", { "text-anchor": "middle" });

    // Water in front of the terrace buildings, so a flooded ground floor reads as under water.
    const waterFront = el("polygon", { id: "water-front", fill: WATER, opacity: 0.78 }, svg);

    const mark24 = levelMark(svg, "mark-24", 2.4, "2.4 m · the 100-year flood level", "#1d4ed8");

    function setLevel(metres) {
      const pts = waterPoints(metres);
      water.setAttribute("points", pts.map((p) => p.join(",")).join(" "));
      const top = pts.slice(0, 2);
      waterLine.setAttribute("points", top.map((p) => p.join(",")).join(" "));
      const yw = y(metres);
      waterFront.setAttribute("points", yw < 610 ? [[1180, yw], [1620 + (610 - yw), yw], [1620, 610], [1180, 610]].map((p) => p.join(",")).join(" ") : "");
    }

    return { svg, ground, water, waterLine, waterFront, bridge, terrain, wall, gauge, buildings, mark24, setLevel, levelMark: (id, m, label, color) => levelMark(svg, id, m, label, color), y };
  };
})();
