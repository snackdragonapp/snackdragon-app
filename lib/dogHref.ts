// lib/dogHref.ts

export function dogHref(dogId: string, subpath: string) {
  const id = String(dogId ?? '').trim();
  if (!id) throw new Error('dogHref: dogId is required');

  let sp = String(subpath ?? '');
  if (!sp.startsWith('/')) sp = `/${sp}`;

  // dogId is a UUID, but encode for safety anyway.
  return `/dog/${encodeURIComponent(id)}${sp}`;
}
