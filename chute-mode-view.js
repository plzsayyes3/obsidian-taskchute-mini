// chute-mode-view.js
// TaskChute Mini - Chute Mode (Obsidian View)
// - Renders a "cockpit" full-view inside a workspace leaf (no page navigation)
// - Read-only for now: it does NOT edit markdown (buttons are wired as stubs)
// - Link tap opens the link via Obsidian's link handler.
//
// Place this file next to main.js in your plugin folder, then require() it from main.js.
// (See the replace snippets in chat.)

const { ItemView, Notice } = require("obsidian");

const VIEW_TYPE = "taskchute-chute-mode";

// ---- small utils ----
function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTaskchuteLogPath(path, logFolderPath) {
  const re = new RegExp(`^${escapeRegExp(logFolderPath)}/\\d{4}-\\d{2}-\\d{2}\\.md$`);
  return re.test(String(path || ""));
}

function todayStr() {
  return window.moment ? window.moment().format("YYYY-MM-DD") : new Date().toISOString().slice(0, 10);
}

function parseMinutesFromEstimate(text) {
  // "(20m)" "(20)" "( 20 m )" etc
  const m = String(text || "").match(/\((\s*\d{1,3}\s*)(m)?\)/i);
  if (!m) return null;
  const n = Number(String(m[1]).trim());
  if (Number.isNaN(n) || n <= 0) return null;
  return n;
}

function extractFirstMarkdownLink(text) {
  // [label](url)
  const m = String(text || "").match(/\[[^\]]+\]\(([^)]+)\)/);
  return m ? m[1] : null;
}

function stripMarkdown(text) {
  return String(text || "")
    .replace(/<!--.*?-->/g, "")
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, (_, url) => url) // keep url
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function parseTaskchuteMarkdown(markdown) {
  // Minimal parser:
  // - parent task: "- ..."
  // - children:
  //   - running: "  - ⌛ HH:mm–"
  //   - done:    "  - ✔️ HH:mm–HH:mm +Xm"
  //   - memo:    "  - 📝 ..."
  // - section headers "##" are ignored for grouping (kept as labels)
  const lines = String(markdown || "").split(/\r?\n/);

  const parents = [];
  let currentSection = null;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^##\s+/.test(line)) {
      currentSection = line.replace(/^##\s+/, "").trim();
      i++;
      continue;
    }

    if (/^-\s+/.test(line)) {
      const parentText = line.replace(/^-\s+/, "");
      const estimate = parseMinutesFromEstimate(parentText);
      const link = extractFirstMarkdownLink(parentText);

      const parent = {
        raw: line,
        title: stripMarkdown(parentText),
        section: currentSection,
        estimateMin: estimate,
        link,
        children: [],
      };

      i++;
      while (i < lines.length) {
        const c = lines[i];
        if (/^##\s+/.test(c) || /^-\s+/.test(c)) break;
        if (/^\s+-\s+/.test(c) && !/^-\s+/.test(c)) {
          parent.children.push(c.trimEnd());
        }
        i++;
      }

      parents.push(parent);
      continue;
    }

    i++;
  }

  // Determine "now" = latest running hourglass without end time
  let now = null;
  for (const p of parents) {
    for (const child of p.children) {
      if (/^-\s*⌛/.test(child.replace(/^\s+-\s+/, "- "))) {
        // normalize
      }
    }
    // child line format in your plugin is: "  - ⌛ HH:mm–  "
    const running = p.children.findLast
      ? p.children.findLast((c) => /^-\s*⌛/.test(c.replace(/^\s+-\s+/, "- ")))
      : (() => {
          let last = null;
          for (const c of p.children) {
            if (/^\s+-\s+⌛/.test(c)) last = c;
          }
          return last;
        })();

    if (running && !/–\s*\d{2}:\d{2}/.test(running)) {
      now = p; // last one wins
    }
  }

  // Determine done: has any done child ✔️
  function isDone(p) {
    return p.children.some((c) => /^\s+-\s+✔️/.test(c));
  }

  // Next = first parent that is not done and not now
  const next = parents.find((p) => p !== now && !isDone(p)) || null;

  // Must = top few upcoming (not done), keep original order
  const must = parents.filter((p) => !isDone(p)).slice(0, 8);

  // Progress ribbon entries (all parents in order)
  const ribbon = parents.map((p) => {
    const done = isDone(p);
    const isNow = p === now;
    const isNext = p === next;
    return {
      title: p.title,
      done,
      isNow,
      isNext,
      estimateMin: p.estimateMin,
    };
  });

  // Remaining estimate
  const remainingMin = must.reduce((sum, p) => sum + (p.estimateMin || 0), 0);

  return { parents, now, next, must, ribbon, remainingMin };
}

