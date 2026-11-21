"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import { AnimatePresence, animate, motion, useInView, useMotionValue, useMotionValueEvent, useSpring, useTransform, type MotionValue } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./line-chart.module.css";
import { fittedViewport, positionInView, streamDurationMs, streamWindow, type StreamSpacing, type StreamWindow } from "./stream-window";

export interface LineChartSeries {
  /** Stable identity. A series keeps its line across data changes, so switching ranges morphs the path instead of redrawing it. */
  key: string;
  /** Name in the legend, the tooltip, and the data table. */
  label: string;
  /** Any CSS color. Defaults to the accent for the first series, then quieter neutral steps. */
  color?: string;
  /** Draws a dashed stroke, useful for a previous period or a target. */
  dashed?: boolean;
  /** Fills the area under the line with a faint tint of its color. Defaults to true for the first series. */
  area?: boolean;
}

export interface LineChartDatum {
  /** Stable identity, such as an ISO date. */
  key: string;
  /** Full label for the tooltip and screen readers, such as "Tue, Sep 15". */
  label: string;
  /** Milliseconds since epoch when the stable sample key is not a timestamp. */
  timestamp?: number;
  /** Short label on the x axis, such as "Sep 15". Leave it out to keep the axis quiet at that point. */
  axisLabel?: string;
  /** One value per series key. An undefined value counts as zero; explicit null leaves a gap. */
  values: Record<string, number | null | undefined>;
  /** Display-only per-series readings for tooltips and assistive text; never used for geometry. */
  valueLabels?: Record<string, string>;
}

/** Use a line chart for one or more measures over time, when the shape of the trend matters more than any single value. */
export interface LineChartProps {
  data: LineChartDatum[];
  series: LineChartSeries[];
  /** What is measured, such as "Signups". Names the chart for assistive technology. */
  label: string;
  /** Unit after each value in the tooltip, such as "ms". */
  unit?: string;
  /** Plot height in pixels. The width follows the container. */
  height?: number;
  /** Formats values in the tooltip and data table. */
  formatValue?: (value: number, series: LineChartSeries) => string;
  /** Formats the value axis. Defaults to a compact number, such as 1.2K. */
  formatTick?: (value: number) => string;
  /** Viorka: minimum positive span of the data-driven value axis. Defaults to 1. */
  minYSpan?: number;
  /** Controlled hidden series keys. */
  hiddenSeries?: string[];
  defaultHiddenSeries?: string[];
  onHiddenSeriesChange?: (hidden: string[]) => void;
  /** Called as the crosshair moves, and with null when it leaves. Use it to drive a headline readout. */
  onActiveChange?: (index: number | null, datum: LineChartDatum | null) => void;
  /** Keeps the current lines on screen, dimmed, while the next range loads. */
  loading?: boolean;
  /** Viorka: advance the plot as samples arrive, without pausing on hover. */
  realtime?: boolean;
  /** Viorka: space live data by elapsed time (the default) or evenly by sample. */
  realtimeSpacing?: StreamSpacing;
  /** A full server snapshot replaces any in-flight scroll immediately. */
  realtimeReset?: boolean;
  /** Shown when there are no points. */
  emptyLabel?: string;
  /** Series toggles above the plot. Shown by default when there is more than one series. */
  legend?: boolean;
  /** Header of the first column in the data table read by screen readers. */
  categoryLabel?: string;
  /** Smooth monotone curves that never swing past the data, or straight segments. */
  curve?: "smooth" | "linear";
  ref?: Ref<HTMLElement>;
  className?: string;
}

type Point = [x: number, value: number];
type Track = { shape: Point[]; presence: number; fade: { stop: () => void } | null };

const { spring, duration, ease } = motionTokens;
/** Motion drops inherited velocity on time-defined springs, so values that retarget mid-flight run the same springs written as stiffness and damping. */
const physical = ({ visualDuration, bounce }: { visualDuration: number; bounce: number }, restDelta = .001) => { const root = (2 * Math.PI) / (visualDuration * 1.2); return { type: "spring" as const, stiffness: root * root, damping: 2 * (1 - bounce) * root, restDelta, restSpeed: restDelta * 2 }; };
const settle = physical(spring.smooth);
const glide = physical(spring.snappy, .0001);
const follow = { stiffness: glide.stiffness, damping: glide.damping, restDelta: .01 };
const draw = { duration: duration.considered * 1.75, ease: [...ease.inOut] } as const;
const fadeFast = { duration: duration.instant, ease: [...ease.standard] } as const;

/** Room above the top gridline, and the gap between the crosshair and its tooltip. */
const TOP = 12, GAP = 14;
const PALETTE = ["var(--accent)", "color-mix(in oklab, var(--foreground) 46%, var(--surface))", "color-mix(in oklab, var(--foreground) 26%, var(--surface))"];
const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const colorOf = (series: LineChartSeries, index: number) => series.color ?? PALETTE[Math.min(index, PALETTE.length - 1)];
const clean = (value: number) => Number(value.toPrecision(12));

