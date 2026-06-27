import type { Moment } from "moment";
import type { TFile } from "obsidian";
import { getDailyNoteSettings } from "obsidian-daily-notes-interface";

import type { ISettings } from "src/settings";
import { createConfirmationDialog } from "src/ui/modal";

export const DEFAULT_MONTHLY_FORMAT = "YYYY-MM";

/**
 * Get the folder path for monthly notes.
 * Uses the daily notes folder from Obsidian settings.
 */
export function getMonthlyNoteFolder(): string {
  const { folder } = getDailyNoteSettings();
  return folder || "";
}

/**
 * Get the format for monthly notes.
 */
export function getMonthlyNoteFormat(settings: ISettings): string {
  return settings.monthlyNoteFormat || DEFAULT_MONTHLY_FORMAT;
}

/**
 * Get all monthly notes from the vault.
 */
export function getAllMonthlyNotes(): Record<string, TFile> {
  const { vault } = window.app;
  const { folder } = getDailyNoteSettings();
  const notes: Record<string, TFile> = {};

  vault.getMarkdownFiles().forEach((file) => {
    if (folder && !file.path.startsWith(folder)) {
      return;
    }
    // Match YYYY-MM format at the beginning of the filename
    const match = file.basename.match(/^(\d{4}-\d{2})/);
    if (match) {
      notes[match[1]] = file;
    }
  });

  return notes;
}

/**
 * Get a specific monthly note by date.
 */
export function getMonthlyNote(
  date: Moment,
  monthlyNotes: Record<string, TFile>
): TFile | null {
  const monthKey = date.format("YYYY-MM");
  return monthlyNotes[monthKey] || null;
}

/**
 * Parse tasks from monthly note content.
 * Format:
 * ## DD
 * - [ ] task1
 * - [ ] task2
 *
 * Returns a map of day -> tasks array
 */
export function parseMonthlyNoteTasks(content: string): Record<string, string[]> {
  const tasks: Record<string, string[]> = {};
  const lines = content.split("\n");
  let currentDay = "";

  for (const line of lines) {
    // Match day header: ## 01, ## 1, ## 01-some text, etc.
    const dayMatch = line.match(/^##\s+(\d{1,2})(?:\s|$)/);
    if (dayMatch) {
      currentDay = dayMatch[1].padStart(2, "0");
      if (!tasks[currentDay]) {
        tasks[currentDay] = [];
      }
      continue;
    }

    // Match task items: - [ ] task or - [x] task or - task
    if (currentDay && line.match(/^\s*[-*]\s+/)) {
      const taskMatch = line.match(/^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+)/);
      if (taskMatch) {
        tasks[currentDay].push(taskMatch[1].trim());
      }
    }
  }

  return tasks;
}

/**
 * Parse day sections from monthly note content with full markdown.
 * Returns a map of day -> raw markdown content for that section.
 */
export function parseMonthlyNoteSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = content.split("\n");
  let currentDay = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    const dayMatch = line.match(/^##\s+(\d{1,2})(?:\s|$)/);
    if (dayMatch) {
      // Save previous day's content
      if (currentDay && currentLines.length > 0) {
        sections[currentDay] = currentLines.join("\n").trim();
      }
      currentDay = dayMatch[1].padStart(2, "0");
      currentLines = [];
      continue;
    }

    // Stop at next h1 or h2 that's not a day
    if (line.match(/^#\s/) || (line.match(/^##\s/) && !line.match(/^##\s+\d{1,2}/))) {
      if (currentDay && currentLines.length > 0) {
        sections[currentDay] = currentLines.join("\n").trim();
      }
      currentDay = "";
      currentLines = [];
      continue;
    }

    if (currentDay) {
      currentLines.push(line);
    }
  }

  // Save last day's content
  if (currentDay && currentLines.length > 0) {
    sections[currentDay] = currentLines.join("\n").trim();
  }

  return sections;
}

/**
 * Serialize tasks back to monthly note content.
 */
export function serializeMonthlyNoteTasks(
  tasks: Record<string, string[]>,
  title: string
): string {
  const lines: string[] = [`# ${title}`, ""];

  // Sort days numerically
  const sortedDays = Object.keys(tasks).sort((a, b) => {
    return parseInt(a) - parseInt(b);
  });

  for (const day of sortedDays) {
    if (tasks[day] && tasks[day].length > 0) {
      lines.push(`## ${day}`);
      for (const task of tasks[day]) {
        lines.push(`- [ ] ${task}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Create a monthly note for a given date.
 */
export async function tryToCreateMonthlyNote(
  date: Moment,
  inNewSplit: boolean,
  settings: ISettings,
  cb?: (newFile: TFile) => void
): Promise<void> {
  const { workspace, vault } = window.app;
  const folder = getMonthlyNoteFolder();
  const format = getMonthlyNoteFormat(settings);
  const filename = date.format(format);
  const filePath = folder ? `${folder}/${filename}.md` : `${filename}.md`;

  const createFile = async () => {
    // Create initial content with month title
    const content = `# ${filename}\n`;
    const newFile = await vault.create(filePath, content);

    const leaf = inNewSplit
      ? workspace.splitActiveLeaf()
      : workspace.getUnpinnedLeaf();

    await leaf.openFile(newFile, { active: true });
    cb?.(newFile);
  };

  if (settings.shouldConfirmBeforeCreate) {
    createConfirmationDialog({
      cta: "Create",
      onAccept: createFile,
      text: `Monthly note ${filename} does not exist. Would you like to create it?`,
      title: "New Monthly Note",
    });
  } else {
    await createFile();
  }
}

/**
 * Save tasks to a monthly note file.
 */
export async function saveMonthlyNoteTasks(
  file: TFile,
  tasks: Record<string, string[]>,
  monthTitle: string
): Promise<void> {
  const { vault } = window.app;
  const content = serializeMonthlyNoteTasks(tasks, monthTitle);
  await vault.modify(file, content);
}
