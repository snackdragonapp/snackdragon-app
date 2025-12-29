// components/DogListRow.tsx
'use client';

import { useRef, useState } from 'react';
import ListRow from '@/components/primitives/ListRow';
import DeleteButton from '@/components/primitives/DeleteButton';
import Pencil from '@/components/icons/Pencil';
import { archiveDogAction, renameDogAction } from '@/app/dogs/actions';

type Dog = {
  id: string;
  name: string;
  created_at: string;
  archived_at: string | null;
};

export default function DogListRow({ dog, next }: { dog: Dog; next: string | null }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="py-2">
        <EditRow dog={dog} next={next} onCancel={() => setEditing(false)} />
      </li>
    );
  }

  return <ViewRow dog={dog} next={next} onEdit={() => setEditing(true)} />;
}

function ViewRow({
  dog,
  next,
  onEdit,
}: {
  dog: Dog;
  next: string | null;
  onEdit: () => void;
}) {
  const editBtn =
    'inline-flex h-11 w-11 md:h-7 md:w-7 items-center justify-center rounded ' +
    'hover:bg-control-hover focus:outline-none focus:ring-2 focus:ring-control-ring';

  const dims = 'h-5 w-5 md:h-4 md:w-4';

  return (
    <ListRow
      handle={null}
      content={
        <div className="grid gap-0.5">
          <div className="font-medium">{dog.name}</div>
          <div className="text-xs text-muted-foreground">Active</div>
        </div>
      }
      actions={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className={editBtn}
            title="Rename dog"
            aria-label="Rename dog"
          >
            <Pencil className={dims} aria-hidden="true" />
          </button>

          <DeleteButton
            formAction={archiveDogAction}
            hidden={{ id: dog.id, next }}
            title="Archive dog"
            aria-label="Archive dog"
            confirmMessage="Archive this dog?"
            withRefresh={false}
          />
        </div>
      }
    />
  );
}

function EditRow({
  dog,
  next,
  onCancel,
}: {
  dog: Dog;
  next: string | null;
  onCancel: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  const buttonBase = 'rounded border px-3 py-1 text-sm hover:bg-control-hover';

  return (
    <form
      ref={formRef}
      action={renameDogAction}
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <input type="hidden" name="id" value={dog.id} />
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="flex flex-col">
        <label htmlFor={`dog-name-${dog.id}`} className="text-xs text-muted-foreground">
          Dog name
        </label>
        <input
          id={`dog-name-${dog.id}`}
          name="name"
          required
          className="w-full border rounded px-2 py-1 text-sm"
          defaultValue={dog.name}
          autoComplete="off"
          autoFocus
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <button type="submit" className={buttonBase} title="Save name">
          Save
        </button>
        <button
          type="button"
          className={buttonBase}
          title="Cancel"
          onClick={() => {
            formRef.current?.reset();
            onCancel();
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
