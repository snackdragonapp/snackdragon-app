// components/realtime/validatePayload.ts

type PostgresEvent = 'INSERT' | 'UPDATE' | 'DELETE';

export type RowWithClientOpId = {
  id?: unknown;
  client_op_id?: string | null;
  [key: string]: unknown;
};

export type RtChangePayload = {
  eventType: PostgresEvent;
  new: RowWithClientOpId | null;
  old: RowWithClientOpId | null;
};

/**
 * Validates that a Realtime payload has the expected structure.
 * Returns the validated payload or null if invalid.
 */
export function validateRealtimePayload(payload: unknown): RtChangePayload | null {
  if (payload === null || typeof payload !== 'object') {
    return null;
  }

  const p = payload as Record<string, unknown>;

  // eventType must be a valid PostgresEvent
  const eventType = p.eventType;
  if (eventType !== 'INSERT' && eventType !== 'UPDATE' && eventType !== 'DELETE') {
    return null;
  }

  // new and old must be objects or null
  const newRow = p.new;
  const oldRow = p.old;

  if (newRow !== null && typeof newRow !== 'object') {
    return null;
  }
  if (oldRow !== null && typeof oldRow !== 'object') {
    return null;
  }

  return {
    eventType,
    new: newRow as RowWithClientOpId | null,
    old: oldRow as RowWithClientOpId | null,
  };
}
