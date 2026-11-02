import { AlertTriangle } from "lucide-react";
import { DocBody } from "@/components/doc-body";
import { LEGAL } from "@/lib/marketing";

export const legalContact = () =>
  LEGAL.contactEmail ?? "[contact email — to be published before launch]";

/** Shared shell for /privacy and /terms (body uses the docs mini-markup). */
export function LegalPage({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      {!LEGAL.reviewed && (
        <div className="mb-8 flex items-start gap-2 rounded-lg border border-warning-bg bg-warning-bg p-3 text-sm text-warning-text">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p>
            Draft for the public beta, pending legal review. It describes how the
            product actually handles data today; wording may change before general
            availability.
          </p>
        </div>
      )}
      <h1 className="text-[28px] font-semibold text-ink2">{title}</h1>
      <p className="mt-1 mb-8 text-tiny text-muted">Last updated {LEGAL.lastUpdated}</p>
      <DocBody body={body} />
    </main>
  );
}
