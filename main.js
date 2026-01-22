// main.js
// TaskChute 最小構成プラグイン
// ✅機能
// - Open Today
// - Insert Task Line（##セクション末尾）
// - Insert+Start（親＋⌛＋tc:id付与＋state保存）
// - Start（⌛開始時刻を入れる／無ければ追加／tc:id付与）
// - End（stateがあればtc:idで終了、見つからなければ「開いているログ（なければToday）」を1回スキャンして最新の未完了⌛を終了）
// - Resume（最新の✅を⌛に戻し、state復元）
// - Insert Memo（タスク直下のみ）
// - Recalculate Duration（アクティブ行 or 親配下の最新✅の +Xm を再計算）
// - リボン（Today / Insert / Insert+Start / End）
//
// ✅追加（今回）
// - モバイルツールバーに出した時に「？」にならないよう、各コマンドに icon を付与
// - さらにカスタムアイコン（tc-hourglass）を addIcon() で登録（任意）
//   → Start に割り当て例を入れてある（必要なら他にも使える）

const { Plugin, Notice, MarkdownView, addIcon } = require("obsidian");

module.exports = class TaskChuteMinPlugin extends Plugin {
  async onload() {
    // =================================================
    // ✅ カスタムアイコン登録（任意）
    // - これを先に実行してから addCommand の icon で使う
    // =================================================
    addIcon(
      "tc-hourglass",
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
         <path d="M6 2h12"/>
         <path d="M6 22h12"/>
         <path d="M8 2v6a4 4 0 0 0 2 3l2 1 2-1a4 4 0 0 0 2-3V2"/>
         <path d="M8 22v-6a4 4 0 0 1 2-3l2-1 2 1a4 4 0 0 1 2 3v6"/>
       </svg>`
    );

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
    // Today / Insert / Insert+Start / End
    // =================================================
    this.addRibbonIcon("calendar", "TaskChute: Open Today", () => {
      this.openToday();
    });

    this.addRibbonIcon("plus", "TaskChute: Insert Task Line", () => {
      this.insertTaskLine();
    });

    this.addRibbonIcon("tc-hourglass", "TaskChute: Insert Task Line and Start", () => {
      this.insertTaskLineAndStartFromRibbon();
    });

    this.addRibbonIcon("square", "TaskChute: End", () => {
      this.endTask();
    });

    this.addRibbonIcon("skip-forward", "TaskChute: End and Start", () => {
      this.endAndStartTask();
    });
  }

  onunload() {}

  // async をそのまま渡すと環境によって握りつぶされることがあるのでラップ
  insertTaskLineAndStartFromRibbon() {
    this.insertAndStartTask();
  }

  // -------------------------
  // Open Today
  // -------------------------
  async openToday() {
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

    await this.app.workspace.getLeaf(false).openFile(file);
  }

  // -------------------------
  // Insert Task Line（仕様：現在の ## セクション末尾に親行を追加）
  // -------------------------
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

  // -------------------------
  // Insertして即Start
  // 例：
  // - 13:20   <!-- tc:id=xxxx -->
  //   - ⌛ 13:20–
  // -------------------------
  async insertAndStartTask() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return void new Notice("Markdownエディタを開いてね");

    const editor = view.editor;
    if (!editor) return void new Notice("エディタが見つからなかったよ");

    const file = view.file;
    if (!file) return void new Notice("ファイルが見つからなかったよ");

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

    // data.json 非依存のため state 保存は行わない
  }

  // -------------------------
  // Start（既存：上書きしない）
  // -------------------------
  async startTask() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return void new Notice("Markdownエディタを開いてね");

    const editor = view.editor;
    if (!editor) return void new Notice("エディタが見つからなかったよ");

    const file = view.file;
    if (!file) return void new Notice("ファイルが見つからなかったよ");

    const cursor = editor.getCursor();
    const parentLine = this.findParentLineIndex(editor, cursor.line);
    if (parentLine === null) return void new Notice("親行にカーソルを置いてね");

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

    // ⌛があるなら開始だけ入れる（既に開始ありはNotice）
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

      // data.json 非依存のため state 保存は行わない
      return;
    }

    // ⌛が無い → 親直下に新規
    const childText = `  - ⌛ ${timeStr}–  `;
    const insertPos = { line: parentLine, ch: parentText.length };

    editor.replaceRange("\n" + childText, insertPos);
    editor.setCursor({ line: parentLine + 1, ch: childText.length });

    // data.json 非依存のため state 保存は行わない
  }

  // -------------------------
  // End（改善版）
  // - state があれば tc:id で終了を試す
  // - tc:id 親が見つからない / ⌛が無いなどで失敗したら、
  //   「開いているログ（なければToday）」を1回スキャンして未完了⌛を終了する
  // -------------------------
  async endTask() {
    const state = null;

    // ===== ① state経由（確定的） =====
    if (state && state.filePath && state.tcId) {
      const file = this.app.vault.getAbstractFileByPath(state.filePath);
      if (file) {
        await this.app.workspace.getLeaf(false).openFile(file);

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !view.editor) return void new Notice("Markdownエディタが見つからなかったよ");

        const editor = view.editor;

        const parentLine = this.findParentLineByTcId(editor, state.tcId);

        // 見つかった場合だけ従来処理を試す。失敗したらフォールバックへ落ちる
        if (parentLine !== null) {
          const hourglass = this.findLatestHourglassChild(editor, parentLine);
          if (hourglass) {
            const { lineIndex, text } = hourglass;

            const startTime = this.extractStartTimeFromHourglass(text);
            if (!startTime) return void new Notice("開始時刻が無いよ（Startで入れてね）");

            if (this.hasEndTimeOnHourglass(text)) {
              new Notice("もう終了が入ってるよ（上書きしない）");
              return;
            }

            const endTime = window.moment().format("HH:mm");
            const minutes = this.diffMinutesHHMM(startTime, endTime);

            const doneText = `  - ✅ ${startTime}–${endTime} +${minutes}m`;
            editor.setLine(lineIndex, doneText);
            editor.setCursor({ line: lineIndex, ch: doneText.length });

            // data.json 非依存のため state 保存は行わない
            return;
          }
        }
      }
    }

    // ===== ② フォールバック：開いているログ（なければToday）を1回スキャン =====
    const targetFile = await this.resolveFileForFallback();
    if (!targetFile) {
      new Notice("稼働中のタスクが見つからないよ（対象ログも見つからない）");
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

    // data.json 非依存のため state 保存は行わない
  }

  // -------------------------
  // End and Start（新規）
  // - 対象は「今開いているファイルのみ」
  // - End に失敗したら Start しない
  // - Start は「ファイル先頭から一番上の未処理タスク」を開始（📝は除外）
  // -------------------------
  async endAndStartTask() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return void new Notice("Markdownエディタを開いてね");

    const editor = view.editor;
    if (!editor) return void new Notice("エディタが見つからなかったよ");

    const cursor = editor.getCursor();

    // ===== ① End 対象を決める（カーソル優先 → 親配下 → ファイル上から） =====
    const endTarget = this.pickEndTargetInCurrentFile(editor, cursor.line);
    if (!endTarget) {
      new Notice("未完了の⌛が見つからないよ");
      return;
    }

    const endResult = this.applyEndAtHourglassLine(editor, endTarget.lineIndex, endTarget.text);
    if (!endResult.ok) {
      new Notice(endResult.reason || "Endできなかったよ");
      return; // ✅ End失敗ならStartしない（確定）
    }

    // ===== ② Start 対象（最上段の未処理タスク） =====
    const parentLine = this.findFirstUnprocessedTaskParent(editor);
    if (parentLine === null) {
      new Notice("開始できる未処理タスクが見つからないよ");
      return;
    }

    await this.startTaskAtParentLine(editor, parentLine);
  }

  // End対象の決定（同一ファイルのみ）
  pickEndTargetInCurrentFile(editor, cursorLine) {
    const here = editor.getLine(cursorLine);

    // ① カーソルが⌛行ならそれ
    if (/^\s*-\s+⌛/.test(here) && !this.hasEndTimeOnHourglass(here)) {
      return { lineIndex: cursorLine, text: here };
    }

    // ② 親配下の未完了⌛
    const parentLine = this.findParentLineIndex(editor, cursorLine);
    if (parentLine !== null) {
      const boundary = this.findParentBlockBoundary(editor, parentLine);
      for (let i = parentLine + 1; i < boundary; i++) {
        const t = editor.getLine(i);
        if (/^\s*-\s+⌛/.test(t) && !this.hasEndTimeOnHourglass(t)) {
          return { lineIndex: i, text: t };
        }
      }
    }

    // ③ 同一ファイルを上から1回スキャンして最初の未完了⌛
    for (let i = 0; i < editor.lineCount(); i++) {
      const t = editor.getLine(i);
      if (/^\s*-\s+⌛/.test(t) && !this.hasEndTimeOnHourglass(t)) {
        return { lineIndex: i, text: t };
      }
    }

    return null;
  }

  // End適用（⌛行を✅に置換）
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

      // 親行候補：トップレベルの "- "
      if (!/^-\s+/.test(t)) continue;
      if (/^-\s+📝/.test(t)) continue; // ✅ 📝除外（確定）

      // 見出し等は除外（念のため）
      if (/^\s*#{1,6}\s+/.test(t)) continue;

      const boundary = this.findParentBlockBoundary(editor, i);

      let hasDone = false;
      let hasUnfinishedHourglass = false;

      for (let j = i + 1; j < boundary; j++) {
        const c = editor.getLine(j);
        if (/^\s+-\s+✅/.test(c)) hasDone = true;
        if (/^\s*-\s+⌛/.test(c) && !this.hasEndTimeOnHourglass(c)) hasUnfinishedHourglass = true;
        if (hasDone || hasUnfinishedHourglass) break;
      }

      if (!hasDone && !hasUnfinishedHourglass) return i;
    }

    return null;
  }

  // startTask の中核を「親行指定」で実行（data.jsonは使わない）
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

    // ⌛があるなら開始だけ入れる（既に開始ありはNotice）
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

  // -------------------------
  // Resume（直前の✅を⌛に戻して「実行中」に復元）
  // -------------------------
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

    // 親行を特定
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

    // data.json 非依存のため state 保存は行わない
  }

  // -------------------------
  // Recalculate Duration
  // - カーソル行が✅ならその行を再計算
  // - それ以外なら、親配下の最新✅を再計算
  // -------------------------
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

  // ✅行の +Xm を再計算して置換
  recalcDoneLine(doneLineText) {
    // 例：  "  - ✅ 13:20–14:05 +48m"
    // start/end が取れなければ null
    const m = doneLineText.match(/^\s+-\s+✅\s*(\d{2}:\d{2})\s*–\s*(\d{2}:\d{2})(.*)$/);
    if (!m) return null;

    const start = m[1];
    const end = m[2];
    const tail = m[3] || "";

    const minutes = this.diffMinutesHHMM(start, end);

    // 既存の +Xm があれば置換
    if (/\+\d+m/.test(tail)) {
      return doneLineText.replace(/\+\d+m/, `+${minutes}m`);
    }

    // +Xm が無いなら末尾に付与
    const trimmed = doneLineText.replace(/\s+$/, "");
    return `${trimmed} +${minutes}m`;
  }

  // -------------------------
  // Memo（既存）
  // -------------------------
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

  // -------------------------
  // 対象ファイル決定（開いているtaskchuteログ優先、なければTodayを作成）
  // -------------------------
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

  // -------------------------
  // ファイル全体スキャン helpers（End/Resume用）
  // -------------------------
  findLatestUnfinishedHourglassInFile(editor) {
    for (let i = editor.lineCount() - 1; i >= 0; i--) {
      const t = editor.getLine(i);

      // ⌛ 行だけ（念のため「子行」っぽい形を優先）
      // - "  - ⌛" や "- ⌛" の両方を拾えるようにしておく
      if (/^\s*-\s+⌛/.test(t)) {
        if (!this.hasEndTimeOnHourglass(t)) {
          return { lineIndex: i, text: t };
        }
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

  // -------------------------
  // ## セクション helpers（Insert系で使用）
  // -------------------------
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

  // -------------------------
  // 親行探索：確定ルールどおり
  // -------------------------
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

  findParentLineByTcId(editor, tcId) {
    const re = new RegExp(`<!--\\s*tc:id=${this.escapeRegExp(tcId)}\\s*-->`);
    const lineCount = editor.lineCount();
    for (let i = 0; i < lineCount; i++) {
      const t = editor.getLine(i);
      if (/^-\s+/.test(t) && re.test(t)) return i;
    }
    return null;
  }

  // -------------------------
  // ⌛ 子行探索（親配下）
  // -------------------------
  findLatestHourglassChild(editor, parentLine) {
    const boundary = this.findParentBlockBoundary(editor, parentLine);
    let last = null;

    for (let i = parentLine + 1; i < boundary; i++) {
      const t = editor.getLine(i);
      if (/^\s*$/.test(t)) continue;

      // 子ブロックの ⌛ 行（インデントあり）だけを対象にする
      // ※親行は ^-\s+ で始まるので、誤ヒットしない
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

  // ✅ 子行探索（親配下の最新）
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

  hasStartTimeOnHourglass(text) {
    return /^\s*-\s+⌛\s*\d{2}:\d{2}/.test(text);
  }

  insertStartTimeOnHourglass(text, timeStr) {
    if (!/^\s*-\s+⌛/.test(text)) return text;
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

  escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // -------------------------
  // tc:id utils
  // -------------------------
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
