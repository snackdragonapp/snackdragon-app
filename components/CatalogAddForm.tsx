// components/CatalogAddForm.tsx
'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import RefreshOnActionComplete from '@/components/RefreshOnActionComplete';
import { parsePositiveNumber, parsePositiveDecimal } from '@/lib/quantity';
import Alert from '@/components/primitives/Alert';

export type CatalogItemFieldsProps = {
  initialName?: string;
  initialUnit?: string;
  initialLabelAmount?: string;
  initialLabelKcal?: string;
  initialDefaultQty?: string;
  /** Optional callback so parent can know if any numeric field is invalid. */
  onValidationChange?: (hasError: boolean) => void;
};

export function CatalogItemFields({
  initialName = '',
  initialUnit = '',
  initialLabelAmount = '',
  initialLabelKcal = '',
  initialDefaultQty = '',
  onValidationChange,
}: CatalogItemFieldsProps) {
  const [name, setName] = useState(initialName);
  const [unit, setUnit] = useState(initialUnit);
  const [labelAmount, setLabelAmount] = useState(initialLabelAmount);
  const [labelKcal, setLabelKcal] = useState(initialLabelKcal);
  const [defaultQty, setDefaultQty] = useState(initialDefaultQty);

  // Parsed numeric values
  // Servings may be fractional:
  const parsedLabelAmount = useMemo(
    () => parsePositiveNumber(labelAmount),
    [labelAmount]
  );
  const parsedDefaultQty = useMemo(
    () => parsePositiveNumber(defaultQty),
    [defaultQty]
  );
  // Calories must be decimal-only:
  const parsedLabelKcal = useMemo(
    () => parsePositiveDecimal(labelKcal),
    [labelKcal]
  );

  // Error flags: only treat as an error if the field is non-empty but unparsable.
  const labelAmountError =
    labelAmount.trim().length > 0 && parsedLabelAmount == null;
  const labelKcalError =
    labelKcal.trim().length > 0 && parsedLabelKcal == null;
  const defaultQtyError =
    defaultQty.trim().length > 0 && parsedDefaultQty == null;

  const hasNumericError =
    labelAmountError || labelKcalError || defaultQtyError;

  // Let the parent know when error state changes
  useEffect(() => {
    onValidationChange?.(hasNumericError);
  }, [hasNumericError, onValidationChange]);

  // Derived values for preview (only when parsed and valid)
  const perUnit = useMemo(() => {
    if (parsedLabelAmount == null || parsedLabelKcal == null) return null;
    return parsedLabelKcal / parsedLabelAmount;
  }, [parsedLabelAmount, parsedLabelKcal]);

  const defaultKcal = useMemo(() => {
    if (perUnit == null || parsedDefaultQty == null) return null;
    return perUnit * parsedDefaultQty;
  }, [perUnit, parsedDefaultQty]);

  const unitLabel = unit.trim() || 'unit';

  return (
    <>
      {/* Name / description */}
      <div>
        <label className="block text-xs text-muted-foreground">Name</label>
        <input
          name="name"
          required
          className="w-full border rounded px-2 py-1 text-sm"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
      </div>

      {/* From the package */}
      <fieldset className="space-y-2 border rounded px-3 py-2">
        <legend className="text-xs text-muted-foreground px-1">
          From the package
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-[1.1fr_0.9fr_1fr] gap-2 items-start">
          {/* Serving size (amount on package) */}
          <div>
            <label className="block text-xs text-muted-foreground">
              Serving size
            </label>
            <input
              name="label_amount"
              type="text"
              inputMode="decimal"
              value={labelAmount}
              onChange={(e) => setLabelAmount(e.currentTarget.value)}
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="1 or 3/4"
              required
            />
            {labelAmountError ? (
              <p className="mt-1 text-[11px] text-alert-error-fg">
                Enter a positive number or simple fraction like 3/4 or 1 1/2.
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-subtle-foreground">
                e.g., 1, 3/4, 100
              </p>
            )}
          </div>

          {/* Unit (used for both package + default serving) */}
          <div>
            <label className="block text-xs text-muted-foreground">Unit</label>
            <input
              name="unit"
              value={unit}
              onChange={(e) => setUnit(e.currentTarget.value)}
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="cup"
              required
              autoCapitalize="none"
            />
            <p className="mt-1 text-[11px] text-subtle-foreground">
              e.g., cup, g, piece
            </p>
          </div>

          {/* Calories for that serving */}
          <div>
            <label className="block text-xs text-muted-foreground">
              Calories
            </label>
            <input
              name="label_kcal"
              type="text"
              inputMode="decimal"
              value={labelKcal}
              onChange={(e) => setLabelKcal(e.currentTarget.value)}
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="365"
              required
            />
            {labelKcalError ? (
              <p className="mt-1 text-[11px] text-alert-error-fg">
                Enter a positive number (e.g., 365).
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-subtle-foreground">
                kcal for that serving
              </p>
            )}
          </div>
        </div>
      </fieldset>

      {/* Your default serving */}
      <fieldset className="space-y-2 border rounded px-3 py-2">
        <legend className="text-xs text-muted-foreground px-1">
          Your default serving (for this dog)
        </legend>

        <div className="grid grid-cols-1 sm:grid-cols-[1.1fr_0.9fr_1fr] gap-2 items-start">
          <div>
            <label className="block text-xs text-muted-foreground">
              Default serving
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                name="default_qty"
                type="text"
                inputMode="decimal"
                value={defaultQty}
                onChange={(e) => setDefaultQty(e.currentTarget.value)}
                className="w-full border rounded px-2 py-1 text-sm"
                placeholder="0.5 or 3/4"
                required
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {unitLabel}
              </span>
            </div>
            {defaultQtyError ? (
              <p className="mt-1 text-[11px] text-alert-error-fg">
                Enter a positive number or simple fraction like 0.5 or 3/4.
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-subtle-foreground">
                Your usual serving for this dog
              </p>
            )}
          </div>

          <div className="hidden sm:block" />
          <div className="hidden sm:block" />
        </div>
      </fieldset>

      {/* Preview combining both groups */}
      <div className="text-xs text-muted-foreground">
        {perUnit == null ? (
          <span>
            Fill in serving size and calories from the package to see a preview.
          </span>
        ) : (
          <>
            1 {unitLabel} ≈{' '}
            <span className="tabular-nums">{perUnit.toFixed(2)}</span> kcal
            {defaultKcal != null && defaultQty && !defaultQtyError && (
              <>
                {' · '}Default:{' '}
                <span className="tabular-nums">{defaultQty}</span> {unitLabel} ≈{' '}
                <span className="tabular-nums">{defaultKcal.toFixed(0)}</span>{' '}
                kcal
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** Watch the nearest form; when pending -> settled, call onComplete(). */
function ResetOnSubmit({ onComplete }: { onComplete: () => void }) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending) {
      onComplete();
    }
    wasPending.current = pending;
  }, [pending, onComplete]);

  return null;
}

export default function CatalogAddForm({
  next,
  createAction,
}: {
  next?: string | null;
  createAction: (formData: FormData) => Promise<void>;
}) {
  // Bump this key to force CatalogItemFields to remount -> clears its internal state.
  const [resetKey, setResetKey] = useState(0);
  const [hasNumericError, setHasNumericError] = useState(false);

  const buttonBase =
    'rounded border px-3 py-1 text-sm hover:bg-control-hover';
  const disabledButton =
    'opacity-60 cursor-not-allowed hover:bg-transparent';

  return (
    <div className="rounded-lg border bg-card p-4">
      <form action={createAction} className="space-y-3">
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <CatalogItemFields
          key={resetKey}
          onValidationChange={setHasNumericError}
        />

        {/* Global alert if any numeric field is invalid */}
        {hasNumericError && (
          <Alert tone="error">
            Some values are invalid. Servings can use positive numbers or simple
            fractions like <code>3/4</code> or <code>1 1/2</code>, and calories
            must be positive numbers.
          </Alert>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="submit"
            name="intent"
            value="create"
            className={`${buttonBase} ${
              hasNumericError ? disabledButton : ''
            }`}
            disabled={hasNumericError}
          >
            Create
          </button>
          {next && (
            <button
              type="submit"
              name="intent"
              value="create_return"
              className={`${buttonBase} ${
                hasNumericError ? disabledButton : ''
              }`}
              title="Create this item and return to the day you came from"
              disabled={hasNumericError}
            >
              Create &amp; return
            </button>
          )}
        </div>

        {/* When the server action settles, both:
             - Refresh page data, and
             - Reset the form fields to their initial, blank state. */}
        <ResetOnSubmit onComplete={() => setResetKey((k) => k + 1)} />
        <RefreshOnActionComplete debounceMs={250} />
      </form>
    </div>
  );
}
