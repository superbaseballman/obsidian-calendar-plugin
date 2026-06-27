<script lang="ts">
  import type { Moment } from "moment";
  import type { TFile } from "obsidian";
  import { onDestroy } from "svelte";

  import {
    parseMonthlyNoteTasks,
    saveMonthlyNoteTasks,
    getMonthlyNote,
    tryToCreateMonthlyNote,
  } from "src/io/monthlyNotes";
  import type { ISettings } from "src/settings";
  import { monthlyNotes, settings } from "./stores";

  export let displayedMonth: Moment;
  export let onMonthNoteCreated: () => void;

  let tasks: Record<string, string[]> = {};
  let currentFile: TFile | null = null;
  let newTaskText: string = "";
  let selectedDay: string = "";
  let isLoading: boolean = false;
  let currentSettings: ISettings;

  const unsubSettings = settings.subscribe((val) => {
    currentSettings = val;
  });

  let lastLoadedMonth: string = "";

  $: monthLabel = displayedMonth ? displayedMonth.format("YYYY-MM") : "";

  $: {
    const monthKey = displayedMonth ? displayedMonth.format("YYYY-MM") : "";
    const notes = $monthlyNotes;
    if (displayedMonth && notes && monthKey !== lastLoadedMonth) {
      lastLoadedMonth = monthKey;
      loadMonthTasks(displayedMonth);
    }
  }

  // Days that actually have tasks
  $: daysWithTasks = Object.keys(tasks)
    .filter((d) => tasks[d] && tasks[d].length > 0)
    .sort((a, b) => parseInt(a) - parseInt(b));

  async function loadMonthTasks(date: Moment) {
    isLoading = true;
    currentFile = getMonthlyNote(date, $monthlyNotes);
    if (currentFile) {
      try {
        const content = await window.app.vault.cachedRead(currentFile);
        tasks = parseMonthlyNoteTasks(content);
      } catch (err) {
        console.log("[Calendar] Failed to read monthly note", err);
        tasks = {};
      }
    } else {
      tasks = {};
    }
    selectedDay = "";
    isLoading = false;
  }

  function getDaysInMonth(date: Moment): string[] {
    if (!date) return [];
    const total = date.daysInMonth();
    const days: string[] = [];
    for (let i = 1; i <= total; i++) {
      days.push(String(i).padStart(2, "0"));
    }
    return days;
  }

  function selectDay(day: string) {
    selectedDay = day;
    newTaskText = "";
  }

  async function addTask() {
    if (!newTaskText.trim() || !selectedDay) return;

    if (!currentFile) {
      await tryToCreateMonthlyNote(displayedMonth, false, currentSettings);
      monthlyNotes.reindex();
      currentFile = getMonthlyNote(displayedMonth, $monthlyNotes);
      if (!currentFile) return;
    }

    if (!tasks[selectedDay]) {
      tasks[selectedDay] = [];
    }
    tasks[selectedDay] = [...tasks[selectedDay], newTaskText.trim()];
    newTaskText = "";

    await saveToFile();
  }

  async function removeTask(day: string, index: number) {
    if (!currentFile) return;

    tasks[day] = tasks[day].filter((_, i) => i !== index);
    if (tasks[day].length === 0) {
      delete tasks[day];
      if (selectedDay === day) {
        selectedDay = "";
      }
    }

    await saveToFile();
  }

  async function saveToFile() {
    if (!currentFile || !displayedMonth) return;

    const monthTitle = displayedMonth.format("YYYY-MM");
    await saveMonthlyNoteTasks(currentFile, tasks, monthTitle);
    tasks = { ...tasks };
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      addTask();
    }
  }

  async function createMonthlyNote() {
    if (!displayedMonth) return;
    await tryToCreateMonthlyNote(displayedMonth, false, currentSettings, () => {
      monthlyNotes.reindex();
      onMonthNoteCreated?.();
    });
  }

  onDestroy(() => {
    unsubSettings();
  });
</script>

