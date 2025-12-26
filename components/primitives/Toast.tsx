// components/primitives/Toast.tsx
'use client';

import { useEffect, useRef, useState } from 'react';

type Tone = 'info' | 'success' | 'error';

export type ToastInput = {
  tone?: Tone;
  message: string;
  durationMs?: number;
  actionLabel?: string;
  onAction?: () => void;
};

type ToastItem = {
  id: string;
  tone: Tone;
  message: string;
  durationMs: number;
  actionLabel?: string;
  onAction?: () => void;
};

type Listener = (t: ToastItem) => void;
const listeners = new Set<Listener>();

export function toast(input: ToastInput) {
  const t: ToastItem = {
    id: crypto.randomUUID(),
    tone: input.tone ?? 'info',
    message: input.message,
    durationMs:
      typeof input.durationMs === 'number'
        ? input.durationMs
        : (input.tone ?? 'info') === 'error'
        ? 3500
        : 1600,
    actionLabel: input.actionLabel,
    onAction: input.onAction,
  };

  for (const fn of listeners) {
    try {
      fn(t);
    } catch (err) {
      console.error('[Toast] listener error', err);
    }
  }
}

export default function ToastViewport() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const onToast = (t: ToastItem) => {
      setItems((prev) => {
        const next = [...prev, t];
        // Keep the last 3 toasts so rapid-tapping doesn’t flood the screen.
        return next.length > 3 ? next.slice(next.length - 3) : next;
      });

      const existing = timers.current.get(t.id);
      if (existing) window.clearTimeout(existing);

      const timer = window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
        timers.current.delete(t.id);
      }, t.durationMs);

      timers.current.set(t.id, timer);
    };

    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    };
  }, []);

  const toneClasses: Record<Tone, string> = {
    info: 'text-alert-info-fg bg-alert-info-surface border-alert-info-border',
    success: 'text-alert-success-fg bg-alert-success-surface border-alert-success-border',
    error: 'text-alert-error-fg bg-alert-error-surface border-alert-error-border',
  };

  const iconFor = (tone: Tone) => {
    const common = { className: 'h-4 w-4', 'aria-hidden': true } as const;
    switch (tone) {
      case 'success':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...common}>
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        );
      case 'error':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...common}>
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        );
      case 'info':
      default:
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...common}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="8" />
          </svg>
        );
    }
  };

  if (items.length === 0) return null;

  return (
    <div
      className="fixed left-0 right-0 z-50 pointer-events-none"
      style={{ bottom: `calc(1rem + env(safe-area-inset-bottom))` }}
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="mx-auto max-w-2xl px-3 flex flex-col items-center gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto w-full sm:max-w-md border rounded px-3 py-2 shadow-sm bg-card ${toneClasses[t.tone]}`}
            role={t.tone === 'error' ? 'alert' : 'status'}
          >
            <div className="flex items-start gap-2">
              <span className="mt-[2px]">{iconFor(t.tone)}</span>
              <div className="flex-1 text-sm">{t.message}</div>

              {t.actionLabel && t.onAction ? (
                <button
                  type="button"
                  className="ml-2 text-xs underline hover:no-underline"
                  onClick={() => {
                    try {
                      t.onAction?.();
                    } finally {
                      setItems((prev) => prev.filter((x) => x.id !== t.id));
                      const timer = timers.current.get(t.id);
                      if (timer) window.clearTimeout(timer);
                      timers.current.delete(t.id);
                    }
                  }}
                >
                  {t.actionLabel}
                </button>
              ) : null}

              <button
                type="button"
                className="ml-2 text-xs text-muted-foreground hover:text-foreground"
                aria-label="Dismiss"
                onClick={() => {
                  setItems((prev) => prev.filter((x) => x.id !== t.id));
                  const timer = timers.current.get(t.id);
                  if (timer) window.clearTimeout(timer);
                  timers.current.delete(t.id);
                }}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
