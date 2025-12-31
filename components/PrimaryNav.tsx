// components/PrimaryNav.tsx
import AppNav from '@/components/AppNav';
import MobileBottomNav from '@/components/MobileBottomNav';

export default function PrimaryNav({
  dogId,
  dogName,
  dogs,
}: {
  dogId: string;
  dogName: string | null;
  dogs: { id: string; name: string }[] | null;
}) {
  return (
    <>
      {/* Desktop primary nav (top) */}
      <div className="hidden sm:block">
        <AppNav dogId={dogId} dogName={dogName} dogs={dogs} />
      </div>

      {/* Mobile primary nav (bottom, pinned) */}
      <MobileBottomNav dogId={dogId} dogName={dogName} dogs={dogs} />
    </>
  );
}
