import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { docBySlug } from "@/lib/docs";

/** Small "?" next to a heading that opens the matching help article. */
export function HelpLink({ slug }: { slug: string }) {
  const doc = docBySlug(slug);
  if (!doc) return null;
  return (
    <Link
      href={`/help?a=${slug}`}
      title={`Help: ${doc.title}`}
      aria-label={`Help: ${doc.title}`}
      className="inline-flex text-faint hover:text-accent"
    >
      <CircleHelp size={15} />
    </Link>
  );
}
