# TaskChute Mini Plugin

⚠️ **非公式プラグイン / Unofficial Plugin**

**日本語**  
このプラグインは、TaskChute の思想に影響を受けて作られた  
**非公式・個人実装の Obsidian プラグイン**です。  

TaskChute® の公式製品・公式ツールとは関係ありません。

**English**  
This is an **unofficial Obsidian plugin**, inspired by the TaskChute methodology.  
It is not affiliated with or endorsed by official TaskChute® products or services.

---

## 概要 / Overview

### 日本語
TaskChute Mini は、Obsidian 上で「今やっていること」に集中するための  
**最小構成の実行ログプラグイン**です。

- 状態管理は Markdown のみ（data.json 不使用）
- 「開始・終了・次へ進む」を最短で回す設計
- 表示は CM6 Decoration で制御（本文は極力変更しない）

使い方の詳細は [USAGE.md](USAGE.md) を参照してください。

### English
TaskChute Mini is a minimal execution-log plugin for Obsidian,  
focused on "what you are doing right now".

- Markdown is the single source of truth (no data.json)
- Optimized for start/end/next flow
- Display is controlled via CM6 Decorations (minimal content edits)

See [USAGE.md](USAGE.md) for practical usage.

---

## 導入方法 / Installation

1. Vault の `.obsidian/plugins/obsidian-taskchute-min/` に配置  
2. Obsidian の「コミュニティプラグイン」を有効化  
3. `TaskChute (min)` を ON

---

## ログ記法 / Log Format

- 親タスク: トップレベル `- ` 行はすべてタスク  
- 子タスク:
  - 実行中: `  - ⌛ HH:mm–`
  - 完了: `  - ✔️ HH:mm–HH:mm +Xm`
  - メモ: `  - 📝 ...`

---

## 主な機能 / Key Features

- Open Today / Prev / Next（`logFolderPath/YYYY-MM-DD.md`）
- Start / End / End&Start / Resume / Time Punch
- 見積（`(20m)` / `(20)`）の自然記法＋バッジ表示
- Horizon Header（上部固定の残り/見積/ETA）
- Player Mode（下部UI）＋Grid 切替
- Player/Horizon の埋め込み・フローティング切替／ドラッグ移動／サイズ調整
- モバイル多段ツールバー（タップ最短）
- Focus / Filter / Dim 表示モード
- テンプレ（フォルダ指定・セクション挿入・前日コピー）

---

## 設定 / Settings

- Log folder path（`logFolderPath`）
- Template folder path（`templateFolderPath`）
- Enable templates / Focus / Filter / Dim / Player / Mobile toolbar
- Player placement / Player size / Horizon size / Size ranges
- Player 表示（初期ビュー / ≡挙動 / Grid割当）

---

## コマンド一覧 / Commands

### 日付・移動
- TaskChute: Open Today
- TaskChute: Open Previous Day
- TaskChute: Open Next Day

### 実行フロー
- TaskChute: Start
- TaskChute: End
- TaskChute: End At Estimate
- TaskChute: End and Start
- TaskChute: Resume
- TaskChute: Start From Latest Done Time
- TaskChute: Time Punch

### 挿入
- TaskChute: Insert Task Line（## セクション末尾）
- TaskChute: Add Task（親の兄弟として時刻なし追加）
- TaskChute: Insert Task Line and Start
- TaskChute: Insert Memo Line

### 見積
- TaskChute: Set Estimate (minutes)

### テンプレ・前日
- TaskChute: Insert Templates (Multi Select)
- TaskChute: Copy From Previous Day
- TaskChute: Debug List Templates

### 表示・UI
- TaskChute: Toggle Player Mode
- TaskChute: Toggle Horizon Header
- TaskChute: Toggle Focus Mode
- TaskChute: Toggle Filter Mode

### その他
- TaskChute: Recalculate Duration (+Xm)

---

## ライセンス / License
MIT
