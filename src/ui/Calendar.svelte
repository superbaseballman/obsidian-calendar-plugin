<svelte:options immutable />

<script lang="ts">
  import type { Moment } from "moment";
  import type { TFile } from "obsidian";
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
  import { activeFile, dailyNotes, settings, weeklyNotes, monthlyNotes } from "./stores";
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
  export let onContextMenuDay: (date: Moment, event: MouseEvent) => boolean;
  export let onContextMenuWeek: (date: Moment, event: MouseEvent) => boolean;

  // --- Monthly tasks state ---
  let monthFile: TFile | null = null;
  let lastLoadedMonth: string = "";
  let currentSettings: ISettings;

  // Monthly note content rendering
  let dayContents: Record<string, string> = {};

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

  $: daysWithTasks = Object.keys(dayContents)
    .filter((d) => dayContents[d] && dayContents[d].trim().length > 0)
    .sort((a, b) => parseInt(a) - parseInt(b));

  async function loadMonthTasks(date: Moment) {
    monthFile = getMonthlyNote(date, $monthlyNotes);
    if (monthFile) {
      try {
        const content = await window.app.vault.cachedRead(monthFile);
        dayContents = parseMonthlyNoteSections(content);
      } catch (err) {
        console.log("[Calendar] Failed to read monthly note", err);
        dayContents = {};
      }
    } else {
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
      },
      onAddItem: (d: Moment) => {
        openMonthlyNoteForEdit(d);
      },
    });
    modal.open();
    return false;
  }

  async function openMonthlyNoteForEdit(date: Moment) {
    const { workspace, vault } = window.app;
    
    // Get or create monthly note
    let file = getMonthlyNote(displayedMonth, $monthlyNotes);
    if (!file) {
      await tryToCreateMonthlyNote(displayedMonth, false, currentSettings);
      monthlyNotes.reindex();
      file = getMonthlyNote(displayedMonth, $monthlyNotes);
    }
    
    if (file) {
      // Ensure the day section exists, create it if not
      const dayStr = date.format("DD");
      let content = await vault.cachedRead(file);
      const lines = content.split("\n");
      let targetLine = -1;
      
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(new RegExp(`^##\\s+${dayStr}`))) {
          targetLine = i;
          break;
        }
      }
      
      // Day section doesn't exist — append it
      if (targetLine < 0) {
        const newSection = `\n\n## ${dayStr}\n`;
        await vault.modify(file, content.trimEnd() + newSection);
        // Re-read to get updated content and find the new line
        content = await vault.cachedRead(file);
        const updatedLines = content.split("\n");
        for (let i = 0; i < updatedLines.length; i++) {
          if (updatedLines[i].match(new RegExp(`^##\\s+${dayStr}`))) {
            targetLine = i;
            break;
          }
        }
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
  }

  function cancelEdit() {
    editingDay = null;
    editText = "";
  }

  async function saveEditDay(day: string) {
    if (!monthFile) return;
    const newContent = editText.trim();
    try {
      await saveDaySection(monthFile, day, newContent);
      // Update local state immediately
      dayContents[day] = newContent;
      dayContents = { ...dayContents };
      editingDay = null;
      editText = "";
    } catch (err) {
      console.log("[Calendar] Failed to save day section", err);
    }
  }

  export function refreshMonthlyContent() {
    if (displayedMonth) {
      loadMonthTasks(displayedMonth);
    }
  }

  function resolveImagePaths(node: HTMLElement) {
    if (!monthFile) return;
    const images = node.querySelectorAll("img");
    const folder = monthFile.parent?.path || "";
    images.forEach((img) => {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("app://") || src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
        return; // skip already resolved or external URLs
      }
      // Resolve relative path to absolute vault path
      let absPath = src;
      if (!src.startsWith("/")) {
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
        absPath = parts.join("/");
      } else {
        absPath = src.slice(1); // remove leading /
      }
      // Use Obsidian vault to get the resource URL
      const file = window.app.vault.getAbstractFileByPath(absPath);
      if (file) {
        const resourcePath = window.app.vault.getResourcePath(file);
        img.setAttribute("src", resourcePath);
      }
    });
  }

  function renderMarkdown(node: HTMLElement, content: string) {
    if (!content || !monthFile) {
      node.empty();
      return;
    }
    node.empty();
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
    markdownComponent.unload();
  });
</script>

<div class="calendar-wrapper">
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
                  ></textarea>
                  <div class="mt-edit-actions">
                    <button class="mt-edit-save" on:click={() => saveEditDay(day)}>Save</button>
                    <button class="mt-edit-cancel" on:click={cancelEdit}>Cancel</button>
                  </div>
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
    {:else if !monthFile}
      <div class="mt-empty">
        <span>No monthly note</span>
        <button class="mt-create-btn" on:click={createMonthlyNote}>Create {monthLabel}</button>
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

  .mt-edit-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }

  .mt-edit-save {
    padding: 4px 12px;
    font-size: 12px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .mt-edit-save:hover {
    background: var(--interactive-accent-hover);
  }

  .mt-edit-cancel {
    padding: 4px 12px;
    font-size: 12px;
    background: var(--background-primary);
    color: var(--text-muted);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    cursor: pointer;
  }

  .mt-edit-cancel:hover {
    color: var(--text-normal);
    border-color: var(--text-muted);
  }
</style>
