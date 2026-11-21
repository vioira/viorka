import type { LineChartDatum } from "./line-chart";

export type StreamSpacing = "time" | "sample";
type Viewport = { start: number; end: number };
export type StreamWindow = {
  data: LineChartDatum[];
  coordinates: number[];
  first: number;
  spacing: StreamSpacing;
  view: Viewport;
  target: Viewport;
};

export function fittedViewport(start: number, end: number): Viewport {
  return { start: end - Math.max(1, end - start), end };
}

export function positionInView(x: number, view: Viewport) {
  return (x - view.start) / (view.end - view.start);
}

/** Play a delivered batch over the time it covers. Bound catch-up after an outage. */
export function streamDurationMs(previous: LineChartDatum, latest: LineChartDatum) {
  const elapsed = (latest.timestamp ?? Date.parse(latest.key))
    - (previous.timestamp ?? Date.parse(previous.key));
  return Number.isFinite(elapsed) && elapsed > 0 ? Math.min(elapsed, 5000) : 1000;
}

/** Keep evicted samples just long enough to scroll them past the left edge. */
export function streamWindow(
  data: LineChartDatum[],
  spacing: StreamSpacing,
  previous?: StreamWindow,
): StreamWindow {
  let coordinates = data.map((point, i) =>
    spacing === "sample" ? i : point.timestamp ?? Date.parse(point.key),
  );
  const target = fittedViewport(coordinates[0] ?? 0, coordinates.at(-1) ?? 0);
  const snapshot = { data, coordinates, spacing, first: 0, view: target, target };
  if (!previous || previous.spacing !== spacing || !data.length) return snapshot;

  const overlap = previous.data.findIndex(
    (point, i) => i >= previous.first && point.key === data[0].key,
  );
  if (overlap < 0) return snapshot;
  const retained = previous.data.length - overlap;
  if (retained >= data.length) return snapshot;
  // Corrections and out-of-order insertions replace the window directly.
  for (let i = 0; i < retained; i++) {
    const old = previous.data[overlap + i];
    const next = data[i];
    if (old.key !== next.key || old.timestamp !== next.timestamp) return snapshot;
    if (old.values !== next.values) {
      const keys = Object.keys(old.values);
      if (keys.length !== Object.keys(next.values).length ||
        keys.some(key => old.values[key] !== next.values[key])) return snapshot;
    }
  }
  if (spacing === "sample") {
    const offset = previous.coordinates[overlap];
    coordinates = coordinates.map(x => x + offset);
  }
  const nextView = fittedViewport(coordinates[0], coordinates[coordinates.length - 1]);
  if (nextView.end <= previous.target.end) return snapshot;

  const visible = previous.coordinates.findIndex(x => x >= previous.view.start);
  const keepFrom = Math.min(overlap, Math.max(0, visible - 1));
  const first = overlap - keepFrom;
  // Bound the outgoing buffer even when a burst outruns the display.
  if (first > Math.max(previous.data.length - previous.first, data.length)) return snapshot;
  const oldEnd = previous.target.end;
  const view = previous.data.length === 1
    ? { start: oldEnd - (nextView.end - nextView.start), end: oldEnd }
    : previous.view;
  return {
    data: previous.data.slice(keepFrom, overlap).concat(data),
    coordinates: previous.coordinates.slice(keepFrom, overlap).concat(coordinates),
    first,
    spacing,
    view,
    target: nextView,
  };
}
