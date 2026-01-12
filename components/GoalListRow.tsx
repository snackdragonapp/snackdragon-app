// components/GoalListRow.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import ListRow from '@/components/primitives/ListRow';
import DeleteButton from '@/components/primitives/DeleteButton';
import { deleteGoalAction } from '@/app/dog/[dogId]/goals/actions';
import { formatYMDLong } from '@/lib/dates';
import RefreshOnActionComplete from '@/components/RefreshOnActionComplete';
import Alert from '@/components/primitives/Alert';
import { parsePositiveDecimal } from '@/lib/quantity';

type Goal = {
  id: string;
  start_date: string;
  kcal_target: string | number;
  note: string | null;
};

export default function GoalListRow({
  goal,
  current = false,
  updateAction,
}: {
  goal: Goal;
  current?: boolean;
  // Server Action passed down from the Server Component (page)
  updateAction: (formData: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="py-2">
        <EditRow
          goal={goal}
          updateAction={updateAction}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <ViewRow
      goal={goal}
      current={current}
      onEdit={() => setEditing(true)}
    />
  );
}

/* ---------- View row (clean, scannable) ---------- */

function ViewRow({
  goal,
  current,
  onEdit,
}: {
  goal: Goal;
  current: boolean;
  onEdit: () => void;
}) {
  const startLabel = formatYMDLong(String(goal.start_date));
  const target = Number(goal.kcal_target);

  return (
    <ListRow
      handle={null}
      content={
        <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1">
          <div>
            <div className="font-medium">
              {startLabel}
              {current ? (
                <span className="ml-2 text-xs rounded border px-1 py-0.5 bg-chip-face">
                  Current
                </span>
              ) : null}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {goal.note ? <>{goal.note}</> : null}
            </div>
          </div>
          <div className="flex items-center justify-end">
            <div className="text-sm font-medium tabular-nums">
              {target} kcal/day
            </div>
          </div>
        </div>
      }
      actions={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit goal"
            title="Edit goal"
            className="inline-flex h-11 w-11 md:h-7 md:w-7 items-center justify-center hover:bg-control-hover focus:outline-none focus:ring-2 focus:ring-control-ring rounded"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-5 w-5 md:h-4 md:w-4"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>

          <DeleteButton
            formAction={deleteGoalAction}
            hidden={{ id: goal.id }}
            title="Delete goal"
            aria-label="Delete goal"
            confirmMessage="Delete this goal?"
            withRefresh={250}
          />
        </div>
      }
    />
  );
}

/* ---------- Edit row (in-place) ---------- */

// Exit edit mode after a successful submit settles
function PendingWatcher({ onSettled }: { onSettled: () => void }) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending) {
      onSettled();
    }
    wasPending.current = pending;
  }, [pending, onSettled]);

  return null;
}

function EditRow({
  goal,
  updateAction,
  onDone,
  onCancel,
}: {
  goal: Goal;
  updateAction: (formData: FormData) => Promise<void>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const initialStart = String(goal.start_date ?? '');
  const initialTarget = String(goal.kcal_target ?? '');
  const initialNote = goal.note ?? '';

  const [startDate, setStartDate] = useState(initialStart);
  const [kcalTarget, setKcalTarget] = useState(initialTarget);
  const [note, setNote] = useState(initialNote);

  const parsedTarget = useMemo(
    () => parsePositiveDecimal(kcalTarget),
    [kcalTarget]
  );

  const isInt = parsedTarget != null && Number.isInteger(parsedTarget);
  const targetOutOfRange =
    parsedTarget != null && (parsedTarget < 200 || parsedTarget > 5000);

  const targetBlank = kcalTarget.trim().length === 0;

  const targetError =
    targetBlank || parsedTarget == null || !isInt || targetOutOfRange;

  const startDateError = startDate.trim().length === 0;

  const hasError = targetError || startDateError;

  const buttonBase =
    'rounded border px-3 py-1 text-sm hover:bg-control-hover';
  const disabledButton =
    'opacity-60 cursor-not-allowed hover:bg-transparent';

  return (
    <form
      action={updateAction}
      className="space-y-3 rounded-lg border bg-card p-3"
      onSubmit={(e) => {
        // Prevent “Enter submits anyway” when fields are invalid.
        if (hasError) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <input type="hidden" name="id" value={goal.id} />

      <div className="grid grid-cols-[2fr_1fr] md:grid-cols-[1fr_1fr_1fr_1fr] gap-2 items-start">
        <div>
          <label className="text-xs text-muted-foreground">Start date</label>
          <input
            name="start_date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.currentTarget.value)}
            className="w-full border rounded px-2 py-1 text-sm"
            required
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

        {hasError ? (
          <div className="col-span-full">
            <Alert tone="error">
              Please fix the values. Start date is required, and the target must
              be a whole number between 200 and 5000 kcal/day.
            </Alert>
          </div>
        ) : null}

        <div className="col-span-full flex items-center justify-end gap-1 pt-1">
          <button
            type="submit"
            className={`${buttonBase} ${hasError ? disabledButton : ''}`}
            title="Save changes"
            disabled={hasError}
          >
            Save
          </button>
          <button
            type="button"
            className={buttonBase}
            title="Cancel editing"
            onClick={() => {
              setStartDate(initialStart);
              setKcalTarget(initialTarget);
              setNote(initialNote);
              onCancel();
            }}
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Refresh page data on action settle + leave edit mode */}
      <PendingWatcher onSettled={onDone} />
      <RefreshOnActionComplete debounceMs={250} />
    </form>
  );
}
