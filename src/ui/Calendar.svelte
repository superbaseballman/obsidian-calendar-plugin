<svelte:options immutable />

<script lang="ts">
  import type { Moment } from "moment";
  import type { TFile } from "obsidian";
  import { MarkdownRenderer } from "obsidian";
  import {
    Calendar as CalendarBase,
    ICalendarSource,
    configureGlobalMomentLocale,
  } from "obsidian-calendar-ui";
  import { onDestroy } from "svelte";

  import type { ISettings } from "src/settings";
  import {
    parseMonthlyNoteTasks,
    parseMonthlyNoteSections,
    getMonthlyNote,
    tryToCreateMonthlyNote,
  } from "src/io/monthlyNotes";
  import { activeFile, dailyNotes, settings, weeklyNotes, monthlyNotes } from "./stores";
  import { DateActionModal } from "./modal";

  let today: Moment;

  $: today = getToday($settings);

  export let displayedMonth: Moment = today;
  export let sources: ICalendarSource[];
  export let onHoverDay: (date: Moment, targetEl: EventTarget) => boolean;
  export let onHoverWeek: (date: Moment, targetEl: EventTarget) => boolean;
  export let onClickDay: (date: Moment, isMetaPressed: boolean) => boolean;
  export let onClickWeek: (date: Moment, isMetaPressed: boolean) => boolean;
  export let onContextMenuDay: (date: Moment, event: MouseEvent) => boolean;
  export let onContextMenuWeek: (date: Moment, event: MouseEvent) => boolean;

  // --- Monthly tasks state ---
  let monthTasks: Record<string, string[]> = {};
  let monthFile: TFile | null = null;
  let lastLoadedMonth: string = "";
  let currentSettings: ISettings;

  // Monthly note content rendering
  let dayContents: Record<string, string> = {};

  const unsubSettings = settings.subscribe((val) => {
    currentSettings = val;
  });

  $: monthLabel = displayedMonth ? displayedMonth.format("YYYY-MM") : "";

  $: {
    const monthKey = displayedMonth ? displayedMonth.format("YYYY-MM") : "";
    const notes = $monthlyNotes;
    if (displayedMonth && notes && monthKey !== lastLoadedMonth) {
      lastLoadedMonth = monthKey;
      loadMonthTasks(displayedMonth);
    }
  }

  $: daysWithTasks = Object.keys(monthTasks)
    .filter((d) => monthTasks[d] && monthTasks[d].length > 0)
    .sort((a, b) => parseInt(a) - parseInt(b));

  async function loadMonthTasks(date: Moment) {
    monthFile = getMonthlyNote(date, $monthlyNotes);
    if (monthFile) {
      try {
        const content = await window.app.vault.cachedRead(monthFile);
        monthTasks = parseMonthlyNoteTasks(content);
        dayContents = parseMonthlyNoteSections(content);
      } catch (err) {
        console.log("[Calendar] Failed to read monthly note", err);
        monthTasks = {};
        dayContents = {};
      }
    } else {
      monthTasks = {};
      dayContents = {};
    }
  }

  function handleDayClick(date: Moment, isMetaPressed: boolean): boolean {
    if (!currentSettings?.showMonthlyNote) {
      return onClickDay(date, isMetaPressed);
    }

    // Show DateActionModal
    const modal = new DateActionModal(window.app, date, {
      onOpenDailyNote: (d: Moment) => {
        onClickDay(d, false);
        closePopup();
      },
      onAddItem: (d: Moment) => {
        openMonthlyNoteForEdit(d);
      },
    });
    modal.open();
    return false;
  }

  async function openMonthlyNoteForEdit(date: Moment) {
    const { workspace } = window.app;
    
    // Get or create monthly note
    let file = getMonthlyNote(displayedMonth, $monthlyNotes);
    if (!file) {
      await tryToCreateMonthlyNote(displayedMonth, false, currentSettings);
      monthlyNotes.reindex();
      file = getMonthlyNote(displayedMonth, $monthlyNotes);
    }
    
    if (file) {
      const leaf = workspace.getUnpinnedLeaf();
      await leaf.openFile(file, { active: true });
      
      // Set cursor to the day section if it exists
      const editor = workspace.activeEditor?.editor;
      if (editor) {
        const content = await window.app.vault.cachedRead(file);
        const dayStr = date.format("DD");
        const lines = content.split("\n");
        let targetLine = -1;
        
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].match(new RegExp(`^##\\s+${dayStr}`))) {
            targetLine = i;
            break;
          }
        }
        
        if (targetLine >= 0) {
          editor.setCursor({ line: targetLine + 1, ch: 0 });
        }
      }
    }
    
    closePopup();
  }

  function closePopup() {
    // Placeholder for future use
  }

  function renderMarkdown(node: HTMLElement, content: string) {
    if (!content || !monthFile) {
      node.empty();
      return;
    }
    node.empty();
    MarkdownRenderer.renderMarkdown(content, node, monthFile.path, null);

    return {
      update(newContent: string) {
        if (!newContent || !monthFile) {
          node.empty();
          return;
        }
        node.empty();
        MarkdownRenderer.renderMarkdown(newContent, node, monthFile.path, null);
      },
    };
  }

  async function createMonthlyNote() {
    if (!displayedMonth) return;
    await tryToCreateMonthlyNote(displayedMonth, false, currentSettings, () => {
      monthlyNotes.reindex();
    });
  }

  export function tick() {
    today = window.moment();
  }

  function getToday(settings: ISettings) {
    configureGlobalMomentLocale(settings.localeOverride, settings.weekStart);
    dailyNotes.reindex();
    weeklyNotes.reindex();
    if (settings.showMonthlyNote) {
      monthlyNotes.reindex();
    }
    return window.moment();
  }

  // 1 minute heartbeat to keep `today` reflecting the current day
  let heartbeat = setInterval(() => {
    tick();

    const isViewingCurrentMonth = displayedMonth.isSame(today, "day");
    if (isViewingCurrentMonth) {
      displayedMonth = today;
    }
  }, 1000 * 60);

  onDestroy(() => {
    clearInterval(heartbeat);
    unsubSettings();
  });
