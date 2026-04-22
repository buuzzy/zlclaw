import ImageLogo from '@/assets/logo.png';
import { cn } from '@/shared/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <img src={ImageLogo} alt="涨乐金融龙虾" className="text-primary size-7" />
    </div>
  );
}
