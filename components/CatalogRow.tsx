// components/CatalogRow.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import RefreshOnActionComplete from '@/components/RefreshOnActionComplete';
import ListRow from '@/components/primitives/ListRow';
import DeleteButton from '@/components/primitives/DeleteButton';
import { deleteCatalogItemAction } from '@/app/dog/[dogId]/catalog/actions';
import { useFormStatus } from 'react-dom';
import {
  CatalogItemFields,
  type CatalogItemFieldsProps,
} from '@/components/CatalogAddForm';
import Alert from '@/components/primitives/Alert';

type Item = {
  id: string;
  name: string;
  unit: string;
  kcal_per_unit: number | string;
  default_qty: number | string;
  created_at: string;
};

function initialLabelQtyForUnit(unit: string): number {
  const u = unit.trim().toLowerCase();
  if (
    u === 'g' ||
    u === 'gram' ||
    u === 'grams' ||
    u === 'ml' ||
    u === 'milliliter' ||
    u === 'milliliters' ||
    u === 'millilitre'
  ) {
    return 100;
  }
  return 1;
}

export default function CatalogRow({
  item,
  updateAction,
  dogId,
}: {
  item: Item;
  // Server Action passed down from the Server Component (page)
  updateAction: (formData: FormData) => Promise<void>;
  dogId: string;
}) {
  const [editing, setEditing] = useState(false);
  const defaultQty = Number(item.default_qty ?? 0);
  const perUnit = Number(item.kcal_per_unit ?? 0);
  const approxKcal = Number.isFinite(defaultQty * perUnit)
    ? (defaultQty * perUnit).toFixed(2)
    : '';

  if (editing) {
    return (
      <li className="py-2">
        <EditRow
          item={item}
          updateAction={updateAction}
          dogId={dogId}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <ViewRow
      item={item}
      dogId={dogId}
      approxKcal={approxKcal}
      onEdit={() => setEditing(true)}
    />
  );
}

/* ---------- View row (clean, scannable) ---------- */

function ViewRow({
  item,
  dogId,
  approxKcal,
  onEdit,
}: {
  item: Item;
  dogId: string;
  approxKcal: string;
  onEdit: () => void;
}) {
  const defaultQty = Number(item.default_qty ?? 0);
  const perUnit = Number(item.kcal_per_unit ?? 0);

  return (
    <ListRow
      handle={null}
      content={
        <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1">
          <div>
            <div className="font-medium">{item.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {defaultQty.toString()} {item.unit} · {perUnit} kcal/{item.unit}
              {approxKcal ? (
                <>
                  {' '}
                  &nbsp;≈&nbsp;
                  <span className="tabular-nums">{approxKcal}</span> kcal
                </>
              ) : null}
            </div>
          </div>
          <div className="flex items-center justify-end">
            <div className="text-sm font-medium tabular-nums">
              {/* optional: right-side emphasis; keep or remove as you prefer */}
            </div>
          </div>
        </div>
      }
      actions={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit item"
            title="Edit item"
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
            formAction={deleteCatalogItemAction}
            hidden={{ id: item.id, dog_id: dogId }}
            title="Delete item"
            aria-label="Delete item"
            confirmMessage="Delete this catalog item? (Past entries remain unchanged)"
            withRefresh={250}
          />
        </div>
      }
    />
  );
}

/* ---------- Edit row (friendly label-style inputs) ---------- */

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

function buildInitialFields(item: Item): CatalogItemFieldsProps {
  const perUnit = Number(item.kcal_per_unit ?? 0);
  const defaultQty = Number(item.default_qty ?? 0);

  // Choose a convenient label amount (1 for most units, 100 for g/ml).
  const labelAmount = initialLabelQtyForUnit(item.unit);
  const labelKcal =
    Number.isFinite(perUnit * labelAmount) && perUnit > 0
      ? (perUnit * labelAmount).toFixed(2)
      : '';

  const defaultQtyStr = defaultQty > 0 ? defaultQty.toString() : '';

  return {
    initialName: item.name,
    initialUnit: item.unit,
    initialLabelAmount: labelAmount.toString(),
    initialLabelKcal: labelKcal,
    initialDefaultQty: defaultQtyStr,
  };
}

function EditRow({
  item,
  updateAction,
  dogId,
  onDone,
  onCancel,
}: {
  item: Item;
  updateAction: (formData: FormData) => Promise<void>;
  dogId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const initialFields = buildInitialFields(item);
  const [hasNumericError, setHasNumericError] = useState(false);

  const buttonBase = 'rounded border px-3 py-1 text-sm hover:bg-control-hover';
  const disabledButton = 'opacity-60 cursor-not-allowed hover:bg-transparent';

  return (
    <form
      ref={formRef}
      action={updateAction}
      className="space-y-3 rounded-lg border bg-card p-3"
      onSubmit={(e) => {
        // Prevent “Enter submits anyway” when fields are invalid.
        if (hasNumericError) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="dog_id" value={dogId} />

      <CatalogItemFields
       {...initialFields}
        onValidationChange={setHasNumericError}
     />

      {hasNumericError ? (
       <Alert tone="error">
          Some values are invalid. Servings can use positive numbers or simple
          fractions like <code>3/4</code> or <code>1 1/2</code>, and calories
          must be positive numbers.
        </Alert>
      ) : null}

      {/* Row: Save + Cancel */}
      <div className="flex items-center justify-end gap-1 pt-1">
        <button
          type="submit"
          className={`${buttonBase} ${hasNumericError ? disabledButton : ''}`}
          title="Save changes"
          disabled={hasNumericError}
        >
          Save
        </button>
        <button
          type="button"
          className={buttonBase}
          title="Cancel editing"
          onClick={() => {
            // Reset inputs back to defaults and exit edit mode
            formRef.current?.reset();
            onCancel();
          }}
        >
          Cancel
        </button>
      </div>

      {/* Refresh page data on action settle + leave edit mode */}
      <PendingWatcher onSettled={onDone} />
      <RefreshOnActionComplete debounceMs={250} />
    </form>
  );
}
