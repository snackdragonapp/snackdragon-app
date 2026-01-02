'use client';

import * as React from 'react';
import Link from 'next/link';
import Alert from '@/components/primitives/Alert';
import { addSetupDogAction } from './actions';

type Dog = { id: string; name: string | null };

export default function DogSetupBuilder(props: {
  initialDogs: Dog[];
  continueHref: string;
}) {
  const { initialDogs, continueHref } = props;

  const [dogs, setDogs] = React.useState<Dog[]>(initialDogs);
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const inputRef = React.useRef<HTMLInputElement>(null);

  const hasAnyDog = dogs.length > 0;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required.');
      return;
    }

    startTransition(() => {
      void (async () => {
        const res = await addSetupDogAction({ name: trimmed });

        if (!res.ok) {
          setError(res.error);
          return;
        }

        setDogs((prev) => [...prev, res.dog]);
        setName('');
        requestAnimationFrame(() => inputRef.current?.focus());
      })();
    });
  }

  const buttonBase = 'rounded border px-3 py-1 text-sm hover:bg-control-hover';
  const disabledButton = 'rounded border px-3 py-1 text-sm opacity-50 cursor-not-allowed';

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Setup: Dogs</h1>
        <p className="text-sm text-muted-foreground">
          Add at least one dog to continue. You can add more now, and you can manage dogs later too.
        </p>
      </header>

      {error ? (
        <Alert tone="error">
          <span className="font-medium">Error:</span> {error}
        </Alert>
      ) : null}

      {hasAnyDog ? (
        <section className="space-y-2">
          <h2 className="font-semibold">Dogs added</h2>
          <div className="rounded-lg border bg-card p-4">
            <ul className="list-disc pl-5 text-sm">
              {dogs.map((d) => (
                <li key={d.id}>{(d.name ?? '').trim() || 'Unnamed dog'}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="font-semibold">Add dog</h2>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex flex-col">
              <label htmlFor="dog-name" className="text-xs text-muted-foreground">
                Dog name
              </label>
              <input
                ref={inputRef}
                id="dog-name"
                name="name"
                required
                className="border rounded px-2 py-1"
                placeholder="e.g., Snapdragon"
                autoComplete="off"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="submit" className={buttonBase} disabled={isPending}>
              {isPending ? 'Adding…' : 'Add dog'}
            </button>

            {hasAnyDog ? (
              <Link href={continueHref} className={buttonBase}>
                Continue
              </Link>
            ) : (
              <button type="button" disabled className={disabledButton} aria-disabled="true">
                Continue
              </button>
            )}
          </div>

          {!hasAnyDog ? (
            <p className="text-sm text-muted-foreground">Add at least one dog to continue.</p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
