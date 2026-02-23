import { redirect } from "next/navigation";

/** Redirect legacy /requests to Queues page Request queue tab. */
export default function RequestsPage() {
  redirect("/queues?tab=requests");
}
