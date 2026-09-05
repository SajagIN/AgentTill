import { Badge } from "@/components/ui/badge";
import { missionMeta, stateBadgeClass } from "@/lib/mission-states";
import type { MissionState } from "@/lib/types";

/** Mission state, rendered consistently everywhere it appears. */
export function StateBadge({ state }: { state: MissionState }) {
  return (
    <Badge variant="outline" className={stateBadgeClass(state)} title={missionMeta(state).blurb}>
      {missionMeta(state).label}
    </Badge>
  );
}