/** Clean gridlines: the smallest step of 1, 2, 2.5, or 5 that covers the data in four rows or fewer, from zero unless the data dips below it. */
function niceScale(low: number, high: number, minSpan: number) {
  const lo = Math.min(0, low), hi = Math.max(high, lo + minSpan);
  const span = hi - lo, magnitude = 10 ** Math.floor(Math.log10(span / 4));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    const step = factor * magnitude, bottom = Math.floor(lo / step) * step, top = Math.ceil(hi / step) * step;
    if ((top - bottom) / step <= 4 + 1e-9) {
      const ticks: number[] = [];
      for (let value = bottom; value <= top + step / 2; value += step) ticks.push(clean(value));
      return { min: clean(bottom), max: clean(top), ticks };
    }
  }
  return { min: lo, max: hi, ticks: [lo, hi] };
}

/** The line through every value, sampled densely on x from 0 to 1 in data units. Monotone cubic tangents keep a smooth curve from swinging past the data. */
function curveFor(values: number[], smooth: boolean): Point[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [[0, values[0]!], [1, values[0]!]];
  const last = values.length - 1, step = 1 / last;
  if (!smooth) return values.map((value, index) => [index * step, value]);
  const slopes = values.slice(1).map((value, index) => (value - values[index]!) / step);
  const tangents = values.map((_, index) => index === 0 || index === last ? 0 : (Math.sign(slopes[index - 1]!) + Math.sign(slopes[index]!)) * Math.min(Math.abs(slopes[index - 1]!), Math.abs(slopes[index]!), Math.abs(slopes[index - 1]! + slopes[index]!) / 4) || 0);
  if (last > 1) { tangents[0] = (3 * slopes[0]! - tangents[1]!) / 2; tangents[last] = (3 * slopes[last - 1]! - tangents[last - 1]!) / 2; }
  else { tangents[0] = slopes[0]!; tangents[1] = slopes[0]!; }
  const samples = Math.max(1, Math.min(16, Math.round(192 / last)));
  const points: Point[] = [];
  for (let index = 0; index < last; index++) {
    const low = Math.min(values[index]!, values[index + 1]!), high = Math.max(values[index]!, values[index + 1]!);
    for (let sample = 0; sample < samples; sample++) {
      const t = sample / samples, t2 = t * t, t3 = t2 * t;
      const value = (2 * t3 - 3 * t2 + 1) * values[index]! + (t3 - 2 * t2 + t) * step * tangents[index]! + (3 * t2 - 2 * t3) * values[index + 1]! + (t3 - t2) * step * tangents[index + 1]!;
      points.push([(index + t) * step, clamp(value, low, high)]);
    }
  }
  points.push([1, values[last]!]);
  return points;
}

/** Explicit gaps keep each run at its original position on the category axis. */
export function gapCurve(values: (number | null | undefined)[], smooth: boolean): Point[] {
  if (!values.includes(null)) return curveFor(values.map(value => value ?? 0), smooth);
  const result: Point[] = [];
  const last = Math.max(1, values.length - 1);
  for (let start = 0; start < values.length;) {
    if (values[start] === null) { result.push([start / last, NaN]); start++; continue; }
    let end = start;
    while (end + 1 < values.length && values[end + 1] !== null) end++;
    const run = curveFor(values.slice(start, end + 1).map(value => value ?? 0), smooth);
    result.push(...run.map(([x, y]): Point => [(start + x * (end - start)) / last, y]));
    start = end + 1;
  }
  return result;
}

// Fit the retained samples to the plot in timestamp or sample-index units.
const streamSpan = (xValues: number[], end: number) => Math.max(1, end - (xValues[0] ?? end));

/** Place the gap-aware curve on the live axis. */
export function streamCurve(shape: Point[], xValues: number[], end: number): Point[] {
  if (!xValues.length) return [];
  const span = streamSpan(xValues, end);
  return shape.map(([x, value]) => {
    const position = clamp(x * (xValues.length - 1), 0, xValues.length - 1);
    const index = Math.floor(position);
    const left = xValues[index]!;
    const right = xValues[index + 1] ?? left;
    const at = left + (right - left) * (position - index);
    return [1 + (at - end) / span, value];
  });
}

// A snapshot is laid out from the newest sample. Appends keep existing tick IDs
// and fill space beyond the last retained tick, including multi-sample batches.
const axisSpacing = 88;
export function streamAxisPicks(data: LineChartDatum[], xValues: number[], width: number,
  view = fittedViewport(xValues[0] ?? 0, xValues.at(-1) ?? 0),
  retained?: ReadonlySet<string>, visibleStart = view.start) {
  if (width <= 0) return [];
  const minimumGap = axisSpacing * (view.end - view.start) / width;
  // A growing window can squeeze ticks slightly. Thin them only when needed
  // for readability, so small changes in scale do not reshuffle the axis.
  const retainedGap = minimumGap * 0.75;
  const candidates = data.flatMap((sample, i) =>
    xValues[i] >= visibleStart && xValues[i] <= view.end && sample.axisLabel &&
    Object.values(sample.values).some(value => value != null) ? [i] : []);
  const picks: number[] = [];
  let left = -Infinity;
  for (const i of candidates) {
    if (retained?.has(data[i].key) && xValues[i] - left >= retainedGap) {
      picks.push(i);
      left = xValues[i];
    }
  }
  if (picks.length) {
    for (const i of candidates) {
      if (xValues[i] - left < minimumGap) continue;
      picks.push(i);
      left = xValues[i];
    }
    return picks;
  }
  let right = Infinity;
  for (const i of candidates.reverse()) {
    if (right - xValues[i] < minimumGap) continue;
    picks.push(i);
    right = xValues[i];
  }
  return picks.reverse();
}

