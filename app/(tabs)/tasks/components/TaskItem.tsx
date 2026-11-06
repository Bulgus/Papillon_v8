import React, { memo, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Reanimated from 'react-native-reanimated';

import { Homework } from "@/services/shared/homework";
import Task from "@/ui/components/Task";
import { PapillonAppearIn, PapillonAppearOut } from '@/ui/utils/Transition';
import { getSubjectName } from "@/utils/subjects/name";
import { getSubjectEmoji } from "@/utils/subjects/emoji";
import { getSubjectColor } from "@/utils/subjects/colors";
import { useMagicPrediction } from '../hooks/useMagicPrediction';
import { Link } from 'expo-router';
import { getHomeworkRouteId } from '@/database/useHomework';

interface TaskItemProps {
  item: Homework;
  index: number;
  fromCache?: boolean;
  /** Off for rows the week pager mounts off-screen — nobody sees them appear. */
  animated?: boolean;
  setAsDone: (item: Homework, done: boolean) => void;
}

const TaskItem = memo(
  ({
    item,
    animated = true,
    setAsDone
  }: TaskItemProps) => {
    const cleanContent = useMemo(() => item.content.replace(/<[^>]*>/g, ""), [item.content]);
    const magic = useMagicPrediction(item.vikunja ? "" : cleanContent);

    // A Vikunja task wears its subject's look when its project is matched to
    // one; otherwise its project's name and colour (never registered as a
    // subject, so it does not end up in the subject settings).
    const meta = item.vikunja;
    const display = meta && !meta.subjectKey
      ? { name: meta.projectPath, emoji: "📋", color: meta.color ?? "#5B6CF0" }
      : { name: getSubjectName(item.subject), emoji: getSubjectEmoji(item.subject), color: getSubjectColor(item.subject) };

    return (
      <Reanimated.View
        style={{ marginBottom: 10 }}
        entering={animated ? PapillonAppearIn : undefined}
        exiting={animated ? PapillonAppearOut : undefined}
      >
        <Link
          href={meta
            ? { pathname: "/(tabs)/tasks/vikunja/[id]", params: { id: String(meta.taskId) } }
            : { pathname: "/(tabs)/tasks/[id]", params: { id: getHomeworkRouteId(item) } }}
          asChild
        >
          <Task
            subject={display.name}
            emoji={display.emoji}
            title={""}
            color={display.color}
            description={item.content}
            date={new Date(item.dueDate)}
            completed={item.isDone}
            hasAttachments={item.attachments.length > 0}
            isCustom={item.custom}
            isVikunja={Boolean(meta)}
            magic={magic}
            onToggle={() => setAsDone(item, !item.isDone)}
          />
        </Link>
      </Reanimated.View>
    );
  }
);

TaskItem.displayName = "TaskItem";
export default TaskItem;
