// components/ChartsClient.tsx
'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartItem, ChartRow, ChartSeries } from '@/lib/chartData';
import {
  clamp,
  normalizeView,
  panView,
  pinchView,
  presetView,
  resolveView,
  zoomView,
  type View,
} from '@/lib/chartView';
import { dogHref } from '@/lib/dogHref';
import { isValidYMD } from '@/lib/dates';
import ChartsTouchDebug, { parseTouchDebugOptions } from '@/components/ChartsTouchDebug';

// ───────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────

const SERIES_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-chart-6)',
];
const OTHER_COLOR = 'var(--color-chart-other)';
const INK = 'var(--foreground)';
const SURFACE = 'var(--color-card)';
const GRID = 'var(--color-border)';
const AXIS_TEXT = 'var(--color-subtle-foreground)';

const Y_AXIS_WIDTH = 48;
const CHART_MARGIN = { top: 8, right: 12, bottom: 0, left: 0 };

const RANGES = [
  { key: '30', label: '30d', days: 30 },
  { key: '90', label: '90d', days: 90 },
  { key: '180', label: '180d', days: 180 },
  { key: 'all', label: 'All', days: null },
] as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Ctrl+wheel: one mouse notch (deltaY ≈ 100) changes the window by ~20%. */
const WHEEL_ZOOM_RATE = 0.002;
/** Wheel zoom eases toward its target by this fraction per animation frame. */
const ZOOM_EASE = 0.35;
/** Pointer must move this far before a press counts as a pan rather than a click. */
const DRAG_THRESHOLD_PX = 3;
const HINT_MS = 1600;
const HINT_COOLDOWN_MS = 8000;

// ───────────────────────────────────────────────────────────────
// Formatting helpers
// ───────────────────────────────────────────────────────────────

const fmtKcal = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtKg = (n: number) => String(Number(n.toFixed(2)));

function fmtShortDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function fmtMediumDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function colorForSlot(slot: number | null): string {
  return slot === null ? OTHER_COLOR : SERIES_COLORS[slot] ?? OTHER_COLOR;
}

// ───────────────────────────────────────────────────────────────
// Axis helpers
// ───────────────────────────────────────────────────────────────

type AxisConfig = { domain: [number, number]; ticks: number[] };

/** Rounds a numeric range out to nice, evenly spaced ticks. */
function makeNiceAxis(values: number[], opts?: { includeZero?: boolean }): AxisConfig | null {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;

  let minVal = Math.min(...nums);
  let maxVal = Math.max(...nums);
  if (opts?.includeZero) minVal = Math.min(0, minVal);

  if (minVal === maxVal) {
    const pad = minVal === 0 ? 1 : Math.abs(minVal) * 0.1;
    minVal -= pad;
    maxVal += pad;
  }

  const span = maxVal - minVal;
  const roughStep = span / 4; // aim for ~5 ticks
  const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(roughStep, 1e-6))));
  let step = pow10;
  for (const m of [1, 2, 2.5, 5, 10]) {
    const s = m * pow10;
    if (s >= roughStep) {
      step = s;
      break;
    }
  }

  const niceMin = Math.floor(minVal / step) * step;
  const niceMax = Math.ceil(maxVal / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(Number(v.toFixed(6)));

  return { domain: [niceMin, niceMax], ticks };
}

function dayOfWeek(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

type XTicks = { values: number[]; format: (i: number) => string };

/**
 * Picks calendar-aligned x ticks (days, Mondays or month starts) among rows
 * `from`..`to`, thinned so at most ~8 labels appear. Month ticks carry the
 * year on the first tick and whenever the year changes from the previous tick.
 */
function pickTicks(rows: ChartRow[], from: number, to: number): XTicks {
  if (to < from) return { values: [], format: () => '' };
  const MAX_TICKS = 8;
  const count = to - from + 1;

  let mode: 'day' | 'week' | 'month';
  const candidates: number[] = [];
  if (count <= 14) {
    mode = 'day';
    for (let i = from; i <= to; i++) candidates.push(i);
  } else if (count <= 70) {
    mode = 'week';
    for (let i = from; i <= to; i++) if (dayOfWeek(rows[i].ymd) === 1) candidates.push(i);
  } else {
    mode = 'month';
    for (let i = from; i <= to; i++) if (rows[i].ymd.endsWith('-01')) candidates.push(i);
  }

  const stride = Math.max(1, Math.ceil(candidates.length / MAX_TICKS));
  const values = candidates.filter((_, k) => k % stride === 0);

  const withYear = new Set<number>();
  values.forEach((i, k) => {
    if (k === 0 || rows[i].ymd.slice(0, 4) !== rows[values[k - 1]].ymd.slice(0, 4)) withYear.add(i);
  });

  const format = (i: number) => {
    const row = rows[i];
    if (!row) return '';
    const [y, m, d] = row.ymd.split('-').map(Number);
    if (mode === 'month') return withYear.has(i) ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1];
    return `${MONTHS[m - 1]} ${d}`;
  };

  return { values, format };
}

