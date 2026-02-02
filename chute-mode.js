/*!
 * Chute Mode (standalone) - cockpit-inspired full view
 * ---------------------------------------------------
 * This is a standalone UI layer intended for quick prototyping.
 * It renders a single-page "Chute Mode" view WITHOUT navigation.
 *
 * How to use:
 * 1) Create an HTML file that includes:
 *    <link rel="stylesheet" href="chute-mode.css" />
 *    <div id="app"></div>
 *    <script src="chute-mode.js"></script>
 * 2) Open the HTML in a browser.
 *
 * Optional:
 * - Put markdown into the textarea; the UI will parse parent tasks and child logs.
 * - The "NOW" section is derived from the latest unfinished hourglass (⌛) child line.
 */

(function () {
  "use strict";

  // ---------- Utilities ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const pad2 = (n) => String(n).padStart(2, "0");
  const nowHHMM = () => {
    const d = new Date();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  // Parse "(20m)" or "(20)" into minutes
  function parseEstimateMinutes(text) {
    const m = String(text || "").match(/\((\d{1,4})\s*m?\)/i);
    if (!m) return null;
    const v = Number(m[1]);
    if (!Number.isFinite(v) || v <= 0) return null;
    return v;
  }

  // Extract markdown link like [title](url) or [[Page|Alias]] or [[Page]]
  function extractLink(text) {
    const s = String(text || "");

    // [title](url)
    const md = s.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (md) return { label: md[1], href: md[2], kind: "md" };

    // [[Page|Alias]] or [[Page]]
    const wik = s.match(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/);
    if (wik) return { label: wik[3] || wik[1], href: wik[1], kind: "wik" };

    return null;
  }

  function isScheduleParent(line) {
    return /^-\s*\d{2}:\d{2}\b/.test(line);
  }

  function stripTcComment(s) {
    return String(s || "").replace(/<!--\s*tc:id=[^>]+-->/g, "").trim();
  }

  function stripEstimate(s) {
    return String(s || "").replace(/\(\d{1,4}\s*m?\)/gi, "").trim();
  }

  // ---------- Task parsing ----------
  function parseTaskchuteMarkdown(md) {
    const lines = String(md || "").split(/\r?\n/);

    const parents = [];
    let current = null;

    function pushCurrent() {
      if (current) parents.push(current);
      current = null;
    }

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];

      if (i === 0 && /^#\s+/.test(raw)) continue;

      const isParent = /^-\s+/.test(raw);
      const isChild = /^\s+-\s+/.test(raw) && !isParent;

      if (isParent) {
        pushCurrent();
        const text = stripTcComment(raw);
        const estimate = parseEstimateMinutes(text);
        const link = extractLink(text);
        current = {
          lineNo: i,
          raw,
          text,
          textNoEstimate: stripEstimate(text),
          estimate,
          link,
          children: [],
          done: false,
          running: false,
          latestChild: null,
          schedule: isScheduleParent(text),
          must: false,
        };
        continue;
      }

      if (isChild && current) {
        const t = raw.trim();
        current.children.push({ raw, text: t, lineNo: i });

        if (/^\-\s*✔️/.test(t)) current.done = true;

        if (/^\-\s*⌛/.test(t)) {
          const hasEnd = /–\s*\d{2}:\d{2}/.test(t);
          if (!hasEnd) {
            current.running = true;
            current.latestChild = { raw, text: t, lineNo: i, kind: "hourglass" };
          }
        }

        current.latestChild = current.latestChild || { raw, text: t, lineNo: i, kind: "child" };
        continue;
      }
    }

    pushCurrent();

    const mustParents = parents.filter((p) => /\bmust\b/i.test(p.text));
    mustParents.forEach((p) => (p.must = true));

    let now = null;
    for (const p of parents) {
      if (p.running && p.latestChild && p.latestChild.kind === "hourglass") {
        if (!now || p.latestChild.lineNo > now.latestChild.lineNo) now = p;
      }
    }

    let next = null;
    if (now) {
      const idx = parents.indexOf(now);
      for (let j = idx + 1; j < parents.length; j++) {
        const p = parents[j];
        if (!p.done && !p.running) {
          next = p;
          break;
        }
      }
    }
    if (!next) next = parents.find((p) => !p.done && !p.running) || null;

    const remaining = parents.reduce((sum, p) => {
      if (p.done) return sum;
      if (typeof p.estimate === "number") return sum + p.estimate;
      return sum;
    }, 0);

    return { parents, now, next, remaining };
  }

  const minutesToHHMM = (totalMinutes) => {
    const m = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${pad2(h)}:${pad2(mm)}`;
  };

  function computeETA(remainingMinutes) {
    const d = new Date();
    const current = d.getHours() * 60 + d.getMinutes();
    return minutesToHHMM(current + (remainingMinutes || 0));
  }

  // ---------- Rendering ----------
  function createBaseLayout() {
    const root = document.createElement("div");
    root.className = "chute";

    root.innerHTML = `
      <header class="chute__header">
        <div class="horizon">
          <div class="horizon__left">
            <div class="horizon__label">NOW</div>
            <div class="horizon__time" id="h_now_time">--:--</div>
          </div>
          <div class="horizon__center">
            <div class="horizon__metric">
              <div class="metric__k">Remaining</div>
              <div class="metric__v" id="h_remaining">—</div>
            </div>
            <div class="horizon__metric">
              <div class="metric__k">ETA</div>
              <div class="metric__v" id="h_eta">—</div>
            </div>
          </div>
          <div class="horizon__right">
            <button class="btn btn--ghost" id="btn_refresh" type="button">Refresh</button>
          </div>
        </div>
      </header>

      <main class="chute__main">
        <section class="panel panel--must" aria-label="Must">
          <div class="panel__title">MUST (up to 3)</div>
          <div class="panel__body" id="must_list"></div>
        </section>

        <section class="panel panel--now" aria-label="Now">
          <div class="panel__title panel__title--now">NOW</div>
          <div class="panel__body panel__body--now">
            <div class="nowcard" id="now_card">
              <div class="nowcard__state" id="now_state">READY</div>
              <div class="nowcard__title" id="now_title">No active task</div>
              <div class="nowcard__meta" id="now_meta"></div>
            </div>
            <textarea class="memo" id="memo" placeholder="Memo (stays in this view)…"></textarea>
            <div class="btnrow" id="now_btnrow">
              <button class="btn" data-action="start_from_last">Start (from last end)</button>
              <button class="btn" data-action="end">End</button>
              <button class="btn" data-action="end_at_estimate">End at estimate</button>
              <button class="btn" data-action="time_punch">Time Punch</button>
              <button class="btn" data-action="end_and_start">End & Start</button>
              <button class="btn" data-action="add_under_now">Add under NOW</button>
            </div>
            <details class="accordion">
              <summary class="accordion__summary">More</summary>
              <div class="accordion__body">
                <button class="btn btn--ghost" data-action="toggle_focus_filter">Toggle Focus+Filter</button>
                <button class="btn btn--ghost" data-action="open_today">Open Today</button>
                <button class="btn btn--ghost" data-action="templates">Templates</button>
              </div>
            </details>
          </div>
        </section>

        <section class="panel panel--next" aria-label="Next and List">
          <div class="panel__title">NEXT</div>
          <div class="panel__body" id="next_block"></div>

          <div class="panel__title panel__title--sub">TASKS (scroll)</div>
          <div class="list list--tasks" id="task_list"></div>
        </section>
      </main>

      <footer class="chute__footer">
        <div class="input">
          <div class="input__title">Markdown source (prototype)</div>
          <textarea class="input__textarea" id="src"></textarea>
          <div class="input__hint">Paste your TaskChute markdown here. Links are tappable.</div>
        </div>
      </footer>

      <div class="toast" id="toast" aria-live="polite"></div>
    `;
    return root;
  }

  function toast(msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("is-show");
    window.clearTimeout(toast._timer);
    toast._timer = window.setTimeout(() => t.classList.remove("is-show"), 1400);
  }

  function elEmpty(text) {
    const d = document.createElement("div");
    d.className = "empty";
    d.textContent = text;
    return d;
  }

  function attachLongPress(el, onLongPress, ms = 450) {
    let timer = null;
    let moved = false;

    const start = (ev) => {
      moved = false;
      timer = window.setTimeout(() => {
        timer = null;
        if (!moved) onLongPress(ev);
      }, ms);
    };
    const cancel = () => {
      if (timer) window.clearTimeout(timer);
      timer = null;
    };

    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchend", cancel);
    el.addEventListener("touchcancel", cancel);
    el.addEventListener("touchmove", () => (moved = true), { passive: true });

    el.addEventListener("mousedown", start);
    el.addEventListener("mouseup", cancel);
    el.addEventListener("mouseleave", cancel);
    el.addEventListener("mousemove", () => (moved = true));
  }

  function renderTaskRow(p, opts) {
    const { compact, faintIfDone } = opts || {};
    const row = document.createElement("div");
    row.className = "taskrow";
    if (compact) row.classList.add("taskrow--compact");
    if (p.running) row.classList.add("is-running");
    if (p.done && faintIfDone) row.classList.add("is-done");

    const title = document.createElement("div");
    title.className = "taskrow__title";
    title.textContent = p.textNoEstimate || p.text;

    const meta = document.createElement("div");
    meta.className = "taskrow__meta";

    const parts = [];
    if (p.schedule) {
      const m = p.text.match(/-\s*(\d{2}:\d{2})/);
      if (m) parts.push(m[1]);
    }
    if (typeof p.estimate === "number") parts.push(`${p.estimate}m`);
    if (p.link) parts.push("link");
    meta.textContent = parts.join(" • ");

    row.appendChild(title);
    row.appendChild(meta);

    if (p.link) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = p.link.kind === "md" ? "open" : "wiki";
      chip.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (p.link.kind === "md") {
          window.open(p.link.href, "_blank", "noopener,noreferrer");
        } else {
          toast(`Wiki link: [[${p.link.href}]] (handled by Obsidian in-plugin)`);
        }
      });
      row.appendChild(chip);
    }

    return row;
  }

  function renderMust(mustEl, parents) {
    mustEl.replaceChildren();
    const explicit = parents.filter((p) => p.must);
    const fallback = parents.filter((p) => !p.done).slice(0, 3);
    const items = (explicit.length ? explicit : fallback).slice(0, 3);

    if (items.length === 0) {
      mustEl.appendChild(elEmpty("No must tasks"));
      return;
    }
    for (const p of items) mustEl.appendChild(renderTaskRow(p, { compact: false, faintIfDone: true }));
  }

  function renderNow(parsed) {
    const now = parsed.now;

    const stateEl = document.getElementById("now_state");
    const titleEl = document.getElementById("now_title");
    const metaEl = document.getElementById("now_meta");

    document.getElementById("h_now_time").textContent = nowHHMM();
    document.getElementById("h_remaining").textContent = parsed.remaining ? `${parsed.remaining}m` : "—";
    document.getElementById("h_eta").textContent = parsed.remaining ? computeETA(parsed.remaining) : "—";

    metaEl.replaceChildren();

    if (!now) {
      stateEl.textContent = "READY";
      titleEl.textContent = "No active task";
      return;
    }

    stateEl.textContent = "PLAYING";
    titleEl.textContent = now.textNoEstimate || now.text;

    let start = null;
    if (now.latestChild && now.latestChild.kind === "hourglass") {
      const m = now.latestChild.text.match(/⌛\s*(\d{2}:\d{2})/);
      if (m) start = m[1];
    }

    const bits = [];
    if (start) bits.push(`Started: ${start}`);
    if (typeof now.estimate === "number") bits.push(`Est: ${now.estimate}m`);

    if (now.link) {
      const a = document.createElement("a");
      a.className = "link";
      a.href = now.link.kind === "md" ? now.link.href : "#";
      a.textContent = now.link.label;
      a.addEventListener("click", (ev) => {
        if (now.link.kind === "wik") {
          ev.preventDefault();
          toast(`Wiki link: [[${now.link.href}]] (handled by Obsidian in-plugin)`);
        }
      });
      metaEl.appendChild(a);
    }

    if (bits.length) {
      const span = document.createElement("div");
      span.className = "meta";
      span.textContent = bits.join("  •  ");
      metaEl.appendChild(span);
    }
  }

  function renderNext(nextEl, parsed) {
    nextEl.replaceChildren();
    const next = parsed.next;

    if (!next) {
      nextEl.appendChild(elEmpty("No next task"));
      return;
    }

    const row = renderTaskRow(next, { compact: false, faintIfDone: true });
    row.classList.add("taskrow--next");
    nextEl.appendChild(row);
  }

  function renderTaskList(listEl, parsed) {
    listEl.replaceChildren();
    const visible = parsed.parents.filter((p) => !p.done);

    if (visible.length === 0) {
      listEl.appendChild(elEmpty("All tasks done"));
      return;
    }

    for (const p of visible) {
      const row = renderTaskRow(p, { compact: true, faintIfDone: false });
      if (parsed.now && p === parsed.now) row.classList.add("is-now");

      row.addEventListener("click", () => {
        if (!parsed.now) {
          const ok = window.confirm(`Start "${p.textNoEstimate || p.text}" ?`);
          if (ok) toast("Start requested (prototype)");
        } else {
          toast("Tap handled (prototype). In-plugin: jump to task line, etc.");
        }
      });

      attachLongPress(row, () => toast("Long-press menu (prototype)"));
      listEl.appendChild(row);
    }
  }

  function sampleMarkdown() {
    return `# TaskChute 2026-01-10

- 起床
  - ✔️ 06:20–06:29 +9m
- 🐈[みんちゃれ](shortcuts://run-shortcut?name=%E3%81%BF%E3%82%93%E3%81%A1%E3%82%83%E3%82%8C) <!-- tc:id=89ctw6 -->
  - ✔️ 06:29–06:32 +3m
- [英語](shortcuts://run-shortcut?name=English) (2m)<!-- tc:id=yyccy0 -->
  - ✔️ 06:32–06:33 +1m
- [[2026-01-10 ミッションステートメント|ミッション]]をみる (1m) <!-- tc:id=2ecnqx -->
  - ⌛ 06:35–  
- 書類発送 (15m)
- こどもの迎え (20m)
- プラグイン開発 (45m)
`;
  }

  function main() {
    const mount = document.getElementById("app") || document.body;
    const root = createBaseLayout();
    mount.appendChild(root);

    const src = document.getElementById("src");
    src.value = sampleMarkdown();

    const rerender = () => {
      const parsed = parseTaskchuteMarkdown(src.value);
      renderMust(document.getElementById("must_list"), parsed.parents);
      renderNow(parsed);
      renderNext(document.getElementById("next_block"), parsed);
      renderTaskList(document.getElementById("task_list"), parsed);
    };

    document.getElementById("btn_refresh").addEventListener("click", () => {
      rerender();
      toast("Refreshed");
    });

    document.getElementById("now_btnrow").addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-action]");
      if (!btn) return;
      toast(`Action: ${btn.getAttribute("data-action")} (prototype)`);
    });

    window.setInterval(() => {
      const t = document.getElementById("h_now_time");
      if (t) t.textContent = nowHHMM();
    }, 30_000);

    rerender();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();