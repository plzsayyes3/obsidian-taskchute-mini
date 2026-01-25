// main.js
// TaskChute Min Plugin（Obsidian）
//
//✔️コア機能
// - Open Today / Prev Day / Next Day（logFolderPath/YYYY-MM-DD.md を開く。無ければ作成）
// - Insert Task Line（## セクション末尾に親行を追加）
// - Insert & Start（親行 + tc:id 付与 + ⌛ 子行を追加して開始）
// - Start（親行に tc:id を付与。⌛ 子行があれば開始時刻だけ入れる／無ければ追加）
// - End（stateなし運用：開いているログをスキャンして「未完了⌛」を✔️に変換）
// - End & Start（同一ファイルで「未完了⌛」を終了 → ファイル先頭の未処理タスクを開始。📝親は除外）
// - Resume（最新の✔️を ⌛ に戻す）
// - Insert Memo（タスク直下のみ）
// - Recalculate Duration（✔️ 行の +Xm を再計算：カーソル行 or 親配下の最新✔️）
// - Settings（logFolderPath / templateFolderPath / dimMode を変更可能）
//
//✔️UI / 表示拡張
// - Player Mode（taskchuteログを開いていて、モバイルでキーボードが閉じている時だけ表示）
//   - [入力モード] / [≡] / [▷▷ End&Start] / [▶ Start] / [■ End] / [＜ 上] / [＞ 下]
//   - 上下ボタンは「行フォーカス」＝エディタのカーソルを 1 行移動（本文は変更しない）
// - Focus Mode（本文を書き換えず、表示だけ）
//   - 親行（トップレベル - ）は表示
//   - 子行は「⌛ 行だけ表示」、それ以外の子行は非表示（CSSで隠す）
//
//✔️アイコン
// - コマンドに icon を付与（モバイルツールバーで「？」にならない）
// - カスタムアイコン tc-hourglass を addIcon() で登録
//
// ⚠️ CSS について
// - Player Mode の見た目（.taskchute-player など）は styles.css に入れてください。
//   main.js に CSS を混ぜると VS Code / Obsidian で構文エラーになります。

const { Plugin, Notice, MarkdownView, addIcon, Menu, PluginSettingTab, Setting, TFolder, TFile } = require("obsidian");

// Focus Mode（CodeMirror6 行デコレーション用）
const { ViewPlugin, Decoration } = require("@codemirror/view");
const { RangeSetBuilder } = require("@codemirror/state");

const DEFAULT_SETTINGS = {
  logFolderPath: "taskchute",
  templateFolderPath: "",
  dimMode: true,
  enableTemplates: false,
  enableFocusMode: false,
  enableFilterMode: false,
  enablePlayerMode: false,
  enableMobileToolbar: false,
  mobileToolbarRow1Enabled: true,
  mobileToolbarRow2Enabled: true,
  mobileToolbarRow3Enabled: true,
  mobileToolbarRow3Collapsed: true,
  playerDefaultView: "player",
  playerMenuAction: "toggle_grid",
  playerGridBindings: [
    "start",
    "end",
    "endAndStart",
    "insertAndStart",
    "openToday",
    "openPrevDay",
    "openNextDay",
    "toggleFocus",
  ],
  settingsVersion: 1,
};

