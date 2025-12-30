// app/dog/[dogId]/layout.tsx
import AppNav from '@/components/AppNav';

export default async function DogLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ dogId: string }>;
}) {
  // Note: params is a Promise in this codebase’s Next.js setup (see other pages).
  const { dogId } = await params;

  return (
    <>
      <AppNav dogId={dogId} />
      {children}
    </>
  );
}
