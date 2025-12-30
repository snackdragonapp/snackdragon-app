// components/WeightAddForm.tsx
'use client';

import { useMemo, useState } from 'react';
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

export default function WeightAddForm({
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
  const [date, setDate] = useState(() => {
    const s = typeof defaultDate === 'string' ? defaultDate.trim() : '';
    return s ? s : localTodayYMD();
  });
  const [method, setMethod] = useState<'vet' | 'home_diff'>('vet');
  const [unit, setUnit] = useState<'kg' | 'lb'>('kg');
  const [you, setYou] = useState('');
  const [youDog, setYouDog] = useState('');
  const [weight, setWeight] = useState('');

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

  const weightError =
    method === 'vet' &&
    weight.trim().length > 0 &&
    parsedWeight == null;

  const youError =
    method === 'home_diff' &&
    you.trim().length > 0 &&
    parsedYou == null;

  const youDogError =
    method === 'home_diff' &&
    youDog.trim().length > 0 &&
    parsedYouDog == null;

  const diffError =
    method === 'home_diff' &&
    parsedYou != null &&
    parsedYouDog != null &&
    parsedYouDog <= parsedYou;

  const hasNumericError =
    weightError || youError || youDogError || diffError;

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
    <div className="rounded-lg border bg-card p-4">
      <form
        action={createAction}
        className="grid grid-cols-[1fr_1fr_1fr_1fr] md:grid-cols-[1fr_1fr_1fr_1fr_1fr] gap-2 items-start"
      >
        <input type="hidden" name="dog_id" value={dogId} />
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <div className="col-span-2">
          <label className="text-xs text-muted-foreground">Date</label>
          <input
            name="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.currentTarget.value)}
            className="w-full border rounded px-2 py-1 text-sm"
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
          />
        </div>

        {/* Global numeric error alert */}
        {hasNumericError && (
          <div className="col-span-full">
            <Alert tone="error">
              Some weights are invalid. Please use positive decimal numbers
              (e.g., 12.5), and ensure “You + dog” is greater than “You”.
            </Alert>
          </div>
        )}

        <div className="col-span-full flex gap-2 items-center">
          <button
            type="submit"
            name="intent"
            value="create"
            className={`${buttonBase} ${
              hasNumericError ? disabledButton : ''
            }`}
            disabled={hasNumericError}
          >
            Save
          </button>
          {next && (
            <button
              type="submit"
              name="intent"
              value="create_return"
              className={`${buttonBase} ${
                hasNumericError ? disabledButton : ''
              }`}
              title="Save and return to the selected day"
              disabled={hasNumericError}
            >
              Save &amp; return
            </button>
          )}
          {previewKg != null && (
            <span className="text-xs text-muted-foreground">
              Preview:&nbsp;
              <span className="font-medium tabular-nums">
                {previewKg.toFixed(2)} kg
              </span>
            </span>
          )}
        </div>

        <RefreshOnActionComplete debounceMs={250} />
      </form>
    </div>
  );
}
