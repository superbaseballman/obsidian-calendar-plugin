import { App, Modal } from "obsidian";
import type { Moment } from "moment";

interface IConfirmationDialogParams {
  cta: string;
  // eslint-disable-next-line
  onAccept: (...args: any[]) => Promise<void>;
  text: string;
  title: string;
}

export interface IDateActionCallbacks {
  onOpenDailyNote: (date: Moment) => void;
  onAddItem: (date: Moment) => void;
}

/**
 * Modal dialog shown when clicking a calendar date.
 * Presents options: open daily note or add item to monthly note.
 */
export class DateActionModal extends Modal {
  private date: Moment;
  private callbacks: IDateActionCallbacks;

  constructor(app: App, date: Moment, callbacks: IDateActionCallbacks) {
    super(app);
    this.date = date;
    this.callbacks = callbacks;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    // Title
    contentEl.createEl("h2", {
      text: this.date.format("YYYY年MM月DD日"),
      cls: "date-action-title",
    });

    // Action buttons container
    const btnContainer = contentEl.createDiv("date-action-buttons");

    // Option 1: Open daily note
    const dailyBtn = btnContainer.createEl("button", {
      text: "📝 记日记",
      cls: "date-action-btn",
    });
    dailyBtn.addEventListener("click", () => {
      this.close();
      this.callbacks.onOpenDailyNote(this.date);
    });

    // Option 2: Open monthly note for editing
    const addBtn = btnContainer.createEl("button", {
      text: "📋 打开月记",
      cls: "date-action-btn",
    });
    addBtn.addEventListener("click", () => {
      this.close();
      this.callbacks.onAddItem(this.date);
    });

    // Cancel button
    const cancelBtn = contentEl.createEl("button", {
      text: "取消",
      cls: "date-action-cancel",
    });
    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class ConfirmationModal extends Modal {
  constructor(app: App, config: IConfirmationDialogParams) {
    super(app);

    const { cta, onAccept, text, title } = config;

    this.contentEl.createEl("h2", { text: title });
    this.contentEl.createEl("p", { text });

    this.contentEl.createDiv("modal-button-container", (buttonsEl) => {
      buttonsEl
        .createEl("button", { text: "Never mind" })
        .addEventListener("click", () => this.close());

      buttonsEl
        .createEl("button", {
          cls: "mod-cta",
          text: cta,
        })
        .addEventListener("click", async (e) => {
          await onAccept(e);
          this.close();
        });
    });
  }
}

export function createConfirmationDialog({
  cta,
  onAccept,
  text,
  title,
}: IConfirmationDialogParams): void {
  new ConfirmationModal(window.app, { cta, onAccept, text, title }).open();
}
