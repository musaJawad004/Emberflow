import type { Metadata } from "next";
import { DeploymentList } from "@/modules/deploy/DeploymentList";

export const metadata: Metadata = {
  title: "Emberflow · deployments",
};

/** `/deployments` — active deployment + rollback history. */
export default function DeploymentsPage() {
  return <DeploymentList />;
}