export function gapPaths(shape: Point[], width: number, height: number, y: (value: number) => number) {
  const runs: Point[][] = [];
  let run: Point[] = [];
  for (const point of shape) {
    if (!Number.isFinite(point[1])) { run = []; continue; }
    if (!run.length) runs.push(run);
    run.push(point);
  }
  let line = '', area = '';
  for (const run of runs) {
    const path = `M${run.map(([x, value]) => `${(x * width).toFixed(1)},${y(value).toFixed(1)}`).join('L')}`;
    line += path;
    area += `${path}L${(run.at(-1)![0] * width).toFixed(1)},${height}L${(run[0]![0] * width).toFixed(1)},${height}Z`;
  }
  return { line, area };
}

/** Value of a sampled line at x, straight between samples. */
export function valueAt(shape: Point[], x: number) {
  if (!shape.length) return NaN;
  let low = 0, high = shape.length - 1;
  if (x <= shape[low]![0]) return shape[low]![1];
  if (x >= shape[high]![0]) return shape[high]![1];
  while (high - low > 1) { const middle = (low + high) >> 1; if (shape[middle]![0] < x) low = middle; else high = middle; }
  const [x0, y0] = shape[low]!, [x1, y1] = shape[high]!;
  if (x === x0) return y0;
  if (x === x1) return y1;
  return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/** Tracks are mutable animation state read by the painter, never by render. */
const update = (track: Track, patch: Partial<Track>) => Object.assign(track, patch);

const grid = Array.from({ length: 241 }, (_, index) => index / 240);

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(notify: () => void) {
  const preference = window.matchMedia(reducedMotionQuery);
  preference.addEventListener("change", notify);
  return () => preference.removeEventListener("change", notify);
}

function useReducedMotionSafe() {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(reducedMotionQuery).matches, () => false);
}

type Scale = { min: MotionValue<number>; max: MotionValue<number> };
function useRowY(value: number, scale: Scale, height: number) {
  return useTransform(() => { const span = scale.max.get() - scale.min.get() || 1; return Math.round(TOP + (1 - (value - scale.min.get()) / span) * (height - TOP)) + .5; });
}

/** A gridline rides the scale, so a taller range slides it down while new rows fade in above. */
function Gridline({ value, scale, height }: { value: number; scale: Scale; height: number }) {
  const y = useRowY(value, scale, height);
  return <motion.line className={styles.grid} x1={0} x2="100%" y1={y} y2={y} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: fadeFast }} transition={{ duration: duration.standard, ease: [...ease.standard] }} />;
}

function TickLabel({ value, scale, height, format }: { value: number; scale: Scale; height: number; format: (value: number) => string }) {
  const y = useRowY(value, scale, height);
  return <motion.span className={styles.tick} style={{ y }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: fadeFast }} transition={{ duration: duration.standard, ease: [...ease.standard] }}>
    <span className={styles.tickText}>{format(value)}</span>
  </motion.span>;
}

/** Axis labels that fit: at most one per 76 pixels, counted back from the latest so the newest date always shows. */
function axisPicks(data: LineChartDatum[], width: number) {
  const labeled = data.flatMap((item, index) => item.axisLabel ? [index] : []);
  if (!width || !labeled.length) return [];
  const room = Math.max(2, Math.floor(width / 76));
  const stride = Math.ceil(labeled.length / room);
  return labeled.reverse().filter((_, rank) => rank % stride === 0).reverse();
}

