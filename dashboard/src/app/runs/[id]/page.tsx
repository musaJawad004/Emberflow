import { RunDetail } from "@/modules/runs/RunDetail";

/** `/runs/[id]` — run detail. The module reads the id via useParams(). */
export default function RunDetailPage() {
  return <RunDetail />;
}
