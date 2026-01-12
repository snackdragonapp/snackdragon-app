// components/WeightListRow.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import ListRow from '@/components/primitives/ListRow';
import DeleteButton from '@/components/primitives/DeleteButton';
import { deleteWeightAction } from '@/app/dog/[dogId]/weights/actions';
import { formatYMDLong } from '@/lib/dates';
import RefreshOnActionComplete from '@/components/RefreshOnActionComplete';
import Alert from '@/components/primitives/Alert';
import { parsePositiveDecimal } from '@/lib/quantity';

type Weight = {
  id: string;
  measured_at: string;
  method: string;
  weight_kg: string | number;
  me_kg: string | number | null;
  me_and_dog_kg: string | number | null;
  note: string | null;
};

export default function WeightListRow({
  w,
  updateAction,
}: {
  w: Weight;
  // Server Action passed down from the Server Component (page)
  updateAction: (formData: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="py-2">
        <EditRow
          w={w}
          updateAction={updateAction}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return <ViewRow w={w} onEdit={() => setEditing(true)} />;
}

/* ---------- View row (clean, scannable) ---------- */

function ViewRow({
  w,
  onEdit,
}: {
  w: Weight;
  onEdit: () => void;
}) {
  const label = formatYMDLong(String(w.measured_at));
  const kg = Number(w.weight_kg);

  return (
    <ListRow
      handle={null}
      content={
        <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1">
          <div>
            <div className="font-medium">{label}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {w.note ? <>{w.note}</> : null}
            </div>
          </div>
          <div className="flex items-center justify-end">
            <div className="text-sm font-medium tabular-nums">
              {kg.toFixed(1)} kg
            </div>
          </div>
        </div>
      }
      actions={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit weight entry"
            title="Edit weight entry"
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
            formAction={deleteWeightAction}
            hidden={{ id: w.id }}
            title="Delete weight entry"
            aria-label="Delete weight entry"
            confirmMessage="Delete this weight entry?"
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
  w,
  updateAction,
  onDone,
  onCancel,
}: {
  w: Weight;
  updateAction: (formData: FormData) => Promise<void>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const initialDate = String(w.measured_at ?? '');
  const initialMethod: 'vet' | 'home_diff' =
    w.method === 'home_diff' ? 'home_diff' : 'vet';

  const initialWeight =
    initialMethod === 'vet' ? String(Number(w.weight_kg ?? '')) : '';

  const initialYou =
    initialMethod === 'home_diff' && w.me_kg != null
      ? String(Number(w.me_kg))
      : '';

  const initialYouDog =
    initialMethod === 'home_diff' && w.me_and_dog_kg != null
      ? String(Number(w.me_and_dog_kg))
      : '';

  const initialNote = w.note ?? '';

  const [date, setDate] = useState(initialDate);
  const [method, setMethod] = useState<'vet' | 'home_diff'>(initialMethod);
  const [unit, setUnit] = useState<'kg' | 'lb'>('kg');

  const [you, setYou] = useState(initialYou);
  const [youDog, setYouDog] = useState(initialYouDog);
  const [weight, setWeight] = useState(initialWeight);
  const [note, setNote] = useState(initialNote);

  // Parse numeric inputs as decimals (no fraction syntax).
  const parsedWeight = useMemo(
    () => parsePositiveDecimal(weight),
    [weight]
  );
  const parsedYou = useMemo(() => parsePositiveDecimal(you), [you]);
  const parsedYouDog = useMemo(
    () => parsePositiveDecimal(youDog),
    [youDog]
  );

  const dateError = date.trim().length === 0;

  const weightBlank =
    method === 'vet' && weight.trim().length === 0;

  const weightError =
    method === 'vet' && (weightBlank || parsedWeight == null);

  const youBlank =
    method === 'home_diff' && you.trim().length === 0;

  const youError =
    method === 'home_diff' && (youBlank || parsedYou == null);

  const youDogBlank =
    method === 'home_diff' && youDog.trim().length === 0;

  const youDogError =
    method === 'home_diff' && (youDogBlank || parsedYouDog == null);

  const diffError =
    method === 'home_diff' &&
    parsedYou != null &&
    parsedYouDog != null &&
    parsedYouDog <= parsedYou;

  const hasError =
    dateError || weightError || youError || youDogError || diffError;

  const previewKg = useMemo(() => {
    if (method === 'vet') {
      if (parsedWeight == null) return null;
      const w = parsedWeight;
      return unit === 'lb' ? w * 0.45359237 : w;
    } else {
      if (parsedYou == null || parsedYouDog == null) return null;
      if (parsedYouDog <= parsedYou) return null;
      const diff = parsedYouDog - parsedYou;
      return unit === 'lb' ? diff * 0.45359237 : diff;
    }
  }, [method, unit, parsedWeight, parsedYou, parsedYouDog]);

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
      <input type="hidden" name="id" value={w.id} />

      <div className="grid grid-cols-[1fr_1fr_1fr_1fr] md:grid-cols-[1fr_1fr_1fr_1fr_1fr] gap-2 items-start">
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground">Date</label>
          <input
            name="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.currentTarget.value)}
            className="w-full border rounded px-2 py-1 text-sm"
            required
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Method</label>
          <select
            name="method"
            value={method}
            onChange={(e) =>
              setMethod(e.currentTarget.value as 'vet' | 'home_diff')
            }
            className="w-full border rounded px-2 py-1 text-sm"
          >
            <option value="vet">Vet scale</option>
            <option value="home_diff">At home (difference)</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Units</label>
          <select
            name="unit"
            value={unit}
            onChange={(e) =>
              setUnit(e.currentTarget.value as 'kg' | 'lb')
            }
            className="w-full border rounded px-2 py-1 text-sm"
          >
            <option value="kg">kg</option>
            <option value="lb">lb</option>
          </select>
        </div>

        {/* Method-specific inputs */}
        {method === 'vet' ? (
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">
              Dog weight
            </label>
            <input
              name="weight"
              type="text"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.currentTarget.value)}
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder={unit === 'kg' ? '12.3' : '27.1'}
            />
            {weightError ? (
              <p className="mt-1 text-[11px] text-alert-error-fg">
                Enter a positive number (e.g., 12.3).
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-subtle-foreground">
                Dog weight only
              </p>
            )}
          </div>
        ) : (
          <>
            <div>
              <label className="text-xs text-muted-foreground">You</label>
              <input
                name="me"
                type="text"
                inputMode="decimal"
                value={you}
                onChange={(e) => setYou(e.currentTarget.value)}
                className="w-full border rounded px-2 py-1 text-sm"
                placeholder={unit === 'kg' ? '78.2' : '172.5'}
              />
              {youError ? (
                <p className="mt-1 text-[11px] text-alert-error-fg">
                  Enter a positive number.
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-subtle-foreground">
                  Your weight alone
                </p>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                You + dog
              </label>
              <input
                name="me_plus_dog"
                type="text"
                inputMode="decimal"
                value={youDog}
                onChange={(e) => setYouDog(e.currentTarget.value)}
                className="w-full border rounded px-2 py-1 text-sm"
                placeholder={unit === 'kg' ? '90.6' : '199.9'}
              />
              {youDogError ? (
                <p className="mt-1 text-[11px] text-alert-error-fg">
                  Enter a positive number.
                </p>
              ) : diffError ? (
                <p className="mt-1 text-[11px] text-alert-error-fg">
                  “You + dog” must be greater than “You”.
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-subtle-foreground">
                  Combined weight
                </p>
              )}
            </div>
          </>
        )}

        <div className="col-span-full">
          <label className="text-xs text-muted-foreground">
            Note (optional)
          </label>
          <input
            name="note"
            className="w-full border rounded px-2 py-1 text-sm"
            placeholder="e.g., after dinner, different scale"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
        </div>

        {/* Global error alert */}
        {hasError ? (
          <div className="col-span-full">
            <Alert tone="error">
              Please fix the values. Date is required, weights must be positive
              decimal numbers, and “You + dog” must be greater than “You”.
            </Alert>
          </div>
        ) : null}

        <div className="col-span-full flex items-center justify-end gap-2 pt-1">
          {previewKg != null && (
            <span className="text-xs text-muted-foreground">
              Preview:&nbsp;
              <span className="font-medium tabular-nums">
                {previewKg.toFixed(2)} kg
              </span>
            </span>
          )}

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
              setDate(initialDate);
              setMethod(initialMethod);
              setUnit('kg');
              setYou(initialYou);
              setYouDog(initialYouDog);
              setWeight(initialWeight);
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