// ───────────────────────────────────────────────────────────────
// Plot geometry (both charts share margins and y-axis width, so the
// horizontal plot area of the wrapper element is the same for both).
// ───────────────────────────────────────────────────────────────

/** The plot's horizontal extent in client coordinates (the element may carry padding). */
/** True when an event target lies inside one of the two plot boxes (data-plot). */
function inPlot(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-plot]') !== null;
}

function plotBox(el: HTMLElement): { left: number; width: number } {
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const left = rect.left + padL + CHART_MARGIN.left + Y_AXIS_WIDTH;
  const width = rect.width - padL - padR - CHART_MARGIN.left - Y_AXIS_WIDTH - CHART_MARGIN.right;
  return { left, width: Math.max(1, width) };
}

function plotWidthOf(el: HTMLElement): number {
  return plotBox(el).width;
}

/** Horizontal position of a client x inside the plot, 0 = left edge, 1 = right edge. */
function fractionAt(el: HTMLElement, clientX: number): number {
  const b = plotBox(el);
  return clamp((clientX - b.left) / b.width, 0, 1);
}

// ───────────────────────────────────────────────────────────────
// Cursor: one vertical hairline in both charts.
// ───────────────────────────────────────────────────────────────

type CursorProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  points?: ReadonlyArray<{ x: number; y: number }>;
};

function CursorLine({ x, y, width, height, points }: CursorProps) {
  let cx: number | undefined;
  let top: number | undefined;
  let bottom: number | undefined;

  if (points && points.length >= 2) {
    cx = points[0].x;
    top = Math.min(points[0].y, points[1].y);
    bottom = Math.max(points[0].y, points[1].y);
  } else if (x != null && y != null && width != null && height != null) {
    cx = x + width / 2;
    top = y;
    bottom = y + height;
  }
  if (cx == null || top == null || bottom == null) return null;

  return (
    <line
      x1={cx}
      x2={cx}
      y1={top}
      y2={bottom}
      stroke={AXIS_TEXT}
      strokeWidth={1}
      pointerEvents="none"
    />
  );
}

const noTooltipContent = () => null;
const noLabel = () => '';

// ───────────────────────────────────────────────────────────────
// The two linked charts. Memoised so hover only re-renders the readout.
//
// Both charts share a numeric x axis (the row index) whose domain is the
// fractional zoom window: day i occupies [i - 0.5, i + 0.5]. Calories are
// stacked step areas, one path per food, rather than one rectangle per food
// per day: that keeps the DOM small enough to re-render every frame while
// zooming, and there are no per-day seams to anti-alias into stripes.
// ───────────────────────────────────────────────────────────────

type LinkedChartsProps = {
  /** Rows covering the window plus one on each side, so edge days are drawn in full. */
  rows: ChartRow[];
  domain: [number, number];
  ticks: XTicks;
  /** Small note beside the weight title: pin state, pin hint, or the custom window's dates. */
  note: string | null;
  series: ChartSeries[];
  showOther: boolean;
  /** Y axes come from the full history so zooming and panning never rescale the charts. */
  weightAxis: AxisConfig | null;
  kcalAxis: AxisConfig | null;
  /**
   * The day (index into `rows`) both cursors show. The charts take no pointer
   * input of their own (see .recharts-wrapper in globals.css): the parent turns
   * mouse and touch positions into a day and hands it down, so the two charts
   * can never disagree and no Recharts sync state is involved.
   */
  defaultIndex: number;
};