function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = class TaskChuteMinPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    // =================================================
    //✔️カスタムアイコン登録（任意）
    // =================================================
    addIcon(
      "tc-hourglass",
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 2h12"/>
        <path d="M6 22h12"/>
        <path d="M8 2v6a4 4 0 0 0 2 3l2 1 2-1a4 4 0 0 0 2-3V2"/>
        <path d="M8 22v-6a4 4 0 0 1 2-3l2-1 2 1a4 4 0 0 1 2 3v6"/>
      </svg>`
    );

    // =================================================
    // Player / Focus / Filter Mode state（手動トグル）
    // =================================================
    this.playerMode = false;
    this.playerEl = null;
    this.playerTopEl = null;
    this.playerBottomEl = null;
    this.playerDisplayEl = null;
    this.nowPlayingTitleEl = null;
    this.nowPlayingSubEl = null;
    this.playerHeaderEl = null;
    this.playerHeaderMainEl = null;
    this.playerHeaderEtaEl = null;
    this.playerView = "player";
    this.playerNowPlayingTimer = null;
    this.playerHeaderTimerSec = null;
    this.playerHeaderTimerMin = null;
    this.playerHeaderLastEtaMinute = null;
    this.mobileToolbarEl = null;
    this.mobileToolbarRow3Collapsed = this.settings.mobileToolbarRow3Collapsed;
    this.oneLineMode = false;

    this.focusMode = false;
    this.filterMode = false;
    this.isTaskchuteActiveFlag = false;

    // Player Mode: 表示条件を監視（アクティブファイル / キーボード開閉）
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.updateTaskchuteActiveFlag();
        this.updatePlayerVisibility();
        this.updateMobileToolbarVisibility();
        this.refreshAllMarkdownEditors();
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.updateTaskchuteActiveFlag();
        this.updatePlayerVisibility();
        this.updateMobileToolbarVisibility();
        this.refreshAllMarkdownEditors();
      })
    );

    // iOS/Android キーボード推定：visualViewport の高さ変化を見る
    if (window.visualViewport) {
      this.registerDomEvent(window.visualViewport, "resize", () => {
        this.updatePlayerVisibility();
        this.updateMobileToolbarVisibility();
      });
    }
    this.registerDomEvent(window, "resize", () => {
      this.updatePlayerVisibility();
      this.updateMobileToolbarVisibility();
    });

    this.applyDisplaySettings();
    this.updateTaskchuteActiveFlag();
    // Focus Mode + Dim（表示のみ・本文非変更）
    this.registerEditorExtension(this.buildFocusModeExtension());
    // Filter Mode（表示のみ・本文非変更）
    this.registerEditorExtension(this.buildFilterModeExtension());
    // Metadata Ghosting / Estimate Badge（表示のみ）
    this.registerEditorExtension(this.buildMetadataDecorationExtension());

    this.registerSuggestStyles();
    this.addSettingTab(new TaskChuteSettingTab(this.app, this));

    // =================================================
    // Commands
    // =================================================
    this.addCommand({
      id: "taskchute-open-today",
      name: "TaskChute: Open Today",
      icon: "calendar",
      callback: () => this.openToday(),
    });

    this.addCommand({
      id: "taskchute-open-prev-day",
      name: "TaskChute: Open Previous Day",
      icon: "chevron-left",
      callback: () => this.openPrevDay(),
    });

    this.addCommand({
      id: "taskchute-open-next-day",
      name: "TaskChute: Open Next Day",
      icon: "chevron-right",
      callback: () => this.openNextDay(),
    });

    this.addCommand({
      id: "taskchute-toggle-player-mode",
      name: "TaskChute: Toggle Player Mode",
      icon: "keyboard",
      callback: () => this.togglePlayerMode(),
    });

    this.addCommand({
      id: "taskchute-toggle-focus-mode",
      name: "TaskChute: Toggle Focus Mode",
      icon: "eye",
      callback: () => this.toggleFocusMode(),
    });

    this.addCommand({
      id: "taskchute-toggle-filter-mode",
      name: "TaskChute: Toggle Filter Mode",
      icon: "filter",
      callback: () => this.toggleFilterMode(),
    });

    this.addCommand({
      id: "taskchute-insert-task-line",
      name: "TaskChute: Insert Task Line",
      icon: "plus",
      callback: () => this.insertTaskLine(),
    });

    this.addCommand({
      id: "taskchute-add-task",
      name: "TaskChute: Add Task",
      icon: "plus",
      callback: () => this.addTaskSibling(),
    });

    this.addCommand({
      id: "taskchute-debug-list-templates",
      name: "TaskChute: Debug List Templates",
      icon: "list",
      callback: () => this.debugListTemplates(),
    });

    this.addCommand({
      id: "taskchute-insert-templates-multi",
      name: "TaskChute: Insert Templates (Multi Select)",
      icon: "list",
      callback: () => this.insertTemplatesMultiSelect(),
    });

    this.addCommand({
      id: "taskchute-copy-from-previous-day",
      name: "TaskChute: Copy From Previous Day",
      icon: "copy",
      callback: () => this.copyFromPreviousDay(),
    });

    this.addCommand({
      id: "taskchute-insert-and-start",
      name: "TaskChute: Insert Task Line and Start",
      icon: "tc-hourglass",
      callback: () => this.insertAndStartTask(),
    });

    this.addCommand({
      id: "taskchute-start",
      name: "TaskChute: Start",
      icon: "play",
      callback: () => this.startTask(),
    });

    this.addCommand({
      id: "taskchute-start-from-latest-done-time",
      name: "TaskChute: Start From Latest Done Time",
      icon: "play",
      callback: () => this.startTaskFromLatestDoneTime(),
    });

    this.addCommand({
      id: "taskchute-end",
      name: "TaskChute: End",
      icon: "square",
      callback: () => this.endTask(),
    });

    this.addCommand({
      id: "taskchute-end-at-estimate",
      name: "TaskChute: End At Estimate",
      icon: "clock",
      callback: () => this.endTaskAtEstimate(),
    });

    this.addCommand({
      id: "taskchute-end-and-start",
      name: "TaskChute: End and Start",
      icon: "skip-forward",
      callback: () => this.endAndStartTask(),
    });

    this.addCommand({
      id: "taskchute-insert-memo-line",
      name: "TaskChute: Insert Memo Line",
      icon: "sticky-note",
      callback: () => this.insertMemoLine(),
    });

    this.addCommand({
      id: "taskchute-resume",
      name: "TaskChute: Resume",
      icon: "rotate-ccw",
      callback: () => this.resumeTask(),
    });

    this.addCommand({
      id: "taskchute-recalc-duration",
      name: "TaskChute: Recalculate Duration (+Xm)",
      icon: "calculator",
      callback: () => this.recalculateDurationFromActiveLine(),
    });

    this.addCommand({
      id: "taskchute-set-estimate",
      name: "TaskChute: Set Estimate (minutes)",
      icon: "clock",
      callback: () => this.setEstimateMinutes(),
    });

    // =================================================
    // スマホ操作用：リボン
    // =================================================
    this.addRibbonIcon("chevron-left", "TaskChute: Open Previous Day", () => this.openPrevDay());
    this.addRibbonIcon("calendar", "TaskChute: Open Today", () => this.openToday());
    this.addRibbonIcon("chevron-right", "TaskChute: Open Next Day", () => this.openNextDay());

    this.addRibbonIcon("plus", "TaskChute: Insert Task Line", () => this.insertTaskLine());
    this.addRibbonIcon("tc-hourglass", "TaskChute: Insert Task Line and Start", () =>
      this.insertTaskLineAndStartFromRibbon()
    );

    this.addRibbonIcon("square", "TaskChute: End", () => this.endTask());
    this.addRibbonIcon("skip-forward", "TaskChute: End and Start", () => this.endAndStartTask());
  }

  onunload() {
    document.body.classList.remove("taskchute-focus");
    this.stopPlayerNowPlayingTicker();
    this.stopPlayerHeaderTimers();
    this.destroyPlayerUI();
    this.destroyMobileToolbarUI();
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    let changed = false;
    const normalized = this.normalizeLogFolderPath(this.settings.logFolderPath);
    this.settings.logFolderPath = normalized || DEFAULT_SETTINGS.logFolderPath;
    const template = this.normalizeTemplateFolderPath(this.settings.templateFolderPath);
    this.settings.templateFolderPath = template != null ? template : "";
    if (typeof this.settings.dimMode !== "boolean") {
      this.settings.dimMode = DEFAULT_SETTINGS.dimMode;
      changed = true;
    }
    if (typeof this.settings.enableTemplates !== "boolean") {
      this.settings.enableTemplates = DEFAULT_SETTINGS.enableTemplates;
      changed = true;
    }
    if (typeof this.settings.enableFocusMode !== "boolean") {
      this.settings.enableFocusMode = DEFAULT_SETTINGS.enableFocusMode;
      changed = true;
    }
    if (typeof this.settings.enableFilterMode !== "boolean") {
      this.settings.enableFilterMode = DEFAULT_SETTINGS.enableFilterMode;
      changed = true;
    }
    if (typeof this.settings.enablePlayerMode !== "boolean") {
      this.settings.enablePlayerMode = DEFAULT_SETTINGS.enablePlayerMode;
      changed = true;
    }
    if (typeof this.settings.enableMobileToolbar !== "boolean") {
      this.settings.enableMobileToolbar = DEFAULT_SETTINGS.enableMobileToolbar;
      changed = true;
    }
    if (typeof this.settings.mobileToolbarRow1Enabled !== "boolean") {
      this.settings.mobileToolbarRow1Enabled = DEFAULT_SETTINGS.mobileToolbarRow1Enabled;
      changed = true;
    }
    if (typeof this.settings.mobileToolbarRow2Enabled !== "boolean") {
      this.settings.mobileToolbarRow2Enabled = DEFAULT_SETTINGS.mobileToolbarRow2Enabled;
      changed = true;
    }
    if (typeof this.settings.mobileToolbarRow3Enabled !== "boolean") {
      this.settings.mobileToolbarRow3Enabled = DEFAULT_SETTINGS.mobileToolbarRow3Enabled;
      changed = true;
    }
    if (typeof this.settings.mobileToolbarRow3Collapsed !== "boolean") {
      this.settings.mobileToolbarRow3Collapsed = DEFAULT_SETTINGS.mobileToolbarRow3Collapsed;
      changed = true;
    }
    if (!["player", "grid"].includes(this.settings.playerDefaultView)) {
      this.settings.playerDefaultView = DEFAULT_SETTINGS.playerDefaultView;
      changed = true;
    }
    if (!["toggle_grid", "open_menu", "both"].includes(this.settings.playerMenuAction)) {
      this.settings.playerMenuAction = DEFAULT_SETTINGS.playerMenuAction;
      changed = true;
    }
    if (!Array.isArray(this.settings.playerGridBindings)) {
      this.settings.playerGridBindings = DEFAULT_SETTINGS.playerGridBindings.slice();
      changed = true;
    } else if (this.settings.playerGridBindings.length < 8) {
      const filled = this.settings.playerGridBindings.slice();
      while (filled.length < 8) filled.push(DEFAULT_SETTINGS.playerGridBindings[filled.length]);
      this.settings.playerGridBindings = filled;
      changed = true;
    }
    if (typeof this.settings.settingsVersion !== "number") {
      this.settings.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
      changed = true;
    }
    if (changed) {
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  normalizeLogFolderPath(input) {
    const raw = String(input || "").trim();
    if (!raw) return null;
    if (raw.startsWith("/")) return null;
    const trimmed = raw.replace(/\/+$/, "");
    if (!trimmed) return null;
    if (trimmed.includes("..")) return null;
    return trimmed;
  }

  normalizeTemplateFolderPath(input) {
    const raw = String(input || "").trim();
    if (raw === "") return "";
    if (raw.startsWith("/")) return null;
    const trimmed = raw.replace(/\/+$/, "");
    if (!trimmed) return null;
    if (trimmed.includes("..")) return null;
    return trimmed;
  }

  ensureFolderExists(path) {
    const normalized = this.normalizeLogFolderPath(path);
    if (!normalized) return Promise.resolve();

    const vault = this.app.vault;
    const parts = normalized.split("/").filter(Boolean);
    let current = "";

    return parts.reduce((p, part) => {
      return p.then(async () => {
        current = current ? `${current}/${part}` : part;
        const existing = vault.getAbstractFileByPath(current);
        if (!existing) {
          await vault.createFolder(current);
        }
      });
    }, Promise.resolve());
  }

  registerSuggestStyles() {
    const style = document.createElement("style");
    style.textContent = `
.taskchute-suggest {
  position: absolute;
  z-index: 1000;
  margin-top: 6px;
  padding: 6px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  background: var(--background-primary);
  box-shadow: var(--shadow-s);
  max-height: 240px;
  overflow: auto;
}
.taskchute-suggest.is-hidden { display: none; }
.taskchute-suggest-item {
  padding: 6px 8px;
  border-radius: 6px;
  color: var(--text-normal);
  cursor: pointer;
}
.taskchute-suggest-item.is-selected {
  background: var(--background-secondary);
}
`;
    document.head.appendChild(style);
    this.register(() => style.remove());
  }

  // Phase 2-1: template base
  async getTemplateFiles() {
    if (!this.settings.enableTemplates) return [];
    const folder = this.settings.templateFolderPath;
    if (!folder) return [];

    const vault = this.app.vault;
    const folderAbstract = vault.getAbstractFileByPath(folder);
    if (!folderAbstract) return [];

    const files = vault
      .getFiles()
      .filter((f) => f.path.startsWith(folder + "/") && f.extension === "md");

    const result = [];
    for (const file of files) {
      const content = await vault.read(file);
      const sections = this.extractTemplateSectionsAllLevels(content);
      result.push({ file, sections });
    }

    return result;
  }

  extractTemplateSectionsAllLevels(content) {
    const lines = String(content || "").split(/\r?\n/);
    const sections = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^#{2,6}\s+/.test(line)) {
        const start = i;
        i++;
        while (i < lines.length && !/^#{1,6}\s+/.test(lines[i])) i++;
        const end = i;
        const title = line.replace(/^#{2,6}\s+/, "").trim();
        const text = lines.slice(start, end).join("\n");
        sections.push({ title, text, headingLine: line.trim() });
        continue;
      }
      i++;
    }

    return sections;
  }

  async debugListTemplates() {
    const files = await this.getTemplateFiles();
    const fileCount = files.length;
    const sectionCount = files.reduce((sum, f) => sum + f.sections.length, 0);

    console.log("[TaskChute] Template files:", fileCount);
    files.forEach((f) => {
      console.log(
        `[TaskChute] ${f.file.path}`,
        f.sections.map((s) => s.title)
      );
    });

    new Notice(`Templates: ${fileCount} files / ${sectionCount} sections`);
  }

  // Phase 2-2: multi select templates
  async insertTemplatesMultiSelect() {
    if (!this.isTaskchuteLogActive()) {
      new Notice("taskchuteログを開いてね");
      return;
    }
    if (!this.settings.templateFolderPath) {
      new Notice("テンプレフォルダが未設定");
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) return void new Notice("Markdownエディタを開いてね");
    const editor = view.editor;

    const templates = await this.getTemplateFiles();
    const candidates = [];
    for (const tpl of templates) {
      const fileName = tpl.file.path.split("/").pop() || tpl.file.path;
      for (const section of tpl.sections) {
        const heading = section.headingLine || `## ${section.title}`;
        candidates.push({
          label: `${fileName} / ${heading}`,
          text: section.text,
        });
      }
    }

    if (candidates.length === 0) {
      new Notice("テンプレが見つからないよ");
      return;
    }

    const selected = await this.pickFromMenuSequential(candidates, {
      exitLabel: "Exit / Done",
      cancelLabel: "Cancel",
    });

    if (!selected) return;
    if (selected.length === 0) {
      new Notice("何も選ばれてないよ");
      return;
    }

    const blockText = selected.map((s) => s.text.trimEnd()).join("\n\n");
    this.appendTextToEnd(editor, blockText);
  }

  // Phase 2-3: copy from previous day
  async copyFromPreviousDay() {
    if (!this.isTaskchuteLogActive()) {
      new Notice("taskchuteログを開いてね");
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) return void new Notice("Markdownエディタを開いてね");
    const editor = view.editor;

    const baseDate = this.getActiveTaskchuteDateOrToday();
    const prevDate = window.moment(baseDate, "YYYY-MM-DD").add(-1, "day").format("YYYY-MM-DD");
    const prevPath = `${this.settings.logFolderPath}/${prevDate}.md`;
    const prevFile = this.app.vault.getAbstractFileByPath(prevPath);
    if (!prevFile || !(prevFile instanceof TFile)) {
      new Notice("前日のログが見つからないよ");
      return;
    }

    const choice = await this.promptSingleMenu(
      [
        { label: "All tasks (copy whole file body except H1)", value: "all" },
        { label: "Unlogged tasks (no child OR no ✔️)", value: "unlogged" },
        { label: "Pick sections...", value: "sections" },
      ],
      { cancelLabel: "Cancel" }
    );
    if (!choice) return;

    const content = await this.app.vault.read(prevFile);

    if (choice.value === "all") {
      const body = this.stripChildLines(this.stripH1(content));
      if (!body.trim()) {
        new Notice("前日のログが空だよ");
        return;
      }
      const block = `---\n${body.trimStart()}`;
      this.appendTextToEnd(editor, block);
      if (this.focusMode || this.filterMode) {
        new Notice("Focus/Filter がONだと子行が非表示になるよ");
      }
      return;
    }

    if (choice.value === "unlogged") {
      const tasks = this.extractUnloggedParentTasks(content);
      if (tasks.length === 0) {
        new Notice("対象タスクが見つからないよ");
        return;
      }
      const blockText = tasks.join("\n");
      this.appendTextToEnd(editor, blockText);
      if (this.focusMode || this.filterMode) {
        new Notice("Focus/Filter がONだと子行が非表示になるよ");
      }
      return;
    }

    const sections = this.extractTemplateSectionsAllLevels(content);
    if (sections.length === 0) {
      new Notice("前日のセクションが見つからないよ");
      return;
    }

    const candidates = sections.map((s) => ({
      label: `Prev Day / ${s.headingLine || `## ${s.title}`}`,
      text: s.text,
    }));

    const selected = await this.pickFromMenuSequential(candidates, {
      exitLabel: "Exit / Done",
      cancelLabel: "Cancel",
    });
    if (!selected) return;
    if (selected.length === 0) {
      new Notice("何も選ばれてないよ");
      return;
    }

    const blockText = selected.map((s) => this.stripChildLines(s.text).trimEnd()).join("\n\n");
    this.appendTextToEnd(editor, blockText);
    if (this.focusMode || this.filterMode) {
      new Notice("Focus/Filter がONだと子行が非表示になるよ");
    }
  }

  pickFromMenuSequential(candidates, labels) {
    return new Promise(async (resolve) => {
      let remaining = candidates.slice();
      const picked = [];
      while (true) {
        const choice = await this.promptMenuChoice(remaining, labels);
        if (!choice) return resolve(null);
        if (choice.kind === "exit") return resolve(picked);
        if (choice.kind === "cancel") return resolve(null);

        picked.push(choice.item);
        remaining = remaining.filter((c) => c !== choice.item);
        if (remaining.length === 0) return resolve(picked);
      }
    });
  }

  promptMenuChoice(remaining, labels) {
    return new Promise((resolve) => {
      const menu = new Menu();
      let resolved = false;
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
      };

      menu.addItem((item) => item.setTitle(labels.exitLabel).onClick(() => finish({ kind: "exit" })));
      menu.addItem((item) => item.setTitle(labels.cancelLabel).onClick(() => finish({ kind: "cancel" })));
      menu.addSeparator();

      remaining.forEach((c) => {
        menu.addItem((item) => item.setTitle(c.label).onClick(() => finish({ kind: "pick", item: c })));
      });

      menu.onHide = () => finish({ kind: "cancel" });
      menu.showAtPosition({ x: Math.round(window.innerWidth * 0.5), y: 100 });
    });
  }

  promptSingleMenu(items, labels) {
    return new Promise((resolve) => {
      const menu = new Menu();
      let resolved = false;
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
      };

      menu.addItem((item) => item.setTitle(labels.cancelLabel).onClick(() => finish(null)));
      menu.addSeparator();
      items.forEach((c) => {
        menu.addItem((item) => item.setTitle(c.label).onClick(() => finish(c)));
      });

      menu.onHide = () => finish(null);
      menu.showAtPosition({ x: Math.round(window.innerWidth * 0.5), y: 100 });
    });
  }

  appendTextToEnd(editor, blockText) {
    const lastLineIndex = Math.max(0, editor.lineCount() - 1);
    const lastLineText = editor.getLine(lastLineIndex) ?? "";
    const prefix = lastLineText.trim() === "" ? "\n" : "\n\n";
    const insertText = prefix + blockText;
    const insertPos = { line: lastLineIndex, ch: lastLineText.length };
    editor.replaceRange(insertText, insertPos);
  }

  stripH1(content) {
    const lines = String(content || "").split(/\r?\n/);
    if (lines.length && /^#\s+/.test(lines[0])) lines.shift();
    while (lines.length && /^\s*$/.test(lines[0])) lines.shift();
    return lines.join("\n");
  }

  stripChildLines(content) {
    const lines = String(content || "").split(/\r?\n/);
    const kept = lines.filter((line) => {
      if (/^\s+-\s+/.test(line) && !/^-/.test(line)) return false;
      return true;
    });
    return kept.join("\n");
  }

  // Phase 2-3: unlogged task extraction (no child OR no ✔️)
  extractUnloggedParentTasks(content) {
    const body = this.stripH1(content);
    const lines = body.split(/\r?\n/);
    const result = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^-\s+/.test(line)) {
        const start = i;
        i++;
        let hasChild = false;
        let hasDone = false;

        while (i < lines.length && !/^-\s+/.test(lines[i]) && !/^#\s+/.test(lines[i])) {
          const t = lines[i];
          if (/^\s+-\s+/.test(t) && !/^-/.test(t)) {
            hasChild = true;
            if (/^\s+-\s*✔️/.test(t)) hasDone = true;
          }
          i++;
        }

        if (!hasChild || !hasDone) {
          result.push(line.trimEnd());
        }
        continue;
      }
      i++;
    }

    return result;
  }

  // async をそのまま渡すと環境によって握りつぶされることがあるのでラップ
  insertTaskLineAndStartFromRibbon() {
    this.insertAndStartTask();
  }

  // =================================================
  // Player Mode（手動トグル）
  // =================================================
  togglePlayerMode() {
    this.playerMode = !this.playerMode;
    this.settings.enablePlayerMode = this.playerMode;

    if (this.playerMode) {
      this.playerView = this.settings.playerDefaultView;
      this.ensurePlayerUI();
    }
    this.updatePlayerVisibility();

    new Notice(this.playerMode ? "Player Mode: ON" : "Player Mode: OFF");
    this.saveSettings();
  }

  applyDisplaySettings() {
    this.focusMode = this.settings.enableFocusMode;
    this.filterMode = this.settings.enableFilterMode;
    this.playerMode = this.settings.enablePlayerMode;
    this.playerView = this.settings.playerDefaultView;
    this.mobileToolbarRow3Collapsed = this.settings.mobileToolbarRow3Collapsed;

    document.body.classList.toggle("taskchute-focus", this.focusMode);
    document.body.classList.toggle("taskchute-filter", this.filterMode);

    if (this.playerMode) {
      this.ensurePlayerUI();
      if (this.playerView === "grid") {
        this.renderGridTop();
      } else {
        this.renderPlayerTop();
      }
    }
    this.updatePlayerVisibility();
    if (this.settings.enableMobileToolbar) {
      this.ensureMobileToolbarUI();
    } else {
      this.destroyMobileToolbarUI();
    }
    this.updateMobileToolbarVisibility();
    this.refreshAllMarkdownEditors();
  }

  getPlayerActionMap() {
    return {
      start: { label: "Start", run: () => this.startTask() },
      end: { label: "End", run: () => this.endTask() },
      endAtEstimate: { label: "End(Est)", run: () => this.endTaskAtEstimate() },
      endAndStart: { label: "End&Start", run: () => this.endAndStartTask() },
      insertTask: { label: "Insert", run: () => this.insertTaskLine() },
      insertAndStart: { label: "Ins+Start", run: () => this.insertAndStartTask() },
      resume: { label: "Resume", run: () => this.resumeTask() },
      openToday: { label: "Today", run: () => this.openToday() },
      openPrevDay: { label: "Prev", run: () => this.openPrevDay() },
      openNextDay: { label: "Next", run: () => this.openNextDay() },
      toggleFocus: {
        label: this.focusMode ? "Focus:ON" : "Focus:OFF",
        run: () => this.toggleFocusMode(),
      },
      togglePlayerMode: { label: "Player", run: () => this.togglePlayerMode() },
    };
  }

  // =========================
  // TaskChute Music Player Mode
  // =========================
  ensurePlayerUI() {
    if (this.playerEl) return;

    const el = document.createElement("div");
    el.className = "taskchute-player is-hidden";
    el.setAttribute("aria-label", "TaskChute Music Player Mode");

    const root = document.createElement("div");
    root.className = "tc-root";

    this.playerTopEl = document.createElement("div");
    this.playerTopEl.className = "tc-top";

    this.playerBottomEl = document.createElement("div");
    this.playerBottomEl.className = "tc-bottom";

    const btnUp = document.createElement("button");
    btnUp.className = "tc-btn tc-focus";
    btnUp.textContent = "＜";
    btnUp.addEventListener("click", () => this.moveCursorLine(-1));

    const grip = document.createElement("div");
    grip.className = "tc-grip";
    const gripbar = document.createElement("div");
    gripbar.className = "tc-gripbar";
    grip.appendChild(gripbar);

    const btnDown = document.createElement("button");
    btnDown.className = "tc-btn tc-next";
    btnDown.textContent = "＞";
    btnDown.addEventListener("click", () => this.moveCursorLine(1));

    this.playerBottomEl.appendChild(btnUp);
    this.playerBottomEl.appendChild(grip);
    this.playerBottomEl.appendChild(btnDown);

    root.appendChild(this.playerTopEl);
    root.appendChild(this.playerBottomEl);
    el.appendChild(root);

    if (this.playerView === "grid") {
      this.renderGridTop();
    } else {
      this.renderPlayerTop();
    }
    document.body.appendChild(el);
    this.playerEl = el;
  }

  destroyPlayerUI() {
    if (!this.playerEl) return;
    this.playerEl.remove();
    this.playerEl = null;
    this.playerTopEl = null;
    this.playerBottomEl = null;
    this.playerDisplayEl = null;
    this.nowPlayingTitleEl = null;
    this.nowPlayingSubEl = null;
    this.playerHeaderEl = null;
    this.playerHeaderMainEl = null;
    this.playerHeaderEtaEl = null;
    this.stopPlayerNowPlayingTicker();
    this.stopPlayerHeaderTimers();
  }

  togglePlayerView() {
    this.playerView = this.playerView === "player" ? "grid" : "player";
    if (!this.playerEl) this.ensurePlayerUI();
    if (this.playerView === "player") {
      this.renderPlayerTop();
    } else {
      this.renderGridTop();
    }
  }

  renderPlayerTop() {
    if (!this.playerTopEl) return;
    this.playerTopEl.replaceChildren();

    const grid = document.createElement("div");
    grid.className = "tc-grid";

    const header = document.createElement("div");
    header.className = "tc-player-header";
    const headerMain = document.createElement("span");
    headerMain.className = "tc-player-header-main";
    headerMain.textContent = "--:-- / --:-- ";
    const headerEta = document.createElement("span");
    headerEta.className = "tc-player-header-eta";
    headerEta.textContent = "【--:--】";
    header.appendChild(headerMain);
    header.appendChild(headerEta);
    this.playerHeaderEl = header;
    this.playerHeaderMainEl = headerMain;
    this.playerHeaderEtaEl = headerEta;

    const btnInput = document.createElement("button");
    btnInput.className = "tc-btn tc-input";
    btnInput.textContent = "入力モード";
    btnInput.addEventListener("click", () => this.enterInputMode());

    const display = document.createElement("div");
    display.className = "tc-display";
    const displayMain = document.createElement("div");
    displayMain.className = "tc-display-main";
    displayMain.textContent = "Ready";
    const displaySub = document.createElement("div");
    displaySub.className = "tc-display-sub";
    displaySub.textContent = "";
    display.appendChild(displayMain);
    display.appendChild(displaySub);
    this.playerDisplayEl = display;
    this.nowPlayingTitleEl = displayMain;
    this.nowPlayingSubEl = displaySub;

    const btnMenu = document.createElement("button");
    btnMenu.className = "tc-btn tc-menu";
    btnMenu.textContent = "≡";
    btnMenu.addEventListener("click", (ev) => {
      const action = this.settings.playerMenuAction;
      if (action === "open_menu") return this.openPlayerMenu(ev);
      if (action === "both") {
        // TODO: long-press to open menu
        return this.togglePlayerView();
      }
      return this.togglePlayerView();
    });

    const btnSkip = document.createElement("button");
    btnSkip.className = "tc-btn tc-skip";
    btnSkip.textContent = "▷▷";
    btnSkip.addEventListener("click", () => this.endAndStartTask());

    const btnStart = document.createElement("button");
    btnStart.className = "tc-btn tc-start";
    btnStart.textContent = "▶";
    btnStart.addEventListener("click", () => this.startTask());

    const btnEnd = document.createElement("button");
    btnEnd.className = "tc-btn tc-end";
    btnEnd.textContent = "■";
    btnEnd.addEventListener("click", () => this.endTask());

    grid.appendChild(btnInput);
    grid.appendChild(display);
    grid.appendChild(btnMenu);

    grid.appendChild(btnSkip);
    grid.appendChild(btnStart);
    grid.appendChild(btnEnd);

    const chipWrap = document.createElement("div");
    chipWrap.className = "tc-estimate-chips";
    const chipDefs = [
      { label: "-15", delta: -15 },
      { label: "-5", delta: -5 },
      { label: "+5", delta: 5 },
      { label: "+15", delta: 15 },
    ];
    chipDefs.forEach((c) => {
      const btn = document.createElement("button");
      btn.className = "tc-chip";
      btn.textContent = c.label;
      btn.addEventListener("click", () => this.adjustEstimateForRunningTask(c.delta));
      chipWrap.appendChild(btn);
    });
    const btnClear = document.createElement("button");
    btnClear.className = "tc-chip tc-chip-clear";
    btnClear.textContent = "Clear";
    btnClear.addEventListener("click", () => this.clearEstimateForRunningTask());
    chipWrap.appendChild(btnClear);

    this.playerTopEl.appendChild(header);
    this.playerTopEl.appendChild(grid);
    this.playerTopEl.appendChild(chipWrap);
    this.updateNowPlaying();
    const shouldShow = this.playerMode && this.isTaskchuteLogActive() && this.isKeyboardClosedLikely();
    if (shouldShow) {
      this.startPlayerNowPlayingTicker();
      this.startPlayerHeaderTimers();
    } else {
      this.stopPlayerNowPlayingTicker();
      this.stopPlayerHeaderTimers();
    }
  }

  renderGridTop() {
    if (!this.playerTopEl) return;
    this.playerTopEl.replaceChildren();
    this.playerDisplayEl = null;
    this.nowPlayingTitleEl = null;
    this.nowPlayingSubEl = null;
    this.playerHeaderEl = null;
    this.playerHeaderMainEl = null;
    this.playerHeaderEtaEl = null;
    this.stopPlayerNowPlayingTicker();
    this.stopPlayerHeaderTimers();

    const wrap = document.createElement("div");
    wrap.className = "tc-grid-wrap";

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "tc-btn tc-menu tc-grid-toggle";
    toggleBtn.textContent = "≡";
    toggleBtn.addEventListener("click", (ev) => {
      const action = this.settings.playerMenuAction;
      if (action === "open_menu") return this.openPlayerMenu(ev);
      if (action === "both") {
        // TODO: long-press to open menu
        return this.togglePlayerView();
      }
      return this.togglePlayerView();
    });

    const panel = document.createElement("div");
    panel.className = "tc-panel";

    const actionMap = this.getPlayerActionMap();
    const bindings = this.settings.playerGridBindings || DEFAULT_SETTINGS.playerGridBindings;

    bindings.slice(0, 8).forEach((actionId) => {
      const def = actionMap[actionId] || actionMap.start;
      const btn = document.createElement("button");
      btn.className = "tc-btn tc-grid-btn";
      btn.textContent = def.label;
      btn.addEventListener("click", () => {
        def.run();
        if (actionId === "toggleFocus") this.renderGridTop();
      });
      panel.appendChild(btn);
    });

    wrap.appendChild(panel);
    wrap.appendChild(toggleBtn);
    this.playerTopEl.appendChild(wrap);
  }

  updatePlayerVisibility() {
    // Player Mode がONでなければ隠す（UIは残してOK）
    if (!this.playerMode) {
      if (this.playerEl) this.playerEl.classList.add("is-hidden");
      this.stopPlayerNowPlayingTicker();
      return;
    }

    // UIがまだなければ作る
    this.ensurePlayerUI();
    this.updateNowPlaying();

    const shouldShow = this.isTaskchuteLogActive() && this.isKeyboardClosedLikely();
    this.playerEl.classList.toggle("is-hidden", !shouldShow);
    if (shouldShow && this.playerDisplayEl) {
      this.startPlayerNowPlayingTicker();
      if (this.playerHeaderMainEl) this.startPlayerHeaderTimers();
    } else {
      this.stopPlayerNowPlayingTicker();
      this.stopPlayerHeaderTimers();
    }
    this.updateMobileToolbarVisibility();
  }

  updateTaskchuteActiveFlag() {
    this.isTaskchuteActiveFlag = this.isTaskchuteLogActive();
  }

  updateNowPlaying() {
    this.updatePlayerNowPlayingText();
  }

  updatePlayerNowPlayingText() {
    if (!this.nowPlayingTitleEl || !this.nowPlayingSubEl) return;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (!this.isTaskchuteLogActive() || !editor) {
      this.nowPlayingTitleEl.textContent = "Ready";
      this.nowPlayingSubEl.textContent = "";
      return;
    }

    const info = this.getNowPlayingInfo(editor);
    if (!info) {
      this.nowPlayingTitleEl.textContent = "Ready";
      this.nowPlayingSubEl.textContent = "";
      return;
    }

    this.nowPlayingTitleEl.textContent = `▶ ${info.titleText}`;
    this.nowPlayingSubEl.textContent = info.subText || "";
    this.updatePlayerHeaderDisplay(true);
  }

  updatePlayerHeaderDisplay(forceEta = false) {
    if (!this.playerHeaderMainEl || !this.playerHeaderEtaEl) return;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (!this.isTaskchuteLogActive() || !editor) {
      this.playerHeaderMainEl.textContent = "--:-- / --:-- ";
      this.playerHeaderEtaEl.textContent = "【--:--】";
      this.playerHeaderEtaEl.classList.remove("is-alert");
      return;
    }

    const summary = this.getTaskEstimateSummary(editor);
    if (!summary) {
      this.playerHeaderMainEl.textContent = "--:-- / --:-- ";
      this.playerHeaderEtaEl.textContent = "【--:--】";
      this.playerHeaderEtaEl.classList.remove("is-alert");
      return;
    }

    const currentRemainingSeconds = Math.max(0, summary.currentRemainingSeconds);
    const estimateSeconds = Math.max(0, summary.currentEstimateSeconds);
    this.playerHeaderMainEl.textContent = `${this.formatMMSS(currentRemainingSeconds)} / ${this.formatMMSS(
      estimateSeconds
    )} `;

    const now = window.moment();
    const minuteKey = now.format("YYYY-MM-DD HH:mm");
    if (forceEta || this.playerHeaderLastEtaMinute !== minuteKey) {
      const eta = now.clone().add(summary.totalRemainingSeconds, "seconds");
      const etaText = eta.format("HH:mm");
      const dayDiff = eta.clone().startOf("day").diff(now.clone().startOf("day"), "days");
      this.playerHeaderEtaEl.textContent = `【${etaText}】`;
      if (dayDiff > 0) {
        this.playerHeaderEtaEl.classList.add("is-alert");
      } else {
        this.playerHeaderEtaEl.classList.remove("is-alert");
      }
      this.playerHeaderLastEtaMinute = minuteKey;
    }
  }

  getTaskEstimateSummary(editor) {
    const nowInfo = this.findLatestUnfinishedHourglassInFile(editor);
    if (!nowInfo) return null;

    const parentLine = this.findParentLineIndex(editor, nowInfo.lineIndex);
    if (parentLine === null) return null;

    const parentText = editor.getLine(parentLine);
    const estimateMin = this.extractEstimateMinutesFromParentLine(parentText) || 0;
    const startTime = this.extractStartTimeFromHourglass(nowInfo.text);
    const elapsedSeconds = startTime ? this.diffSecondsHHMMToNow(startTime) : 0;

    const totalEstimateMinutes = this.sumUnfinishedEstimates(editor);
    const totalRemainingSeconds = Math.max(0, totalEstimateMinutes * 60 - elapsedSeconds);

    return {
      totalRemainingSeconds,
      currentEstimateSeconds: estimateMin * 60,
      currentRemainingSeconds: Math.max(0, estimateMin * 60 - elapsedSeconds),
    };
  }

  sumUnfinishedEstimates(editor) {
    const lineCount = editor.lineCount();
    let total = 0;
    for (let i = 0; i < lineCount; i++) {
      const t = editor.getLine(i);
      if (!/^-\s+/.test(t)) continue;
      if (/^\s*#{1,6}\s+/.test(t)) continue;

      const boundary = this.findParentBlockBoundary(editor, i);
      let hasDone = false;
      let hasUnfinishedHourglass = false;

      for (let j = i + 1; j < boundary; j++) {
        const c = editor.getLine(j);
        if (/^\s+-\s*✔️/.test(c)) hasDone = true;
        if (this.isHourglassLine(c) && !this.hasEndTimeOnHourglass(c)) hasUnfinishedHourglass = true;
      }

      if (!hasDone || hasUnfinishedHourglass) {
        const est = this.extractEstimateMinutesFromParentLine(t);
        if (est) total += est;
      }
      i = boundary - 1;
    }
    return total;
  }

  diffSecondsHHMMToNow(startHHMM) {
    const now = window.moment();
    const start = window.moment(startHHMM, "HH:mm", true);
    if (!start.isValid()) return 0;
    const startToday = now.clone().startOf("day").add(start.hour(), "hours").add(start.minute(), "minutes");
    let current = now.clone();
    if (current.isBefore(startToday)) current = current.add(1, "day");
    return Math.max(0, current.diff(startToday, "seconds"));
  }

  formatMMSS(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  startPlayerHeaderTimers() {
    if (this.playerHeaderTimerSec) return;
    this.playerHeaderTimerSec = window.setInterval(() => {
      this.updatePlayerHeaderDisplay(false);
    }, 1000);
    if (!this.playerHeaderTimerMin) {
      this.playerHeaderTimerMin = window.setInterval(() => {
        this.updatePlayerHeaderDisplay(true);
      }, 60 * 1000);
    }
  }

  stopPlayerHeaderTimers() {
    if (this.playerHeaderTimerSec) {
      window.clearInterval(this.playerHeaderTimerSec);
      this.playerHeaderTimerSec = null;
    }
    if (this.playerHeaderTimerMin) {
      window.clearInterval(this.playerHeaderTimerMin);
      this.playerHeaderTimerMin = null;
    }
  }

  getNowPlayingInfo(editor) {
    const found = this.findLatestUnfinishedHourglassInFile(editor);
    if (!found) return null;

    const parentLine = this.findParentLineIndex(editor, found.lineIndex);
    if (parentLine === null) return null;

    const parentText = editor.getLine(parentLine);
    const titleText = this.stripTaskMetaForNowPlaying(parentText);
    if (!titleText) return null;

    const start = this.extractStartTimeFromHourglass(found.text);
    const est = this.extractEstimateMinutesFromParentLine(parentText);
    const parts = [];
    if (start) {
      const nowText = window.moment().format("HH:mm");
      parts.push(`${start}–${nowText}`);
    }
    if (est) parts.push(`Now Est: ${est}m`);
    return { titleText, subText: parts.join(" / ") };
  }

  startPlayerNowPlayingTicker() {
    if (this.playerNowPlayingTimer) return;
    this.playerNowPlayingTimer = window.setInterval(() => {
      this.updatePlayerNowPlayingText();
    }, 60 * 1000);
  }

  stopPlayerNowPlayingTicker() {
    if (!this.playerNowPlayingTimer) return;
    window.clearInterval(this.playerNowPlayingTimer);
    this.playerNowPlayingTimer = null;
  }

  isTaskchuteLogActive() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const path = view?.file?.path || "";
    return this.isTaskchuteLogPath(path);
  }

  // iOS/Androidの「キーボード閉」推定
  isKeyboardClosedLikely() {
    // Desktop は常に「閉」とみなす
    if (!this.app.isMobile) return true;

    const vv = window.visualViewport;
    if (!vv) return true; // 取れない環境は閉扱い

    // 表示領域が 85% 未満ならキーボードが出てるとみなす
    const ratio = vv.height / window.innerHeight;
    return ratio >= 0.85;
  }

  // =========================
  // TaskChute Mobile Toolbar
  // =========================
  ensureMobileToolbarUI() {
    if (this.mobileToolbarEl) return;
    if (!this.app.isMobile) return;

    const el = document.createElement("div");
    el.className = "taskchute-mobile-toolbar is-hidden";

    this.mobileToolbarEl = el;
    this.renderMobileToolbar();
    document.body.appendChild(el);
  }

  destroyMobileToolbarUI() {
    if (!this.mobileToolbarEl) return;
    this.mobileToolbarEl.remove();
    this.mobileToolbarEl = null;
  }

  updateMobileToolbarVisibility() {
    if (!this.mobileToolbarEl) return;
    if (!this.app.isMobile || !this.settings.enableMobileToolbar) {
      this.mobileToolbarEl.classList.add("is-hidden");
      return;
    }

    const shouldShow = this.isTaskchuteLogActive() && this.isKeyboardClosedLikely();
    this.mobileToolbarEl.classList.toggle("is-hidden", !shouldShow);

    if (!shouldShow) return;

    let offset = 12;
    if (this.playerEl && !this.playerEl.classList.contains("is-hidden")) {
      const rect = this.playerEl.getBoundingClientRect();
      offset += Math.ceil(rect.height) + 8;
    }
    this.mobileToolbarEl.style.bottom = `calc(${offset}px + env(safe-area-inset-bottom))`;
  }

  renderMobileToolbar() {
    if (!this.mobileToolbarEl) return;
    this.mobileToolbarEl.replaceChildren();

    if (this.settings.mobileToolbarRow1Enabled) {
      const row = this.createMobileToolbarRow([
        { icon: "▶", label: "Start", onClick: () => this.startTaskFromLatestDoneTime() },
        { icon: "⏹", label: "End", onClick: () => this.endTask() },
        { icon: "⏱", label: "Est", onClick: () => this.setEstimateMinutes() },
        { icon: "⌛", label: "EndEst", onClick: () => this.endTaskAtEstimate() },
        { icon: "⏩", label: "End&Start", onClick: () => this.endAndStartTask() },
      ]);
      this.mobileToolbarEl.appendChild(row);
    }

    if (this.settings.mobileToolbarRow2Enabled) {
      const row = this.createMobileToolbarRow([
        { icon: "+", label: "Add", onClick: () => this.addTaskSibling() },
        { icon: "📝", label: "Memo", onClick: () => this.insertMemoLine() },
        { icon: "📄", label: "Template", onClick: () => this.insertTemplatesMultiSelect() },
        { icon: "↩", label: "Resume", onClick: () => this.resumeTask() },
        { icon: "✋", label: "Punch", onClick: () => this.timePunch() },
      ]);
      this.mobileToolbarEl.appendChild(row);
    }

    if (this.settings.mobileToolbarRow3Enabled) {
      const row = document.createElement("div");
      row.className = "tc-mt-row tc-mt-row3";
      if (this.mobileToolbarRow3Collapsed) row.classList.add("is-collapsed");

      const btnToggle = this.createToolbarButton({
        icon: this.mobileToolbarRow3Collapsed ? "▸" : "▾",
        label: "More",
        onClick: () => {
          this.mobileToolbarRow3Collapsed = !this.mobileToolbarRow3Collapsed;
          this.renderMobileToolbar();
        },
      });
      btnToggle.classList.add("tc-mt-toggle");
      row.appendChild(btnToggle);

      const btns = [
        { icon: "←", label: "Yesterday", onClick: () => this.openPrevDay() },
        { icon: "●", label: "Today", onClick: () => this.openToday() },
        { icon: "→", label: "Tomorrow", onClick: () => this.openNextDay() },
        { icon: "◎", label: "Focus+Filter", onClick: () => this.toggleFocusFilterCombo() },
      ];

      btns.forEach((b) => row.appendChild(this.createToolbarButton(b)));
      this.mobileToolbarEl.appendChild(row);
    }
  }

  createMobileToolbarRow(buttons) {
    const row = document.createElement("div");
    row.className = "tc-mt-row";
    buttons.forEach((b) => row.appendChild(this.createToolbarButton(b)));
    return row;
  }

  createToolbarButton({ icon, label, onClick }) {
    const btn = document.createElement("button");
    btn.className = "tc-mt-btn";
    btn.setAttribute("aria-label", label);

    const iconEl = document.createElement("span");
    iconEl.className = "tc-mt-icon";
    iconEl.textContent = icon;

    const labelEl = document.createElement("span");
    labelEl.className = "tc-mt-label";
    labelEl.textContent = label;

    btn.appendChild(iconEl);
    btn.appendChild(labelEl);
    btn.addEventListener("click", onClick);
    return btn;
  }

  toggleFocusFilterCombo() {
    const next = !(this.focusMode && this.filterMode);
    this.focusMode = next;
    this.filterMode = next;
    this.settings.enableFocusMode = next;
    this.settings.enableFilterMode = next;
    this.applyDisplaySettings();
    this.saveSettings();
    new Notice(next ? "Focus+Filter: ON" : "Focus+Filter: OFF");
  }

  // 入力モード：エディタにフォーカスしてキーボードを出す（モバイル）
  enterInputMode() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (!editor) return;
    editor.focus();
  }

  // Player Mode: カーソルを上下に移動（行単位）
  moveCursorLine(delta) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (!editor) return;

    const cur = editor.getCursor();
    const lineCount = typeof editor.lineCount === "function" ? editor.lineCount() : null;

    let nextLine = cur.line + delta;
    if (nextLine < 0) nextLine = 0;
    if (lineCount != null && nextLine > lineCount - 1) nextLine = lineCount - 1;

    const lineText = editor.getLine(nextLine) ?? "";
    const nextCh = Math.min(cur.ch, lineText.length);

    editor.setCursor({ line: nextLine, ch: nextCh });
    editor.focus();

    if (typeof editor.scrollIntoView === "function") {
      editor.scrollIntoView({ from: { line: nextLine, ch: 0 }, to: { line: nextLine, ch: 0 } });
    }
  }

  openPlayerMenu(ev) {
    const menu = new Menu();
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle(this.focusMode ? "Focus Mode: OFF" : "Focus Mode: ON")
        .onClick(() => this.toggleFocusMode())
    );

    menu.addItem((item) =>
      item
        .setTitle(this.filterMode ? "Filter Mode: OFF" : "Filter Mode: ON")
        .onClick(() => this.toggleFilterMode())
    );

    menu.addItem((item) => item.setTitle("Prev Day").onClick(() => this.openPrevDay()));
    menu.addItem((item) => item.setTitle("Next Day").onClick(() => this.openNextDay()));
    menu.addItem((item) => item.setTitle("Today").onClick(() => this.openToday()));

    menu.addSeparator();

    menu.addItem((item) => item.setTitle("Insert Task").onClick(() => this.insertTaskLine()));
    menu.addItem((item) => item.setTitle("Insert & Start").onClick(() => this.insertAndStartTask()));
    menu.addItem((item) => item.setTitle("Resume").onClick(() => this.resumeTask()));
    menu.addItem((item) => item.setTitle("End at Estimate").onClick(() => this.endTaskAtEstimate()));
    menu.addItem((item) => item.setTitle("Time Punch…").onClick(() => this.timePunch()));

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle(this.oneLineMode ? "One-line mode: OFF" : "One-line mode: ON")
        .onClick(() => {
          this.oneLineMode = !this.oneLineMode;
          new Notice(this.oneLineMode ? "One-line mode: ON" : "One-line mode: OFF");
        })
    );

    menu.showAtMouseEvent(ev);
  }

  // =================================================
  // Focus Mode（OFF ⇄ ON）
  // =================================================
  toggleFocusMode() {
    this.focusMode = !this.focusMode;
    this.settings.enableFocusMode = this.focusMode;

    document.body.classList.toggle("taskchute-focus", this.focusMode);
    this.refreshAllMarkdownEditors();

    new Notice(this.focusMode ? "Focus Mode: ON" : "Focus Mode: OFF");
    this.saveSettings();
  }

  // =================================================
  // Filter Mode（未実行のみ）
  // =================================================
  toggleFilterMode() {
    this.filterMode = !this.filterMode;
    this.settings.enableFilterMode = this.filterMode;

    document.body.classList.toggle("taskchute-filter", this.filterMode);
    this.refreshAllMarkdownEditors();

    new Notice(this.filterMode ? "Filter Mode: ON" : "Filter Mode: OFF");
    this.saveSettings();
  }

  refreshAllMarkdownEditors() {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const editor = leaf.view?.editor;
      const cm = editor?.cm; // CM6 EditorView が入ることがある
      if (cm && typeof cm.dispatch === "function") {
        cm.dispatch({ effects: [] }); // no-op（再描画のきっかけ）
      }
    }
  }

  buildFocusModeExtension() {
    const plugin = this;

    function isChildLine(text) {
      // 子行：インデントが付いた "- "（例: "  - ..."）
      return /^\s+-\s+/.test(text) && !/^-\s+/.test(text);
    }

    function isHourglass(text) {
      // 子行の ⌛（"  - ⌛" など）
      return /^\s*-\s+⌛/.test(text);
    }

    function shouldHide(text) {
      if (/^\s*$/.test(text)) return false; // 空行
      if (/^\s*#{1,6}\s+/.test(text)) return false; // 見出し
      if (/^-\s+/.test(text)) return false; // 親行（トップレベル）
      if (isChildLine(text)) {
        if (isHourglass(text)) return false; // ⌛ は表示
        return true; // それ以外の子行は隠す
      }
      return false;
    }

    function findNowParentLineNo(doc) {
      let latestHourglassLineNo = -1;
      for (let i = 1; i <= doc.lines; i++) {
        const t = doc.line(i).text;
        if (plugin.isHourglassLine(t) && !plugin.hasEndTimeOnHourglass(t)) {
          latestHourglassLineNo = i;
        }
      }
      if (latestHourglassLineNo < 1) return null;

      for (let i = latestHourglassLineNo - 1; i >= 1; i--) {
        const t = doc.line(i).text;
        if (/^\s*#{1,6}\s+/.test(t)) break;
        if (/^-\s+/.test(t)) return i;
      }
      return null;
    }

    function isHeading(text) {
      return /^\s*#{1,6}\s+/.test(text);
    }

    function shouldDim(text) {
      if (/^\s*$/.test(text)) return false;
      return true;
    }

    function build(view) {
      const allowFocus = plugin.focusMode;
      const allowDim = plugin.settings.dimMode && plugin.isTaskchuteActiveFlag;
      if (!allowFocus && !allowDim) return Decoration.none;

      const b = new RangeSetBuilder();
      const doc = view.state.doc;
      const nowParentLineNo = allowDim ? findNowParentLineNo(doc) : null;

      for (const r of view.visibleRanges) {
        let pos = r.from;
        while (pos <= r.to) {
          const line = doc.lineAt(pos);
          const classes = [];

          if (allowFocus && shouldHide(line.text)) {
            classes.push("taskchute-focus-hide");
          }

          if (allowDim) {
            const isNowParent = nowParentLineNo === line.number;
            if (!isNowParent && shouldDim(line.text)) {
              if (isHeading(line.text)) {
                classes.push("tc-dim-heading");
              } else {
                classes.push("tc-dim-line");
              }
            }
            if (/^\s*-\s*✔️/.test(line.text)) classes.push("tc-done-dim");
            if (isNowParent) classes.push("tc-now-parent");
          }

          if (classes.length > 0) {
            b.add(
              line.from,
              line.from,
              Decoration.line({ attributes: { class: classes.join(" ") } })
            );
          }
          pos = line.to + 1;
        }
      }
      return b.finish();
    }

    return ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.decorations = build(view);
        }
        update(update) {
          if (update.docChanged || update.viewportChanged || update.transactions.length) {
            this.decorations = build(update.view);
          }
        }
      },
      { decorations: (v) => v.decorations }
    );
  }

  buildFilterModeExtension() {
    const plugin = this;

    const hideLine = Decoration.line({
      attributes: { class: "taskchute-filter-hide" },
    });

    function isParentTask(text) {
      if (/^\s*#{1,6}\s+/.test(text)) return false;
      return /^-\s+/.test(text);
    }

    function hasDoneChild(doc, parentLineNo, boundaryLineNo) {
      for (let i = parentLineNo + 1; i < boundaryLineNo; i++) {
        const t = doc.line(i).text;
        if (/^\s+-\s*✔️/.test(t)) return true;
      }
      return false;
    }

    function findParentBlockBoundary(doc, parentLineNo) {
      for (let i = parentLineNo + 1; i <= doc.lines; i++) {
        const t = doc.line(i).text;
        if (/^\s*#{1,6}\s+/.test(t)) return i;
        if (/^-\s+/.test(t)) return i;
      }
      return doc.lines + 1;
    }

    function build(view) {
      if (!plugin.filterMode) return Decoration.none;

      const hiddenLines = new Set();
      const doc = view.state.doc;

      for (let i = 1; i <= doc.lines; i++) {
        const t = doc.line(i).text;
        if (!isParentTask(t)) continue;

        const boundary = findParentBlockBoundary(doc, i);
        if (hasDoneChild(doc, i, boundary)) {
          for (let j = i; j < boundary; j++) hiddenLines.add(j);
        }
        i = boundary - 1;
      }

      const b = new RangeSetBuilder();

      for (const r of view.visibleRanges) {
        let pos = r.from;
        while (pos <= r.to) {
          const line = doc.lineAt(pos);
          if (hiddenLines.has(line.number)) {
            b.add(line.from, line.from, hideLine);
          }
          pos = line.to + 1;
        }
      }

      return b.finish();
    }

    return ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.decorations = build(view);
        }
        update(update) {
          if (update.docChanged || update.viewportChanged || update.transactions.length) {
            this.decorations = build(update.view);
          }
        }
      },
      { decorations: (v) => v.decorations }
    );
  }

  buildMetadataDecorationExtension() {
    const plugin = this;
    const idHidden = Decoration.mark({ class: "tcm-id-ghost" });

    function build(view) {
      if (!plugin.isTaskchuteActiveFlag) return Decoration.none;

      const b = new RangeSetBuilder();
      const doc = view.state.doc;
      const sel = view.state.selection.main;

      for (const r of view.visibleRanges) {
        let pos = r.from;
        while (pos <= r.to) {
          const line = doc.lineAt(pos);
          const text = line.text;
          const isParent = /^-\s+/.test(text);
          const isSelectedLine = sel.from <= line.to && sel.to >= line.from;

          const idRe = /<!--\s*tc:id=[a-zA-Z0-9_-]+\s*-->/g;
          let m;
          while ((m = idRe.exec(text))) {
            const from = line.from + m.index;
            const to = from + m[0].length;
            b.add(from, to, idHidden);
          }

          if (isParent && !isSelectedLine) {
            const estRe = /\(\s*\d+\s*m?\s*\)/g;
            let em;
            while ((em = estRe.exec(text))) {
              const from = line.from + em.index;
              const to = from + em[0].length;
              b.add(from, to, Decoration.mark({ class: "tcm-estimate-badge" }));
            }
          }

          pos = line.to + 1;
        }
      }

      return b.finish();
    }

    return ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.decorations = build(view);
        }
        update(update) {
          if (update.docChanged || update.viewportChanged || update.selectionSet || update.transactions.length) {
            this.decorations = build(update.view);
          }
        }
      },
      { decorations: (v) => v.decorations }
    );
  }

  // =================================================
  // Open Today / Prev / Next
  // =================================================
  async openToday() {
    const dateStr = window.moment().format("YYYY-MM-DD");
    await this.openTaskchuteByDate(dateStr);
  }

  async openPrevDay() {
    const base = this.getActiveTaskchuteDateOrToday();
    const prev = window.moment(base, "YYYY-MM-DD").add(-1, "day").format("YYYY-MM-DD");
    await this.openTaskchuteByDate(prev);
  }

  async openNextDay() {
    const base = this.getActiveTaskchuteDateOrToday();
    const next = window.moment(base, "YYYY-MM-DD").add(1, "day").format("YYYY-MM-DD");
    await this.openTaskchuteByDate(next);
  }

  getActiveTaskchuteDateOrToday() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const path = view?.file?.path || "";
    const folder = this.settings.logFolderPath;
    const m = String(path).match(new RegExp(`^${escapeRegExp(folder)}/(\\d{4}-\\d{2}-\\d{2})\\.md$`));
    if (m) return m[1];
    return window.moment().format("YYYY-MM-DD");
  }

  async openTaskchuteByDate(dateStr) {
    const vault = this.app.vault;
    const folder = this.settings.logFolderPath;
    const filePath = `${folder}/${dateStr}.md`;

    await this.ensureFolderExists(folder);

    let file = vault.getAbstractFileByPath(filePath);
    if (!file) {
      file = await vault.create(filePath, `# TaskChute ${dateStr}\n\n`);
    }

    await this.app.workspace.getLeaf(false).openFile(file);
  }

  // =================================================
  // Insert Task Line（## セクション末尾）
  // =================================================
  insertTaskLine() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return void new Notice("Markdownエディタを開いてね");

    const editor = view.editor;
    if (!editor) return void new Notice("エディタが見つからなかったよ");

    const cursor = editor.getCursor();
    const sectionHeaderLine = this.findCurrentH2SectionHeaderLine(editor, cursor.line);

    if (sectionHeaderLine === null) {
      new Notice("このコマンドは ## セクション内で使ってね");
      return;
    }

    const boundary = this.findH2SectionBoundary(editor, sectionHeaderLine);
    const insertText = `- ${window.moment().format("HH:mm")}  `;

    const insertAfterLine = Math.max(sectionHeaderLine, boundary - 1);
    const insertPos = { line: insertAfterLine, ch: editor.getLine(insertAfterLine).length };

    editor.replaceRange("\n" + insertText, insertPos);
    editor.setCursor({ line: insertAfterLine + 1, ch: insertText.length });
  }

  // =================================================
  // Add Task（親の兄弟として時刻なしで追加）
  // =================================================
  addTaskSibling() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return void new Notice("Markdownエディタを開いてね");

    const editor = view.editor;
    if (!editor) return void new Notice("エディタが見つからなかったよ");

    const cursor = editor.getCursor();
    let parentLine = this.findParentLineIndex(editor, cursor.line);
    if (parentLine === null) parentLine = this.findFirstTaskParentFromTop(editor);
    if (parentLine === null) return void new Notice("親タスクが見つからないよ");

    const boundary = this.findParentBlockBoundary(editor, parentLine);
    const lineCount = editor.lineCount();
    let insertPos = { line: boundary, ch: 0 };
    let insertText = "-  \n";
    let newLineIndex = boundary;

    if (boundary >= lineCount) {
      const lastLine = lineCount - 1;
      const lastText = editor.getLine(lastLine) ?? "";
      const needsNewline = lastText.length > 0;
      insertPos = { line: lastLine, ch: lastText.length };
      insertText = (needsNewline ? "\n" : "") + "-  ";
      newLineIndex = needsNewline ? lastLine + 1 : lastLine;
    }

    editor.replaceRange(insertText, insertPos);
    editor.setCursor({ line: newLineIndex, ch: 3 });
  }

  // =================================================
  // Insert & Start
  // =================================================
  async insertAndStartTask() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return void new Notice("Markdownエディタを開いてね");

    const editor = view.editor;
    if (!editor) return void new Notice("エディタが見つからなかったよ");

    const cursor = editor.getCursor();
    const sectionHeaderLine = this.findCurrentH2SectionHeaderLine(editor, cursor.line);
    if (sectionHeaderLine === null) {
      new Notice("このコマンドは ## セクション内で使ってね");
      return;
    }

    const timeStr = window.moment().format("HH:mm");

    const tcId = this.generateTcId();

    const parentLineText = `- ${timeStr}   <!-- tc:id=${tcId} -->`;
    const childLineText = `  - ⌛ ${timeStr}–  `;

    const boundary = this.findH2SectionBoundary(editor, sectionHeaderLine);
    const insertAfterLine = Math.max(sectionHeaderLine, boundary - 1);
    const insertPos = { line: insertAfterLine, ch: editor.getLine(insertAfterLine).length };

    editor.replaceRange("\n" + parentLineText + "\n" + childLineText, insertPos);
    editor.setCursor({ line: insertAfterLine + 2, ch: childLineText.length });
    this.updateNowPlaying();
  }

  // =================================================
  // Start（上書きしない）
  // =================================================
  async startTask() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return void new Notice("Markdownエディタを開いてね");

    const editor = view.editor;
    if (!editor) return void new Notice("エディタが見つからなかったよ");

    const cursor = editor.getCursor();
    const parentLine = this.findParentLineIndex(editor, cursor.line);
    if (parentLine === null) return void new Notice("親行にカーソルを置いてね");

    await this.startTaskAtParentLine(editor, parentLine);
  }

  // 親行指定で Start する中核
  async startTaskAtParentLine(editor, parentLine, timeStr = window.moment().format("HH:mm")) {
    let parentText = editor.getLine(parentLine);

    // tc:id は保険として静かに付与（フローには使わない）
    const existingId = this.extractTcId(parentText);
    if (!existingId) {
      const tcId = this.generateTcId();
      parentText = this.upsertTcIdComment(parentText, tcId);
      editor.setLine(parentLine, parentText);
    }

    // ⌛があるなら開始だけ入れる
    const hourglass = this.findHourglassChild(editor, parentLine);
    if (hourglass) {
      const { lineIndex, text } = hourglass;

      if (this.hasStartTimeOnHourglass(text)) {
        new Notice("もう開始時刻が入ってるよ（上書きしない）");
        return;
      }

      const updated = this.insertStartTimeOnHourglass(text, timeStr);
      if (updated === text) {
        new Notice("開始時刻を入れられなかった（行の形を確認してね）");
        return;
      }

      editor.setLine(lineIndex, updated);
      editor.setCursor({ line: lineIndex, ch: updated.length });
      this.updateNowPlaying();
      return;
    }

    // ⌛が無い → 親直下に新規
    const childText = `  - ⌛ ${timeStr}–  `;
    const insertPos = { line: parentLine, ch: parentText.length };

    editor.replaceRange("\n" + childText, insertPos);
    editor.setCursor({ line: parentLine + 1, ch: childText.length });
    this.updateNowPlaying();
  }

  // =================================================
  // End（stateなし運用：同ファイルをスキャンして未完了⌛を終了）
  // =================================================
  async endTask() {
    const targetFile = await this.resolveFileForFallback();
    if (!targetFile) {
      new Notice("対象ログが見つからないよ");
      return;
    }

    await this.app.workspace.getLeaf(false).openFile(targetFile);

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) return void new Notice("Markdownエディタが見つからなかったよ");

    const editor = view.editor;

    const found = this.findLatestUnfinishedHourglassInFile(editor);
    if (!found) {
      new Notice("未完了の⌛が見つからないよ");
      return;
    }

    const { lineIndex, text } = found;

    const startTime = this.extractStartTimeFromHourglass(text);
    if (!startTime) return void new Notice("未完了⌛に開始時刻が無いよ（Startで入れてね）");

    if (this.hasEndTimeOnHourglass(text)) {
      new Notice("もう終了が入ってるよ（上書きしない）");
      return;
    }

    const endTime = window.moment().format("HH:mm");
    const minutes = this.diffMinutesHHMM(startTime, endTime);

    const doneText = `  - ✔️ ${startTime}–${endTime} +${minutes}m`;
    editor.setLine(lineIndex, doneText);
    editor.setCursor({ line: lineIndex, ch: doneText.length });
    this.updateNowPlaying();
  }

  // =================================================
  // End at Estimate（見積で締める）
  // =================================================
  async endTaskAtEstimate() {
    let view = this.app.workspace.getActiveViewOfType(MarkdownView);
    let editor = view?.editor;

    if (!this.isTaskchuteLogActive() || !editor) {
      const targetFile = await this.resolveFileForFallback();
      if (!targetFile) return void new Notice("対象ログが見つからないよ");

      await this.app.workspace.getLeaf(false).openFile(targetFile);
      view = this.app.workspace.getActiveViewOfType(MarkdownView);
      editor = view?.editor;
    }

    if (!this.isTaskchuteLogActive() || !editor) {
      return void new Notice("taskchuteログを開いてね");
    }

    const cursor = editor.getCursor();
    const target = this.pickEndTargetInCurrentFile(editor, cursor.line);
    if (!target) return void new Notice("未完了の⌛が見つからないよ");

    if (this.hasEndTimeOnHourglass(target.text)) {
      return void new Notice("もう終了が入ってるよ（上書きしない）");
    }

    const parentLine = this.findParentLineIndex(editor, target.lineIndex);
    if (parentLine === null) return void new Notice("親タスクが見つからないよ");

    const parentText = editor.getLine(parentLine);
    const estimateMin = this.extractEstimateMinutesFromParentLine(parentText);
    if (!estimateMin) return void new Notice("見積が無いよ（例: (20m) を親行に入れてね）");

    const startTime = this.extractStartTimeFromHourglass(target.text);
    if (!startTime) return void new Notice("⌛に開始時刻が無いよ（Startで入れてね）");

    const endTime = this.addMinutesHHMM(startTime, estimateMin);
    if (!endTime) return void new Notice("終了時刻を計算できなかったよ");

    const doneText = `  - ✔️ ${startTime}–${endTime} +${estimateMin}m`;
    editor.setLine(target.lineIndex, doneText);
    editor.setCursor({ line: target.lineIndex, ch: doneText.length });
    this.updateNowPlaying();
  }

  // =================================================
  // End and Start（同一ファイルのみ）
  // =================================================
  async endAndStartTask() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return void new Notice("Markdownエディタを開いてね");

    const editor = view.editor;
    if (!editor) return void new Notice("エディタが見つからなかったよ");

    const cursor = editor.getCursor();

    // ① End 対象を決める（カーソル優先 → 親配下 → ファイル上から）
    const endTarget = this.pickEndTargetInCurrentFile(editor, cursor.line);
    if (!endTarget) {
      new Notice("未完了の⌛が見つからないよ");
      return;
    }

    const endResult = this.applyEndAtHourglassLine(editor, endTarget.lineIndex, endTarget.text);
    if (!endResult.ok) {
      new Notice(endResult.reason || "Endできなかったよ");
      return; // End失敗ならStartしない
    }

    // ② Start 対象（最上段の未処理タスク）
    const parentLine = this.findFirstUnprocessedTaskParent(editor);
    if (parentLine === null) {
      new Notice("開始できる未処理タスクが見つからないよ");
      return;
    }

    await this.startTaskAtParentLine(editor, parentLine);
  }

  pickEndTargetInCurrentFile(editor, cursorLine) {
    const here = editor.getLine(cursorLine);

    // ① カーソルが⌛行ならそれ
    if (this.isHourglassLine(here) && !this.hasEndTimeOnHourglass(here)) {
      return { lineIndex: cursorLine, text: here };
    }

    // ② 親配下の未完了⌛
    const parentLine = this.findParentLineIndex(editor, cursorLine);
    if (parentLine !== null) {
      const boundary = this.findParentBlockBoundary(editor, parentLine);
      for (let i = parentLine + 1; i < boundary; i++) {
        const t = editor.getLine(i);
        if (this.isHourglassLine(t) && !this.hasEndTimeOnHourglass(t)) {
          return { lineIndex: i, text: t };
        }
      }
    }

    // ③ 同一ファイルを上から1回スキャンして最初の未完了⌛
    for (let i = 0; i < editor.lineCount(); i++) {
      const t = editor.getLine(i);
      if (this.isHourglassLine(t) && !this.hasEndTimeOnHourglass(t)) {
        return { lineIndex: i, text: t };
      }
    }

    return null;
  }

  applyEndAtHourglassLine(editor, lineIndex, text) {
    const startTime = this.extractStartTimeFromHourglass(text);
    if (!startTime) return { ok: false, reason: "開始時刻が無いよ（Startで入れてね）" };

    if (this.hasEndTimeOnHourglass(text)) {
      return { ok: false, reason: "もう終了が入ってるよ（上書きしない）" };
    }

    const endTime = window.moment().format("HH:mm");
    const minutes = this.diffMinutesHHMM(startTime, endTime);
    const doneText = `  - ✔️ ${startTime}–${endTime} +${minutes}m`;

    editor.setLine(lineIndex, doneText);
    editor.setCursor({ line: lineIndex, ch: doneText.length });
    this.updateNowPlaying();

    return { ok: true };
  }

  // 「一番上の未処理タスク」＝トップレベル親行で、
  // - 親行が "- 📝" の場合は除外
  // - 配下に✔️が無い
  // - 配下に 未完了⌛ が無い
  findFirstUnprocessedTaskParent(editor) {
    const n = editor.lineCount();

    for (let i = 0; i < n; i++) {
      const t = editor.getLine(i);

      if (!/^-\s+/.test(t)) continue;
      if (/^-\s+📝/.test(t)) continue;
      if (/^\s*#{1,6}\s+/.test(t)) continue;

      const boundary = this.findParentBlockBoundary(editor, i);

      let hasDone = false;
      let hasUnfinishedHourglass = false;

      for (let j = i + 1; j < boundary; j++) {
        const c = editor.getLine(j);
        if (/^\s+-\s*✔️/.test(c)) hasDone = true;
        if (this.isHourglassLine(c) && !this.hasEndTimeOnHourglass(c)) hasUnfinishedHourglass = true;
        if (hasDone || hasUnfinishedHourglass) break;
      }

      if (!hasDone && !hasUnfinishedHourglass) return i;
    }

    return null;
  }

  // =================================================
  // Resume（最新の✔️を⌛に戻す）
  // =================================================
  async resumeTask() {
    const targetFile = await this.resolveFileForFallback();
    if (!targetFile) {
      new Notice("対象ログが見つからないよ");
      return;
    }

    await this.app.workspace.getLeaf(false).openFile(targetFile);

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) return void new Notice("Markdownエディタが見つからなかったよ");

    const editor = view.editor;

    const found = this.findLatestDoneInFile(editor);
    if (!found) {
      new Notice("戻せる✔️が見つからないよ");
      return;
    }

    const { lineIndex, text } = found;

    const startTime = this.extractStartTimeFromDone(text);
    if (!startTime) {
      new Notice("✔️から開始時刻を取れなかったよ");
      return;
    }

    const parentLine = this.findParentLineIndex(editor, lineIndex);
    if (parentLine === null) {
      new Notice("✔️の親行が見つからないよ");
      return;
    }

    // 親行に tc:id が無ければ付与（フローには使わない）
    let parentText = editor.getLine(parentLine);
    const existingId = this.extractTcId(parentText);
    if (!existingId) {
      const tcId = this.generateTcId();
      parentText = this.upsertTcIdComment(parentText, tcId);
      editor.setLine(parentLine, parentText);
    }

    const resumedText = `  - ⌛ ${startTime}–  `;
    editor.setLine(lineIndex, resumedText);
    editor.setCursor({ line: lineIndex, ch: resumedText.length });
    this.updateNowPlaying();
  }

  // =================================================
  // Time Punch（HHmm入力で ⌛ 開始 or ✔️ 終了）
  // =================================================
  async timePunch() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return void new Notice("Markdownエディタを開いてね");

    const editor = view.editor;
    if (!editor) return void new Notice("エディタが見つからなかったよ");

    const input = window.prompt("Time Punch (HHmm):");
    if (input == null) return;

    const timeStr = this.parseHHmmToHHmm(input);
    if (!timeStr) {
      new Notice("HHmmだけ受け付けるよ（例: 0930）");
      return;
    }

    const cursorLine = editor.getCursor().line;
    let parentLine = this.findParentLineIndex(editor, cursorLine);
    if (parentLine === null) {
      parentLine = this.findFirstTaskParentFromTop(editor);
    }
    if (parentLine === null) {
      new Notice("対象の親タスクが見つからないよ");
      return;
    }

    const hourglass = this.findLatestUnfinishedHourglassChild(editor, parentLine);
    if (!hourglass) {
      const childText = `  - ⌛ ${timeStr}–  `;
      const insertPos = { line: parentLine, ch: editor.getLine(parentLine).length };
      editor.replaceRange("\n" + childText, insertPos);
      editor.setCursor({ line: parentLine + 1, ch: childText.length });
      this.updateNowPlaying();
      return;
    }

    const { lineIndex, text } = hourglass;
    const startTime = this.extractStartTimeFromHourglass(text);
    if (!startTime) {
      new Notice("⌛の開始時刻が取れなかったよ");
      return;
    }

    const minutes = this.diffMinutesHHMM(startTime, timeStr);
    const doneText = `  - ✔️ ${startTime}–${timeStr} +${minutes}m`;
    editor.setLine(lineIndex, doneText);
    editor.setCursor({ line: lineIndex, ch: doneText.length });
    this.updateNowPlaying();
  }

  // =================================================
  // Start From Latest Done Time
  // =================================================
  async startTaskFromLatestDoneTime() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return void new Notice("Markdownエディタを開いてね");

    const editor = view.editor;
    if (!editor) return void new Notice("エディタが見つからなかったよ");

    const cursorLine = editor.getCursor().line;
    const cursorText = editor.getLine(cursorLine);

    let parentLine = null;
    if (/^-\s+/.test(cursorText)) {
      parentLine = cursorLine;
    } else {
      parentLine = this.findFirstTaskParentFromTop(editor);
    }

    if (parentLine === null) {
      new Notice("開始できるタスク行が見つからないよ");
      return;
    }

    const latest = this.findLatestDoneInFile(editor);
    if (!latest) {
      new Notice("✔️が見つからないよ");
      return;
    }

    const latestTime = this.extractEndTimeFromDone(latest.text) || this.extractStartTimeFromDone(latest.text);
    if (!latestTime) {
      new Notice("✔️行から時刻を読めなかったよ");
      return;
    }

    await this.startTaskAtParentLine(editor, parentLine, latestTime);
  }

  // =================================================
  // Recalculate Duration
  // =================================================
  async recalculateDurationFromActiveLine() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return void new Notice("Markdownエディタを開いてね");

    const editor = view.editor;
    if (!editor) return void new Notice("エディタが見つからなかったよ");

    const cursor = editor.getCursor();
    const lineIndex = cursor.line;
    const lineText = editor.getLine(lineIndex);

    // ① カーソル行が✔️なら、その行を対象
    if (/^\s+-\s*✔️/.test(lineText)) {
      const updated = this.recalcDoneLine(lineText);
      if (!updated) return void new Notice("✔️行から時刻を読めなかったよ");
      if (updated === lineText) return void new Notice("変更はないよ");

      editor.setLine(lineIndex, updated);
      editor.setCursor({ line: lineIndex, ch: updated.length });
      new Notice("再計算したよ");
      return;
    }

    // ② それ以外 → 親配下の最新✔️
    const parentLine = this.findParentLineIndex(editor, lineIndex);
    if (parentLine === null) return void new Notice("親行（タスク）を見つけられなかったよ");

    const done = this.findLatestDoneChild(editor, parentLine);
    if (!done) return void new Notice("このタスク配下に✔️が見つからないよ");

    const { lineIndex: doneLineIndex, text: doneText } = done;
    const updated = this.recalcDoneLine(doneText);
    if (!updated) return void new Notice("✔️行から時刻を読めなかったよ");
    if (updated === doneText) return void new Notice("変更はないよ");

    editor.setLine(doneLineIndex, updated);
    editor.setCursor({ line: doneLineIndex, ch: updated.length });
    new Notice("再計算したよ");
  }

  recalcDoneLine(doneLineText) {
    const m = doneLineText.match(/^\s+-\s*✔️\s*(\d{2}:\d{2})\s*–\s*(\d{2}:\d{2})(.*)$/);
    if (!m) return null;

    const start = m[1];
    const end = m[2];
    const tail = m[3] || "";

    const minutes = this.diffMinutesHHMM(start, end);

    if (/\+\d+m/.test(tail)) {
      return doneLineText.replace(/\+\d+m/, `+${minutes}m`);
    }

    const trimmed = doneLineText.replace(/\s+$/, "");
    return `${trimmed} +${minutes}m`;
  }

  // =================================================
  // Memo（タスク直下）
  // =================================================
  insertMemoLine() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return void new Notice("Markdownエディタを開いてね");

    const editor = view.editor;
    if (!editor) return void new Notice("エディタが見つからなかったよ");

    const cursor = editor.getCursor();
    const currentText = editor.getLine(cursor.line);

    if (/^\s*$/.test(currentText) || /^\s*#{1,6}\s+/.test(currentText)) {
      new Notice("親行にカーソルを置いてね");
      return;
    }

    const parentLine = this.findParentLineIndex(editor, cursor.line);
    if (parentLine === null) return void new Notice("親行にカーソルを置いてね");

    const isChildLine = /^\s+-\s+/.test(currentText) && !/^-\s+/.test(currentText);

    const boundary = this.findParentBlockBoundary(editor, parentLine);
    let insertAfterLine = isChildLine ? cursor.line : parentLine;

    if (insertAfterLine + 1 >= boundary) {
      insertAfterLine = boundary - 1;
    }

    const insertText = `  - 📝 `;
    const insertPos = { line: insertAfterLine, ch: editor.getLine(insertAfterLine).length };

    editor.replaceRange("\n" + insertText, insertPos);
    editor.setCursor({ line: insertAfterLine + 1, ch: insertText.length });
  }

  // =================================================
  // 対象ファイル決定（開いているtaskchuteログ優先、なければToday）
  // =================================================
  async resolveFileForFallback() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const activeFile = activeView?.file || null;

    if (activeFile && this.isTaskchuteLogPath(activeFile.path)) {
      return activeFile;
    }

    const vault = this.app.vault;
    const folder = this.settings.logFolderPath;
    const dateStr = window.moment().format("YYYY-MM-DD");
    const filePath = `${folder}/${dateStr}.md`;

    await this.ensureFolderExists(folder);

    let file = vault.getAbstractFileByPath(filePath);
    if (!file) {
      file = await vault.create(filePath, `# TaskChute ${dateStr}\n\n`);
    }

    return file;
  }

  isTaskchuteLogPath(path) {
    const folder = this.settings.logFolderPath;
    const re = new RegExp(`^${escapeRegExp(folder)}/\\d{4}-\\d{2}-\\d{2}\\.md$`);
    return re.test(String(path || ""));
  }

  // =================================================
  // ファイル全体スキャン helpers（End/Resume用）
  // =================================================
  findLatestUnfinishedHourglassInFile(editor) {
    for (let i = editor.lineCount() - 1; i >= 0; i--) {
      const t = editor.getLine(i);
      if (this.isHourglassLine(t) && !this.hasEndTimeOnHourglass(t)) {
        return { lineIndex: i, text: t };
      }
    }
    return null;
  }

  findLatestDoneInFile(editor) {
    for (let i = editor.lineCount() - 1; i >= 0; i--) {
      const t = editor.getLine(i);
      if (/^\s+-\s*✔️/.test(t)) {
        return { lineIndex: i, text: t };
      }
    }
    return null;
  }

  extractStartTimeFromDone(text) {
    const m = text.match(/^\s+-\s*✔️\s*(\d{2}:\d{2})/);
    return m ? m[1] : null;
  }

  extractEndTimeFromDone(text) {
    const m = text.match(/^\s+-\s*✔️\s*\d{2}:\d{2}\s*–\s*(\d{2}:\d{2})/);
    return m ? m[1] : null;
  }

  stripTaskLineText(lineText) {
    let text = String(lineText || "");
    text = text.replace(/^\s*-\s+/, "");
    text = text.replace(/\s*<!--\s*tc:id=[a-zA-Z0-9_-]+\s*-->\s*/g, "");
    text = text.replace(/\(\s*\d+\s*m?\s*\)/g, "");
    return text.trim();
  }

  stripTaskMetaForNowPlaying(lineText) {
    let text = String(lineText || "");
    text = text.replace(/^\s*-\s+/, "");
    text = text.replace(/\s*<!--\s*tc:id=[a-zA-Z0-9_-]+\s*-->\s*/g, " ");
    text = text.replace(/^\s*\d{2}:\d{2}\s+/, "");
    text = text.replace(/\(\s*\d+\s*m?\s*\)/g, " ");
    text = text.replace(/\s+/g, " ").trim();
    return text || "(untitled)";
  }

  extractEstimateFromParentLine(lineText) {
    return this.extractEstimateMinutesFromParentLine(lineText);
  }

  extractEstimateMinutesFromParentLine(lineText) {
    const text = String(lineText || "");
    const m = text.match(/\(\s*(\d{1,3})\s*m?\s*\)/);
    if (m) {
      const n = Number(m[1]);
      if (!Number.isFinite(n) || n < 1 || n > 999) return null;
      return n;
    }
    const legacy = text.match(/<!--\s*tc:est=(\d{1,3})\s*-->/);
    if (!legacy) return null;
    const n = Number(legacy[1]);
    if (!Number.isFinite(n) || n < 1 || n > 999) return null;
    return n;
  }

  upsertEstimateOnParentLine(lineText, minutes) {
    let text = String(lineText || "");
    text = text.replace(/\(\s*\d+\s*m?\s*\)/g, "");
    text = text.replace(/<!--\s*tc:est=\d+\s*-->/g, "");
    text = text.replace(/\s+$/, "");
    return `${text} (${minutes}m)`;
  }

  clearEstimateOnParentLine(lineText) {
    let text = String(lineText || "");
    text = text.replace(/\(\s*\d+\s*m?\s*\)/g, "");
    text = text.replace(/<!--\s*tc:est=\d+\s*-->/g, "");
    text = text.replace(/\s+$/, "");
    return text;
  }

  addMinutesHHMM(startHHMM, minutes) {
    const base = window.moment(startHHMM, "HH:mm", true);
    if (!base.isValid()) return null;
    return base.add(minutes, "minutes").format("HH:mm");
  }

  // =================================================
  // ## セクション helpers（Insert系で使用）
  // =================================================
  findCurrentH2SectionHeaderLine(editor, fromLine) {
    for (let i = fromLine; i >= 0; i--) {
      const t = editor.getLine(i);
      if (/^\s*##\s+/.test(t)) return i;
      if (/^\s*#\s+/.test(t)) break;
    }
    return null;
  }

  findH2SectionBoundary(editor, headerLine) {
    const lineCount = editor.lineCount();
    for (let i = headerLine + 1; i < lineCount; i++) {
      const t = editor.getLine(i);
      if (/^\s*#{1,2}\s+/.test(t)) return i;
    }
    return lineCount;
  }

  // =================================================
  // 親行探索
  // =================================================
  findParentLineIndex(editor, lineIndex) {
    const lineText = editor.getLine(lineIndex);

    if (/^\s*$/.test(lineText) || /^\s*#{1,6}\s+/.test(lineText)) return null;
    if (/^-\s+/.test(lineText)) return lineIndex;

    if (/^\s+-\s+/.test(lineText)) {
      for (let i = lineIndex - 1; i >= 0; i--) {
        const t = editor.getLine(i);
        if (/^\s*$/.test(t)) continue;
        if (/^\s*#{1,6}\s+/.test(t)) break;
        if (/^-\s+/.test(t)) return i;
      }
      return null;
    }

    return null;
  }

  // =================================================
  // Estimate (text)
  // =================================================
  setEstimateMinutes() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return void new Notice("Markdownエディタを開いてね");

    const editor = view.editor;
    if (!editor) return void new Notice("エディタが見つからなかったよ");

    const cursor = editor.getCursor();
    let parentLine = this.findParentLineIndex(editor, cursor.line);
    if (parentLine === null) parentLine = this.findFirstTaskParentFromTop(editor);
    if (parentLine === null) return void new Notice("親行が見つからないよ");

    const menu = new Menu();
    const minutesList = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120];
    minutesList.forEach((m) => {
      menu.addItem((item) =>
        item.setTitle(`${m}m`).onClick(() => this.applyEstimateAtParent(editor, parentLine, m, cursor))
      );
    });
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle("Clear estimate").onClick(() => this.clearEstimateAtParent(editor, parentLine, cursor))
    );
    menu.addItem((item) => item.setTitle("Cancel").onClick(() => {}));
    menu.showAtPosition({ x: Math.round(window.innerWidth * 0.5), y: 120 });
  }

  applyEstimateAtParent(editor, parentLine, minutes, cursor) {
    const parentText = editor.getLine(parentLine);
    const updated = this.upsertEstimateOnParentLine(parentText, minutes);
    editor.setLine(parentLine, updated);
    editor.setCursor(cursor);
    this.updateNowPlaying();
    new Notice(`Estimate set: ${minutes}m`);
  }

  clearEstimateAtParent(editor, parentLine, cursor) {
    const parentText = editor.getLine(parentLine);
    const updated = this.clearEstimateOnParentLine(parentText);
    editor.setLine(parentLine, updated);
    editor.setCursor(cursor);
    this.updateNowPlaying();
    new Notice("Estimate cleared");
  }

  adjustEstimateForRunningTask(deltaMinutes) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (!this.isTaskchuteLogActive() || !editor) return void new Notice("taskchuteログを開いてね");

    const target = this.findLatestUnfinishedHourglassInFile(editor);
    if (!target) return void new Notice("実行中タスクが無いよ");

    const parentLine = this.findParentLineIndex(editor, target.lineIndex);
    if (parentLine === null) return void new Notice("親タスクが見つからないよ");

    const parentText = editor.getLine(parentLine);
    const current = this.extractEstimateMinutesFromParentLine(parentText) || 0;
    const next = current + deltaMinutes;

    if (next <= 0) {
      const cleared = this.clearEstimateOnParentLine(parentText);
      editor.setLine(parentLine, cleared);
      this.updateNowPlaying();
      new Notice("Estimate cleared");
      return;
    }

    const updated = this.upsertEstimateOnParentLine(parentText, next);
    editor.setLine(parentLine, updated);
    this.updateNowPlaying();
    new Notice(`Estimate set: ${next}m`);
  }

  clearEstimateForRunningTask() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (!this.isTaskchuteLogActive() || !editor) return void new Notice("taskchuteログを開いてね");

    const target = this.findLatestUnfinishedHourglassInFile(editor);
    if (!target) return void new Notice("実行中タスクが無いよ");

    const parentLine = this.findParentLineIndex(editor, target.lineIndex);
    if (parentLine === null) return void new Notice("親タスクが見つからないよ");

    const parentText = editor.getLine(parentLine);
    const cleared = this.clearEstimateOnParentLine(parentText);
    editor.setLine(parentLine, cleared);
    this.updateNowPlaying();
    new Notice("Estimate cleared");
  }

  findFirstTaskParentFromTop(editor) {
    const n = editor.lineCount();
    for (let i = 0; i < n; i++) {
      const t = editor.getLine(i);
      if (/^-\s+/.test(t)) return i;
    }
    return null;
  }

  findParentBlockBoundary(editor, parentLine) {
    const lineCount = editor.lineCount();
    for (let i = parentLine + 1; i < lineCount; i++) {
      const t = editor.getLine(i);
      if (/^\s*#{1,6}\s+/.test(t)) return i;
      if (/^-\s+/.test(t)) return i;
    }
    return lineCount;
  }

  // =================================================
  // 子行探索（親配下）
  // =================================================
  findLatestHourglassChild(editor, parentLine) {
    const boundary = this.findParentBlockBoundary(editor, parentLine);
    let last = null;

    for (let i = parentLine + 1; i < boundary; i++) {
      const t = editor.getLine(i);
      if (/^\s*$/.test(t)) continue;
      if (/^\s+-\s+⌛/.test(t)) last = { lineIndex: i, text: t };
    }

    return last;
  }

  findLatestUnfinishedHourglassChild(editor, parentLine) {
    const boundary = this.findParentBlockBoundary(editor, parentLine);
    let last = null;

    for (let i = parentLine + 1; i < boundary; i++) {
      const t = editor.getLine(i);
      if (/^\s*$/.test(t)) continue;
      if (this.isHourglassLine(t) && !this.hasEndTimeOnHourglass(t)) {
        last = { lineIndex: i, text: t };
      }
    }

    return last;
  }

  findHourglassChild(editor, parentLine) {
    const boundary = this.findParentBlockBoundary(editor, parentLine);
    for (let i = parentLine + 1; i < boundary; i++) {
      const t = editor.getLine(i);
      if (/^\s*$/.test(t)) continue;
      if (/^\s+-\s+⌛/.test(t)) return { lineIndex: i, text: t };
    }
    return null;
  }

  findLatestDoneChild(editor, parentLine) {
    const boundary = this.findParentBlockBoundary(editor, parentLine);
    let last = null;

    for (let i = parentLine + 1; i < boundary; i++) {
      const t = editor.getLine(i);
      if (/^\s*$/.test(t)) continue;
      if (/^\s+-\s*✔️/.test(t)) last = { lineIndex: i, text: t };
    }

    return last;
  }

  // =================================================
  // ⌛ /✔️解析
  // =================================================
  isHourglassLine(text) {
    return /^\s*-\s+⌛/.test(text);
  }

  hasStartTimeOnHourglass(text) {
    return /^\s*-\s+⌛\s*\d{2}:\d{2}/.test(text);
  }

  insertStartTimeOnHourglass(text, timeStr) {
    if (!this.isHourglassLine(text)) return text;
    if (this.hasStartTimeOnHourglass(text)) return text;

    const m = text.match(/^(\s*-\s+⌛)(.*)$/);
    if (!m) return text;

    const head = m[1];
    let tail = m[2] || "";
    tail = tail.replace(/^\s*/, "");

    return `${head} ${timeStr}${tail ? tail : "–  "}`;
  }

  extractStartTimeFromHourglass(text) {
    const m = text.match(/^\s*-\s+⌛\s*(\d{2}:\d{2})/);
    return m ? m[1] : null;
  }

  parseHHmmToHHmm(input) {
    const raw = String(input || "").trim();
    if (!/^\d{4}$/.test(raw)) return null;
    const h = raw.slice(0, 2);
    const m = raw.slice(2, 4);
    const hh = Number(h);
    const mm = Number(m);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return `${h}:${m}`;
  }

  hasEndTimeOnHourglass(text) {
    return /–\s*\d{2}:\d{2}/.test(text);
  }

  diffMinutesHHMM(start, end) {
    const s = window.moment(start, "HH:mm");
    const e = window.moment(end, "HH:mm");
    if (e.isBefore(s)) e.add(1, "day");
    const min = e.diff(s, "minutes");
    return Math.max(0, min);
  }

  // =================================================
  // tc:id utils
  // =================================================
  collectTcIds(text) {
    const re = /<!--\s*tc:id=([a-zA-Z0-9_-]+)\s*-->/g;
    const ids = [];
    let m;
    while ((m = re.exec(text)) !== null) ids.push(m[1]);
    return ids;
  }

  extractTcId(lineText) {
    const m = lineText.match(/<!--\s*tc:id=([a-zA-Z0-9_-]+)\s*-->/);
    return m ? m[1] : null;
  }

  upsertTcIdComment(lineText, tcId) {
    const has = /<!--\s*tc:id=([a-zA-Z0-9_-]+)\s*-->/;
    if (has.test(lineText)) {
      return lineText.replace(has, `<!-- tc:id=${tcId} -->`);
    }
    const trimmed = lineText.replace(/\s+$/, "");
    return `${trimmed} <!-- tc:id=${tcId} -->`;
  }

  isDuplicateId(idsInFile, id) {
    let count = 0;
    for (const x of idsInFile) if (x === id) count++;
    return count >= 2;
  }

  generateTcId() {
    return Math.random().toString(36).slice(2, 8);
  }

  generateUniqueTcId(idsInFile) {
    let id = this.generateTcId();
    let guard = 0;
    while (idsInFile.includes(id) && guard < 20) {
      id = this.generateTcId();
      guard++;
    }
    return id;
  }
};

class TaskChuteSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h3", { text: "General" });

    const setting = new Setting(containerEl)
      .setName("Log folder path")
      .setDesc("YYYY-MM-DD.md をこのフォルダに作成/検索します（Vaultルート相対）");

    setting.addText((text) => {
      text.setPlaceholder("taskchute");
      text.setValue(this.plugin.settings.logFolderPath);

      const inputEl = text.inputEl;
      const controlEl = setting.controlEl;
      controlEl.style.position = "relative";

      const suggestEl = controlEl.createDiv({ cls: "taskchute-suggest is-hidden" });

      let activeItems = [];
      let selectedIndex = -1;
      let choosing = false;

      const renderSuggestions = () => {
        suggestEl.empty();
        if (activeItems.length === 0) {
          suggestEl.addClass("is-hidden");
          return;
        }

        activeItems.forEach((path, idx) => {
          const itemEl = suggestEl.createDiv({
            cls: `taskchute-suggest-item${idx === selectedIndex ? " is-selected" : ""}`,
          });
          itemEl.textContent = path;
          itemEl.addEventListener("mousedown", (ev) => {
            ev.preventDefault();
            choosing = true;
            this.applyLogFolderChoice(path, inputEl, () => this.closeSuggest(suggestEl));
          });
        });

        suggestEl.removeClass("is-hidden");
      };

      const updateSuggestions = () => {
        const query = inputEl.value;
        activeItems = this.getFolderSuggestions(query);
        selectedIndex = activeItems.length > 0 ? 0 : -1;
        renderSuggestions();
      };

      inputEl.addEventListener("focus", () => {
        updateSuggestions();
      });

      inputEl.addEventListener("input", () => {
        updateSuggestions();
      });

      inputEl.addEventListener("keydown", (ev) => {
        if (ev.key === "ArrowDown") {
          if (activeItems.length === 0) return;
          ev.preventDefault();
          selectedIndex = (selectedIndex + 1) % activeItems.length;
          renderSuggestions();
        } else if (ev.key === "ArrowUp") {
          if (activeItems.length === 0) return;
          ev.preventDefault();
          selectedIndex = (selectedIndex - 1 + activeItems.length) % activeItems.length;
          renderSuggestions();
        } else if (ev.key === "Enter") {
          ev.preventDefault();
          if (activeItems.length === 0) {
            this.applyLogFolderChoice(inputEl.value, inputEl, () => this.closeSuggest(suggestEl), true);
            return;
          }
          const choice = activeItems[Math.max(0, selectedIndex)];
          this.applyLogFolderChoice(choice, inputEl, () => this.closeSuggest(suggestEl), true);
        } else if (ev.key === "Escape") {
          this.closeSuggest(suggestEl);
        }
      });

      inputEl.addEventListener("blur", () => {
        window.setTimeout(() => {
          if (!choosing) this.closeSuggest(suggestEl);
          choosing = false;
        }, 150);
      });

      inputEl.addEventListener("change", () => {
        this.applyLogFolderChoice(inputEl.value, inputEl, () => this.closeSuggest(suggestEl), true);
      });
    });

    new Setting(containerEl).addButton((btn) => {
      btn.setButtonText("Reset");
      btn.onClick(async () => {
        const value = DEFAULT_SETTINGS.logFolderPath;
        this.plugin.settings.logFolderPath = value;
        await this.plugin.saveSettings();
        this.plugin.applyDisplaySettings();
        new Notice(`Log folder reset to: ${value}`);
        this.display();
      });
    });

    containerEl.createEl("h3", { text: "Templates" });

    new Setting(containerEl)
      .setName("Enable templates")
      .setDesc("テンプレ機能を有効にします")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableTemplates);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableTemplates = value;
          await this.plugin.saveSettings();
        });
      });

    const templateSetting = new Setting(containerEl)
      .setName("Template folder path")
      .setDesc("テンプレ用 Markdown を保存するフォルダ（セクション単位で使用）");

    templateSetting.addText((text) => {
      text.setPlaceholder("(not set)");
      text.setValue(this.plugin.settings.templateFolderPath || "");

      const inputEl = text.inputEl;
      const controlEl = templateSetting.controlEl;
      controlEl.style.position = "relative";

      const suggestEl = controlEl.createDiv({ cls: "taskchute-suggest is-hidden" });

      let activeItems = [];
      let selectedIndex = -1;
      let choosing = false;

      const renderSuggestions = () => {
        suggestEl.empty();
        if (activeItems.length === 0) {
          suggestEl.addClass("is-hidden");
          return;
        }

        activeItems.forEach((path, idx) => {
          const itemEl = suggestEl.createDiv({
            cls: `taskchute-suggest-item${idx === selectedIndex ? " is-selected" : ""}`,
          });
          itemEl.textContent = path;
          itemEl.addEventListener("mousedown", (ev) => {
            ev.preventDefault();
            choosing = true;
            this.applyTemplateFolderChoice(path, inputEl, () => this.closeSuggest(suggestEl));
          });
        });

        suggestEl.removeClass("is-hidden");
      };

      const updateSuggestions = () => {
        const query = inputEl.value;
        activeItems = this.getFolderSuggestions(query);
        selectedIndex = activeItems.length > 0 ? 0 : -1;
        renderSuggestions();
      };

      inputEl.addEventListener("focus", () => {
        updateSuggestions();
      });

      inputEl.addEventListener("input", () => {
        updateSuggestions();
      });

      inputEl.addEventListener("keydown", (ev) => {
        if (ev.key === "ArrowDown") {
          if (activeItems.length === 0) return;
          ev.preventDefault();
          selectedIndex = (selectedIndex + 1) % activeItems.length;
          renderSuggestions();
        } else if (ev.key === "ArrowUp") {
          if (activeItems.length === 0) return;
          ev.preventDefault();
          selectedIndex = (selectedIndex - 1 + activeItems.length) % activeItems.length;
          renderSuggestions();
        } else if (ev.key === "Enter") {
          ev.preventDefault();
          if (activeItems.length === 0) {
            this.applyTemplateFolderChoice(inputEl.value, inputEl, () => this.closeSuggest(suggestEl), true);
            return;
          }
          const choice = activeItems[Math.max(0, selectedIndex)];
          this.applyTemplateFolderChoice(choice, inputEl, () => this.closeSuggest(suggestEl), true);
        } else if (ev.key === "Escape") {
          this.closeSuggest(suggestEl);
        }
      });

      inputEl.addEventListener("blur", () => {
        window.setTimeout(() => {
          if (!choosing) this.closeSuggest(suggestEl);
          choosing = false;
        }, 150);
      });

      inputEl.addEventListener("change", () => {
        this.applyTemplateFolderChoice(inputEl.value, inputEl, () => this.closeSuggest(suggestEl), true);
      });
    });

    new Setting(containerEl).addButton((btn) => {
      btn.setButtonText("Reset Template Path");
      btn.onClick(async () => {
        this.plugin.settings.templateFolderPath = "";
        await this.plugin.saveSettings();
        new Notice("Template folder cleared");
        this.display();
      });
    });

    containerEl.createEl("h3", { text: "Display" });

    new Setting(containerEl)
      .setName("Enable focus mode")
      .setDesc("Focus Mode を有効にします")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableFocusMode);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableFocusMode = value;
          await this.plugin.saveSettings();
          this.plugin.applyDisplaySettings();
        });
      });

    new Setting(containerEl)
      .setName("Enable filter mode")
      .setDesc("Filter Mode を有効にします")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableFilterMode);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableFilterMode = value;
          await this.plugin.saveSettings();
          this.plugin.applyDisplaySettings();
        });
      });

    new Setting(containerEl)
      .setName("Dim non-current text (Focus on now)")
      .setDesc("taskchuteログの本文を薄くして“今”を強調します")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.dimMode);
        toggle.onChange(async (value) => {
          this.plugin.settings.dimMode = value;
          await this.plugin.saveSettings();
          this.plugin.refreshAllMarkdownEditors();
        });
      });

    containerEl.createEl("h3", { text: "Mobile Toolbar" });

    new Setting(containerEl)
      .setName("Enable mobile toolbar")
      .setDesc("モバイル専用の多段ツールバーを表示します")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableMobileToolbar);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableMobileToolbar = value;
          await this.plugin.saveSettings();
          this.plugin.applyDisplaySettings();
        });
      });

    new Setting(containerEl)
      .setName("Row 1 enabled")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.mobileToolbarRow1Enabled);
        toggle.onChange(async (value) => {
          this.plugin.settings.mobileToolbarRow1Enabled = value;
          await this.plugin.saveSettings();
          this.plugin.renderMobileToolbar();
          this.plugin.updateMobileToolbarVisibility();
        });
      });

    new Setting(containerEl)
      .setName("Row 2 enabled")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.mobileToolbarRow2Enabled);
        toggle.onChange(async (value) => {
          this.plugin.settings.mobileToolbarRow2Enabled = value;
          await this.plugin.saveSettings();
          this.plugin.renderMobileToolbar();
          this.plugin.updateMobileToolbarVisibility();
        });
      });

    new Setting(containerEl)
      .setName("Row 3 enabled")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.mobileToolbarRow3Enabled);
        toggle.onChange(async (value) => {
          this.plugin.settings.mobileToolbarRow3Enabled = value;
          await this.plugin.saveSettings();
          this.plugin.renderMobileToolbar();
          this.plugin.updateMobileToolbarVisibility();
        });
      });

    new Setting(containerEl)
      .setName("Row 3 default state")
      .setDesc("Row 3 の初期状態")
      .addDropdown((dropdown) => {
        dropdown.addOption("collapsed", "Collapsed");
        dropdown.addOption("expanded", "Expanded");
        dropdown.setValue(this.plugin.settings.mobileToolbarRow3Collapsed ? "collapsed" : "expanded");
        dropdown.onChange(async (value) => {
          this.plugin.settings.mobileToolbarRow3Collapsed = value === "collapsed";
          await this.plugin.saveSettings();
          this.plugin.mobileToolbarRow3Collapsed = this.plugin.settings.mobileToolbarRow3Collapsed;
          this.plugin.renderMobileToolbar();
          this.plugin.updateMobileToolbarVisibility();
        });
      });

    containerEl.createEl("h3", { text: "Player" });

    new Setting(containerEl)
      .setName("Enable player mode")
      .setDesc("Player Mode を有効にします")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enablePlayerMode);
        toggle.onChange(async (value) => {
          this.plugin.settings.enablePlayerMode = value;
          await this.plugin.saveSettings();
          this.plugin.applyDisplaySettings();
        });
      });

    containerEl.createEl("h3", { text: "Player / Grid" });

    new Setting(containerEl)
      .setName("≡ ボタンの挙動")
      .setDesc("≡ のクリック動作を選びます")
      .addDropdown((dropdown) => {
        dropdown.addOption("toggle_grid", "≡: Player ⇄ Grid 切替");
        dropdown.addOption("open_menu", "≡: メニューを開く");
        dropdown.addOption("both", "≡: 短押し=切替 / 長押し=メニュー");
        dropdown.setValue(this.plugin.settings.playerMenuAction);
        dropdown.onChange(async (value) => {
          this.plugin.settings.playerMenuAction = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("起動時のビュー")
      .setDesc("Player Mode ON時の初期表示")
      .addDropdown((dropdown) => {
        dropdown.addOption("player", "Player");
        dropdown.addOption("grid", "Grid");
        dropdown.setValue(this.plugin.settings.playerDefaultView);
        dropdown.onChange(async (value) => {
          this.plugin.settings.playerDefaultView = value;
          await this.plugin.saveSettings();
          this.plugin.applyDisplaySettings();
        });
      });

    const actions = this.plugin.getPlayerActionMap();
    const actionEntries = Object.keys(actions).map((id) => ({ id, label: actions[id].label }));

    for (let i = 0; i < 8; i++) {
      new Setting(containerEl)
        .setName(`Grid Button ${i + 1}`)
        .addDropdown((dropdown) => {
          actionEntries.forEach((a) => dropdown.addOption(a.id, a.label));
          dropdown.setValue(this.plugin.settings.playerGridBindings[i] || DEFAULT_SETTINGS.playerGridBindings[i]);
          dropdown.onChange(async (value) => {
            const next = this.plugin.settings.playerGridBindings.slice();
            next[i] = value;
            this.plugin.settings.playerGridBindings = next;
            await this.plugin.saveSettings();
            if (this.plugin.playerView === "grid") this.plugin.renderGridTop();
          });
        });
    }

    containerEl.createEl("h3", { text: "Advanced" });

    new Setting(containerEl).addButton((btn) => {
      btn.setButtonText("Reset to defaults");
      btn.onClick(async () => {
        this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
        await this.plugin.saveSettings();
        this.plugin.applyDisplaySettings();
        new Notice("Settings reset to defaults");
        this.display();
      });
    });
  }

  closeSuggest(el) {
    el.addClass("is-hidden");
  }

  getFolderSuggestions(query) {
    const q = String(query || "").trim().toLowerCase();
    const folders = new Set();

    for (const file of this.app.vault.getAllLoadedFiles()) {
      if (file instanceof TFolder && file.path) {
        folders.add(file.path);
      }
    }

    let list = Array.from(folders).filter((p) => p !== "");
    list.sort();

    if (q) {
      list = list.filter((p) => p.toLowerCase().includes(q));
    }

    return list.slice(0, 8);
  }

  async applyLogFolderChoice(value, inputEl, after, notifyOnInvalid = false) {
    const normalized = this.plugin.normalizeLogFolderPath(value);
    if (!normalized) {
      if (notifyOnInvalid) new Notice("パスが不正だよ（先頭/末尾/.. を確認してね）");
      if (after) after();
      return;
    }

    this.plugin.settings.logFolderPath = normalized;
    await this.plugin.saveSettings();
    inputEl.value = normalized;
    new Notice(`Log folder set to: ${normalized}`);
    this.plugin.applyDisplaySettings();
    if (after) after();
  }

  async applyTemplateFolderChoice(value, inputEl, after, notifyOnInvalid = false) {
    const normalized = this.plugin.normalizeTemplateFolderPath(value);
    if (normalized == null) {
      if (notifyOnInvalid) new Notice("パスが不正だよ（先頭/末尾/.. を確認してね）");
      if (after) after();
      return;
    }

    this.plugin.settings.templateFolderPath = normalized;
    await this.plugin.saveSettings();
    inputEl.value = normalized;
    if (normalized) {
      new Notice(`Template folder set to: ${normalized}`);
    } else {
      new Notice("Template folder cleared");
    }
    if (after) after();
  }
}
