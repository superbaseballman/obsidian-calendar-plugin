<svelte:options immutable />

<script lang="ts">
  import type { Moment } from "moment";
  import type { TFile } from "obsidian";
  import { getDailyNote } from "obsidian-daily-notes-interface";
  import { Component, MarkdownRenderer } from "obsidian";
  import {
    Calendar as CalendarBase,
    ICalendarSource,
    configureGlobalMomentLocale,
  } from "obsidian-calendar-ui";
  import { onDestroy } from "svelte";

  import type { ISettings } from "src/settings";
  import {
    parseMonthlyNoteSections,
    getMonthlyNote,
    tryToCreateMonthlyNote,
    saveDaySection,
  } from "src/io/monthlyNotes";
  import {
    activeFile,
    dailyNotes,
    settings,
    weeklyNotes,
    monthlyNotes,
    canvasSchedules,
  } from "./stores";
  import type { CanvasSchedule } from "src/io/canvasSchedules";
  import { t } from "../i18n";
  import { DateActionModal } from "./modal";

  // Component for MarkdownRenderer to properly track lifecycle
  // Must call load() so embedded content (images, etc.) registers properly
  const markdownComponent = new Component();
  markdownComponent.load();

  let today: Moment;

  $: today = getToday($settings);

  export let displayedMonth: Moment = today;
  export let sources: ICalendarSource[];
  export let onHoverDay: (date: Moment, targetEl: EventTarget) => boolean;
  export let onHoverWeek: (date: Moment, targetEl: EventTarget) => boolean;
  export let onClickDay: (date: Moment, isMetaPressed: boolean) => boolean;
  export let onClickWeek: (date: Moment, isMetaPressed: boolean) => boolean;

  // --- Monthly tasks state ---
  let monthFile: TFile | null = null;
  let lastLoadedMonth: string = "";
  let currentSettings: ISettings;

  // Monthly note content rendering
  let dayContents: Record<string, string> = {};
  let canvasDaySchedules: Record<string, CanvasSchedule[]> = {};

  // Editing state
  let editingDay: string | null = null;
  let editText: string = "";

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

  $: {
    const schedules = $canvasSchedules;
    if (displayedMonth && currentSettings?.showCanvasSchedules && schedules) {
      loadCanvasSchedules(displayedMonth, schedules);
    } else if (!currentSettings?.showCanvasSchedules) {
      canvasDaySchedules = {};
    }
  }

  // Update CSS variable for monthly dot color
  $: if (currentSettings?.monthlyDotColor && calendarWrapper) {
    calendarWrapper.style.setProperty("--monthly-dot-color", currentSettings.monthlyDotColor);
  }

  $: if (currentSettings?.canvasSchedulesDotColor && calendarWrapper) {
    calendarWrapper.style.setProperty(
      "--canvas-schedule-dot-color",
      currentSettings.canvasSchedulesDotColor
    );
  }

  $: daysWithTasks = Object.keys(dayContents)
    .filter((d) => dayContents[d] && dayContents[d].trim().length > 0)
    .sort((a, b) => parseInt(a) - parseInt(b));

  $: daysWithCanvasSchedules = Object.keys(canvasDaySchedules)
    .filter((day) => canvasDaySchedules[day]?.length > 0)
    .sort((a, b) => parseInt(a) - parseInt(b));

  async function loadMonthTasks(date: Moment) {
    monthFile = getMonthlyNote(date, $monthlyNotes);
    if (monthFile) {
      try {
        const content = await window.app.vault.cachedRead(monthFile);
        dayContents = parseMonthlyNoteSections(content, displayedMonth.format("YYYY-MM"));
      } catch (err) {
        console.log(t('error.readMonthlyNote'), err);
        dayContents = {};
      }
    } else {
      dayContents = {};
    }
  }

  function loadCanvasSchedules(
    date: Moment,
    schedules: Record<string, CanvasSchedule[]>
  ) {
    const monthKey = date.format("YYYY-MM");
    const grouped: Record<string, CanvasSchedule[]> = {};
    Object.entries(schedules).forEach(([dateKey, daySchedules]) => {
      if (dateKey.startsWith(`${monthKey}-`)) {
        grouped[dateKey.slice(-2)] = daySchedules;
      }
    });
    canvasDaySchedules = grouped;
  }

  function openCanvasSchedule(schedule: CanvasSchedule) {
    if (!schedule?.file) {
      return;
    }
    window.app.workspace.getUnpinnedLeaf().openFile(schedule.file, {
      active: true,
    });
  }

  function handleDayClick(date: Moment, isMetaPressed: boolean): boolean {
    // Without monthly notes enabled, keep the original single-action behavior.
    if (!currentSettings?.showMonthlyNote) {
      return onClickDay(date, isMetaPressed);
    }

    // Reading the monthly note is async, so resolve the action on demand.
    void resolveDayAction(date, isMetaPressed);
    return false;
  }

  /**
   * Decide what a left click should do for the given day:
   * - daily + monthly content both exist -> ask which to open
   * - only daily note exists -> open daily note
   * - only monthly content exists -> open monthly note section
   * - neither exists -> ask which to create
   */
  async function resolveDayAction(date: Moment, isMetaPressed: boolean) {
    const hasDaily = !!getDailyNote(date, $dailyNotes);
    const hasMonthly = await hasMonthlyDayContent(date);

    if (hasDaily && hasMonthly) {
      new DateActionModal(window.app, date, {
        mode: "choose",
        onOpenDailyNote: (selectedDate) => onClickDay(selectedDate, isMetaPressed),
        onAddItem: openMonthlyNoteForEdit,
      }).open();
      return;
    }

    if (hasDaily) {
      onClickDay(date, isMetaPressed);
      return;
    }

    if (hasMonthly) {
      await openMonthlyNoteForEdit(date);
      return;
    }

    new DateActionModal(window.app, date, {
      mode: "create",
      onOpenDailyNote: (selectedDate) => onClickDay(selectedDate, isMetaPressed),
      onAddItem: openMonthlyNoteForEdit,
    }).open();
  }

  /**
   * Whether the monthly note for the given date exists and contains a
   * non-empty `## DD` section for that specific day.
   */
  async function hasMonthlyDayContent(date: Moment): Promise<boolean> {
    const file = getMonthlyNote(date, $monthlyNotes);
    if (!file) {
      return false;
    }
    try {
      const content = await window.app.vault.cachedRead(file);
      const sections = parseMonthlyNoteSections(content, date.format("YYYY-MM"));
      return !!sections[date.format("DD")]?.trim();
    } catch (err) {
      console.log(t('error.readMonthlyNote'), err);
      return false;
    }
  }

  async function openMonthlyNoteForEdit(date: Moment) {
    const { workspace, vault } = window.app;
    
    // Get or create monthly note
    let file = getMonthlyNote(date, $monthlyNotes);
    if (!file) {
      await tryToCreateMonthlyNote(displayedMonth, false, currentSettings);
      monthlyNotes.reindex();
      file = getMonthlyNote(date, $monthlyNotes);
    }
    
    if (file) {
      // Ensure the day section exists, create it if not
      const dayStr = date.format("DD");
      const monthTitle = date.format("YYYY-MM");
      let content = await vault.cachedRead(file);
      const lines = content.split("\n");
      let targetLine = -1;
      const monthLine = lines.findIndex((line) =>
        new RegExp(`^#\\s+${monthTitle}(?:\\s|$)`).test(line)
      );
      const nextMonthLine = lines.findIndex(
        (line, index) => index > monthLine && /^#\s/.test(line)
      );
      const monthEndLine = nextMonthLine >= 0 ? nextMonthLine : lines.length;

      if (monthLine >= 0) {
        targetLine = lines.findIndex(
          (line, index) =>
            index > monthLine &&
            index < monthEndLine &&
            new RegExp(`^##\\s+${dayStr}(?:\\s|$)`).test(line)
        );
      }
      
      // Day section doesn't exist — insert it inside the requested month.
      if (targetLine < 0) {
        const newSection = monthLine >= 0
          ? [`## ${dayStr}`, ""]
          : [`# ${monthTitle}`, "", `## ${dayStr}`, ""];
        const nextDayLine = monthLine >= 0
          ? lines.findIndex((line, index) => {
              if (index <= monthLine || index >= monthEndLine) return false;
              const dayMatch = line.match(/^##\s+(\d{1,2})(?:\s|$)/);
              return dayMatch ? parseInt(dayMatch[1], 10) > parseInt(dayStr, 10) : false;
            })
          : -1;
        const nextMonthLineForInsert = monthLine < 0
          ? lines.findIndex((line) => {
              const monthMatch = line.match(/^#\s+(\d{4}-\d{2})(?:\s|$)/);
              return monthMatch ? monthMatch[1] > monthTitle : false;
            })
          : -1;
        const insertAt = nextDayLine >= 0
          ? nextDayLine
          : monthLine >= 0
            ? monthEndLine
            : nextMonthLineForInsert >= 0
              ? nextMonthLineForInsert
              : lines.length;
        const result = [
          ...lines.slice(0, insertAt),
          ...newSection,
          ...lines.slice(insertAt),
        ];
        await vault.modify(file, result.join("\n"));
        // Re-read to get updated content and find the new line
        content = await vault.cachedRead(file);
        const updatedLines = content.split("\n");
        const updatedMonthLine = updatedLines.findIndex((line) =>
          new RegExp(`^#\\s+${monthTitle}(?:\\s|$)`).test(line)
        );
        const updatedNextMonthLine = updatedLines.findIndex(
          (line, index) => index > updatedMonthLine && /^#\s/.test(line)
        );
        const updatedMonthEndLine = updatedNextMonthLine >= 0
          ? updatedNextMonthLine
          : updatedLines.length;
        targetLine = updatedLines.findIndex(
          (line, index) =>
            index > updatedMonthLine &&
            index < updatedMonthEndLine &&
            new RegExp(`^##\\s+${dayStr}(?:\\s|$)`).test(line)
        );
      }
      
      const leaf = workspace.getUnpinnedLeaf();
      await leaf.openFile(file, { active: true });
      
      // Set cursor to the day section
      const editor = workspace.activeEditor?.editor;
      if (editor && targetLine >= 0) {
        editor.setCursor({ line: targetLine + 1, ch: 0 });
      }
    }
  }

  function startEditDay(day: string) {
    editingDay = day;
    editText = dayContents[day] || "";
    originalEditContent = editText;
    hasEdited = false;
    textareaFocused = false;
    // Auto-focus the textarea after it renders
    requestAnimationFrame(() => {
      const textarea = document.querySelector(".mt-edit-textarea") as HTMLTextAreaElement;
      if (textarea) textarea.focus();
    });
  }

  let isCancelling = false;
  let originalEditContent: string = "";
  let hasEdited: boolean = false;
  let textareaFocused: boolean = false;

  function cancelEdit() {
    isCancelling = true;
    editingDay = null;
    editText = "";
    hasEdited = false;
    textareaFocused = false;
    // Reset flag after blur event fires
    requestAnimationFrame(() => { isCancelling = false; });
  }

  function onTextareaFocus() {
    textareaFocused = true;
  }

  function onTextareaBlur(day: string) {
    if (isCancelling) return;
    if (textareaFocused && hasEdited && editText.trim() !== originalEditContent.trim()) {
      // Textarea was focused and content was modified — save
      saveEditDay(day);
    } else {
      // Textarea never focused, or no changes — cancel silently
      cancelEdit();
    }
  }

  async function saveEditDay(day: string) {
    if (!monthFile || isCancelling) return;
    const newContent = editText.trim();
    try {
      await saveDaySection(monthFile, displayedMonth.format("YYYY-MM"), day, newContent);
      // Update local state immediately
      dayContents[day] = newContent;
      dayContents = { ...dayContents };
      editingDay = null;
      editText = "";
      hasEdited = false;
    } catch (err) {
      console.log("[Calendar] Failed to save day section", err);
    }
  }

  export function refreshMonthlyContent() {
    if (displayedMonth) {
      loadMonthTasks(displayedMonth);
    }
  }

  export async function refreshCanvasSchedules() {
    if (!currentSettings?.showCanvasSchedules) {
      canvasDaySchedules = {};
      return;
    }
    if (displayedMonth && $canvasSchedules) {
      loadCanvasSchedules(displayedMonth, $canvasSchedules);
    }
  }

  function resolveImagePaths(node: HTMLElement) {
    if (!monthFile) return;
    const folder = monthFile.parent?.path || "";

    function resolveAbsPath(src: string): string {
      if (src.startsWith("/")) return src.slice(1);
      // Relative path — resolve against the monthly note's folder
      const parts = folder.split("/").filter(Boolean);
      const srcParts = src.split("/");
      for (const part of srcParts) {
        if (part === "..") {
          parts.pop();
        } else if (part !== ".") {
          parts.push(part);
        }
      }
      return parts.join("/");
    }

    function getResolvedSrc(src: string): string | null {
      if (!src || src.startsWith("app://") || src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
        return null;
      }
      const absPath = resolveAbsPath(src);
      const file = window.app.vault.getAbstractFileByPath(absPath);
      if (file) {
        return window.app.vault.getResourcePath(file);
      }
      return null;
    }

    // 1. Fix existing <img> tags
    const images = node.querySelectorAll("img");
    images.forEach((img) => {
      const src = img.getAttribute("src");
      const resolved = getResolvedSrc(src);
      if (resolved) {
        img.setAttribute("src", resolved);
      }
    });

    // 2. Convert Obsidian's <span class="internal-embed"> to <img> tags
    const embeds = node.querySelectorAll("span.internal-embed");
    embeds.forEach((span) => {
      const src = span.getAttribute("src");
      if (!src) return;
      // Only convert image-type embeds (check file extension or existing class)
      const isImage = /\.(png|jpe?g|gif|bmp|svg|webp|avif|tiff?)$/i.test(src) || span.classList.contains("image");
      if (!isImage) return;

      let finalSrc = src;
      // If it's not already an app:// or external URL, resolve via vault API
      if (!src.startsWith("app://") && !src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("data:")) {
        const resolved = getResolvedSrc(src);
        if (resolved) {
          finalSrc = resolved;
        }
      }

      const img = document.createElement("img");
      img.setAttribute("src", finalSrc);
      img.setAttribute("alt", span.getAttribute("alt") || src);
      img.classList.add("mt-resolved-image");
      span.replaceWith(img);
    });
  }

  function renderMarkdown(node: HTMLElement, content: string) {
    if (!content || !monthFile) {
      node.empty();
      return;
    }
    const sourcePath = monthFile.path;
    const handleInternalLinkClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const link = target.closest("a.internal-link");
      const linkText = link?.getAttribute("data-href") || link?.getAttribute("href");
      if (!link || !linkText) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      window.app.workspace.openLinkText(linkText, sourcePath, false);
    };
    node.empty();
    node.addEventListener("click", handleInternalLinkClick);
    // Unload and reload component to clean up previous embedded content handlers
    markdownComponent.unload();
    markdownComponent.load();
    // renderMarkdown is async — resolve image paths after it completes
    MarkdownRenderer.renderMarkdown(content, node, monthFile.path, markdownComponent).then(() => {
      resolveImagePaths(node);
    });

    return {
      update(newContent: string) {
        if (!newContent || !monthFile) {
          node.empty();
          return;
        }
        node.empty();
        markdownComponent.unload();
        markdownComponent.load();
        MarkdownRenderer.renderMarkdown(newContent, node, monthFile.path, markdownComponent).then(() => {
          resolveImagePaths(node);
        });
      },
      destroy() {
        node.removeEventListener("click", handleInternalLinkClick);
      },
    };
  }

  async function createMonthlyNote() {
    if (!displayedMonth) return;
    await tryToCreateMonthlyNote(displayedMonth, false, currentSettings, () => {
      monthlyNotes.reindex();
    });
  }

  // Click on month label to create monthly note
  // Use capture phase to intercept before CalendarBase's resetDisplayedMonth
  let calendarWrapper: HTMLElement | null = null;

  function handleMonthLabelClick(e: Event) {
    const target = e.target as HTMLElement;
    // Only respond to clicks on the month label span
    if (!target.closest(".month")) return;
    if (!currentSettings?.showMonthlyNote) return;
    e.stopPropagation();
    e.preventDefault();

    if (monthFile) {
      // Monthly note exists — open it
      window.app.workspace.getUnpinnedLeaf().openFile(monthFile, { active: true });
    } else {
      // No monthly note — create it
      createMonthlyNote();
    }
  }

  // Svelte action to attach capture-phase listener when the wrapper mounts
  function monthClickAction(node: HTMLElement) {
    calendarWrapper = node;
    node.addEventListener("click", handleMonthLabelClick, true); // capture phase

    return {
      destroy() {
        node.removeEventListener("click", handleMonthLabelClick, true);
        calendarWrapper = null;
      },
    };
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
    if (settings.showCanvasSchedules) {
      canvasSchedules.reindex(settings);
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
    markdownComponent.unload();
  });
</script>

<div class="calendar-wrapper" use:monthClickAction>
  <CalendarBase
    {sources}
    {today}
    {onHoverDay}
    {onHoverWeek}
    onClickDay={currentSettings?.showMonthlyNote ? handleDayClick : onClickDay}
    {onClickWeek}
    bind:displayedMonth
    localeData={today.localeData()}
    selectedId={$activeFile}
    showWeekNums={$settings.showWeeklyNote}
  />

  {#if currentSettings?.showMonthlyNote && displayedMonth}
    <!-- Monthly note content rendered below calendar container -->
    {#if monthFile && Object.keys(dayContents).filter(d => dayContents[d]?.trim()).length > 0}
      <div class="mt-content-section">
        {#each daysWithTasks as day}
          {#if dayContents[day] || editingDay === day}
            <div class="mt-day-block">
              <div class="mt-day-label">Day {day}</div>
              {#if editingDay === day}
                <div class="mt-edit-area">
                  <textarea
                    class="mt-edit-textarea"
                    bind:value={editText}
                    placeholder="Enter Markdown content..."
                    on:focus={onTextareaFocus}
                    on:input={() => { hasEdited = true; }}
                    on:blur={() => onTextareaBlur(day)}
                    on:keydown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
                  ></textarea>
                </div>
              {:else}
                <div
                  class="mt-markdown-content"
                  use:renderMarkdown={dayContents[day]}
                  on:dblclick={() => startEditDay(day)}
                  title="Double-click to edit"
                ></div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  {/if}

  {#if currentSettings?.showCanvasSchedules && daysWithCanvasSchedules.length > 0}
    <div class="canvas-schedules-section">
      <div class="canvas-schedules-title">{t('calendar.canvasSchedules')}</div>
      {#each daysWithCanvasSchedules as day}
        <div class="canvas-schedule-day">
          <div class="canvas-schedule-day-label">
            {displayedMonth.format("YYYY-MM")}-{day}
          </div>
          {#each canvasDaySchedules[day] as schedule}
            <div
              class="canvas-schedule-item"
              role="button"
              tabindex="0"
              on:click={() => openCanvasSchedule(schedule)}
              on:keydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openCanvasSchedule(schedule);
                }
              }}
            >
              <span class="canvas-schedule-content">{schedule.content}</span>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .calendar-wrapper {
    position: relative;
    display: flex;
    flex-direction: column;
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

  .canvas-schedules-section {
    margin-top: 8px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    overflow: hidden;
  }

  .canvas-schedules-title {
    padding: 8px 12px;
    font-size: 14px;
    font-weight: 700;
    color: var(--text-accent);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .canvas-schedule-day {
    padding: 8px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .canvas-schedule-day:last-child {
    border-bottom: none;
  }

  .canvas-schedule-day-label {
    margin-bottom: 4px;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
  }

  .canvas-schedule-item {
    padding: 3px 0;
    font-size: 13px;
    cursor: pointer;
    border-radius: 4px;
  }

  .canvas-schedule-item:hover {
    background: var(--background-modifier-hover);
  }

  .canvas-schedule-content {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
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

  /* Task list (checkbox) alignment fix */
  .mt-markdown-content :global(.task-list-item) {
    display: flex;
    align-items: baseline;
    gap: 6px;
    list-style: none;
    margin-left: -20px;
  }

  .mt-markdown-content :global(.task-list-item-checkbox) {
    margin: 0;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    position: relative;
    top: 2px;
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

  /* Edit area */
  .mt-edit-area {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .mt-edit-textarea {
    width: 100%;
    min-height: 80px;
    padding: 8px;
    font-size: 13px;
    font-family: var(--font-monospace);
    line-height: 1.5;
    color: var(--text-normal);
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    resize: vertical;
  }

  .mt-edit-textarea:focus {
    border-color: var(--interactive-accent);
    outline: none;
  }
</style>
