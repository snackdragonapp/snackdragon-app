// components/GoalAddForm.tsx
'use client';

import { useState, useMemo } from 'react';
import RefreshOnActionComplete from '@/components/RefreshOnActionComplete';
import Alert from '@/components/primitives/Alert';
import { parsePositiveDecimal } from '@/lib/quantity';

function localTodayYMD(): string {
  const d = new Date(); // local device time (reflects travel automatically)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function GoalAddForm({
  dogId,
  defaultDate,
  next,
  createAction,
}: {
  dogId: string;
  defaultDate?: string;
  next?: string | null;
  createAction: (formData: FormData) => Promise<void>;
}) {
  const [startDate, setStartDate] = useState(() => {
    const s = typeof defaultDate === 'string' ? defaultDate.trim() : '';
    return s ? s : localTodayYMD();
  });
  const [kcalTarget, setKcalTarget] = useState('');
  const [note, setNote] = useState('');

  const parsedTarget = useMemo(
    () => parsePositiveDecimal(kcalTarget),
    [kcalTarget]
  );

  const isInt = parsedTarget != null && Number.isInteger(parsedTarget);
  const targetOutOfRange =
    parsedTarget != null && (parsedTarget < 200 || parsedTarget > 5000);

  const targetError =
    kcalTarget.trim().length > 0 &&
    (parsedTarget == null || !isInt || targetOutOfRange);

  const hasError = targetError;

  const buttonBase =
    'rounded border px-3 py-1 text-sm hover:bg-control-hover';
  const disabledButton =
    'opacity-60 cursor-not-allowed hover:bg-transparent';

  return (
    <div className="rounded-lg border bg-card p-4">
      <form
        action={createAction}
        className="grid grid-cols-[2fr_1fr] md:grid-cols-[1fr_1fr_1fr_1fr] gap-2 items-start"
      >
        <input type="hidden" name="dog_id" value={dogId} />
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <div>
          <label className="text-xs text-muted-foreground">Start date</label>
          <input
            name="start_date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.currentTarget.value)}
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground">
            Target (kcal/day)
          </label>
          <input
            name="kcal_target"
            type="text"
            inputMode="decimal"
            value={kcalTarget}
            onChange={(e) => setKcalTarget(e.currentTarget.value)}
            className="w-full border rounded px-2 py-1 text-sm"
            placeholder="1350"
          />
          {targetError ? (
            <p className="mt-1 text-[11px] text-alert-error-fg">
              Enter a whole number between 200 and 5000 (e.g., 1350).
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-subtle-foreground">
              200–5000 kcal/day
            </p>
          )}
        </div>

        <div className="col-span-full">
          <label className="text-xs text-muted-foreground">
            Note (optional)
          </label>
          <input
            name="note"
            className="w-full border rounded px-2 py-1 text-sm"
            placeholder="e.g., post-illness adjustment"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
        </div>

        {/* Global error alert */}
        {hasError && (
          <div className="col-span-full">
            <Alert tone="error">
              Please fix the target value. It must be a whole number between
              200 and 5000 kcal/day.
            </Alert>
          </div>
        )}

        <div className="col-span-full flex gap-2">
          <button
            type="submit"
            name="intent"
            value="create"
            className={`${buttonBase} ${hasError ? disabledButton : ''}`}
            disabled={hasError}
          >
            Save
          </button>
          {next && (
            <button
              type="submit"
              name="intent"
              value="create_return"
              className={`${buttonBase} ${
                hasError ? disabledButton : ''
              }`}
              title="Save and return to the day you came from"
              disabled={hasError}
            >
              Save &amp; return
            </button>
          )}
        </div>

        <RefreshOnActionComplete debounceMs={250} />
      </form>
    </div>
  );
}
