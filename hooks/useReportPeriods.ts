import { useCallback, useEffect, useState } from "react";

import { periodId } from "@/components/reports/PeriodChips";
import { useManagerSubscription } from "@/hooks/useManagerSubscription";
import { getManager } from "@/services/shared";
import { Period } from "@/services/shared/grade";
import { Capabilities } from "@/services/shared/types";
import { getCurrentPeriod } from "@/utils/grades/helper/period";
import { warn } from "@/utils/logger/logger";

/** Periods of a report tab (evaluations or bulletin) and the selected one. */
export function useReportPeriods(capability: Capabilities.EVALUATIONS | Capabilities.GRADEBOOK) {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selected, setSelected] = useState<Period | undefined>();
  const [supported, setSupported] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const manager = getManager(true);
    if (!manager) {return;}
    setSupported(manager.getAvailableClients(capability).length > 0);
    try {
      const list = capability === Capabilities.EVALUATIONS
        ? await manager.getEvaluationPeriods()
        : await manager.getGradebookPeriods();
      const sorted = [...list].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      setPeriods(sorted);
      setSelected(previous => {
        const kept = previous && sorted.find(period => periodId(period) === periodId(previous));
        if (kept) {return kept;}
        if (capability === Capabilities.GRADEBOOK) {
          // The last bulletin out, not the period running now (no bulletin yet).
          const ended = sorted.filter(period => new Date(period.end).getTime() < Date.now());
          return ended[ended.length - 1] ?? getCurrentPeriod(sorted) ?? sorted[0];
        }
        return getCurrentPeriod(sorted) ?? sorted[sorted.length - 1];
      });
    } catch (error) {
      warn(`Report periods: ${String(error)}`);
    } finally {
      setLoaded(true);
    }
  }, [capability]);

  useEffect(() => {
    load();
  }, [load]);
  useManagerSubscription(useCallback(() => {
    load();
  }, [load]));

  return { periods, selected, setSelected, supported, loaded, reload: load };
}