const LinkedCharts = memo(function LinkedCharts({
  rows,
  domain,
  ticks,
  note,
  series,
  showOther,
  weightAxis,
  kcalAxis,
  defaultIndex,
}: LinkedChartsProps) {
  const tickStyle = { fontSize: 12, fill: AXIS_TEXT };

  // The two plots share whatever height the parent gives, 40/60, with floors
  // below which the page scrolls instead of squashing them. Only the two plot
  // boxes (data-plot: the rectangle the chart is drawn in, axes included) take
  // gestures; titles, padding and margins keep the browser's default handling.
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col">
        {/* Weight */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="font-semibold text-sm">Weight (kg)</h2>
          {note && <span className="text-xs text-muted-foreground tabular-nums">{note}</span>}
        </div>
        {/* The chart containers are absolutely positioned inside their flex
            slots: a percentage height would not resolve against a slot whose
            size comes from flexing in a min-height box, but an absolute
            inset does. */}
        <div
          className="relative mt-2 min-h-[150px] flex-[2_1_0%]"
          style={{ touchAction: 'none' }}
          data-plot=""
        >
          {weightAxis ? (
            <div className="absolute inset-0">
            <ResponsiveContainer>
              <ComposedChart data={rows} margin={CHART_MARGIN} accessibilityLayer={false}>
                <CartesianGrid stroke={GRID} />
                {/* Same ticks as the chart below (they drive the grid), but no labels:
                    the calories chart carries the date labels for both. */}
                <XAxis
                  dataKey="i"
                  type="number"
                  domain={domain}
                  allowDataOverflow
                  ticks={ticks.values}
                  interval={0}
                  tickFormatter={noLabel}
                  tick={tickStyle}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  height={6}
                />
                <YAxis
                  width={Y_AXIS_WIDTH}
                  domain={weightAxis.domain}
                  ticks={weightAxis.ticks}
                  tick={tickStyle}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  content={noTooltipContent}
                  cursor={<CursorLine />}
                  defaultIndex={defaultIndex}
                  isAnimationActive={false}
                />
                {/* Straight segments between measurements, broken across long gaps. */}
                <Line
                  type="linear"
                  dataKey="weightLine"
                  stroke={INK}
                  strokeWidth={2}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
                {/* Dots only on the days that were actually measured. */}
                <Line
                  type="linear"
                  dataKey="weight"
                  stroke="none"
                  dot={{ r: 3.5, strokeWidth: 2, stroke: SURFACE, fill: INK }}
                  activeDot={{ r: 5.5, strokeWidth: 2, stroke: SURFACE, fill: INK }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              No weights yet.
            </div>
          )}
        </div>

        {/* Calories. No legend: the readout's chips name each colour on hover,
            and the two lines are keyed beside their values in the stats row. */}
        <h2 className="mt-6 font-semibold text-sm">Calories (kcal)</h2>
        <div
          className="relative mt-2 min-h-[180px] flex-[3_1_0%]"
          style={{ touchAction: 'none' }}
          data-plot=""
        >
          <div className="absolute inset-0">
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={CHART_MARGIN} accessibilityLayer={false}>
              <CartesianGrid stroke={GRID} />
              <XAxis
                dataKey="i"
                type="number"
                domain={domain}
                allowDataOverflow
                ticks={ticks.values}
                interval={0}
                tickFormatter={ticks.format}
                tick={tickStyle}
                tickLine={false}
                axisLine={{ stroke: GRID }}
                height={24}
              />
              <YAxis
                width={Y_AXIS_WIDTH}
                domain={kcalAxis ? kcalAxis.domain : [0, 'auto']}
                ticks={kcalAxis ? kcalAxis.ticks : undefined}
                tickFormatter={fmtKcal}
                tick={tickStyle}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={noTooltipContent}
                cursor={<CursorLine />}
                defaultIndex={defaultIndex}
                isAnimationActive={false}
              />
              {/* "step" switches value halfway between points, so day i fills [i-0.5, i+0.5]. */}
              {series.map((s, i) => (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  stackId="kcal"
                  type="step"
                  fill={SERIES_COLORS[i]}
                  fillOpacity={1}
                  stroke="none"
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
              ))}
              {showOther && (
                <Area
                  dataKey="other"
                  stackId="kcal"
                  type="step"
                  fill={OTHER_COLOR}
                  fillOpacity={1}
                  stroke="none"
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
              )}
              {/* The goal is read from the readout rather than drawn: at the
                  current goal it sits under the 7-day average anyway. */}
              <Line
                type="monotone"
                dataKey="avg7"
                stroke={INK}
                strokeWidth={2}
                dot={false}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
});

// ───────────────────────────────────────────────────────────────
// Readout card. Every part has a fixed height so the charts below never
// move as the hovered day changes: a short date line, a stats grid with
// three fixed cells, and a two-line strip of food chips packed to the
// measured width, with the overflow folded into one "+N more" chip.
// ───────────────────────────────────────────────────────────────

type PrevWeight = { kg: number; ymd: string } | null;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtReadoutDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${WEEKDAYS[dayOfWeek(ymd)]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

/** Text width in CSS pixels for a font shorthand, via a cached canvas. */
let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

const CHIP_LINES = 2;
const CHIP_GAP = 12; // gap-x-3 between chips
const CHIP_INNER = 6; // gap-1.5 inside a chip
const CHIP_SWATCH = 10; // h-2.5 w-2.5

type Chip = { label: string; kcal: string; pct: string; color: string | null };

function chipWidth(c: Chip, font: string): number {
  // The kcal figure is rendered medium weight; 5% covers the difference.
  const text = textWidth(c.label, font) + textWidth(c.kcal, font) * 1.05 + textWidth(c.pct, font);
  return (c.color ? CHIP_SWATCH + CHIP_INNER : 0) + text + 2 * CHIP_INNER;
}

/** Do these chips fit in CHIP_LINES lines of `width`? */
function chipsFit(chips: Chip[], width: number, font: string): boolean {
  let line = 1;
  let used = 0;
  for (const c of chips) {
    const w = Math.min(chipWidth(c, font), width);
    if (used === 0) used = w;
    else if (used + CHIP_GAP + w <= width) used += CHIP_GAP + w;
    else {
      line++;
      used = w;
      if (line > CHIP_LINES) return false;
    }
  }
  return true;
}

/** The longest prefix of items that fits, with the rest folded into a "+N more" chip. */
function packChips(items: ChartItem[], total: number, width: number, font: string): Chip[] {
  const pct = (kcal: number) => `· ${Math.round((kcal / total) * 100)}%`;
  for (let k = items.length; k >= 0; k--) {
    const chips: Chip[] = items.slice(0, k).map((it) => ({
      label: it.name,
      kcal: fmtKcal(it.kcal),
      pct: pct(it.kcal),
      color: colorForSlot(it.slot),
    }));
    const rest = items.slice(k);
    if (rest.length) {
      const kcal = rest.reduce((a, it) => a + it.kcal, 0);
      chips.push({ label: `+${rest.length} more`, kcal: fmtKcal(kcal), pct: pct(kcal), color: null });
    }
    if (width <= 0 || chipsFit(chips, width, font)) return chips;
  }
  return [];
}

function Readout({
  dogId,
  row,
  prevWeight,
}: {
  dogId: string;
  row: ChartRow;
  prevWeight: PrevWeight;
}) {
  // Width and font of the chip strip, so packing uses real text widths.
  const listRef = useRef<HTMLUListElement>(null);
  const [box, setBox] = useState<{ width: number; font: string }>({ width: 0, font: '14px Arial' });
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const width = el.clientWidth;
      setBox((b) => (b.width === width && b.font === font ? b : { width, font }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const chips = useMemo(
    () => packChips(row.items, row.total, box.width, box.font),
    [row, box]
  );

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div className="truncate font-semibold">{fmtReadoutDate(row.ymd)}</div>
        <Link
          href={dogHref(dogId, `/day/${row.ymd}`)}
          className="shrink-0 text-sm text-muted-foreground underline"
        >
          Open day →
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 text-sm sm:grid-cols-3">
        <div className="truncate">
          <span className="text-muted-foreground">Weight </span>
          {row.weight !== null ? (
            <span className="font-medium tabular-nums">{fmtKg(row.weight)} kg</span>
          ) : prevWeight ? (
            <>
              <span className="font-medium tabular-nums">{fmtKg(prevWeight.kg)} kg</span>
              <span className="text-subtle-foreground"> ({fmtShortDate(prevWeight.ymd)})</span>
            </>
          ) : (
            <span className="text-subtle-foreground">—</span>
          )}
        </div>
        <div className="truncate">
          <span className="text-muted-foreground">Calories </span>
          {row.total > 0 ? (
            <span className="font-medium tabular-nums">{fmtKcal(row.total)}</span>
          ) : (
            <span className="text-subtle-foreground">—</span>
          )}
          {row.goal !== null && (
            <span className="text-subtle-foreground tabular-nums"> / {fmtKcal(row.goal)} kcal</span>
          )}
        </div>
        <div className="truncate">
          <span
            className="mr-1.5 inline-block h-0.5 w-3.5 align-middle"
            style={{ background: INK }}
            aria-hidden
          />
          <span className="text-muted-foreground">7-day avg </span>
          {row.avg7 !== null ? (
            <span className="font-medium tabular-nums">{fmtKcal(row.avg7)}</span>
          ) : (
            <span className="text-subtle-foreground">—</span>
          )}
        </div>
      </div>

      {/* Exactly two lines (h-11); packing decides what fits, overflow is a safety net. */}
      <ul
        ref={listRef}
        className="mt-2 flex h-11 flex-wrap content-start gap-x-3 gap-y-1 overflow-hidden text-sm"
      >
        {row.items.length === 0 ? (
          <li className="text-subtle-foreground">Nothing logged this day.</li>
        ) : (
          chips.map((c, i) => (
            <li key={i} className="flex max-w-full items-center gap-1.5">
              {c.color && (
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: c.color }}
                />
              )}
              <span className={c.color ? 'truncate' : 'truncate text-subtle-foreground'}>
                {c.label}
              </span>
              <span
                className={
                  'shrink-0 tabular-nums ' + (c.color ? 'font-medium' : 'text-subtle-foreground')
                }
              >
                {c.kcal}
              </span>
              <span className="shrink-0 tabular-nums text-subtle-foreground">{c.pct}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// Page client
// ───────────────────────────────────────────────────────────────

/** Initial window from ?from=YYYY-MM-DD&to=YYYY-MM-DD, if both fall inside the data. */
function viewFromParams(from: string | null, to: string | null, rows: ChartRow[]): View | null {
  if (!from || !to || !isValidYMD(from) || !isValidYMD(to)) return null;
  const a = rows.findIndex((r) => r.ymd === from);
  const b = rows.findIndex((r) => r.ymd === to);
  if (a < 0 || b < a) return null;
  return normalizeView(a, b - a + 1, rows.length);
}

export default function ChartsClient({
  dogId,
  rows,
  series,
  backHref,
}: {
  dogId: string;
  rows: ChartRow[];
  series: ChartSeries[];
  /** "Back to day" link target, when the page was opened from a day. */
  backHref: string | null;
}) {
  const searchParams = useSearchParams();
  const debugTouch = searchParams.get('debug') === 'touch';
  const debugOptions = useMemo(
    () => parseTouchDebugOptions((k) => searchParams.get(k)),
    [searchParams]
  );
  const [view, setView] = useState<View | null>(() =>
    viewFromParams(searchParams.get('from'), searchParams.get('to'), rows)
  );
  // The hovered day is kept when the pointer leaves the charts, so the readout
  // (and "Open day") stay on what you were looking at; `hovering` drives the hint.
  const [hoverYmd, setHoverYmd] = useState<string | null>(null);
  const [hovering, setHovering] = useState(false);
  const [lockedYmd, setLockedYmd] = useState<string | null>(null);
  const [hint, setHint] = useState(false);

  const n = rows.length;

  // The fractional window drives the x domain; the integer window (res) drives
  // ticks, labels and the URL.
  const start = view ? view.start : 0;
  const len = view ? view.len : n;
  const domain = useMemo<[number, number]>(() => [start - 0.5, start + len - 0.5], [start, len]);
  const res = resolveView(view, n);
  const from = res.start;
  const to = res.start + res.len - 1;

  // Rows handed to the charts: the window plus one day each side, so the days
  // cut by the window's edges are still drawn (the axis clips them).
  const sliceFrom = Math.max(0, Math.floor(start) - 1);
  const sliceTo = Math.min(n, Math.ceil(start + len) + 1);
  const visible = useMemo(() => rows.slice(sliceFrom, sliceTo), [rows, sliceFrom, sliceTo]);

  const ticks = useMemo(() => pickTicks(rows, from, to), [rows, from, to]);

  // Last measured weight before each row (carry-forward over the full history).
  const prevWeights = useMemo(() => {
    const out: PrevWeight[] = [];
    let last: PrevWeight = null;
    for (const r of rows) {
      out.push(last);
      if (r.weight !== null) last = { kg: r.weight, ymd: r.ymd };
    }
    return out;
  }, [rows]);

  const fullIndex = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => m.set(r.ymd, i));
    return m;
  }, [rows]);

  const showOther = useMemo(() => rows.some((r) => r.other > 0), [rows]);

  // Y axes from the whole history: zoom and pan only ever move sideways, and
  // any two periods are drawn to the same scale.
  const weightAxis = useMemo(
    () => makeNiceAxis(rows.map((r) => r.weight).filter((v): v is number => v !== null)),
    [rows]
  );
  const kcalAxis = useMemo(() => {
    const vals: number[] = [];
    for (const r of rows) {
      if (r.total > 0) vals.push(r.total);
      if (r.avg7 !== null) vals.push(r.avg7);
    }
    return makeNiceAxis(vals, { includeZero: true });
  }, [rows]);

  // ── Keep the window in the URL (no navigation, so no server round-trip). ──
  useEffect(() => {
    if (n === 0) return;
    const t = setTimeout(() => {
      const url = new URL(window.location.href);
      if (view) {
        url.searchParams.set('from', rows[from].ymd);
        url.searchParams.set('to', rows[to].ymd);
      } else {
        url.searchParams.delete('from');
        url.searchParams.delete('to');
      }
      if (url.href !== window.location.href) window.history.replaceState(null, '', url);
    }, 250);
    return () => clearTimeout(t);
  }, [view, rows, from, to, n]);

  // ── Hint shown when someone plain-scrolls over the charts. ──
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintShownAt = useRef(0);
  const showHint = useCallback(() => {
    const now = Date.now();
    if (now - hintShownAt.current < HINT_COOLDOWN_MS) return;
    hintShownAt.current = now;
    setHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(false), HINT_MS);
  }, []);
  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  // ── Fit the charts to the viewport: measure where they start (the readout
  // above them changes height) and let CSS take the rest of the screen. ──
  const gestureRef = useRef<HTMLDivElement>(null);

  // The day under a client x, from the plot's geometry and the current domain.
  const ymdAtClientX = useCallback(
    (clientX: number): string | null => {
      const el = gestureRef.current;
      if (!el || n === 0) return null;
      const f = fractionAt(el, clientX);
      const x = domain[0] + f * (domain[1] - domain[0]);
      return rows[clamp(Math.round(x), 0, n - 1)]?.ymd ?? null;
    },
    [domain, n, rows]
  );
  // The touch listeners are bound once; they read the latest mapping through a ref.
  const ymdAtRef = useRef(ymdAtClientX);
  useEffect(() => {
    ymdAtRef.current = ymdAtClientX;
  }, [ymdAtClientX]);

  const [chartsTop, setChartsTop] = useState<number | null>(null);
  useEffect(() => {
    const el = gestureRef.current;
    if (!el) return;
    const measure = () => {
      setChartsTop(Math.round(el.getBoundingClientRect().top + window.scrollY));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (el.parentElement) ro.observe(el.parentElement);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [n]);

  // ── Zoom gestures: Ctrl+wheel / trackpad pinch on desktop, two-finger pinch on touch. ──
  const viewRef = useRef<View | null>(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Wheel zoom eases toward a target over a few frames instead of jumping a
  // whole notch at a time. Any other gesture cancels the easing first.
  const anim = useRef<{ cur: View | null; target: View | null; raf: number | null }>({
    cur: null,
    target: null,
    raf: null,
  });
  const stopZoomAnim = useCallback(() => {
    const a = anim.current;
    if (a.raf !== null) cancelAnimationFrame(a.raf);
    a.raf = null;
    a.target = null;
  }, []);
  useEffect(() => stopZoomAnim, [stopZoomAnim]);

  useEffect(() => {
    const el = gestureRef.current;
    if (!el || n === 0) return;

    const full = { start: 0, len: n };
    const step = () => {
      const a = anim.current;
      const cur = a.cur ?? full;
      const target = a.target ?? full;
      const nextLen = cur.len + (target.len - cur.len) * ZOOM_EASE;
      const nextStart = cur.start + (target.start - cur.start) * ZOOM_EASE;
      const close =
        Math.abs(target.len - nextLen) < 0.05 && Math.abs(target.start - nextStart) < 0.05;
      const next = close ? a.target : normalizeView(nextStart, nextLen, n);
      a.cur = next;
      setView(next);
      if (close) {
        a.raf = null;
        a.target = null;
      } else {
        a.raf = requestAnimationFrame(step);
      }
    };

    // Chrome fixes a wheel sequence's cancelability on its first event: if a
    // plain page scroll runs straight into a Ctrl+wheel/pinch, the zoom events
    // can no longer be cancelled and the browser zooms the page as well. So
    // every wheel event over the charts is cancelled, and plain scrolling is
    // forwarded to the page by hand, which feels the same.
    let lastZoomAt = 0;
    const onWheel = (e: WheelEvent) => {
      if (!inPlot(e.target)) return; // titles and margins: the browser's own scrolling
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
      const dx = e.deltaMode === 1 ? e.deltaX * 33 : e.deltaMode === 2 ? e.deltaX * 800 : e.deltaX;
      e.preventDefault();
      if (!e.ctrlKey) {
        // Fingers rarely lift cleanly: stray scroll events inside a pinch are dropped.
        if (Date.now() - lastZoomAt < 250) return;
        window.scrollBy({ top: dy, left: dx, behavior: 'auto' });
        showHint();
        return;
      }
      lastZoomAt = Date.now();
      const factor = clamp(Math.exp(dy * WHEEL_ZOOM_RATE), 0.5, 2);
      const f = fractionAt(el, e.clientX);
      const a = anim.current;
      const base = a.raf !== null ? a.target : viewRef.current;
      a.target = zoomView(base, n, f, factor);
      if (a.raf === null) {
        a.cur = viewRef.current;
        a.raf = requestAnimationFrame(step);
      }
    };

    // Two-finger pinch. These run in the capture phase and stop propagation so
    // Recharts' own one-finger scrubbing doesn't jump between the fingers.
    let pinch: { dist: number; f: number; view: View | null } | null = null;
    const touchInfo = (e: TouchEvent) => {
      const a = e.touches[0];
      const b = e.touches[1];
      return {
        dist: Math.max(1, Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)),
        f: fractionAt(el, (a.clientX + b.clientX) / 2),
      };
    };
    // Touch events are delivered to the element each finger landed on, so a
    // second finger that lands in the card padding or page margin would never
    // reach a listener on the charts. Listen on the document instead and take
    // any two-finger gesture that has at least one finger over the charts.
    // One finger is left to Recharts (scrub); it never scrolls the page here.
    const touchesHere = (e: TouchEvent) => Array.from(e.touches).some((t) => inPlot(t.target));
    // Diagnostics: present only when the ?debug=touch overlay is mounted.
    const dbg = (s: string) => window.__chartsTouchLog?.(s);
    const fmtView = (v: View | null) =>
      v ? `start=${v.start.toFixed(2)} len=${v.len.toFixed(2)}` : 'all';
    // One finger over the charts scrubs: the day under it becomes the hover.
    const scrub = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!pinch && inPlot(t.target)) {
        const ymd = ymdAtRef.current(t.clientX);
        if (ymd) setHoverYmd(ymd);
      }
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        scrub(e);
        return;
      }
      if (e.touches.length !== 2) return;
      if (!touchesHere(e)) {
        dbg('  gesture: touchstart n=2 ignored (no finger over charts)');
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      stopZoomAnim();
      pinch = { ...touchInfo(e), view: viewRef.current };
      dbg(`  gesture: pinch start dist=${pinch.dist.toFixed(1)} f=${pinch.f.toFixed(3)} view ${fmtView(pinch.view)}`);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        scrub(e);
        return;
      }
      if (e.touches.length !== 2) return;
      if (!touchesHere(e)) {
        dbg('  gesture: touchmove n=2 ignored (no finger over charts)');
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (!pinch) {
        pinch = { ...touchInfo(e), view: viewRef.current };
        dbg(`  gesture: pinch start (from move) dist=${pinch.dist.toFixed(1)} f=${pinch.f.toFixed(3)}`);
        return;
      }
      const { dist, f } = touchInfo(e);
      const next = pinchView(pinch.view, n, pinch.dist, pinch.f, dist, f);
      dbg(`  gesture: pinch move dist=${dist.toFixed(1)} f=${f.toFixed(3)} -> ${fmtView(next)}`);
      setView(next);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        if (pinch) dbg(`  gesture: pinch end (${e.type}, ${e.touches.length} left)`);
        pinch = null;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('touchstart', onTouchStart, { passive: false, capture: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    document.addEventListener('touchend', onTouchEnd, { capture: true });
    document.addEventListener('touchcancel', onTouchEnd, { capture: true });
    return () => {
      stopZoomAnim();
      el.removeEventListener('wheel', onWheel);
      document.removeEventListener('touchstart', onTouchStart, { capture: true });
      document.removeEventListener('touchmove', onTouchMove, { capture: true });
      document.removeEventListener('touchend', onTouchEnd, { capture: true });
      document.removeEventListener('touchcancel', onTouchEnd, { capture: true });
    };
  }, [n, showHint, stopZoomAnim]);

  // ── Drag to pan with the mouse when zoomed in. ──
  const dragMovedRef = useRef(false);
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = gestureRef.current;
      const base = viewRef.current;
      if (!el || !base || e.pointerType !== 'mouse' || e.button !== 0) return;
      if (!inPlot(e.target)) return;
      stopZoomAnim();
      const startX = e.clientX;
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        if (Math.abs(dx) > DRAG_THRESHOLD_PX) dragMovedRef.current = true;
        if (!dragMovedRef.current) return;
        setView(panView(base, n, -dx / plotWidthOf(el)));
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        // The click that follows a drag must not pin or release; clear after it fires.
        setTimeout(() => {
          dragMovedRef.current = false;
        }, 0);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    },
    [n, stopZoomAnim]
  );

  // ── Hover and pin, computed from the pointer's x in the plot. ──
  const onPointerMoveArea = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== 'mouse' || !inPlot(e.target)) return;
      const ymd = ymdAtClientX(e.clientX);
      if (ymd) setHoverYmd(ymd);
    },
    [ymdAtClientX]
  );
  const onClickArea = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (dragMovedRef.current) return; // the click that ends a drag
      if (!inPlot(e.target)) return;
      setLockedYmd((cur) => (cur !== null ? null : ymdAtClientX(e.clientX)));
    },
    [ymdAtClientX]
  );
  const onEnterArea = useCallback(() => setHovering(true), []);
  const onLeaveArea = useCallback(() => setHovering(false), []);

  const titleRow = (children?: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="mr-auto text-2xl font-bold">Charts</h1>
      {children}
      {backHref && (
        <Link href={backHref} className="rounded border px-2 py-1 text-sm hover:bg-control-hover">
          ‹ Back to day
        </Link>
      )}
    </div>
  );

  if (n === 0) {
    return (
      <>
        {titleRow()}
        <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          Nothing to chart yet. Log some entries or add a weight to get started.
        </section>
      </>
    );
  }

  const inWindow = (ymd: string | null) => {
    if (ymd === null) return false;
    const i = fullIndex.get(ymd);
    return i !== undefined && i >= from && i <= to;
  };
  // A pin or hover that fell outside the current window is ignored rather than cleared.
  const locked = inWindow(lockedYmd) ? lockedYmd : null;
  const hover = inWindow(hoverYmd) ? hoverYmd : null;
  const activeIdx = locked !== null ? fullIndex.get(locked)! : hover !== null ? fullIndex.get(hover)! : to;
  const defaultIndex = activeIdx - sliceFrom;

  const presetActive = (days: number | null) =>
    days === null
      ? view === null
      : view !== null && res.len === Math.min(days, n) && res.start === n - res.len;
  const customWindow = !RANGES.some((r) => presetActive(r.days));

  const rangeControl = (
    <div role="group" aria-label="Date range" className="flex gap-1.5 text-sm">
      {RANGES.map((r) => {
        const active = presetActive(r.days);
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => {
              stopZoomAnim();
              setView(presetView(r.days, n));
            }}
            aria-pressed={active}
            className={
              'rounded border px-2 py-1 hover:bg-control-hover focus:outline-none focus:ring-2 focus:ring-control-ring ' +
              (active ? 'bg-nav-item-active font-medium' : '')
            }
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );

  const note =
    locked !== null
      ? 'pinned · click to release'
      : hovering
        ? 'click to pin'
        : customWindow
          ? `${fmtMediumDate(rows[from].ymd)} – ${fmtMediumDate(rows[to].ymd)}`
          : null;

  return (
    <>
      {titleRow(rangeControl)}
      {debugTouch && <ChartsTouchDebug options={debugOptions} />}

      <section className="rounded-lg border bg-card p-4">
        <Readout
          dogId={dogId}
          row={rows[activeIdx]}
          prevWeight={prevWeights[activeIdx]}
        />
        {/* At least the rest of the viewport below this point (see .charts-fit);
            a minimum rather than a height, so when the screen is shorter than
            the plots' own floors the box grows and the page scrolls instead of
            the bottom plot spilling into the card padding. */}
        <div
          ref={gestureRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMoveArea}
          onClick={onClickArea}
          onMouseEnter={onEnterArea}
          onMouseLeave={onLeaveArea}
          className="charts-fit relative mt-6 flex select-none flex-col"
          style={{
            cursor: view ? 'grab' : undefined,
            minHeight: `calc(100dvh - ${chartsTop ?? 360}px - var(--charts-bottom))`,
          }}
        >
          <LinkedCharts
            rows={visible}
            domain={domain}
            ticks={ticks}
            note={note}
            series={series}
            showOther={showOther}
            weightAxis={weightAxis}
            kcalAxis={kcalAxis}
            defaultIndex={defaultIndex}
          />
          {hint && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="rounded border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow">
                Ctrl + scroll to zoom
              </span>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
