// app/dog/[dogId]/day/page.tsx
import { redirect } from 'next/navigation';
import { dogHref } from '@/lib/dogHref';

export default async function DayIndex({
  params,
}: {
  params: Promise<{ dogId: string }>;
}) {
  const { dogId } = await params;

  // "Today" must be determined in the browser's current timezone.
  redirect(dogHref(dogId, '/day/today'));
}
