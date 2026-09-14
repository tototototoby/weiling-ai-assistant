import { cn } from '@/lib/utils';

const BRAND_VARIANTS = {
  compact: {
    frame: 'h-10 w-10 rounded-[1rem]',
    label: 'text-[11px] tracking-[0.24em]',
  },
  hero: {
    frame: 'h-[2.1rem] w-[2.1rem] rounded-[0.9rem]',
    label: 'text-[18px] tracking-[0.22em]',
  },
  rail: {
    frame: 'h-11 w-11 rounded-[1.1rem]',
    label: 'text-[22px] font-black normal-case text-foreground',
  },
} as const;

type BrandVariant = keyof typeof BRAND_VARIANTS;

interface BrandLockupProps {
  avatarFallback?: string;
  className?: string;
  frameClassName?: string;
  imageUrl?: string | null;
  label?: string;
  labelClassName?: string;
  variant?: BrandVariant;
}

export function BrandLockup({
  avatarFallback,
  className,
  frameClassName,
  imageUrl,
  label = '微Link · 微灵 AI 助手',
  labelClassName,
  variant = 'compact',
}: BrandLockupProps) {
  const styles = BRAND_VARIANTS[variant];

  return (
    <div className={cn('inline-flex min-w-0 items-center gap-3', className)}>
      <span
        data-brand-frame=""
        className={cn(
          'inline-flex shrink-0 items-center justify-center overflow-hidden border border-black/10 bg-primary font-semibold text-primary-foreground shadow-[0_18px_40px_-28px_rgba(15,15,15,0.92)]',
          styles.frame,
          frameClassName,
        )}
      >
        {imageUrl ? (
          <img
            alt={`${label} avatar`}
            className="h-full w-full object-cover"
            decoding="async"
            height="720"
            loading="lazy"
            src={imageUrl}
            width="720"
          />
        ) : avatarFallback ? (
          <span aria-label={`${label} avatar`} className="text-base uppercase">
            {avatarFallback.slice(0, 1)}
          </span>
        ) : (
          <img
            alt="微Link · 微灵 AI 助手 logo"
            className="h-full w-full object-cover"
            decoding="async"
            height="720"
            loading="lazy"
            src="/brand/weiling-mark.png"
            width="720"
          />
        )}
      </span>
      <span
        data-brand-label=""
        className={cn(
          'truncate font-semibold uppercase text-[color:var(--text-soft)]',
          styles.label,
          labelClassName,
        )}
      >
        {label}
      </span>
    </div>
  );
}
