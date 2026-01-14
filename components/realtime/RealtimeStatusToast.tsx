// components/realtime/RealtimeStatusToast.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';

type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

// Global state for realtime connection status across all bridges
let globalStatus: ConnectionStatus = 'connected';
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

/**
 * Report a connection state change from a realtime component.
 * Call with 'error' when connection fails, 'live' when connected.
 */
export function reportRealtimeStatus(
  status: 'idle' | 'connecting' | 'live' | 'error'
) {
  const newStatus: ConnectionStatus =
    status === 'error'
      ? 'disconnected'
      : status === 'connecting'
      ? 'reconnecting'
      : 'connected';

  if (newStatus !== globalStatus) {
    globalStatus = newStatus;
    notifyListeners();
  }
}

/**
 * Hook to subscribe to realtime connection status changes.
 */
function useRealtimeStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(globalStatus);

  useEffect(() => {
    const handler = () => setStatus(globalStatus);
    listeners.add(handler);
    // Sync on mount in case status changed before subscription
    handler();
    return () => {
      listeners.delete(handler);
    };
  }, []);

  return status;
}

/**
 * Toast component that shows when realtime sync is lost.
 * Automatically dismisses when connection is restored.
 */
export default function RealtimeStatusToast() {
  const status = useRealtimeStatus();
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  // Reset dismissed state when status changes
  useEffect(() => {
    if (status === 'connected') {
      setDismissed(false);
      // Small delay before hiding to show "reconnected" briefly
      const timeout = setTimeout(() => setVisible(false), 500);
      return () => clearTimeout(timeout);
    } else {
      setVisible(true);
    }
  }, [status]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  // Don't render if connected and not visible, or if user dismissed
  if (!visible || dismissed) {
    return null;
  }

  const isDisconnected = status === 'disconnected';
  const isReconnecting = status === 'reconnecting';

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <div
        className={`flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg ${
          isDisconnected
            ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100'
            : 'border-zinc-200 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'
        }`}
      >
        {/* Status icon */}
        <div className="flex-shrink-0">
          {isDisconnected ? (
            <svg
              className="h-5 w-5 text-amber-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          ) : (
            <svg
              className="h-5 w-5 animate-spin text-zinc-400"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
        </div>

        {/* Message */}
        <div className="flex-1 text-sm">
          {isDisconnected ? (
            <>
              <p className="font-medium">Sync paused</p>
              <p className="text-amber-700 dark:text-amber-300">
                Changes from other devices won&apos;t appear until reconnected.
              </p>
            </>
          ) : isReconnecting ? (
            <p className="font-medium">Reconnecting...</p>
          ) : null}
        </div>

        {/* Dismiss button (only when disconnected) */}
        {isDisconnected && (
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 rounded p-1 hover:bg-amber-100 dark:hover:bg-amber-900"
            aria-label="Dismiss"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
