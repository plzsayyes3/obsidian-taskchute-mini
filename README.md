# TaskChute Mini Plugin

⚠️ **非公式プラグイン / Unofficial Plugin**

**日本語**  
このプラグインは、TaskChute の思想に影響を受けて作られた  
**非公式・個人実装の Obsidian プラグイン**です。  

TaskChute® の公式製品・公式ツールとは関係ありません。

**English**  
This is an **unofficial Obsidian plugin**, inspired by the TaskChute methodology.  

It is not affiliated with or endorsed by the official TaskChute® products or services.

---
# TaskChute Mini Plugin

## 概要 / Overview

### 日本語
TaskChute Min Plugin は、  
Obsidian 上で「今やっていること」を迷わず扱うための  
**最小構成のタスク実行プラグイン**です。

- 状態管理は Markdown ファイルのみ
- data.json に依存しない
- 「開始・終了・次へ進む」ことだけに集中する設計

片づけるためではなく、  
**生活を前に進めるための TaskChute** を目指しています。

---

### English
TaskChute Min Plugin is a minimal task execution plugin for Obsidian,  
designed to handle **what you are doing right now** with clarity.

- No external state file (no data.json dependency)
- Markdown is the single source of truth
- Focused on starting, ending, and moving to the next task

This plugin is not about organizing tasks,  
but about **keeping daily work moving forward**.

---

## 基本思想 / Design Philosophy

### 日本語
- 記録よりも実行を優先する
- 状態は記号（⌛ / ✅）で表現する
- ファイルをまたがない
- 迷ったら「一番上の未処理タスク」へ進む

### English
- Execution over tracking
- Task state is represented by symbols (⌛ / ✅)
- No cross-file state management
- When in doubt, move to the first unprocessed task

---

## 現在の機能 / Current Features

### 📅 Open Today
**日本語**
- `taskchute/YYYY-MM-DD.md` を開く
- ファイルが無ければ新規作成
- 同じタブで開く（新規タブは作らない）

**English**
- Open `taskchute/YYYY-MM-DD.md`
- Create the file if it does not exist
- Reuse the current tab (no new tabs)

---

### ➕ Insert Task Line
**日本語**
- 現在の `##` セクション末尾に親タスク行を挿入
- 未処理タスクを作成する

**English**
- Insert a parent task line at the end of the current `##` section
- Creates an unprocessed task

---

### ⌛ Insert Task Line and Start
**日本語**
- 親タスクを挿入
- 同時に ⌛ を作成して開始
- `tc:id` を自動付与

**English**
- Insert a parent task line
- Start it immediately with an hourglass (⌛)
- Automatically assigns a `tc:id`

---

### ▶️ Start
**日本語**
- 親タスク配下の ⌛ を開始
- すでに開始時刻がある場合は上書きしない
- ⌛ が無ければ新規作成

**English**
- Start an hourglass (⌛) under the parent task
- Does not overwrite existing start times
- Creates a new hourglass if none exists

---

### ⏹ End
**日本語**
- 未完了の ⌛ を終了
- 開始時刻から経過時間を自動計算し `+Xm` を付与
- 同一ファイル内のみを対象とする

**English**
- End an unfinished hourglass (⌛)
- Automatically calculates duration (`+Xm`)
- Operates only within the current file

---

### ⏩ End and Start
**日本語**
- 現在の実行中タスクを終了
- その後、**ファイル先頭から一番上の未処理タスク**を開始
- End に失敗した場合は Start しない
- 📝 メモ行は Start 対象から除外

**English**
- End the currently running task
- Then start the **first unprocessed task in the file**
- Start is skipped if End fails
- Memo lines (`📝`) are excluded from start targets

---

### 🔁 Resume
**日本語**
- 直前の ✅ を ⌛ に戻す
- 実行中の状態を復元する

**English**
- Convert the most recent completed task (✅) back to ⌛
- Restores the running state

---

### 📝 Insert Memo Line
**日本語**
- タスク直下にメモ行（📝）を挿入
- メモは実行対象にならない

**English**
- Insert a memo line (📝) under a task
- Memo lines are never execution targets

---

### 🧮 Recalculate Duration
**日本語**
- 選択中の ✅ 行、または親配下の最新 ✅ の `+Xm` を再計算

**English**
- Recalculate duration (`+Xm`) for the selected or latest completed task

---

## ルーチンタスクについて / About Routine Tasks

### 日本語
- ルーチンは **1行設計**
- `## ルーチン` セクションの **一番下** に配置する
- Start 対象にはならないが、ログとして ✅ を残せる
- 毎日の構造はテンプレートで生成する想定

### English
- Routines are designed as **single-line tasks**
- Placed at the bottom of the `## Routine` section
- Not selected as start targets, but completion is logged with ✅
- Intended to be generated via daily templates

---

## モバイル操作 / Mobile UI

### 日本語
- Start：▶️  
- Insert and Start：⌛  
- End and Start：⏩  

モバイルでも直感的に使えるアイコン設計を採用しています。

### English
- Start: ▶️  
- Insert and Start: ⌛  
- End and Start: ⏩  

Icons are designed for intuitive mobile usage.

---

## 状態管理 / State Management

### 日本語
- data.json は使用しません
- 状態は Markdown 内の記号のみで表現されます

### English
- No data.json is used
- Task state is represented only by Markdown symbols

---

## 今後の構想 / Planned Features

### 日本語
- デイリーテンプレート機能  
  - `YYYY-MM-DD.md` が存在しない場合、テンプレートを選択
  - テンプレートが無い場合は空のデイリーを作成
- Start 対象を特定セクションに限定するオプション
- ルーチン運用のさらなる最適化

### English
- Daily template support  
  - Select a template when `YYYY-MM-DD.md` does not exist
  - Create an empty daily file if no template is available
- Option to limit start targets to specific sections
- Further optimization of routine task handling

---

## ライセンス / License
MIT
