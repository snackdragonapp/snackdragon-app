// components/GoalListRow.tsx
'use client';

import ListRow from '@/components/primitives/ListRow';
import DeleteButton from '@/components/primitives/DeleteButton';
import { deleteGoalAction } from '@/app/dog/[dogId]/goals/actions';
import { formatYMDLong } from '@/lib/dates';

type Goal = {
  id: string;
  start_date: string;
  kcal_target: string | number;
  note: string | null;
};

export default function GoalListRow({
  goal,
  current = false,
}: {
  goal: Goal;
  current?: boolean;
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
        <DeleteButton
          formAction={deleteGoalAction}
          hidden={{ id: goal.id }}
          title="Delete goal"
          aria-label="Delete goal"
          confirmMessage="Delete this goal?"
          withRefresh={250}
        />
      }
    />
  );
}
