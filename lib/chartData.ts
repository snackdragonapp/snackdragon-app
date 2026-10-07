// lib/chartData.ts
// Pure helpers that turn raw rows (weights, goals, entries) into the one-row-per-day
// table the charts page renders. Both charts consume the same rows, which is what
// keeps their x-axes, grid lines and hover cursors aligned.

import { addDaysYMD } from '@/lib/dates';

/** Foods that get their own stacked series; everything else folds into "Other". */
export const MAX_SERIES = 6;

/** The weight line only bridges gaps up to this many days; longer gaps are left open. */
export const WEIGHT_GAP_DAYS = 14;

export type SeriesKey = `s${number}`;

export type ChartSeries = { key: SeriesKey; label: string };

export type ChartItem = {
  name: string;
  kcal: number;
  /** Index into the series list, or null when the item is folded into "Other". */
  slot: number | null;
};

export type ChartRow = {
  /** Position in the full row array; the charts' numeric x value. */
  i: number;
  ymd: string;
  /** Weight measured that day, or null. */
  weight: number | null;
  /**
   * Straight-line value for the weight series: the measurement on measured days,
   * a linear interpolation on days inside a short gap, null across long gaps so
   * the line breaks instead of implying a trend nobody measured.
   */
  weightLine: number | null;
  /** Total kcal logged that day (planned + eaten), 0 when nothing was logged. */
  total: number;
  /** Active goal for that day, or null before the first goal. */
  goal: number | null;
  /** Mean of the logged days in the trailing 7-day window, or null if none. */
  avg7: number | null;
  /** kcal from foods outside the top series. */
  other: number;
  /** Everything logged that day, highest kcal first. */
  items: ChartItem[];
} & { [k: SeriesKey]: number };

export type WeightInput = { measured_at: string; weight_kg: number };
export type GoalInput = { start_date: string; kcal_target: number };
export type EntryInput = {
  date: string;
  name: string;
  catalog_item_id: string | null;
  kcal: number;
};

export const seriesKey = (i: number): SeriesKey => `s${i}`;

/** Catalog id when present, otherwise the (normalised) free-text name. */
function itemKey(e: EntryInput): string {
  return e.catalog_item_id ?? `name:${e.name.trim().toLowerCase()}`;
}

type Agg = { name: string; kcal: number; lastDate: string };

function bump(map: Map<string, Agg>, key: string, e: EntryInput) {
  const cur = map.get(key);
  if (!cur) {
    map.set(key, { name: e.name, kcal: e.kcal, lastDate: e.date });
    return;
  }
  cur.kcal += e.kcal;
  // Keep the most recent spelling as the display name.
  if (e.date >= cur.lastDate) {
    cur.lastDate = e.date;
    cur.name = e.name;
  }
}

export function buildChartData(input: {
  weights: WeightInput[];
  goals: GoalInput[];
  entries: EntryInput[];
}): { rows: ChartRow[]; series: ChartSeries[] } {
  const { weights, goals, entries } = input;

  // Weight per day; a later row for the same day wins.
  const weightByDay = new Map<string, number>();
  for (const w of weights) {
    if (Number.isFinite(w.weight_kg)) weightByDay.set(w.measured_at, w.weight_kg);
  }

  // Entries grouped by day and item, plus whole-history totals per item for ranking.
  const byDay = new Map<string, Map<string, Agg>>();
  const totals = new Map<string, Agg>();
  for (const e of entries) {
    if (!Number.isFinite(e.kcal)) continue;
    const key = itemKey(e);
    let day = byDay.get(e.date);
    if (!day) {
      day = new Map();
      byDay.set(e.date, day);
    }
    bump(day, key, e);
    bump(totals, key, e);
  }

  const allDays = [...weightByDay.keys(), ...byDay.keys()];
  if (allDays.length === 0) return { rows: [], series: [] };

  let minYmd = allDays[0];
  let maxYmd = allDays[0];
  for (const d of allDays) {
    if (d < minYmd) minYmd = d;
    if (d > maxYmd) maxYmd = d;
  }

  // Rank foods by total kcal across the whole history so colours follow the food,
  // not its rank within whatever range is currently displayed.
  const ranked = [...totals.entries()].sort(
    (a, b) => b[1].kcal - a[1].kcal || a[1].name.localeCompare(b[1].name)
  );
  const slotByKey = new Map<string, number>();
  const series: ChartSeries[] = [];
  ranked.slice(0, MAX_SERIES).forEach(([key, agg], i) => {
    slotByKey.set(key, i);
    series.push({ key: seriesKey(i), label: agg.name });
  });

  const goalsAsc = [...goals].sort((a, b) => a.start_date.localeCompare(b.start_date));
  let gi = -1;

  const rows: ChartRow[] = [];
  for (let ymd = minYmd; ymd <= maxYmd; ymd = addDaysYMD(ymd, 1)) {
    while (gi + 1 < goalsAsc.length && goalsAsc[gi + 1].start_date <= ymd) gi++;
    const goal = gi >= 0 ? goalsAsc[gi].kcal_target : null;

    const day = byDay.get(ymd);
    const items: ChartItem[] = day
      ? [...day.entries()]
          .map(([key, agg]) => ({
            name: agg.name,
            kcal: agg.kcal,
            slot: slotByKey.get(key) ?? null,
          }))
          .sort((a, b) => b.kcal - a.kcal || a.name.localeCompare(b.name))
      : [];

    const row = {
      i: rows.length,
      ymd,
      weight: weightByDay.get(ymd) ?? null,
      weightLine: null,
      total: 0,
      goal,
      avg7: null,
      other: 0,
      items,
    } as ChartRow;
    for (let i = 0; i < series.length; i++) row[seriesKey(i)] = 0;

    for (const it of items) {
      row.total += it.kcal;
      if (it.slot === null) row.other += it.kcal;
      else row[seriesKey(it.slot)] += it.kcal;
    }

    // Trailing 7-day mean over logged days only (unlogged days are usually gaps,
    // not fasts, so they must not drag the average down).
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, rows.length - 6); j < rows.length; j++) {
      if (rows[j].total > 0) {
        sum += rows[j].total;
        n++;
      }
    }
    if (row.total > 0) {
      sum += row.total;
      n++;
    }
    row.avg7 = n > 0 ? sum / n : null;

    rows.push(row);
  }

  // Weight line: connect consecutive measurements only when they are close enough.
  let prevIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const w = rows[i].weight;
    if (w === null) continue;
    rows[i].weightLine = w;
    if (prevIdx >= 0 && i - prevIdx <= WEIGHT_GAP_DAYS) {
      const w0 = rows[prevIdx].weight as number;
      for (let k = prevIdx + 1; k < i; k++) {
        rows[k].weightLine = w0 + ((w - w0) * (k - prevIdx)) / (i - prevIdx);
      }
    }
    prevIdx = i;
  }

  return { rows, series };
}
