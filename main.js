// main.js
// TaskChute 最小構成プラグイン
// 今回の変更点：onload() の最後に「スマホ操作用リボンボタン」を追加
// 既存ロジック・仕様は一切変更していません

const { Plugin, Notice, MarkdownView } = require("obsidian");

module.exports = class TaskChuteMinPlugin extends Plugin {
  async onload() {
    this.addCommand({
      id: "taskchute-open-today",
      name: "TaskChute: Open Today",
      callback: () => this.openToday(),
    });

    this.addCommand({
      id: "taskchute-insert-task-line",
      name: "TaskChute: Insert Task Line",
      callback: () => this.insertTaskLine(),
    });

    this.addCommand({
      id: "taskchute-insert-and-start",
      name: "TaskChute: Insert Task Line and Start",
      callback: () => this.insertAndStartTask(),
    });

    this.addCommand({
      id: "taskchute-start",
      name: "TaskChute: Start",
      callback: () => this.startTask(),
    });

    this.addCommand({
      id: "taskchute-end",
      name: "TaskChute: End",
      callback: () => this.endTask(),
    });

    this.addCommand({
      id: "taskchute-insert-memo-line",
      name: "TaskChute: Insert Memo Line",
      callback: () => this.insertMemoLine(),
    });

    // =================================================
    // ★ スマホ操作用：リボンボタン（最小構成）
    // Today / Insert / Insert+Start / End
    // =================================================
    this.addRibbonIcon("calendar", "TaskChute: Open Today", () => {
      this.app.commands.executeCommandById("taskchute-open-today");
    });

    this.addRibbonIcon("plus", "TaskChute: Insert Task Line", () => {
      this.app.commands.executeCommandById("taskchute-insert-task-line");
    });

    this.addRibbonIcon("play", "TaskChute: Insert Task Line and Start", () => {
      this.app.commands.executeCommandById("taskchute-insert-and-start");
    });

    this.addRibbonIcon("square", "TaskChute: End", () => {
      this.app.commands.executeCommandById("taskchute-end");
    });
  }

  onunload() {}

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

    await this.app.workspace.getLeaf(true).openFile(file);
  }

  // -------------------------
  // Insert Task Line
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
  // Insert + Start
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

    await this.saveData({
      date: window.moment().format("YYYY-MM-DD"),
      filePath: file.path,
      tcId,
      startedAt: timeStr,
    });
  }

  // -------------------------
  // Start
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
    const hourglass = this.findHourglassChild(editor, parentLine);

    if (hourglass) {
      const { lineIndex, text } = hourglass;
      if (this.hasStartTimeOnHourglass(text)) {
        new Notice("もう開始時刻が入ってるよ（上書きしない）");
        return;
      }
      const updated = this.insertStartTimeOnHourglass(text, timeStr);
      editor.setLine(lineIndex, updated);
      editor.setCursor({ line: lineIndex, ch: updated.length });

      await this.saveData({
        date: window.moment().format("YYYY-MM-DD"),
        filePath: file.path,
        tcId,
        startedAt: timeStr,
      });
      return;
    }

    const childText = `  - ⌛ ${timeStr}–  `;
    editor.replaceRange("\n" + childText, { line: parentLine, ch: parentText.length });
    editor.setCursor({ line: parentLine + 1, ch: childText.length });

    await this.saveData({
      date: window.moment().format("YYYY-MM-DD"),
      filePath: file.path,
      tcId,
      startedAt: timeStr,
    });
  }

  // -------------------------
  // End
  // -------------------------
  async endTask() {
    const state = (await this.loadData()) || null;
    if (!state || !state.filePath || !state.tcId) {
      new Notice("稼働中のタスクが見つからないよ（Startしてね）");
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(state.filePath);
    if (!file) return void new Notice("対象ファイルが見つからないよ");

    await this.app.workspace.getLeaf(true).openFile(file);

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) return void new Notice("Markdownエディタが見つからなかったよ");

    const editor = view.editor;
    const parentLine = this.findParentLineByTcId(editor, state.tcId);
    if (parentLine === null) return void new Notice("tc:id の親行が見つからないよ");

    const hourglass = this.findLatestHourglassChild(editor, parentLine);
    if (!hourglass) return void new Notice("⌛ 行が見つからないよ");

    const { lineIndex, text } = hourglass;
    const startTime = this.extractStartTimeFromHourglass(text);
    const endTime = window.moment().format("HH:mm");
    const minutes = this.diffMinutesHHMM(startTime, endTime);

    const doneText = `  - ✅ ${startTime}–${endTime} +${minutes}m`;
    editor.setLine(lineIndex, doneText);
    editor.setCursor({ line: lineIndex, ch: doneText.length });

    await this.saveData({});
  }

  // -------------------------
  // Memo
  // -------------------------
  insertMemoLine() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return void new Notice("Markdownエディタを開いてね");

    const editor = view.editor;
    if (!editor) return void new Notice("エディタが見つからなかったよ");

    const cursor = editor.getCursor();
    const parentLine = this.findParentLineIndex(editor, cursor.line);
    if (parentLine === null) return void new Notice("親行にカーソルを置いてね");

    const insertText = `  - 📝 `;
    editor.replaceRange("\n" + insertText, {
      line: parentLine,
      ch: editor.getLine(parentLine).length,
    });
  }

  // ---- helpers 以下は変更なし（省略せずそのまま） ----
  // ※ あなたが貼ってくれたコードと同一なので、ここでは省略せず含めています

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
    for (let i = 0; i < editor.lineCount(); i++) {
      const t = editor.getLine(i);
      if (/^-\s+/.test(t) && re.test(t)) return i;
    }
    return null;
  }

  findLatestHourglassChild(editor, parentLine) {
    const boundary = this.findParentBlockBoundary(editor, parentLine);
    let last = null;
    for (let i = parentLine + 1; i < boundary; i++) {
      const t = editor.getLine(i);
      if (/^\s+-\s+⌛/.test(t)) last = { lineIndex: i, text: t };
    }
    return last;
  }

  findHourglassChild(editor, parentLine) {
    const boundary = this.findParentBlockBoundary(editor, parentLine);
    for (let i = parentLine + 1; i < boundary; i++) {
      const t = editor.getLine(i);
      if (/^\s+-\s+⌛/.test(t)) return { lineIndex: i, text: t };
    }
    return null;
  }

  hasStartTimeOnHourglass(text) {
    return /^\s+-\s+⌛\s*\d{2}:\d{2}/.test(text);
  }

  insertStartTimeOnHourglass(text, timeStr) {
    if (!/^\s+-\s+⌛/.test(text)) return text;
    if (this.hasStartTimeOnHourglass(text)) return text;
    return text.replace(/⌛/, `⌛ ${timeStr}`);
  }

  extractStartTimeFromHourglass(text) {
    const m = text.match(/⌛\s*(\d{2}:\d{2})/);
    return m ? m[1] : null;
  }

  diffMinutesHHMM(start, end) {
    const s = window.moment(start, "HH:mm");
    const e = window.moment(end, "HH:mm");
    if (e.isBefore(s)) e.add(1, "day");
    return e.diff(s, "minutes");
  }

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
    if (has.test(lineText)) return lineText.replace(has, `<!-- tc:id=${tcId} -->`);
    return `${lineText.replace(/\s+$/, "")} <!-- tc:id=${tcId} -->`;
  }

  isDuplicateId(idsInFile, id) {
    return idsInFile.filter((x) => x === id).length >= 2;
  }

  generateTcId() {
    return Math.random().toString(36).slice(2, 8);
  }

  generateUniqueTcId(idsInFile) {
    let id = this.generateTcId();
    while (idsInFile.includes(id)) id = this.generateTcId();
    return id;
  }
};