function fmtMinutes(n) {
  if (!n || n <= 0) return "";
  return `${n}m`;
}

// ---- View ----
class ChuteModeView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.targetFile = null;
    this._unsub = [];
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Chute Mode"; }
  getIcon() { return "layout-dashboard"; }

  async onOpen() {
    this.containerEl.empty();
    this.containerEl.addClass("taskchute-chute-mode-view");

    // Mount UI skeleton (from the standalone HTML body)
    const root = this.containerEl.createDiv({ cls: "tc-obsidian-root" });
    root.innerHTML = "<div class=\"tc-root\">\n    <header class=\"tc-header\">\n      <div class=\"tc-time\" id=\"tcTime\">--:--</div>\n      <div class=\"tc-date\" id=\"tcDate\">----/--/--</div>\n    </header>\n\n    <section class=\"tc-top\">\n      <div class=\"tc-box\">\n        <div class=\"tc-title\">MUST</div>\n        <div class=\"tc-list tc-must\" id=\"mustList\"></div>\n      </div>\n\n      <div class=\"tc-box\">\n        <div class=\"tc-title\">PROGRESS</div>\n        <div class=\"tc-ribbon\" id=\"progressRibbon\"></div>\n        <div class=\"tc-ribbon-legend\" id=\"ribbonLegend\"></div>\n      </div>\n    </section>\n\n    <main class=\"tc-middle\">\n      <section class=\"tc-now\">\n        <div class=\"tc-label\">NOW EXECUTING</div>\n        <div class=\"tc-now-task\" id=\"nowTitle\">READY</div>\n        <div class=\"tc-horizon\"></div>\n\n        <div class=\"tc-now-meta\" id=\"nowMeta\"></div>\n\n        <div class=\"tc-memo\">\n          <textarea id=\"nowMemo\" class=\"tc-memo-input\" placeholder=\"NOW \u306e\u4e0b\u306b\u30e1\u30e2\uff08\u3053\u3053\u306f\u4fdd\u5b58\u3057\u306a\u3044\u30c7\u30e2\uff09\"></textarea>\n        </div>\n\n        <div class=\"tc-actions\">\n          <button class=\"tc-btn\" data-action=\"start\">\u25b6 Start</button>\n          <button class=\"tc-btn\" data-action=\"end\">\u25a0 End</button>\n          <button class=\"tc-btn\" data-action=\"eas\">\u23ed E&S</button>\n          <button class=\"tc-btn\" data-action=\"time\">\u23f1 Time</button>\n          <button class=\"tc-btn tc-btn-accent\" data-action=\"add\">\uff0b Add</button>\n        </div>\n\n        <div class=\"tc-actions-sub\">\n          <button class=\"tc-chip\" data-action=\"startLatest\">\u524d\u56de\u306e\u7d42\u4e86\u6642\u523b\u304b\u3089\u30b9\u30bf\u30fc\u30c8</button>\n          <button class=\"tc-chip\" data-action=\"endAtEstimate\">\u898b\u7a4d\u3082\u308a\u901a\u308a\u306b\u7d42\u4e86</button>\n        </div>\n      </section>\n    </main>\n\n    <section class=\"tc-bottom\">\n      <div class=\"tc-box tc-scheduled-wrap\">\n        <div class=\"tc-title\">SCHEDULED</div>\n        <div class=\"tc-list tc-scroll\" id=\"scheduledList\"></div>\n      </div>\n\n      <div class=\"tc-box tc-tasklist-wrap\">\n        <div class=\"tc-title\">TASK LIST</div>\n        <div class=\"tc-list tc-scroll\" id=\"taskList\"></div>\n      </div>\n    </section>\n\n    <details class=\"tc-debug\">\n      <summary>\u30c7\u30e2\u5165\u529b\uff08Markdown \u3092\u8cbc\u308b\uff09</summary>\n      <div class=\"tc-debug-inner\">\n        <textarea id=\"mdInput\" class=\"tc-debug-text\"></textarea>\n        <div class=\"tc-debug-actions\">\n          <button class=\"tc-btn\" id=\"renderBtn\">Render</button>\n          <button class=\"tc-btn\" id=\"loadSampleBtn\">Load sample</button>\n        </div>\n        <p class=\"tc-note\">\n          \u203b\u3053\u306eHTML\u306f\u300c\u898b\u305f\u76ee\uff0b\u30c7\u30fc\u30bf\u6574\u5f62\u300d\u306e\u305f\u305f\u304d\u53f0\u3067\u3059\u3002Obsidian API \u306f\u4f7f\u3044\u307e\u305b\u3093\u3002<br/>\n          \u30d7\u30e9\u30b0\u30a4\u30f3\u5b9f\u88c5\u3067\u306f\u3001<code>getCockpitData()</code> \u76f8\u5f53\u3067\u751f\u6210\u3057\u305f\u30c7\u30fc\u30bf\u3092\u305d\u306e\u307e\u307e\u3053\u306eUI\u306b\u6d41\u3057\u8fbc\u307f\u307e\u3059\u3002\n        </p>\n      </div>\n    </details>\n  </div>\n\n<script>\n(function(){\n  const $ = (id)=>document.getElementById(id);\n\n  // ===== time ticker =====\n  function tick(){\n    const d = new Date();\n    const pad = (n)=>String(n).padStart(2,\"0\");\n    $(\"tcTime\").textContent = pad(d.getHours()) + \":\" + pad(d.getMinutes());\n    $(\"tcDate\").textContent = d.getFullYear() + \"-\" + pad(d.getMonth()+1) + \"-\" + pad(d.getDate());\n  }\n  tick(); setInterval(tick, 1000);\n\n  // ===== sample =====\n  const SAMPLE = `\u8d77\u5e8a\n  - \u2714\ufe0f 06:20\u201306:29 +9m\n- \ud83d\udc08[\u307f\u3093\u3061\u3083\u308c](shortcuts://run-shortcut?name=%E3%81%BF%E3%82%93%E3%81%A1%E3%82%83%E3%82%8C) <!-- tc:id=89ctw6 -->\n  - \u2714\ufe0f 06:29\u201306:32 +3m\n- [\u82f1\u8a9e](shortcuts://run-shortcut?name=English) (2m)<!-- tc:id=yyccy0 -->\n  - \u2714\ufe0f 06:32\u201306:33 +1m\n- [[2026-01-10 \u30df\u30c3\u30b7\u30e7\u30f3\u30b9\u30c6\u30fc\u30c8\u30e1\u30f3\u30c8|\u30df\u30c3\u30b7\u30e7\u30f3]]\u3092\u307f\u308b (1m) <!-- tc:id=2ecnqx -->\n- \u66f8\u985e\u767a\u9001 #must (20m)\n- \u3053\u3069\u3082\u306e\u8fce\u3048 #must (30m)\n- \u30d7\u30e9\u30b0\u30a4\u30f3\u958b\u767a #must (60m)\n- \ud83e\udde0\u8a2d\u8a08\u3092\u6398\u308b (30m)\n  - \u231b 10:00\u2013\n- \u8fd4\u4fe1\u307e\u3068\u3081 (15m)\n- \u660e\u65e5\u306e\u6e96\u5099 (10m)\n`;\n\n  // ===== very small markdown-ish parser =====\n  // Targets your current TaskChute format:\n  // - Parent task: top-level \"- \" or a bare line (for legacy)\n  // - Child lines: \"  - \" (2 spaces) with \u2714\ufe0f / \u231b / \ud83d\udcdd etc.\n  // - Estimate: \"(20m)\" or \"(20)\" on parent line\n  // - \"must\" marker: \"#must\" (simple convention for this demo)\n  // - Links: markdown link [x](url) or wikilink [[...]]\n  function parse(input){\n    const lines = String(input||\"\").replace(/\\r/g,\"\").split(\"\\n\");\n    const parents = [];\n    let current = null;\n\n    const parentRe = /^-\\s+(.*)$/;\n    const childRe  = /^\\s{2,}-\\s+(.*)$/;\n\n    for(const raw of lines){\n      const line = raw.trimEnd();\n      if(!line.trim()) continue;\n\n      const mChild = line.match(childRe);\n      if(mChild){\n        if(!current){ continue; }\n        current.children.push(mChild[1]);\n        continue;\n      }\n\n      const mParent = line.match(parentRe);\n      const text = mParent ? mParent[1] : line; // allow bare parent\n      current = {\n        raw: text,\n        title: sanitize(text),\n        estimateMin: extractEstimateMin(text),\n        isMust: /(^|\\s)#must(\\s|$)/i.test(text),\n        links: extractLinks(text),\n        children: []\n      };\n      parents.push(current);\n    }\n\n    // Determine NOW: first parent that has an active \"\u231b HH:mm\u2013\" child without a \u2714\ufe0f after it.\n    let now = null;\n    for(const p of parents){\n      const active = p.children.find(c => /\u231b\\s*\\d{2}:\\d{2}\u2013/.test(c));\n      if(active){\n        now = { parent: p, activeChild: active };\n        break;\n      }\n    }\n\n    // Completed heuristic (for task list): any \u2714\ufe0f child => done\n    function isDone(p){\n      return p.children.some(c => /^\u2714\ufe0f\\s/.test(c));\n    }\n\n    // Scheduled: parent lines that start with time like \"10:30 ...\" or have \"(10:30)\" etc.\n    const scheduled = parents\n      .filter(p => /(^|\\s)(\\d{1,2}:\\d{2})(\\s|$)/.test(p.raw))\n      .map(p => p.raw);\n\n    const must = parents\n      .filter(p => p.isMust)\n      .map(p => ({ text: p.raw, done: isDone(p) }));\n\n    const taskList = parents\n      .filter(p => !isDone(p)) // hide completed\n      .map(p => ({\n        title: p.title,\n        raw: p.raw,\n        estimateText: p.estimateMin ? `(${p.estimateMin}m)` : \"\",\n        links: p.links,\n        isNow: now && now.parent === p\n      }));\n\n    // Progress ribbon: build segments based on \u2714\ufe0f and \u231b children\n    // - \u2714\ufe0f segment uses its +Xm or computed from HH:mm\u2013HH:mm if present\n    // - \u231b segment (active) uses from start to now\n    const segments = [];\n    for(const p of parents){\n      for(const c of p.children){\n        if(/^\u2714\ufe0f\\s/.test(c)){\n          const minutes = extractDoneMinutes(c);\n          if(minutes != null) segments.push({ kind:\"done\", minutes, label:p.title });\n        }else if(/^\u231b\\s/.test(c)){\n          const minutes = extractActiveMinutes(c);\n          if(minutes != null) segments.push({ kind:\"now\", minutes, label:p.title });\n        }\n      }\n    }\n\n    return { parents, now, must, scheduled, taskList, segments };\n  }\n\n  function sanitize(s){\n    // Remove HTML comments + tc:id + excessive whitespace\n    return String(s)\n      .replace(/<!--.*?-->/g,\"\")\n      .replace(/\\s+tc:id=[^\\s>]+/g,\"\")\n      .replace(/\\s+/g,\" \")\n      .trim();\n  }\n\n  function extractEstimateMin(s){\n    const m = String(s).match(/\\((\\d{1,4})\\s*m?\\)/i);\n    if(!m) return null;\n    const n = parseInt(m[1],10);\n    return Number.isFinite(n) ? n : null;\n  }\n\n  function extractLinks(s){\n    const links = [];\n    const text = String(s);\n\n    // markdown links [label](url)\n    const mdRe = /\\[([^\\]]+)\\]\\(([^)]+)\\)/g;\n    let m;\n    while((m = mdRe.exec(text))){\n      links.push({ kind:\"external\", label:m[1], url:m[2] });\n    }\n\n    // wikilinks [[path|label]] or [[path]]\n    const wikiRe = /\\[\\[([^\\]|]+)(?:\\|([^\\]]+))?\\]\\]/g;\n    while((m = wikiRe.exec(text))){\n      links.push({ kind:\"internal\", label:(m[2]||m[1]).trim(), url:m[1].trim() });\n    }\n    return links;\n  }\n\n  function extractDoneMinutes(child){\n    // \u2714\ufe0f 06:20\u201306:29 +9m\n    const m1 = child.match(/\\+(\\d+)m\\b/);\n    if(m1) return parseInt(m1[1],10);\n\n    const m2 = child.match(/(\\d{2}):(\\d{2})\\s*[\u2013-]\\s*(\\d{2}):(\\d{2})/);\n    if(m2){\n      const a = parseInt(m2[1],10)*60 + parseInt(m2[2],10);\n      const b = parseInt(m2[3],10)*60 + parseInt(m2[4],10);\n      return Math.max(0, b-a);\n    }\n    return null;\n  }\n\n  function extractActiveMinutes(child){\n    // \u231b 10:00\u2013\n    const m = child.match(/\u231b\\s*(\\d{2}):(\\d{2})\\s*[\u2013-]/);\n    if(!m) return null;\n    const start = parseInt(m[1],10)*60 + parseInt(m[2],10);\n    const d = new Date();\n    const now = d.getHours()*60 + d.getMinutes();\n    return Math.max(0, now - start);\n  }\n\n  // ===== render =====\n  function clear(el){ while(el.firstChild) el.removeChild(el.firstChild); }\n\n  function render(md){\n    const data = parse(md);\n\n    // MUST\n    clear($(\"mustList\"));\n    if(data.must.length === 0){\n      $(\"mustList\").appendChild(itemRow(\"\u2014\", { muted:true }));\n    }else{\n      for(const t of data.must){\n        $(\"mustList\").appendChild(itemRow(t.text, { done:!!t.done }));\n      }\n    }\n\n    // NOW + meta\n    if(data.now){\n      $(\"nowTitle\").textContent = data.now.parent.title || \"\u2014\";\n      const startChild = data.now.activeChild;\n      const activeMin = extractActiveMinutes(startChild);\n      const est = data.now.parent.estimateMin;\n      const nowTime = new Date();\n      const eta = (est!=null)\n        ? new Date(nowTime.getTime() + Math.max(0, (est-(activeMin||0)))*60000)\n        : null;\n\n      const parts = [];\n      const startM = startChild.match(/(\\d{2}:\\d{2})/);\n      if(startM) parts.push(`\u958b\u59cb: ${startM[1]}`);\n      if(est!=null) parts.push(`\u898b\u7a4d: ${est}m`);\n      if(activeMin!=null) parts.push(`\u7d4c\u904e: ${activeMin}m`);\n      if(eta) parts.push(`\u7d42\u4e86\u4e88\u5b9a: ${String(eta.getHours()).padStart(2,\"0\")}:${String(eta.getMinutes()).padStart(2,\"0\")}`);\n      $(\"nowMeta\").textContent = parts.join(\" / \");\n    }else{\n      $(\"nowTitle\").textContent = \"READY\";\n      $(\"nowMeta\").textContent = \"\";\n    }\n\n    // SCHEDULED\n    clear($(\"scheduledList\"));\n    if(data.scheduled.length === 0){\n      $(\"scheduledList\").appendChild(itemRow(\"\u2014\", { muted:true, preserve:true }));\n    }else{\n      data.scheduled.forEach(t => $(\"scheduledList\").appendChild(itemRow(t, { preserve:true })));\n    }\n\n    // TASK LIST (hide done)\n    clear($(\"taskList\"));\n    if(data.taskList.length === 0){\n      $(\"taskList\").appendChild(itemRow(\"\u2014\", { muted:true }));\n    }else{\n      data.taskList.slice(0, 999).forEach(t => {\n        const el = document.createElement(\"div\");\n        el.className = \"tc-task\" + (t.isNow ? \" is-now\" : \"\");\n        const title = document.createElement(\"div\");\n        title.className = \"tc-task-title\";\n        title.textContent = t.title || \"\u2014\";\n        const sub = document.createElement(\"div\");\n        sub.className = \"tc-task-sub\";\n        if(t.estimateText){\n          const chip = document.createElement(\"span\");\n          chip.className = \"tc-task-chip\";\n          chip.textContent = t.estimateText;\n          sub.appendChild(chip);\n        }\n        if(t.links && t.links.length){\n          for(const l of t.links){\n            const a = document.createElement(\"a\");\n            a.className = \"tc-link\";\n            a.href = \"#\";\n            a.textContent = l.kind === \"internal\" ? `\u27e6${l.label}\u27e7` : `\u2197\ufe0e ${l.label}`;\n            a.addEventListener(\"click\", (ev)=>{\n              ev.preventDefault(); ev.stopPropagation();\n              alert(\"\u30c7\u30e2: link open -> \" + (l.kind===\"internal\" ? l.url : l.url));\n            });\n            sub.appendChild(a);\n          }\n        }\n        el.appendChild(title);\n        el.appendChild(sub);\n        el.addEventListener(\"click\", ()=>{\n          if(data.now) return; // ready only\n          const ok = confirm(`Start \"${t.title}\" ?`);\n          if(ok){\n            alert(\"\u30c7\u30e2: start task (plugin side would create \u231b child and set NOW)\");\n          }\n        });\n        $(\"taskList\").appendChild(el);\n      });\n    }\n\n    // PROGRESS RIBBON\n    renderRibbon(data.segments);\n  }\n\n  function itemRow(text, opts){\n    const el = document.createElement(\"div\");\n    el.className = \"tc-item\" + (opts?.muted ? \" is-muted\":\"\") + (opts?.done ? \" is-done\":\"\");\n    const dot = document.createElement(\"span\");\n    dot.className = \"tc-dot\";\n    const span = document.createElement(\"span\");\n    span.className = \"tc-text\" + (opts?.preserve ? \" preserve\":\"\");\n    span.textContent = opts?.preserve ? String(text) : sanitize(text);\n    el.appendChild(dot);\n    el.appendChild(span);\n    return el;\n  }\n\n  function renderRibbon(segments){\n    const ribbon = $(\"progressRibbon\");\n    const legend = $(\"ribbonLegend\");\n    clear(ribbon); clear(legend);\n\n    const total = segments.reduce((s,x)=>s+(x.minutes||0),0) || 1;\n    // Cap huge minutes visually\n    const MAX_MIN = 240; // 4h width cap (demo)\n    const denom = Math.min(total, MAX_MIN);\n\n    // If no segments, show muted placeholder\n    if(!segments.length){\n      const ph = document.createElement(\"div\");\n      ph.className = \"tc-ribbon-empty\";\n      ph.textContent = \"\u30ed\u30b0\u304c\u307e\u3060\u5c11\u306a\u3044 / \u3053\u3053\u306b\u9032\u884c\u304c\u51fa\u308b\";\n      ribbon.appendChild(ph);\n      return;\n    }\n\n    segments.forEach(seg=>{\n      const w = Math.max(2, Math.round((Math.min(seg.minutes, MAX_MIN) / denom) * 1000)/10); // 0.1%\n      const s = document.createElement(\"div\");\n      s.className = \"tc-seg \" + (seg.kind===\"now\" ? \"is-now\" : \"is-done\");\n      s.style.width = w + \"%\";\n      s.title = `${seg.label} (${seg.minutes}m)`;\n      ribbon.appendChild(s);\n    });\n\n    const sumDone = segments.filter(s=>s.kind===\"done\").reduce((a,b)=>a+(b.minutes||0),0);\n    const sumNow  = segments.filter(s=>s.kind===\"now\").reduce((a,b)=>a+(b.minutes||0),0);\n\n    legend.textContent = `\u5b8c\u4e86 ${sumDone}m / \u9032\u884c\u4e2d ${sumNow}m / \u5408\u8a08 ${sumDone+sumNow}m`;\n  }\n\n  // ===== action buttons (demo placeholders) =====\n  document.querySelectorAll(\"[data-action]\").forEach(btn=>{\n    btn.addEventListener(\"click\", ()=>{\n      const a = btn.getAttribute(\"data-action\");\n      alert(\"\u30c7\u30e2: action -> \" + a + \"\\n(\u30d7\u30e9\u30b0\u30a4\u30f3\u3067\u306f\u3053\u3053\u3067\u30b3\u30de\u30f3\u30c9\u3092\u53e9\u304f)\");\n    });\n  });\n\n  // ===== debug UI =====\n  $(\"renderBtn\").addEventListener(\"click\", ()=>render($(\"mdInput\").value));\n  $(\"loadSampleBtn\").addEventListener(\"click\", ()=>{\n    $(\"mdInput\").value = SAMPLE;\n    render(SAMPLE);\n  });\n\n  // init\n  $(\"mdInput\").value = SAMPLE;\n  render(SAMPLE);\n})();\n</script>";

    // Cache root for scoped queries
    this._root = root;

    // Wire Refresh
    const refreshBtn = this._q(".tc-btn-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => this.render());
    }

    // Basic link delegation: any element with data-tc-link will open
    this._root.addEventListener("click", (ev) => {
      const el = ev.target?.closest?.("[data-tc-link]");
      if (!el) return;
      const link = el.getAttribute("data-tc-link");
      if (!link) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.openLink(link);
    });

    // Watch: active file changes, vault modifies
    const app = this.app;
    this._unsub.push(
      app.workspace.on("active-leaf-change", () => this.render()),
      app.workspace.on("file-open", () => this.render()),
      app.vault.on("modify", (file) => {
        if (this.targetFile && file?.path === this.targetFile.path) this.render();
      })
    );

    await this.render();
  }

  onClose() {
    // ItemView cleanup handled by Obsidian event system, but remove local listeners if any
    this._unsub = [];
  }

  _q(sel) {
    return this._root ? this._root.querySelector(sel) : null;
  }
  _qa(sel) {
    return this._root ? Array.from(this._root.querySelectorAll(sel)) : [];
  }

  async resolveTargetFile() {
    const logFolderPath = this.plugin.settings?.logFolderPath || "taskchute";
    const active = this.app.workspace.getActiveFile();

    if (active && isTaskchuteLogPath(active.path, logFolderPath)) {
      return active;
    }

    const path = `${logFolderPath}/${todayStr()}.md`;
    const abs = this.app.vault.getAbstractFileByPath(path);
    if (abs && abs.path) return abs;

    // Do not auto-create (read-only view). Show empty state instead.
    return null;
  }

  async render() {
    const file = await this.resolveTargetFile();
    this.targetFile = file;

    const headerTitle = this._q(".tc-header-title");
    const headerSub = this._q(".tc-header-sub");
    const nowBox = this._q("[data-box='now']");
    const nextBox = this._q("[data-box='next']");
    const mustBox = this._q("[data-box='must']");
    const ribbonBox = this._q("[data-box='ribbon']");

    if (!file) {
      if (headerTitle) headerTitle.textContent = "Chute Mode";
      if (headerSub) headerSub.textContent = "No taskchute log found (open a log or set logFolderPath).";
      this._renderEmpty(nowBox, "READY");
      this._renderEmpty(nextBox, "NEXT");
      this._renderEmpty(mustBox, "MUST");
      this._renderEmpty(ribbonBox, "PROGRESS");
      return;
    }

    const md = await this.app.vault.read(file);
    const parsed = parseTaskchuteMarkdown(md);

    if (headerTitle) headerTitle.textContent = "Chute Mode";
    if (headerSub) headerSub.textContent = `${file.path}`;

    this._renderNow(nowBox, parsed.now, parsed.remainingMin);
    this._renderNext(nextBox, parsed.next);
    this._renderMust(mustBox, parsed.must);
    this._renderRibbon(ribbonBox, parsed.ribbon);
  }

  _renderEmpty(boxEl, title) {
    if (!boxEl) return;
    boxEl.innerHTML = "";
    const h = document.createElement("div");
    h.className = "tc-box-title";
    h.textContent = title;
    const p = document.createElement("div");
    p.className = "tc-empty";
    p.textContent = "—";
    boxEl.appendChild(h);
    boxEl.appendChild(p);
  }

  _renderNow(boxEl, nowTask, remainingMin) {
    if (!boxEl) return;
    boxEl.innerHTML = "";

    const h = document.createElement("div");
    h.className = "tc-box-title";
    h.textContent = "NOW";
    boxEl.appendChild(h);

    const row = document.createElement("div");
    row.className = "tc-now-row";

    const left = document.createElement("div");
    left.className = "tc-now-main";

    const name = document.createElement("div");
    name.className = "tc-now-title";
    name.textContent = nowTask ? nowTask.title : "READY";
    if (nowTask?.link) {
      name.setAttribute("data-tc-link", nowTask.link);
      name.classList.add("tc-link");
      name.title = nowTask.link;
    }
    left.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "tc-now-meta";
    meta.textContent = remainingMin ? `Remaining: ${fmtMinutes(remainingMin)}` : "";
    left.appendChild(meta);

    row.appendChild(left);

    // Memo area (visual only - doesn't write back)
    const memo = document.createElement("textarea");
    memo.className = "tc-now-memo";
    memo.placeholder = "memo (read-only prototype)";
    memo.setAttribute("readonly", "true");
    row.appendChild(memo);

    boxEl.appendChild(row);
  }

  _renderNext(boxEl, nextTask) {
    if (!boxEl) return;
    boxEl.innerHTML = "";

    const h = document.createElement("div");
    h.className = "tc-box-title";
    h.textContent = "NEXT";
    boxEl.appendChild(h);

    const item = document.createElement("div");
    item.className = "tc-task-line";
    item.textContent = nextTask ? nextTask.title : "—";
    if (nextTask?.link) {
      item.setAttribute("data-tc-link", nextTask.link);
      item.classList.add("tc-link");
      item.title = nextTask.link;
    }
    boxEl.appendChild(item);
  }

  _renderMust(boxEl, mustTasks) {
    if (!boxEl) return;
    boxEl.innerHTML = "";

    const h = document.createElement("div");
    h.className = "tc-box-title";
    h.textContent = "MUST";
    boxEl.appendChild(h);

    const list = document.createElement("div");
    list.className = "tc-list";

    (mustTasks || []).slice(0, 12).forEach((t) => {
      const row = document.createElement("div");
      row.className = "tc-task-line tc-must-line";

      const title = document.createElement("div");
      title.className = "tc-task-title";
      title.textContent = t.title;
      if (t.link) {
        title.setAttribute("data-tc-link", t.link);
        title.classList.add("tc-link");
        title.title = t.link;
      }

      const right = document.createElement("div");
      right.className = "tc-task-right";
      right.textContent = t.estimateMin ? fmtMinutes(t.estimateMin) : "";

      row.appendChild(title);
      row.appendChild(right);
      list.appendChild(row);
    });

    boxEl.appendChild(list);
  }

  _renderRibbon(boxEl, ribbon) {
    if (!boxEl) return;
    boxEl.innerHTML = "";

    const h = document.createElement("div");
    h.className = "tc-box-title";
    h.textContent = "PROGRESS";
    boxEl.appendChild(h);

    const wrap = document.createElement("div");
    wrap.className = "tc-ribbon";

    (ribbon || []).slice(0, 30).forEach((r) => {
      const chip = document.createElement("div");
      chip.className = "tc-ribbon-chip";
      if (r.done) chip.classList.add("is-done");
      if (r.isNow) chip.classList.add("is-now");
      if (r.isNext) chip.classList.add("is-next");

      const t = document.createElement("div");
      t.className = "tc-ribbon-title";
      t.textContent = r.title;

      const m = document.createElement("div");
      m.className = "tc-ribbon-meta";
      m.textContent = r.estimateMin ? fmtMinutes(r.estimateMin) : "";

      chip.appendChild(t);
      chip.appendChild(m);
      wrap.appendChild(chip);
    });

    boxEl.appendChild(wrap);
  }

  openLink(link) {
    try {
      // For markdown links / internal notes, openLinkText works well.
      this.app.workspace.openLinkText(link, "", false);
    } catch (e) {
      new Notice("リンクを開けなかったよ");
      console.warn(e);
    }
  }
}

function registerChuteModeView(plugin) {
  // 1) Register view
  plugin.registerView(VIEW_TYPE, (leaf) => new ChuteModeView(leaf, plugin));

  // 2) Command to open in right sidebar (or reuse last leaf)
  plugin.addCommand({
    id: "taskchute-open-chute-mode",
    name: "TaskChute: Open Chute Mode",
    icon: "layout-dashboard",
    callback: async () => {
      const leaf = plugin.app.workspace.getRightLeaf(false) || plugin.app.workspace.getLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
      plugin.app.workspace.revealLeaf(leaf);
    },
  });
}

module.exports = {
  VIEW_TYPE,
  registerChuteModeView,
};
