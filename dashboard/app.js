/* global JOB_DATA */
(function () {
  if (!window.JOB_DATA) {
    window.JOB_DATA = { updatedAt: "", queue: [], applications: [] };
  }

  const STORAGE_KEY = "job-dashboard-v1";
  const API = {
    state: "/api/state",
    apply: "/api/apply",
    unapply: "/api/unapply",
    refresh: "/api/refresh-queue",
    aiSearch: "/api/ai-search",
  };
  let dbOnline = false;
  let aiSearchPoll = null;

  const SENIOR_RE = /\b(senior|staff|principal|lead|sr\.?)\b/i;
  const CANADA_RE = /\b(canada|toronto|ontario|vancouver|montreal|calgary|ottawa|waterloo|mississauga|remote,\s*canada|on\b|bc\b|qc\b|ab\b)/i;
  const TORONTO_RE = /\b(toronto|ontario|\bon\b|waterloo|ottawa|mississauga|hamilton)\b/i;
  const REMOTE_RE = /\bremote\b/i;
  const ROLE_LABEL = { new_grad: "New Grad", intern: "Co-op / Intern", full_time: "Full-time" };
  const DEFAULTS = {
    sort: "newest",
    posted: "7",
    role: "both",
    location: "canada",
    source: "all",
    q: "",
    excludeSenior: true,
    bigTech: false,
    hasSalary: false,
    dedupe: true,
  };

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function field(label, value, isLink) {
    if (value == null || value === "") return "";
    const v = isLink
      ? `<a href="${esc(value)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a>`
      : esc(value);
    return `<div><span><label>${esc(label)}</label></span>${v}</div>`;
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function localClock() {
    return new Date().toLocaleString("zh-CN", {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function showToast(msg, isErr) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast show" + (isErr ? " err" : "");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      el.className = "toast";
    }, 4200);
  }

  function applyServerState(data) {
    if (!data) return;
    window.JOB_DATA.queue = data.queue || [];
    window.JOB_DATA.applications = data.applications || [];
    window.JOB_DATA.updatedAt = data.updatedAt || todayISO();
    cacheLocal();
    document.getElementById("updated").textContent =
      `更新于 ${window.JOB_DATA.updatedAt} · ${dbOnline ? "已同步 SQLite" : "本地缓存"}`;
  }

  function cacheLocal() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          updatedAt: window.JOB_DATA.updatedAt,
          queue: window.JOB_DATA.queue || [],
          applications: window.JOB_DATA.applications || [],
        })
      );
    } catch (_) {}
  }

  function loadLocalCache() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (saved && Array.isArray(saved.queue) && Array.isArray(saved.applications)) {
        applyServerState(saved);
        return true;
      }
    } catch (_) {}
    return false;
  }

  async function api(path, opts) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  async function loadFromDb() {
    try {
      const data = await api(API.state);
      dbOnline = true;
      applyServerState(data);
      return true;
    } catch (_) {
      dbOnline = false;
      if (!loadLocalCache()) {
        document.getElementById("updated").textContent = "数据库未连接 · 使用 data.js";
      } else {
        document.getElementById("updated").textContent =
          `更新于 ${window.JOB_DATA.updatedAt} · 离线缓存（请用 python3 server.py 启动）`;
      }
      return false;
    }
  }

  async function markApplied(id) {
    try {
      if (dbOnline) {
        const data = await api(API.apply, { method: "POST", body: JSON.stringify({ id }) });
        applyServerState(data);
      } else {
        const q = window.JOB_DATA.queue || [];
        const idx = q.findIndex((j) => j.id === id);
        if (idx < 0) return;
        const job = q[idx];
        q.splice(idx, 1);
        window.JOB_DATA.applications = window.JOB_DATA.applications || [];
        window.JOB_DATA.applications.unshift({
          id: String(job.id || "").replace(/^q-/, "a-"),
          company: job.company || "",
          title: job.title || "",
          url: job.url || "",
          appliedAt: todayISO(),
          jd: job.notes || "",
          queueId: job.id,
        });
        cacheLocal();
      }
      refresh();
      showToast(dbOnline ? "已申请并写入 SQLite" : "已申请（离线缓存）");
    } catch (err) {
      showToast(`同步失败：${err.message || err}`, true);
    }
  }

  async function moveBackToQueue(id) {
    try {
      if (dbOnline) {
        const data = await api(API.unapply, { method: "POST", body: JSON.stringify({ id }) });
        applyServerState(data);
      } else {
        const apps = window.JOB_DATA.applications || [];
        const idx = apps.findIndex((j) => j.id === id);
        if (idx < 0) return;
        const app = apps[idx];
        apps.splice(idx, 1);
        window.JOB_DATA.queue = window.JOB_DATA.queue || [];
        window.JOB_DATA.queue.unshift({
          id: app.queueId || String(app.id || "").replace(/^a-/, "q-"),
          company: app.company,
          title: app.title,
          url: app.url,
          notes: app.jd,
          addedAt: todayISO(),
        });
        cacheLocal();
      }
      refresh();
      showToast("已移回 Queue");
    } catch (err) {
      showToast(`同步失败：${err.message || err}`, true);
    }
  }

  async function refreshUnappliedQueue() {
    const btn = document.getElementById("btn-refresh-queue");
    btn.disabled = true;
    try {
      if (!dbOnline) {
        const ok = await loadFromDb();
        if (!ok) throw new Error("请先运行: ../.venv/bin/python server.py");
      }
      const data = await api(API.refresh, { method: "POST", body: "{}" });
      applyServerState(data);
      refresh();
      showToast(
        data.added
          ? `已加入 ${data.added} 个未投岗位并写入 SQLite`
          : "没有新的未投岗位"
      );
    } catch (err) {
      showToast(`刷新失败：${err.message || err}`, true);
    } finally {
      btn.disabled = false;
    }
  }

  function setAiSearchUi(running) {
    const btn = document.getElementById("btn-ai-search");
    const hint = document.getElementById("toolbar-hint");
    if (btn) {
      btn.disabled = !!running;
      btn.textContent = running ? "AI 搜岗中…" : "AI 搜岗";
    }
    if (hint && running) {
      hint.textContent = "本地 Agent 正在搜 Indeed/LinkedIn，通常要几分钟，请勿关闭本页";
    } else if (hint && !running) {
      hint.textContent =
        "AI 搜岗会调用 Cursor 本地 Agent（耗 token）· 刷新仅合并本地未投岗位";
    }
  }

  function stopAiSearchPoll() {
    if (aiSearchPoll) {
      clearInterval(aiSearchPoll);
      aiSearchPoll = null;
    }
  }

  async function pollAiSearchOnce() {
    const data = await api(API.aiSearch);
    if (data.status === "running") return false;
    stopAiSearchPoll();
    setAiSearchUi(false);
    if (data.status === "finished") {
      applyServerState(data);
      refresh();
      const n = data.added;
      const when = localClock();
      showToast(
        n
          ? `AI 搜岗完成（${when}），新增 ${n} 个未投岗位`
          : `AI 搜岗完成（${when}）：没有新的未投岗位，或都已在 Queue/已投`
      );
      return true;
    }
    if (data.status === "error") {
      throw new Error(`${data.error || "AI 搜岗失败"} · ${localClock()}`);
    }
    return true;
  }

  async function startAiSearch() {
    try {
      if (!dbOnline) {
        const ok = await loadFromDb();
        if (!ok) throw new Error("请先运行: ../.venv/bin/python server.py");
      }
      setAiSearchUi(true);
      showToast("已启动 AI 搜岗…");
      await api(API.aiSearch, { method: "POST", body: "{}" });
      stopAiSearchPoll();
      aiSearchPoll = setInterval(async () => {
        try {
          await pollAiSearchOnce();
        } catch (err) {
          stopAiSearchPoll();
          setAiSearchUi(false);
          showToast(`AI 搜岗失败：${err.message || err}`, true);
        }
      }, 3000);
      await pollAiSearchOnce();
    } catch (err) {
      stopAiSearchPoll();
      setAiSearchUi(false);
      showToast(`AI 搜岗失败：${err.message || err}`, true);
    }
  }

  function parseDate(s) {
    if (!s) return null;
    const d = new Date(s.length === 10 ? s + "T12:00:00" : s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function effectivePosted(j) {
    return parseDate(j.postedAt) || parseDate(j.addedAt);
  }

  function parseSalaryNum(s) {
    if (!s || /未|n\/?a|not listed/i.test(s)) return 0;
    const nums = String(s).replace(/,/g, "").match(/\d+(?:\.\d+)?/g);
    if (!nums) return 0;
    const vals = nums.map(Number).filter((n) => n >= 20);
    return vals.length ? Math.max(...vals) : 0;
  }

  function inferRole(j) {
    if (j.roleType) return j.roleType;
    const t = `${j.title || ""} ${j.notes || ""} ${j.jd || ""}`;
    if (/\b(intern|co-?op|co op)\b/i.test(t)) return "intern";
    if (/\b(new\s*grad|associate|launch program|edp|early career)\b/i.test(t)) return "new_grad";
    return "full_time";
  }

  function getFilters() {
    return {
      sort: document.getElementById("sort").value,
      posted: document.getElementById("posted").value,
      role: document.getElementById("role").value,
      location: document.getElementById("location").value,
      source: document.getElementById("source").value,
      q: document.getElementById("q").value.trim().toLowerCase(),
      excludeSenior: document.getElementById("exclude-senior").checked,
      bigTech: document.getElementById("big-tech").checked,
      hasSalary: document.getElementById("has-salary").checked,
      dedupe: document.getElementById("dedupe").checked,
    };
  }

  function applyFilters(items, f) {
    const now = new Date();
    let list = items.slice();

    if (f.posted !== "all") {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - Number(f.posted));
      list = list.filter((j) => {
        const d = effectivePosted(j);
        return d && d >= cutoff;
      });
    }

    if (f.role === "new_grad") list = list.filter((j) => inferRole(j) === "new_grad");
    if (f.role === "intern") list = list.filter((j) => inferRole(j) === "intern");
    if (f.role === "both") {
      list = list.filter((j) => ["new_grad", "intern"].includes(inferRole(j)));
    }

    if (f.location === "canada") {
      list = list.filter((j) => CANADA_RE.test(j.location || "") || CANADA_RE.test(j.notes || ""));
    } else if (f.location === "toronto") {
      list = list.filter((j) => TORONTO_RE.test(j.location || ""));
    } else if (f.location === "remote") {
      list = list.filter((j) => REMOTE_RE.test(j.location || "") || REMOTE_RE.test(j.notes || ""));
    }

    if (f.source === "Indeed" || f.source === "LinkedIn") {
      list = list.filter((j) => (j.source || "") === f.source);
    } else if (f.source === "other") {
      list = list.filter((j) => !["Indeed", "LinkedIn"].includes(j.source));
    }

    if (f.excludeSenior) list = list.filter((j) => !SENIOR_RE.test(j.title || ""));
    if (f.bigTech) list = list.filter((j) => j.bigTech);
    if (f.hasSalary) list = list.filter((j) => parseSalaryNum(j.salary) > 0);

    if (f.q) {
      list = list.filter((j) =>
        `${j.company} ${j.title} ${j.location} ${j.salary} ${j.notes} ${j.id}`
          .toLowerCase()
          .includes(f.q)
      );
    }

    if (f.dedupe) {
      const seen = new Set();
      list = list.filter((j) => {
        const key = `${(j.company || "").toLowerCase()}|${(j.title || "").toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    if (f.sort === "newest") {
      list.sort((a, b) => (effectivePosted(b)?.getTime() || 0) - (effectivePosted(a)?.getTime() || 0));
    } else if (f.sort === "salary") {
      list.sort((a, b) => parseSalaryNum(b.salary) - parseSalaryNum(a.salary));
    } else if (f.sort === "company") {
      list.sort((a, b) => (a.company || "").localeCompare(b.company || ""));
    } else if (f.sort === "added") {
      list.sort((a, b) => (parseDate(b.addedAt)?.getTime() || 0) - (parseDate(a.addedAt)?.getTime() || 0));
    }
    return list;
  }

  function renderQueue(items, totalRaw) {
    const el = document.getElementById("queue-list");
    document.getElementById("queue-count").textContent = items.length;
    document.getElementById("filter-meta").textContent = `显示 ${items.length} / ${totalRaw}`;

    if (!items.length) {
      el.innerHTML = `<div class="empty"><em>Queue 是空的</em>点「刷新未投岗位」，或让 AI 往职位库里加新岗</div>`;
      return;
    }

    el.innerHTML = items
      .map((j) => {
        const role = inferRole(j);
        const posted = j.postedAt || j.addedAt || "—";
        const postedLabel = j.postedAt ? "发布" : "加入";
        return `
        <article class="card">
          <div class="card-top">
            <div class="company">${esc(j.company)}</div>
            <span class="id-tag">${esc(j.id)}</span>
          </div>
          <div class="title">${esc(j.title)}</div>
          <div class="tags">
            <span class="tag type-${esc(role)}">${esc(ROLE_LABEL[role] || role)}</span>
            ${j.bigTech ? `<span class="tag big">大厂优先</span>` : ""}
            ${j.source ? `<span class="tag">${esc(j.source)}</span>` : ""}
          </div>
          <div class="fields">
            ${field("地点", j.location)}
            ${field("薪资", j.salary)}
            ${field(postedLabel, posted)}
            ${field("链接", j.url, true)}
            ${field("备注", j.notes)}
          </div>
          <div class="card-actions">
            <button type="button" class="btn btn-apply" data-action="apply" data-id="${esc(j.id)}">已申请</button>
          </div>
        </article>`;
      })
      .join("");
  }

  function getAppsFiltered() {
    const day = document.getElementById("app-date").value;
    let list = (window.JOB_DATA.applications || []).slice();
    list = list.map((j) => ({ ...j, jd: j.jd || j.notes || "" }));
    if (day) list = list.filter((j) => (j.appliedAt || "") === day);
    list.sort(
      (a, b) => (parseDate(b.appliedAt)?.getTime() || 0) - (parseDate(a.appliedAt)?.getTime() || 0)
    );
    return list;
  }

  function renderApps() {
    const items = getAppsFiltered();
    const total = (window.JOB_DATA.applications || []).length;
    const el = document.getElementById("apps-list");
    const day = document.getElementById("app-date").value;
    document.getElementById("apps-count").textContent = items.length;
    document.getElementById("apps-meta").textContent = day
      ? `${day} · ${items.length} 条（共 ${total}）`
      : `按申请日新→旧 · 共 ${total} 条`;

    if (!items.length) {
      el.innerHTML = day
        ? `<div class="empty"><em>这一天没有申请</em>换一天，或点「全部日期」</div>`
        : `<div class="empty"><em>还没有申请记录</em>在 Queue 点「已申请」</div>`;
      return;
    }

    el.innerHTML = items
      .map(
        (j) => `
        <article class="card" data-app-id="${esc(j.id)}">
          <div class="app-row" data-action="toggle">
            <div class="app-main">
              <div class="company"><span class="chev">▸</span>${esc(j.company)}</div>
              <div class="title">${esc(j.title)}</div>
            </div>
            <div class="app-date">${esc(j.appliedAt || "—")}</div>
          </div>
          <div class="app-detail">
            <div>${j.url ? `<a href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">${esc(j.url)}</a>` : "无链接"}</div>
            <div class="jd-box">${esc(j.jd || "暂无 JD / 备注")}</div>
            <div class="card-actions">
              <button type="button" class="btn btn-ghost" data-action="undo" data-id="${esc(j.id)}">移回 Queue</button>
            </div>
          </div>
        </article>`
      )
      .join("");
  }

  function refresh() {
    const raw = window.JOB_DATA.queue || [];
    renderQueue(applyFilters(raw, getFilters()), raw.length);
    renderApps();
  }

  function setDefaults() {
    Object.entries({
      sort: DEFAULTS.sort,
      posted: DEFAULTS.posted,
      role: DEFAULTS.role,
      location: DEFAULTS.location,
      source: DEFAULTS.source,
      q: DEFAULTS.q,
    }).forEach(([id, val]) => {
      document.getElementById(id).value = val;
    });
    document.getElementById("exclude-senior").checked = DEFAULTS.excludeSenior;
    document.getElementById("big-tech").checked = DEFAULTS.bigTech;
    document.getElementById("has-salary").checked = DEFAULTS.hasSalary;
    document.getElementById("dedupe").checked = DEFAULTS.dedupe;
    refresh();
  }

  function showPage(name) {
    document.getElementById("page-queue").classList.toggle("active", name === "queue");
    document.getElementById("page-apps").classList.toggle("active", name === "apps");
    document.getElementById("nav-queue").className = name === "queue" ? "active-queue" : "";
    document.getElementById("nav-apps").className = name === "apps" ? "active-apps" : "";
    location.hash = name;
    refresh();
  }

  document.getElementById("app-date").value = "";
  document.getElementById("nav-queue").addEventListener("click", () => showPage("queue"));
  document.getElementById("nav-apps").addEventListener("click", () => showPage("apps"));
  document.getElementById("btn-refresh-queue").addEventListener("click", refreshUnappliedQueue);
  document.getElementById("btn-ai-search").addEventListener("click", startAiSearch);
  document.getElementById("reset-filters").addEventListener("click", setDefaults);
  document.getElementById("app-date").addEventListener("change", renderApps);
  document.getElementById("clear-app-date").addEventListener("click", () => {
    document.getElementById("app-date").value = "";
    renderApps();
  });

  ["sort", "posted", "role", "location", "source", "q", "exclude-senior", "big-tech", "has-salary", "dedupe"].forEach(
    (id) => {
      const el = document.getElementById(id);
      const evt =
        el.type === "search" || (el.tagName === "INPUT" && el.type !== "checkbox") ? "input" : "change";
      el.addEventListener(evt, refresh);
    }
  );

  document.getElementById("queue-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='apply']");
    if (btn) markApplied(btn.getAttribute("data-id"));
  });

  document.getElementById("apps-list").addEventListener("click", (e) => {
    const undo = e.target.closest("[data-action='undo']");
    if (undo) {
      e.stopPropagation();
      moveBackToQueue(undo.getAttribute("data-id"));
      return;
    }
    if (e.target.closest("a")) return;
    const row = e.target.closest("[data-action='toggle']");
    if (!row) return;
    const card = row.closest(".card");
    card.classList.toggle("open");
    const chev = card.querySelector(".chev");
    if (chev) chev.textContent = card.classList.contains("open") ? "▾" : "▸";
  });

  (async function boot() {
    await loadFromDb();
    const hash = (location.hash || "").replace("#", "");
    showPage(hash === "apps" ? "apps" : "queue");
    try {
      const st = await api(API.aiSearch);
      if (st.status === "running") {
        setAiSearchUi(true);
        showToast("检测到 AI 搜岗仍在进行，继续等待…");
        stopAiSearchPoll();
        aiSearchPoll = setInterval(async () => {
          try {
            await pollAiSearchOnce();
          } catch (err) {
            stopAiSearchPoll();
            setAiSearchUi(false);
            showToast(`AI 搜岗失败：${err.message || err}`, true);
          }
        }, 3000);
      }
    } catch (_) {}
  })();
})();
