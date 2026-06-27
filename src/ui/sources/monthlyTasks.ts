import type { Moment } from "moment";
import type { TFile } from "obsidian";
import type { ICalendarSource, IDayMetadata, IDot } from "obsidian-calendar-ui";
import { get } from "svelte/store";

import { monthlyNotes } from "../stores";
import { parseMonthlyNoteTasks } from "src/io/monthlyNotes";

/**
 * Check if a date's day has tasks in the monthly note.
 */
async function getDotsForMonthlyNote(
  date: Moment,
  monthlyNotesMap: Record<string, TFile>
): Promise<IDot[]> {
  const monthKey = date.format("YYYY-MM");
  const file = monthlyNotesMap[monthKey];

  if (!file) {
    return [];
  }

  try {
    const content = await window.app.vault.cachedRead(file);
    const tasks = parseMonthlyNoteTasks(content);
    const dayKey = date.format("DD");

    if (tasks[dayKey] && tasks[dayKey].length > 0) {
      return [
        {
          className: "monthly-task",
          color: "purple",
          isFilled: false,
        },
      ];
    }
  } catch (err) {
    // Ignore read errors
  }

  return [];
}

export const monthlyTasksSource: ICalendarSource = {
  getDailyMetadata: async (date: Moment): Promise<IDayMetadata> => {
    const notes = get(monthlyNotes);
    if (!notes) {
      return { dots: [] };
    }
    const dots = await getDotsForMonthlyNote(date, notes);
    return { dots };
  },

  getWeeklyMetadata: async (_date: Moment): Promise<IDayMetadata> => {
    return { dots: [] };
  },
};
