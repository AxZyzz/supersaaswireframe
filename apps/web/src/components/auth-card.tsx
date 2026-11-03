/** Logo + title frame shared by the signed-out auth pages. */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-accent text-tiny font-semibold text-white">
            SS
          </div>
          <span className="text-section font-semibold text-ink2">SuperSaaS</span>
        </div>
        <h1 className="mb-1 text-title font-semibold text-ink2">{title}</h1>
        <p className="mb-6 text-sm text-muted">{subtitle}</p>
        {children}
      </div>
    </main>
  );
}

export const authInput =
  "w-full rounded border border-line-mid bg-surface px-3 py-2 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2";
export const authButton =
  "w-full rounded bg-accent px-3 py-2 text-base font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60";
