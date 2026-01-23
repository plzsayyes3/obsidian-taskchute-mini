// main.js
// TaskChute Min Plugin（Obsidian）
//
// ✅ コア機能
// - Open Today / Prev Day / Next Day（taskchute/YYYY-MM-DD.md を開く。無ければ作成）
// - Insert Task Line（## セクション末尾に親行を追加）
// - Insert & Start（親行 + tc:id 付与 + ⌛ 子行を追加して開始）
// - Start（親行に tc:id を付与。⌛ 子行があれば開始時刻だけ入れる／無ければ追加）
// - End（stateなし運用：開いているログをスキャンして「未完了⌛」を ✅ に変換）
// - End & Start（同一ファイルで「未完了⌛」を終了 → ファイル先頭の未処理タスクを開始。📝親は除外）
// - Resume（最新の ✅ を ⌛ に戻す）
// - Insert Memo（タスク直下のみ）
// - Recalculate Duration（✅ 行の +Xm を再計算：カーソル行 or 親配下の最新✅）
//
// ✅ UI / 表示拡張
// - Player Mode（taskchuteログを開いていて、モバイルでキーボードが閉じている時だけ表示）
//   - [入力モード] / [≡] / [▷▷ End&Start] / [▶ Start] / [■ End] / [＜ 上] / [＞ 下]
//   - 上下ボタンは「行フォーカス」＝エディタのカーソルを 1 行移動（本文は変更しない）
// - Focus Mode（本文を書き換えず、表示だけ）
//   - 親行（トップレベル - ）は表示
//   - 子行は「⌛ 行だけ表示」、それ以外の子行は非表示（CSSで隠す）
//
// ✅ アイコン
// - コマンドに icon を付与（モバイルツールバーで「？」にならない）
// - カスタムアイコン tc-hourglass を addIcon() で登録
//
// ⚠️ CSS について
// - Player Mode の見た目（.taskchute-player など）は styles.css に入れてください。
//   main.js に CSS を混ぜると VS Code / Obsidian で構文エラーになります。

const { Plugin, Notice, MarkdownView, addIcon, Menu } = require("obsidian");

// Focus Mode（CodeMirror6 行デコレーション用）
const { ViewPlugin, Decoration } = require("@codemirror/view");
const { RangeSetBuilder } = require("@codemirror/state");

