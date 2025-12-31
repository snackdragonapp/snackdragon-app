// components/PrimaryNav.tsx
import AppNav from '@/components/AppNav';
import MobileBottomNav from '@/components/MobileBottomNav';

export default function PrimaryNav({ dogId }: { dogId: string }) {
  return (
    <>
      {/* Desktop primary nav (top) */}
      <div className="hidden sm:block">
        <AppNav dogId={dogId} />
      </div>

      {/* Mobile primary nav (bottom, pinned) */}
      <MobileBottomNav dogId={dogId} />
    </>
  );
}
