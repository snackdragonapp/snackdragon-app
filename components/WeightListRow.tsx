// components/WeightListRow.tsx
'use client';

import ListRow from '@/components/primitives/ListRow';
import DeleteButton from '@/components/primitives/DeleteButton';
import { deleteWeightAction } from '@/app/dog/[dogId]/weights/actions';
import { formatYMDLong } from '@/lib/dates';

type Weight = {
  id: string;
  measured_at: string;
  weight_kg: string | number;
  note: string | null;
};

export default function WeightListRow({ w }: { w: Weight }) {
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
        <DeleteButton
          formAction={deleteWeightAction}
          hidden={{ id: w.id }}
          title="Delete weight entry"
          aria-label="Delete weight entry"
          confirmMessage="Delete this weight entry?"
          withRefresh={250}
        />
      }
    />
  );
}