</script>

<div class="calendar-wrapper" on:click|self={closePopup}>
  <CalendarBase
    {sources}
    {today}
    {onHoverDay}
    {onHoverWeek}
    {onContextMenuDay}
    {onContextMenuWeek}
    onClickDay={currentSettings?.showMonthlyNote ? handleDayClick : onClickDay}
    {onClickWeek}
    bind:displayedMonth
    localeData={today.localeData()}
    selectedId={$activeFile}
    showWeekNums={$settings.showWeeklyNote}
  />

  {#if currentSettings?.showMonthlyNote && displayedMonth}
    <!-- Monthly note content rendered below calendar container -->
    {#if monthFile && daysWithTasks.length > 0}
      <div class="mt-content-section">
        {#each daysWithTasks as day}
          {#if dayContents[day]}
            <div class="mt-day-block">
              <div class="mt-day-label">{day}日</div>
              <div class="mt-markdown-content" use:renderMarkdown={dayContents[day]}></div>
            </div>
          {/if}
        {/each}
      </div>
    {:else if !monthFile}
      <div class="mt-empty">
        <span>暂无月记</span>
        <button class="mt-create-btn" on:click={createMonthlyNote}>创建 {monthLabel} 月记</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .calendar-wrapper {
    position: relative;
    display: flex;
    flex-direction: column;
  }

  /* Choice popup */
  .mt-choice-popup {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    margin-top: 6px;
  }

  .mt-choice-header {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-accent);
    margin-right: 4px;
  }

  .mt-choice-btn {
    padding: 4px 10px;
    font-size: 12px;
    background: var(--background-primary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }

  .mt-choice-btn:hover {
    background: var(--background-modifier-hover);
    border-color: var(--interactive-accent);
  }

  .mt-choice-close {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 16px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .mt-choice-close:hover {
    color: var(--text-error);
  }

  /* Task summary */
  .mt-summary {
    padding: 8px 10px;
    margin-top: 6px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    max-height: 200px;
    overflow-y: auto;
  }

  .mt-summary-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-normal);
    margin-bottom: 6px;
  }

  .mt-day-row {
    display: flex;
    gap: 8px;
    padding: 3px 0;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .mt-day-row:last-child {
    border-bottom: none;
  }

  .mt-day-num {
    min-width: 28px;
    font-size: 14px;
    font-weight: 700;
    color: var(--text-accent);
    text-align: center;
    padding-top: 1px;
  }

  .mt-day-tasks {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .mt-task {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
    color: var(--text-normal);
    background: var(--background-primary);
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid var(--background-modifier-border);
  }

  .mt-task-rm {
    opacity: 0;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    padding: 0;
    line-height: 1;
    transition: opacity 0.1s;
  }

  .mt-task:hover .mt-task-rm {
    opacity: 1;
  }

  .mt-task-rm:hover {
    color: var(--text-error);
  }

  .mt-empty {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    margin-top: 6px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .mt-create-btn {
    padding: 3px 10px;
    font-size: 12px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .mt-create-btn:hover {
    background: var(--interactive-accent-hover);
  }

  /* Monthly note content rendering section */
  .mt-content-section {
    margin-top: 8px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    overflow: hidden;
  }

  .mt-day-block {
    padding: 8px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .mt-day-block:last-child {
    border-bottom: none;
  }

  .mt-day-label {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-accent);
    margin-bottom: 6px;
  }

  /* Markdown content rendering */
  .mt-markdown-content {
    padding: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-normal);
  }

  .mt-markdown-content :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
    margin: 4px 0;
  }

  .mt-markdown-content :global(p) {
    margin: 4px 0;
  }

  .mt-markdown-content :global(ul),
  .mt-markdown-content :global(ol) {
    margin: 4px 0;
    padding-left: 20px;
  }

  .mt-markdown-content :global(li) {
    margin: 2px 0;
  }

  .mt-markdown-content :global(blockquote) {
    border-left: 3px solid var(--text-faint);
    padding-left: 12px;
    margin: 4px 0;
    color: var(--text-muted);
  }

  .mt-markdown-content :global(code) {
    background: var(--background-primary);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 12px;
  }

  .mt-markdown-content :global(pre) {
    background: var(--background-primary);
    padding: 8px;
    border-radius: 4px;
    overflow-x: auto;
  }

  .mt-markdown-content :global(pre code) {
    background: none;
    padding: 0;
  }

  .mt-markdown-content :global(a) {
    color: var(--text-accent);
    text-decoration: none;
  }

  .mt-markdown-content :global(a:hover) {
    text-decoration: underline;
  }
</style>