export function LineChart({ data, series, label, unit = "", height = 220, formatValue, formatTick = value => compact.format(value), minYSpan = 1, hiddenSeries, defaultHiddenSeries, onHiddenSeriesChange, onActiveChange, loading = false, realtime = false, realtimeSpacing = "time", realtimeReset = false, emptyLabel = "No data for this range", legend, categoryLabel = "Date", curve = "smooth", ref, className }: LineChartProps) {
  const reduced = useReducedMotionSafe();
  const figure = useRef<HTMLElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const clip = useRef<SVGRectElement>(null);
  const crosshair = useRef<SVGLineElement>(null);
  const streamLayer = useRef<SVGGElement>(null);
  const [streamTicks, setStreamTicks] = useState<{ key: string; text: string; coordinate: number }[]>([]);
  const tickNodes = useRef(new Map<string, { node: HTMLSpanElement; coordinate: number }>());
  const layoutStreamAxis = useCallback((frame: StreamWindow, width: number, reset: boolean) => {
    const start = Math.min(frame.view.start, frame.target.start);
    const scrolling = frame.view !== frame.target;
    const leftBuffer = (frame.view.end - frame.view.start) * axisSpacing / width;
    setStreamTicks(previous => {
      const retained = reset ? undefined : new Set(previous.map(tick => tick.key));
      const ticks = streamAxisPicks(frame.data, frame.coordinates, width, frame.target, retained, start)
        .map(i => ({ key: frame.data[i].key, text: frame.data[i].axisLabel!, coordinate: frame.coordinates[i] }));
      // The sample can leave the data before its text has fully crossed the clip edge.
      if (reset || !scrolling || !width) return ticks;
      const outgoing = previous.filter(tick => tick.coordinate < start && tick.coordinate >= start - leftBuffer);
      return outgoing.concat(ticks);
    });
  }, []);
  const stream = useRef<StreamWindow | undefined>(undefined);
  const lines = useRef(new Map<string, SVGPathElement>());
  const areas = useRef(new Map<string, SVGPathElement>());
  const dots = useRef(new Map<string, SVGCircleElement>());
  const heads = useRef(new Map<string, SVGCircleElement>());
  const groups = useRef(new Map<string, SVGGElement>());
  useImperativeHandle(ref, () => figure.current as HTMLElement);
  const inView = useInView(figure, { once: !realtime, amount: realtime ? "some" : .3 });
  const uid = `line${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const last = data.length - 1;
  const empty = data.length === 0;

  // Hidden series, controlled or not.
  const [ownHidden, setOwnHidden] = useState<string[]>(defaultHiddenSeries ?? []);
  const hidden = hiddenSeries ?? ownHidden;
  const toggle = (key: string) => {
    const next = hidden.includes(key) ? hidden.filter(item => item !== key) : [...hidden, key];
    if (hiddenSeries === undefined) setOwnHidden(next);
    onHiddenSeriesChange?.(next);
  };
  const visible = series.filter(item => !hidden.includes(item.key));
  const showLegend = legend ?? series.length > 1;

  // Each series becomes a dense curve in data units; the scale fits only the series on show.
  const signature = `${curve}|${series.map(item => item.key).join(",")}|${data.map(item => `${item.key}:${item.timestamp ?? ""}:${series.map(line => (item.values[line.key] === null ? "gap" : item.values[line.key] ?? 0)).join(",")}`).join(";")}`;

  let low = Infinity, high = -Infinity;
  for (const line of visible) for (const item of data) { if (item.values[line.key] === null) continue; const value = item.values[line.key] ?? 0; low = Math.min(low, value); high = Math.max(high, value); }
  const range = Number.isFinite(low) ? niceScale(low, high, minYSpan) : null;
  const [steady, setSteady] = useState(() => range ?? niceScale(0, 100, minYSpan));
  if (range && (range.min !== steady.min || range.max !== steady.max)) setSteady(range);
  const scale = { min: useMotionValue(steady.min), max: useMotionValue(steady.max) };

  // 数据更新后按 key 保留选中点，仅在该点移出范围时收起信息框。
  const [active, setActive] = useState<number | null>(null);
  const [seenData, setSeenData] = useState({ signature, data });
  if (seenData.signature !== signature) {
    setSeenData({ signature, data });
    const key = active === null ? undefined : seenData.data[active]?.key;
    const next = key !== undefined ? data.findIndex(item => item.key === key) : -1;
    setActive(next >= 0 ? next : null);
  }
  const index = active === null || empty ? null : Math.min(active, last);
  const scrubbing = index !== null;

  const width = useRef(0);
  const [plotWidth, setPlotWidth] = useState(0);
  const tipSize = useRef({ w: 0, h: 0 });
  const tracks = useRef(new Map<string, Track>());
  const drawn = useMotionValue(0);
  const cursor = useMotionValue(1);
  const tipTargetX = useMotionValue(0), tipTargetY = useMotionValue(0);
  const tipSpringX = useSpring(tipTargetX, follow), tipSpringY = useSpring(tipTargetY, follow);
  const live = useRef({ series, hidden, index });
  useLayoutEffect(() => { live.current = { series, hidden, index }; });

  // Move the existing SVG geometry; picking, labels and markers use that same viewport.
  const paintOverlay = useCallback(() => {
    const w = width.current;
    if (!w) return;
    const frame = stream.current;
    const progress = drawn.get();
    const clipWidth = progress * (frame ? w : w + 16);
    clip.current?.setAttribute("width", String(clipWidth));
    const selection = live.current.index;
    let at = cursor.get();
    let headPosition = NaN;
    if (frame) {
      const { coordinates, view } = frame;
      const full = fittedViewport(coordinates[0] ?? 0, coordinates.at(-1) ?? 0);
      const offset = positionInView(full.start, view);
      const stretch = (full.end - full.start) / (view.end - view.start);
      const edge = view.start + progress * (view.end - view.start);
      if (progress > 0 && edge >= coordinates[0]) headPosition = positionInView(edge, full);
      streamLayer.current?.setAttribute("transform", `translate(${offset * w} 0) scale(${stretch} 1)`);
      const selectedX = selection === null ? undefined : coordinates[frame.first + selection];
      if (selectedX !== undefined) at = positionInView(selectedX, view);
      for (const { node, coordinate } of tickNodes.current.values()) {
        const share = positionInView(coordinate, view);
        node.style.transform = `translateX(${share * w}px) translateX(-${clamp(share, 0, 1) * 100}%)`;
      }
    }
    const lo = scale.min.get(), span = scale.max.get() - lo || 1;
    const dotYs: number[] = [];
    for (const line of live.current.series) {
      const track = tracks.current.get(line.key);
      if (!track) continue;
      const toY = (value: number) => TOP + (1 - (value - lo) * track.presence / span) * (height - TOP);
      const head = heads.current.get(line.key);
      if (head) {
        const value = Number.isFinite(headPosition) ? valueAt(track.shape, headPosition) : NaN;
        head.style.opacity = Number.isFinite(value) ? String(track.presence) : "0";
        if (Number.isFinite(value)) {
          head.setAttribute("cx", String(clipWidth));
          head.setAttribute("cy", toY(value).toFixed(2));
        }
      }
      const dot = dots.current.get(line.key);
      if (!dot || !track.shape.length || selection === null) continue;
      const sample = frame && selection !== null ? frame.data[frame.first + selection] : undefined;
      const value = sample ? sample.values[line.key] : valueAt(track.shape, at);
      const cy = value === null ? NaN : toY(value ?? 0);
      dot.style.display = Number.isFinite(cy) && at >= 0 && at <= 1 ? "" : "none";
      dot.setAttribute("cx", (at * w).toFixed(1));
      dot.setAttribute("cy", (Number.isFinite(cy) ? cy : 0).toFixed(1));
      if (track.presence > .5 && Number.isFinite(cy)) dotYs.push(cy);
    }
    const cx = Math.round(at * w) + .5;
    crosshair.current?.setAttribute("x1", String(cx));
    crosshair.current?.setAttribute("x2", String(cx));
    // The tooltip sits beside the crosshair, flips sides before it would leave the plot, and centres on the points it describes.
    const { w: tw, h: th } = tipSize.current;
    let x = cx + GAP;
    if (x + tw > w) x = cx - GAP - tw;
    tipTargetX.set(clamp(x, 0, Math.max(0, w - tw)));
    const middle = dotYs.length ? dotYs.reduce((sum, value) => sum + value, 0) / dotYs.length : height / 2;
    tipTargetY.set(clamp(middle - th / 2, 0, Math.max(0, height - th)));
    if (crosshair.current) crosshair.current.style.visibility = at >= 0 && at <= 1 ? "" : "hidden";
  }, [cursor, drawn, height, scale.max, scale.min, tipTargetX, tipTargetY]);

  const paint = useCallback(() => {
    const w = width.current;
    if (!w) return;
    const lo = scale.min.get(), span = scale.max.get() - lo || 1;
    for (const line of live.current.series) {
      const track = tracks.current.get(line.key);
      if (!track) continue;
      const y = (value: number) => TOP + (1 - (value - lo) * track.presence / span) * (height - TOP);
      const paths = gapPaths(track.shape, w, height, y);
      lines.current.get(line.key)?.setAttribute("d", paths.line);
      areas.current.get(line.key)?.setAttribute("d", paths.area);
      const group = groups.current.get(line.key);
      if (group) group.style.opacity = String(track.presence);
    }
    paintOverlay();
  }, [height, scale.max, scale.min, paintOverlay]);
  useMotionValueEvent(cursor, "change", paintOverlay);
  useMotionValueEvent(drawn, "change", paintOverlay);
  useMotionValueEvent(scale.min, "change", paint);
  useMotionValueEvent(scale.max, "change", paint);

  // The plot draws in its own pixels: measure the width, follow resizes, and size the tooltip for its flip.
  useLayoutEffect(() => {
    const node = plot.current, bubble = tip.current;
    if (!node) return;
    let containerWidth = figure.current?.clientWidth;
    const read = () => {
      const resized = width.current !== node.clientWidth;
      const nextContainerWidth = figure.current?.clientWidth;
      width.current = node.clientWidth;
      setPlotWidth(node.clientWidth);
      if (resized && stream.current) layoutStreamAxis(stream.current, node.clientWidth, nextContainerWidth !== containerWidth);
      containerWidth = nextContainerWidth;
      if (bubble) tipSize.current = { w: bubble.offsetWidth, h: bubble.offsetHeight };
      paint();
      // A resize changes the coordinate space; do not spring through the old, wider layout.
      if (resized) { tipSpringX.jump(tipTargetX.get()); tipSpringY.jump(tipTargetY.get()); }
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    if (bubble) observer.observe(bubble);
    return () => observer.disconnect();
  }, [layoutStreamAxis, paint, tipSpringX, tipSpringY, tipTargetX, tipTargetY]);

  const canScroll = realtime && inView && !realtimeReset && !reduced;
  // Live updates move the viewport. Historical ranges morph the geometry.
  const morph = useRef<{ stop: () => void } | null>(null);
  useLayoutEffect(() => {
    const previous = stream.current;
    const frame = realtime
      ? streamWindow(data, realtimeSpacing, canScroll && !document.hidden ? previous : undefined)
      : undefined;
    stream.current = frame;
    const samples = frame?.data ?? data;
    const targets = new Map(series.map(line => {
      const shape = gapCurve(samples.map(item => item.values[line.key]), curve === "smooth");
      return [line.key, frame ? streamCurve(shape, frame.coordinates, frame.coordinates.at(-1) ?? 0) : shape];
    }));
    if (frame) {
      layoutStreamAxis(frame, width.current, !previous || realtimeReset || frame.spacing !== previous.spacing);
      for (const [key, target] of targets) {
        const track = tracks.current.get(key);
        if (track) update(track, { shape: target });
        else tracks.current.set(key, { shape: target, presence: live.current.hidden.includes(key) ? 0 : 1, fade: null });
      }
      paint();
      const from = frame.view, to = frame.target;
      if (from === to || !previous) return;
      const durationMs = streamDurationMs(previous.data[previous.data.length - 1], data[data.length - 1]);
      const scroll = animate(0, 1, {
        type: "tween", duration: durationMs / 1000, ease: "linear",
        onUpdate(progress) {
          frame.view = {
            start: from.start + (to.start - from.start) * progress,
            end: from.end + (to.end - from.end) * progress,
          };
          paintOverlay();
        },
      });
      const finishWhenHidden = () => {
        if (!document.hidden) return;
        scroll.stop();
        frame.view = to;
        paintOverlay();
      };
      document.addEventListener("visibilitychange", finishWhenHidden);
      return () => {
        document.removeEventListener("visibilitychange", finishWhenHidden);
        scroll.stop();
      };
    }
    streamLayer.current?.removeAttribute("transform");
    const moves: { track: Track; xs: number[]; from: number[]; to: number[]; target: Point[] }[] = [];
    for (const [key, target] of targets) {
      const track = tracks.current.get(key);
      if (!track) { tracks.current.set(key, { shape: target, presence: live.current.hidden.includes(key) ? 0 : 1, fade: null }); continue; }
      if (!track.shape.length || !target.length || reduced) { update(track, { shape: target }); continue; }
      const xs = [...new Set([...grid, ...target.map(([x]) => x)])].sort((a, b) => a - b);
      moves.push({ track, xs, from: xs.map(x => valueAt(track.shape, x)), to: xs.map(x => valueAt(target, x)), target });
    }
    morph.current?.stop();
    if (!moves.length) { paint(); return; }
    morph.current = animate(0, 1, { ...settle, restDelta: .0005, onUpdate: progress => { for (const move of moves) update(move.track, { shape: move.xs.map((x, at): Point => [x, Number.isFinite(move.from[at]) && Number.isFinite(move.to[at]) ? move.from[at]! + (move.to[at]! - move.from[at]!) * progress : move.to[at]!]) }); paint(); }, onComplete: () => { for (const move of moves) update(move.track, { shape: move.target }); paint(); } });
    return () => morph.current?.stop();
  }, [signature, layoutStreamAxis, paint, paintOverlay, reduced, realtime, realtimeSpacing, canScroll, realtimeReset]);

  useLayoutEffect(paint);

  // A hidden series flattens into the baseline as it fades; the ones that stay rescale around it.
  const hiddenKey = hidden.join("|");
  useEffect(() => {
    for (const [key, track] of tracks.current) {
      const to = hidden.includes(key) ? 0 : 1;
      if (track.presence === to) continue;
      track.fade?.stop();
      if (reduced) { update(track, { presence: to }); continue; }
      update(track, { fade: animate(track.presence, to, { ...settle, onUpdate: value => { update(track, { presence: value }); paint(); } }) });
    }
    paint();
  }, [hiddenKey, paint, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (reduced || (realtime && realtimeReset)) { scale.min.jump(steady.min); scale.max.jump(steady.max); return; }
    const controls = [animate(scale.min, steady.min, settle), animate(scale.max, steady.max, settle)];
    return () => controls.forEach(control => control.stop());
  }, [reduced, realtime, realtimeReset, scale.max, scale.min, steady]);

  // The first visible readings reveal once, independently of subsequent live frames.
  const readyToDraw = realtime ? range !== null : !empty;
  const instantDraw = reduced || (realtime && data.length === 1);
  useLayoutEffect(() => {
    if (!readyToDraw) return;
    if (instantDraw) { drawn.jump(1); return; }
    if (!inView || drawn.get() >= 1) return;
    const controls = animate(drawn, 1, draw);
    return () => controls.stop();
  }, [drawn, readyToDraw, inView, instantDraw]);

  // The crosshair appears on the first scrubbed point and glides between the ones after it; the tooltip follows on its own spring.
  const wasScrubbing = useRef(false);
  useEffect(() => {
    if (index === null || realtime) { wasScrubbing.current = false; return; }
    const to = last > 0 ? index / last : .5;
    if (reduced || !wasScrubbing.current) { cursor.jump(to); tipSpringX.jump(tipTargetX.get()); tipSpringY.jump(tipTargetY.get()); }
    wasScrubbing.current = true;
    if (reduced) return;
    const controls = animate(cursor, to, glide);
    return () => controls.stop();
  }, [cursor, index, last, reduced, tipSpringX, tipSpringY, tipTargetX, tipTargetY, realtime]);

  const onActive = useRef(onActiveChange);
  useLayoutEffect(() => { onActive.current = onActiveChange; });
  useEffect(() => { onActive.current?.(index, index === null ? null : data[index] ?? null); }, [index, signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const pointAt = (clientX: number) => {
    const rect = plot.current?.getBoundingClientRect();
    if (!rect?.width || last < 1) return Math.max(0, last);
    const frame = stream.current;
    if (frame) {
      const at = frame.view.start + ((clientX - rect.left) / rect.width) * (frame.view.end - frame.view.start);
      let nearest = frame.first;
      for (let i = nearest + 1; i < frame.coordinates.length && frame.coordinates[i] <= frame.view.end; i++) {
        if (Math.abs(frame.coordinates[i] - at) < Math.abs(frame.coordinates[nearest] - at)) nearest = i;
      }
      return nearest - frame.first;
    }
    return clamp(Math.round(((clientX - rect.left) / rect.width) * last), 0, last);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && scrubbing) { event.preventDefault(); setActive(null); return; }
    const from = index ?? last + 1, page = Math.max(1, Math.round(data.length / 6));
    const next = ({ ArrowLeft: from - 1, ArrowDown: from - 1, ArrowRight: index === null ? last : from + 1, ArrowUp: index === null ? last : from + 1, PageDown: from - page, PageUp: from + page, Home: 0, End: last } as Record<string, number>)[event.key];
    if (next === undefined || empty) return;
    event.preventDefault();
    setActive(clamp(next, 0, last));
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (empty) return;
    if (event.pointerType !== "mouse") event.currentTarget.setPointerCapture?.(event.pointerId);
    setActive(pointAt(event.clientX));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => { if (!empty && (event.pointerType === "mouse" || event.buttons)) setActive(pointAt(event.clientX)); };

  const format = (value: number, line: LineChartSeries) => `${formatValue ? formatValue(value, line) : grouped.format(value)}${unit ? ` ${unit}` : ""}`;
  const reading = index === null ? null : data[index];
  const readValue = (datum: LineChartDatum | undefined, line: LineChartSeries) => datum?.valueLabels?.[line.key] ?? (datum?.values[line.key] === null ? "无采样" : format(datum?.values[line.key] ?? 0, line));
  const valueText = reading ? `${reading.label}: ${visible.map(line => `${line.label} ${readValue(reading, line)}`).join(", ")}` : empty ? emptyLabel : `${visible.length} of ${series.length} series shown`;
  const summary = empty ? `${label}. ${emptyLabel}.` : `${label}, ${data[0]!.label} to ${data[last]!.label}. ${visible.map(line => `${line.label}, latest ${readValue(data[last], line)}`).join(". ")}.`;
  const picks = realtime ? [] : axisPicks(data, plotWidth);
  const allHidden = !empty && visible.length === 0;
  const tipX = reduced || realtime ? tipTargetX : tipSpringX, tipY = reduced || realtime ? tipTargetY : tipSpringY;

  return <figure ref={figure} className={[styles.figure, className].filter(Boolean).join(" ")} aria-label={label} aria-busy={loading || undefined}>
    {showLegend && <div className={styles.legend} role="group" aria-label={`${label} series`}>
      {series.map((line, at) => <button key={line.key} type="button" className={styles.toggle} aria-pressed={!hidden.includes(line.key)} onClick={() => toggle(line.key)} style={{ "--series": colorOf(line, at) } as CSSProperties}>
        <span className={styles.swatch} data-dashed={line.dashed || undefined} aria-hidden="true" />
        <span className={styles.toggleLabel}>{line.label}</span>
      </button>)}
    </div>}
    <div className={styles.chart} data-scrubbing={scrubbing || undefined} data-loading={loading || undefined}>
      <div ref={plot} className={styles.plot} style={{ height }} role="slider" tabIndex={empty ? -1 : 0} aria-label={`${label}, explore by ${categoryLabel.toLowerCase()}`} aria-orientation="horizontal" aria-valuemin={1} aria-valuemax={Math.max(1, data.length)} aria-valuenow={(index ?? last) + 1} aria-valuetext={valueText}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={event => { if (event.pointerType !== "mouse") setActive(null); }} onPointerCancel={() => setActive(null)} onPointerLeave={event => { if (event.pointerType === "mouse") setActive(null); }} onKeyDown={onKeyDown} onBlur={() => setActive(null)}
        onFocus={event => { if (event.currentTarget.matches(":focus-visible") && !empty) setActive(current => current ?? last); }}>
        <svg className={styles.svg} width="100%" height={height} aria-hidden="true" focusable="false">
          <defs><clipPath id={`${uid}-draw`} clipPathUnits="userSpaceOnUse"><rect ref={clip} x={realtime ? 0 : -8} y={-16} width={0} height={height + 32} /></clipPath></defs>
          <AnimatePresence initial={false}>{steady.ticks.slice(1).map(value => <Gridline key={value} value={value} scale={scale} height={height} />)}</AnimatePresence>
          <line className={styles.baseline} x1={0} x2="100%" y1={height - .5} y2={height - .5} />
          <line ref={crosshair} className={styles.crosshair} y1={TOP - 4} y2={height} />
          <g className={styles.series} clipPath={`url(#${uid}-draw)`}>
            <g ref={streamLayer}>
              {series.map((line, at) => <g key={line.key} ref={node => { if (node) groups.current.set(line.key, node); else groups.current.delete(line.key); }} style={{ "--series": colorOf(line, at) } as CSSProperties}>
                {(line.area ?? at === 0) && <path ref={node => { if (node) areas.current.set(line.key, node); else areas.current.delete(line.key); }} className={styles.area} />}
                <path ref={node => { if (node) lines.current.set(line.key, node); else lines.current.delete(line.key); }} className={styles.line} vectorEffect={realtime ? "non-scaling-stroke" : undefined} data-dashed={line.dashed || undefined} />
              </g>)}
            </g>
          </g>
          {realtime && series.map((line, at) => <circle key={line.key} ref={node => { if (node) heads.current.set(line.key, node); else heads.current.delete(line.key); }}
            r={2.75} fill={colorOf(line, at)} style={{ opacity: 0 }} />)}
          {series.map((line, at) => <circle key={line.key} ref={node => { if (node) dots.current.set(line.key, node); else dots.current.delete(line.key); }} className={styles.dot} r={4} data-hidden={hidden.includes(line.key) || undefined} style={{ "--series": colorOf(line, at) } as CSSProperties} />)}
        </svg>
        <motion.div ref={tip} className={styles.tooltip} style={{ x: tipX, y: tipY }} aria-hidden="true">
          <p className={styles.tipTitle}>{(reading ?? data[last])?.label ?? ""}</p>
          {visible.map(line => <p key={line.key} className={styles.tipRow} style={{ "--series": colorOf(line, series.indexOf(line)) } as CSSProperties}>
            <span className={styles.tipSwatch} data-dashed={line.dashed || undefined} />
            <span className={styles.tipName}>{line.label}</span>
            <span className={styles.tipValue} style={(reading ?? data[last])?.valueLabels ? { whiteSpace: "pre-line" } : undefined}>{readValue(reading ?? data[last], line)}</span>
          </p>)}
        </motion.div>
        <AnimatePresence initial={false}>
          {(empty || allHidden) && !loading && <motion.p key={empty ? "empty" : "hidden"} className={styles.message} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: fadeFast }}>{empty ? emptyLabel : "Choose a series to show"}</motion.p>}
          {loading && empty && <motion.span key="skeleton" className={styles.skeleton} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: fadeFast }} aria-hidden="true" />}
        </AnimatePresence>
      </div>
      <div className={styles.gutter} aria-hidden="true">
        <div className={styles.gutterSizer}>{steady.ticks.map(value => <span key={value} className={styles.tickText}>{formatTick(value)}</span>)}</div>
        <AnimatePresence initial={false}>{steady.ticks.map(value => <TickLabel key={value} value={value} scale={scale} height={height} format={formatTick} />)}</AnimatePresence>
      </div>
      <div className={styles.axis} data-stream={realtime || undefined} aria-hidden="true">
        {realtime ? streamTicks.map(tick => <span key={tick.key} className={styles.axisLabel}
          ref={node => {
            if (node) tickNodes.current.set(tick.key, { node, coordinate: tick.coordinate });
            else tickNodes.current.delete(tick.key);
          }}>{tick.text}</span>) : (
        <AnimatePresence initial={false}>
          {picks.map(at => { const share = last > 0 ? at / last : .5; return <motion.span key={`${data[at]!.key}:${data[at]!.axisLabel}`} className={styles.axisLabel} style={{ left: `${share * 100}%`, translateX: `${-share * 100}%` }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: fadeFast }} transition={{ duration: duration.standard, ease: [...ease.standard] }}>{data[at]!.axisLabel}</motion.span>; })}
        </AnimatePresence>
        )}
      </div>
    </div>
    <p className={styles.srOnly}>{summary}</p>
    {!empty && <div className={styles.srOnly}><table>
      <caption>{label}</caption>
      <thead><tr><th scope="col">{categoryLabel}</th>{series.map(line => <th key={line.key} scope="col">{line.label}</th>)}</tr></thead>
      <tbody>{data.map(item => <tr key={item.key}><th scope="row">{item.label}</th>{series.map(line => <td key={line.key}>{readValue(item, line)}</td>)}</tr>)}</tbody>
    </table></div>}
    <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{loading ? "Loading" : ""}</p>
  </figure>;
}

export default LineChart;