{#if currentSettings?.showMonthlyNote && displayedMonth}
  <div class="monthly-tasks-container">
    <div class="monthly-tasks-header">
      <h3>📋 {monthLabel} 月记事项</h3>
      {#if !currentFile}
        <button class="create-monthly-note-btn" on:click={createMonthlyNote}>
          创建月记
        </button>
      {/if}
    </div>

    {#if isLoading}
      <div class="monthly-tasks-loading">加载中...</div>
    {:else if currentFile}
      <!-- Day selector grid: click a day to add tasks -->
      <div class="day-picker">
        {#each getDaysInMonth(displayedMonth) as day}
          <button
            class="day-pick-btn"
            class:has-tasks={tasks[day] && tasks[day].length > 0}
            class:selected={selectedDay === day}
            on:click={() => selectDay(day)}
          >
            {parseInt(day)}
          </button>
        {/each}
      </div>

      <!-- Input for the selected day -->
      {#if selectedDay}
        <div class="selected-day-input">
          <span class="input-label">{selectedDay} 日：</span>
          <input
            type="text"
            placeholder="输入事项后回车添加..."
            bind:value={newTaskText}
            on:keydown={handleKeydown}
          />
          <button class="task-add-btn" on:click={addTask} title="添加">+</button>
        </div>
      {:else}
        <div class="day-picker-hint">👆 点击日期添加事项</div>
      {/if}

      <!-- Only show days that have tasks -->
      {#if daysWithTasks.length > 0}
        <div class="monthly-tasks-content">
          {#each daysWithTasks as day}
            <div class="monthly-day-section">
              <div class="monthly-day-header">
                <button
                  class="day-number-btn"
                  class:selected={selectedDay === day}
                  on:click={() => selectDay(day)}
                >
                  {day}
                </button>
              </div>
              <div class="monthly-day-tasks">
                {#each tasks[day] as task, index}
                  <div class="monthly-task-item">
                    <span class="task-text">{task}</span>
                    <button
                      class="task-remove-btn"
                      on:click={() => removeTask(day, index)}
                      title="删除"
                    >
                      ×
                    </button>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      <div class="monthly-tasks-empty">
        <p>当前月份暂无月记文件</p>
        <button class="create-monthly-note-btn" on:click={createMonthlyNote}>
          创建月记
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .monthly-tasks-container {
    margin-top: 16px;
    padding: 12px;
    background: var(--background-secondary);
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border);
  }

  .monthly-tasks-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }

  .monthly-tasks-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-normal);
  }

  .create-monthly-note-btn {
    padding: 4px 12px;
    font-size: 12px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .create-monthly-note-btn:hover {
    background: var(--interactive-accent-hover);
  }

  .monthly-tasks-loading,
  .monthly-tasks-empty {
    text-align: center;
    padding: 16px;
    color: var(--text-muted);
    font-size: 13px;
  }

  /* Day picker grid */
  .day-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 10px;
    padding: 8px;
    background: var(--background-primary);
    border-radius: 6px;
    border: 1px solid var(--background-modifier-border);
  }

  .day-pick-btn {
    width: 30px;
    height: 28px;
    font-size: 12px;
    line-height: 1;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.1s;
  }

  .day-pick-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .day-pick-btn.has-tasks {
    background: var(--background-modifier-success);
    color: var(--text-accent);
    font-weight: 600;
  }

  .day-pick-btn.selected {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-color: var(--interactive-accent);
    font-weight: 600;
  }

  .day-picker-hint {
    text-align: center;
    font-size: 12px;
    color: var(--text-faint);
    margin-bottom: 8px;
  }

  /* Selected day input */
  .selected-day-input {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
    padding: 8px;
    background: var(--background-primary);
    border-radius: 6px;
    border: 1px solid var(--background-modifier-border);
  }

  .input-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-accent);
    white-space: nowrap;
  }

  .selected-day-input input {
    flex: 1;
    padding: 4px 8px;
    font-size: 13px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    color: var(--text-normal);
  }

  .selected-day-input input::placeholder {
    color: var(--text-faint);
  }

  .selected-day-input input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .task-add-btn {
    padding: 4px 10px;
    font-size: 14px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    line-height: 1;
  }

  .task-add-btn:hover {
    background: var(--interactive-accent-hover);
  }

  /* Task list (only days with tasks) */
  .monthly-tasks-content {
    max-height: 300px;
    overflow-y: auto;
  }

  .monthly-day-section {
    display: flex;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .monthly-day-section:last-child {
    border-bottom: none;
  }

  .monthly-day-header {
    min-width: 36px;
    text-align: center;
    padding-top: 2px;
  }

  .day-number-btn {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-accent);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
  }

  .day-number-btn:hover {
    background: var(--background-modifier-hover);
  }

  .day-number-btn.selected {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .monthly-day-tasks {
    flex: 1;
    min-width: 0;
  }

  .monthly-task-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 3px 0;
    gap: 8px;
  }

  .task-text {
    flex: 1;
    font-size: 13px;
    color: var(--text-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-remove-btn {
    opacity: 0;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    padding: 0 4px;
    line-height: 1;
    transition: opacity 0.15s;
  }

  .monthly-task-item:hover .task-remove-btn {
    opacity: 1;
  }

  .task-remove-btn:hover {
    color: var(--text-error);
  }
</style>