module.exports = class TaskChuteMinPlugin extends Plugin {
  async onload() {
    // =================================================
    // ✅ カスタムアイコン登録（任意）
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
    // Player / Focus Mode state（手動トグル）
    // =================================================
    this.playerMode = false;
    this.playerEl = null;
    this.oneLineMode = false;

    this.focusMode = false;

    // Player Mode: 表示条件を監視（アクティブファイル / キーボード開閉）
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updatePlayerVisibility()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.updatePlayerVisibility()));

    // iOS/Android キーボード推定：visualViewport の高さ変化を見る
    if (window.visualViewport) {
      this.registerDomEvent(window.visualViewport, "resize", () => this.updatePlayerVisibility());
    }
    this.registerDomEvent(window, "resize", () => this.updatePlayerVisibility());

    // Focus Mode（表示のみ・本文非変更）
    this.registerEditorExtension(this.buildFocusModeExtension());

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
      id: "taskchute-insert-task-line",
      name: "TaskChute: Insert Task Line",
      icon: "plus",
      callback: () => this.insertTaskLine(),
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
      id: "taskchute-end",
      name: "TaskChute: End",
      icon: "square",
      callback: () => this.endTask(),
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
    this.destroyPlayerUI();
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

    if (this.playerMode) {
      this.ensurePlayerUI();
    }
    this.updatePlayerVisibility();

    new Notice(this.playerMode ? "Player Mode: ON" : "Player Mode: OFF");
  }

  // =========================
  // TaskChute Music Player Mode
  // =========================
  ensurePlayerUI() {
    if (this.playerEl) return;

    const el = document.createElement("div");
    el.className = "taskchute-player is-hidden";
    el.setAttribute("aria-label", "TaskChute Music Player Mode");

    const grid = document.createElement("div");
    grid.className = "tc-grid";

    // [入力モード]（左上）
    const btnInput = document.createElement("button");
    btnInput.className = "tc-btn tc-input";
    btnInput.textContent = "入力モード";
    btnInput.addEventListener("click", () => this.enterInputMode());

    // Now Playing（任意：固定。後で「現在の親行名」に置換可能）
    const display = document.createElement("div");
    display.className = "tc-display";
    display.textContent = "Now Playing…";

    // [≡]（右上）
    const btnMenu = document.createElement("button");
    btnMenu.className = "tc-btn tc-menu";
    btnMenu.textContent = "≡";
    btnMenu.addEventListener("click", (ev) => this.openPlayerMenu(ev));

    // [▷▷]（中央段 左）End&Start
    const btnSkip = document.createElement("button");
    btnSkip.className = "tc-btn tc-skip";
    btnSkip.textContent = "▷▷";
    btnSkip.addEventListener("click", () => this.endAndStartTask());

    // [▶]（中央段 中央）Start
    const btnStart = document.createElement("button");
    btnStart.className = "tc-btn tc-start";
    btnStart.textContent = "▶";
    btnStart.addEventListener("click", () => this.startTask());

    // [■]（中央段 右）End
    const btnEnd = document.createElement("button");
    btnEnd.className = "tc-btn tc-end";
    btnEnd.textContent = "■";
    btnEnd.addEventListener("click", () => this.endTask());

    // [＜]（下段 左）1行上へ（カーソル移動）
    const btnUp = document.createElement("button");
    btnUp.className = "tc-btn tc-focus";
    btnUp.textContent = "＜";
    btnUp.addEventListener("click", () => this.moveCursorLine(-1));

    // grip（下段 中央の飾り）
    const grip = document.createElement("div");
    grip.className = "tc-grip";
    const gripbar = document.createElement("div");
    gripbar.className = "tc-gripbar";
    grip.appendChild(gripbar);

    // [＞]（下段 右）1行下へ（カーソル移動）
    const btnDown = document.createElement("button");
    btnDown.className = "tc-btn tc-next";
    btnDown.textContent = "＞";
    btnDown.addEventListener("click", () => this.moveCursorLine(1));

    // append（grid配置はCSSで決まる）
    grid.appendChild(btnInput);
    grid.appendChild(display);
    grid.appendChild(btnMenu);

    grid.appendChild(btnSkip);
    grid.appendChild(btnStart);
    grid.appendChild(btnEnd);

    grid.appendChild(btnUp);
    grid.appendChild(grip);
    grid.appendChild(btnDown);

    el.appendChild(grid);
    document.body.appendChild(el);
    this.playerEl = el;
  }

  destroyPlayerUI() {
    if (!this.playerEl) return;
    this.playerEl.remove();
    this.playerEl = null;
  }

  updatePlayerVisibility() {
    // Player Mode がONでなければ隠す（UIは残してOK）
    if (!this.playerMode) {
      if (this.playerEl) this.playerEl.classList.add("is-hidden");
      return;
    }

    // UIがまだなければ作る
    this.ensurePlayerUI();

    const shouldShow = this.isTaskchuteLogActive() && this.isKeyboardClosedLikely();
    this.playerEl.classList.toggle("is-hidden", !shouldShow);
  }

  isTaskchuteLogActive() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const path = view?.file?.path || "";
    return /^taskchute\/\d{4}-\d{2}-\d{2}\.md$/.test(String(path));
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

    menu.addItem((item) => item.setTitle("Prev Day").onClick(() => this.openPrevDay()));
    menu.addItem((item) => item.setTitle("Next Day").onClick(() => this.openNextDay()));
    menu.addItem((item) => item.setTitle("Today").onClick(() => this.openToday()));

    menu.addSeparator();

    menu.addItem((item) => item.setTitle("Insert Task").onClick(() => this.insertTaskLine()));
    menu.addItem((item) => item.setTitle("Insert & Start").onClick(() => this.insertAndStartTask()));
    menu.addItem((item) => item.setTitle("Resume").onClick(() => this.resumeTask()));

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

    document.body.classList.toggle("taskchute-focus", this.focusMode);
    this.refreshAllMarkdownEditors();

    new Notice(this.focusMode ? "Focus Mode: ON" : "Focus Mode: OFF");
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

    const hideLine = Decoration.line({
      attributes: { class: "taskchute-focus-hide" },
    });

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

    function build(view) {
      if (!plugin.focusMode) return Decoration.none;

      const b = new RangeSetBuilder();
      const doc = view.state.doc;

      for (const r of view.visibleRanges) {
        let pos = r.from;
        while (pos <= r.to) {
          const line = doc.lineAt(pos);
          if (shouldHide(line.text)) {
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
    const m = String(path).match(/^taskchute\/(\d{4}-\d{2}-\d{2})\.md$/);
    if (m) return m[1];
    return window.moment().format("YYYY-MM-DD");
  }

  async openTaskchuteByDate(dateStr) {
    const vault = this.app.vault;
    const folder = "taskchute";
    const filePath = `${folder}/${dateStr}.md`;

    const folderAbstract = vault.getAbstractFileByPath(folder);
    if (!folderAbstract) {
      await vault.createFolder(folder);
    }

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

    const idsInFile = this.collectTcIds(editor.getValue());
    const tcId = this.generateUniqueTcId(idsInFile);

    const parentLineText = `- ${timeStr}   <!-- tc:id=${tcId} -->`;
    const childLineText = `  - ⌛ ${timeStr}–  `;

    const boundary = this.findH2SectionBoundary(editor, sectionHeaderLine);
    const insertAfterLine = Math.max(sectionHeaderLine, boundary - 1);
    const insertPos = { line: insertAfterLine, ch: editor.getLine(insertAfterLine).length };

    editor.replaceRange("\n" + parentLineText + "\n" + childLineText, insertPos);
    editor.setCursor({ line: insertAfterLine + 2, ch: childLineText.length });
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
  async startTaskAtParentLine(editor, parentLine) {
    let parentText = editor.getLine(parentLine);

    // tc:id 付与（重複なら静かに修正）
    const idsInFile = this.collectTcIds(editor.getValue());
    const existingId = this.extractTcId(parentText);

    let tcId = existingId || this.generateTcId();

    if (existingId && this.isDuplicateId(idsInFile, existingId)) {
      tcId = this.generateUniqueTcId(idsInFile);
      parentText = this.upsertTcIdComment(parentText, tcId);
      editor.setLine(parentLine, parentText);
    } else if (!existingId) {
      tcId = this.generateUniqueTcId(idsInFile);
      parentText = this.upsertTcIdComment(parentText, tcId);
      editor.setLine(parentLine, parentText);
    }

    const timeStr = window.moment().format("HH:mm");

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
      return;
    }

    // ⌛が無い → 親直下に新規
    const childText = `  - ⌛ ${timeStr}–  `;
    const insertPos = { line: parentLine, ch: parentText.length };

    editor.replaceRange("\n" + childText, insertPos);
    editor.setCursor({ line: parentLine + 1, ch: childText.length });
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

    const doneText = `  - ✅ ${startTime}–${endTime} +${minutes}m`;
    editor.setLine(lineIndex, doneText);
    editor.setCursor({ line: lineIndex, ch: doneText.length });
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
    const doneText = `  - ✅ ${startTime}–${endTime} +${minutes}m`;

    editor.setLine(lineIndex, doneText);
    editor.setCursor({ line: lineIndex, ch: doneText.length });

    return { ok: true };
  }

  // 「一番上の未処理タスク」＝トップレベル親行で、
  // - 親行が "- 📝" の場合は除外
  // - 配下に ✅ が無い
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
        if (/^\s+-\s+✅/.test(c)) hasDone = true;
        if (this.isHourglassLine(c) && !this.hasEndTimeOnHourglass(c)) hasUnfinishedHourglass = true;
        if (hasDone || hasUnfinishedHourglass) break;
      }

      if (!hasDone && !hasUnfinishedHourglass) return i;
    }

    return null;
  }

  // =================================================
  // Resume（最新の✅を⌛に戻す）
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
      new Notice("戻せる✅が見つからないよ");
      return;
    }

    const { lineIndex, text } = found;

    const startTime = this.extractStartTimeFromDone(text);
    if (!startTime) {
      new Notice("✅から開始時刻を取れなかったよ");
      return;
    }

    const parentLine = this.findParentLineIndex(editor, lineIndex);
    if (parentLine === null) {
      new Notice("✅の親行が見つからないよ");
      return;
    }

    // 親行に tc:id が無ければ付与（重複は静かに回避）
    let parentText = editor.getLine(parentLine);
    const idsInFile = this.collectTcIds(editor.getValue());
    const existingId = this.extractTcId(parentText);

    let tcId = existingId || this.generateTcId();
    if (existingId && this.isDuplicateId(idsInFile, existingId)) {
      tcId = this.generateUniqueTcId(idsInFile);
      parentText = this.upsertTcIdComment(parentText, tcId);
      editor.setLine(parentLine, parentText);
    } else if (!existingId) {
      tcId = this.generateUniqueTcId(idsInFile);
      parentText = this.upsertTcIdComment(parentText, tcId);
      editor.setLine(parentLine, parentText);
    }

    const resumedText = `  - ⌛ ${startTime}–  `;
    editor.setLine(lineIndex, resumedText);
    editor.setCursor({ line: lineIndex, ch: resumedText.length });
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

    // ① カーソル行が✅なら、その行を対象
    if (/^\s+-\s+✅/.test(lineText)) {
      const updated = this.recalcDoneLine(lineText);
      if (!updated) return void new Notice("✅行から時刻を読めなかったよ");
      if (updated === lineText) return void new Notice("変更はないよ");

      editor.setLine(lineIndex, updated);
      editor.setCursor({ line: lineIndex, ch: updated.length });
      new Notice("再計算したよ");
      return;
    }

    // ② それ以外 → 親配下の最新✅
    const parentLine = this.findParentLineIndex(editor, lineIndex);
    if (parentLine === null) return void new Notice("親行（タスク）を見つけられなかったよ");

    const done = this.findLatestDoneChild(editor, parentLine);
    if (!done) return void new Notice("このタスク配下に✅が見つからないよ");

    const { lineIndex: doneLineIndex, text: doneText } = done;
    const updated = this.recalcDoneLine(doneText);
    if (!updated) return void new Notice("✅行から時刻を読めなかったよ");
    if (updated === doneText) return void new Notice("変更はないよ");

    editor.setLine(doneLineIndex, updated);
    editor.setCursor({ line: doneLineIndex, ch: updated.length });
    new Notice("再計算したよ");
  }

  recalcDoneLine(doneLineText) {
    const m = doneLineText.match(/^\s+-\s+✅\s*(\d{2}:\d{2})\s*–\s*(\d{2}:\d{2})(.*)$/);
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
    const folder = "taskchute";
    const dateStr = window.moment().format("YYYY-MM-DD");
    const filePath = `${folder}/${dateStr}.md`;

    const folderAbstract = vault.getAbstractFileByPath(folder);
    if (!folderAbstract) {
      await vault.createFolder(folder);
    }

    let file = vault.getAbstractFileByPath(filePath);
    if (!file) {
      file = await vault.create(filePath, `# TaskChute ${dateStr}\n\n`);
    }

    return file;
  }

  isTaskchuteLogPath(path) {
    return /^taskchute\/\d{4}-\d{2}-\d{2}\.md$/.test(String(path || ""));
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
      if (/^\s+-\s+✅/.test(t)) {
        return { lineIndex: i, text: t };
      }
    }
    return null;
  }

  extractStartTimeFromDone(text) {
    const m = text.match(/^\s+-\s+✅\s*(\d{2}:\d{2})/);
    return m ? m[1] : null;
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
      if (/^\s+-\s+✅/.test(t)) last = { lineIndex: i, text: t };
    }

    return last;
  }

  // =================================================
  // ⌛ / ✅ 解析
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