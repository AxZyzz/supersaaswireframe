import { redirect } from "next/navigation";

/** Sidebar "Review" opens Insights; the other Review pages sit beside it. */
export default function ReviewIndex() {
  redirect("/review/insights");
}
