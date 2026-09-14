import type { ReactNode } from 'react';
import { BrandLockup } from './brand-lockup';
import { LanguageSwitcher } from './language-switcher';

interface AuthShellProps {
  brandImageUrl?: string | null;
  brandLabel?: string;
  children: ReactNode;
  eyebrow: string;
  footer: ReactNode;
  heroDescription: string;
  heroHighlights: readonly string[];
  heroTitle: string;
  subtitle: string;
  title: string;
}

export function AuthShell({
  brandImageUrl,
  brandLabel,
  children,
  eyebrow,
  footer,
  heroDescription,
  heroHighlights,
  heroTitle,
  subtitle,
  title,
}: AuthShellProps) {
  const hasCustomBrand = Boolean(brandImageUrl || brandLabel);

  return (
    <section className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 lg:px-6 lg:py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,var(--auth-glow-left),transparent_44%),radial-gradient(circle_at_top_right,var(--auth-glow-right),transparent_32%),linear-gradient(180deg,var(--auth-overlay-start),var(--auth-overlay-middle)_48%,var(--auth-overlay-end)_100%)]" />
      <div
        className="relative z-10 grid w-full max-w-[110rem] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(42rem,42rem)] lg:gap-8"
        data-auth-shell-grid=""
      >
        <div className="hidden items-center lg:flex">
          <div className="grid max-w-[46rem] gap-8 px-3" data-auth-hero-content="">
            <div data-auth-hero-brand="">
              <BrandLockup
                frameClassName={hasCustomBrand ? 'h-[4.5rem] w-[4.5rem] rounded-[1rem]' : undefined}
                imageUrl={brandImageUrl}
                label={brandLabel}
                labelClassName={hasCustomBrand ? 'text-2xl font-bold normal-case tracking-normal text-foreground' : undefined}
                variant="hero"
              />
            </div>
            <div className="grid gap-6">
              <h2
                className="m-0 text-[3.4rem] font-semibold leading-[1.08] tracking-[-0.045em] text-foreground"
                data-auth-hero-title=""
              >
                {heroTitle}
              </h2>
              <p className="m-0 max-w-[33rem] text-lg leading-8 text-muted-foreground">
                {heroDescription}
              </p>
            </div>
            <ul className="m-0 flex flex-wrap gap-3 p-0">
              {heroHighlights.map((highlight) => (
                <li
                  className="list-none rounded-full border border-[color:var(--border-soft)]/45 bg-[color:var(--surface)]/68 px-4 py-2 text-sm font-medium text-foreground shadow-[var(--shadow-soft)]"
                  key={highlight}
                >
                  {highlight}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="grid gap-4 lg:justify-self-end">
          <div className="flex justify-end">
            <LanguageSwitcher />
          </div>
          <div
            className="relative w-full max-w-none overflow-hidden rounded-[2rem] border border-[color:var(--border-soft)]/38 bg-[color:var(--surface)]/72 p-6 shadow-[var(--shadow-soft)] backdrop-blur-xl lg:max-w-[42rem] lg:p-10"
            data-auth-card=""
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,var(--panel-highlight),transparent)]" />
            <div className="relative mb-8 grid gap-4">
              <div className="lg:hidden">
                <BrandLockup
                  frameClassName={hasCustomBrand ? 'h-14 w-14 rounded-[0.875rem]' : undefined}
                  imageUrl={brandImageUrl}
                  label={brandLabel}
                  labelClassName={hasCustomBrand ? 'text-base font-bold normal-case tracking-normal text-foreground' : undefined}
                  variant="compact"
                />
              </div>
              <div className="grid gap-3">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--text-soft)]">
                  {eyebrow}
                </p>
                <h1 className="m-0 text-3xl font-semibold tracking-[-0.03em] text-foreground lg:text-[2.5rem] lg:tracking-[-0.04em]">
                  {title}
                </h1>
                <p className="m-0 max-w-[44rem] text-sm leading-7 text-muted-foreground lg:text-base lg:leading-8">
                  {subtitle}
                </p>
              </div>
            </div>
            <div className="relative grid gap-6">
              {children}
            </div>
            <div className="relative mt-6 border-t border-[color:var(--border-soft)]/45 pt-6 text-sm text-muted-foreground">
              {footer}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
