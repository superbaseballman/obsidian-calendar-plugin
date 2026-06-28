import { App, Menu, Point, TFile } from "obsidian";
import { t } from "../i18n";

export function showFileMenu(app: App, file: TFile, position: Point): void {
  const fileMenu = new Menu(app);
  fileMenu.addItem((item) =>
    item
      .setTitle(t('fileMenu.delete'))
      .setIcon("trash")
      .onClick(() => {
        (app as { fileManager: { promptForFileDeletion: (file: TFile) => void } }).fileManager.promptForFileDeletion(file);
      })
  );

  app.workspace.trigger(
    "file-menu",
    fileMenu,
    file,
    "calendar-context-menu",
    null
  );
  fileMenu.showAtPosition(position);
}
