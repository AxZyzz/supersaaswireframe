import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm text-center">
        <p className="text-[48px] font-semibold leading-none text-line-faint">404</p>
        <h1 className="mt-3 text-title font-semibold text-ink2">Page not found</h1>
        <p className="mt-1.5 text-sm text-muted">
          That link doesn&apos;t go anywhere — it may have moved or been removed.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link
            href="/dashboard"
            className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Go to dashboard
          </Link>
          <Link
            href="/"
            className="rounded border border-line-mid px-4 py-1.5 text-sm text-ink hover:bg-hover"
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
