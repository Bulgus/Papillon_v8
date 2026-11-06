import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef } from "react";

import { getDateRangeOfWeek } from "@/database/useHomework";
import { Homework } from "@/services/shared/homework";
import { useVikunjaStore } from "@/stores/vikunja";
import { useVikunjaTasksStore, vikunjaTasksAsHomework } from "@/stores/vikunja/tasks";

/**
 * Vikunja tasks for each week the pager shows. Overdue and undated tasks go to
 * the current week (in their own sections). Arrays keep their identity while
 * a week's tasks do not change, like useHomeworkData's.
 */
export function useVikunjaWeeks(weeks: number[], currentWeek: number) {
  const enabled = useVikunjaStore(state => state.connected && state.showInApp);
  const exported = useVikunjaStore(state => state.exported);
  const tasks = useVikunjaTasksStore(state => state.tasks);
  const projects = useVikunjaTasksStore(state => state.projects);
  const doneLocally = useVikunjaTasksStore(state => state.doneLocally);
  const refresh = useVikunjaTasksStore(state => state.refresh);

  useFocusEffect(
    useCallback(() => {
      if (enabled) {refresh();}
    }, [enabled, refresh])
  );

  const year = new Date().getFullYear();
  const currentStart = useMemo(() => getDateRangeOfWeek(currentWeek, year).start, [currentWeek, year]);

  const items = useMemo(
    () => (enabled ? vikunjaTasksAsHomework(tasks, projects, doneLocally, currentStart) : []),
    // `exported` changes which tasks are hidden behind their homework.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, tasks, projects, doneLocally, currentStart, exported]
  );

  const cache = useRef<Record<number, Homework[]>>({});

  const byWeek = useMemo(() => {
    const next: Record<number, Homework[]> = {};
    for (const week of weeks) {
      const { start, end } = getDateRangeOfWeek(week, year);
      const list = items.filter(item => {
        const meta = item.vikunja;
        if (meta?.undated || meta?.overdue) {return week === currentWeek;}
        const due = new Date(item.dueDate).getTime();
        return due >= start.getTime() && due <= end.getTime();
      });
      const previous = cache.current[week];
      const same = previous && previous.length === list.length && previous.every((item, index) => item === list[index]);
      next[week] = same ? previous : list;
    }
    cache.current = next;
    return next;
  }, [items, weeks, currentWeek, year]);

  const forceRefresh = useCallback(() => {
    if (enabled) {refresh(true);}
  }, [enabled, refresh]);

  return { byWeek, refresh: forceRefresh, enabled };
}
