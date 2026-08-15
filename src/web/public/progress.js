(() => {
  const root = document.querySelector("[data-progress-page]");
  if (!(root instanceof HTMLElement)) return;
  const terminal = new Set(["completed", "failed"]);
  let status = root.dataset.initialStatus || "queued", delay = 2000, timer, stopped = terminal.has(status);
  const progress = root.querySelector('[role="progressbar"]'), pollStatus = root.querySelector("[data-poll-status]"), recovery = root.querySelector("[data-poll-recovery]");
  const schedule = () => { if (!stopped && !document.hidden && navigator.onLine) timer = window.setTimeout(refresh, delay); };
  const setText = (selector, value) => { const node = root.querySelector(selector); if (node) node.textContent = value; };
  const render = (job) => {
    const changed = job.status !== status; status = job.status;
    const percent = Math.max(0, Math.min(100, Number(job.percent) || 0));
    progress?.setAttribute("aria-valuenow", String(percent)); setText("[data-progress-step]", `${root.dataset.stepPrefix || ""}${job.currentStep}`); setText("[data-progress-percent]", `${percent}%`);
    const fill = root.querySelector("[data-progress-fill]"); if (fill instanceof HTMLElement) fill.style.width = `${percent}%`;
    const list = root.querySelector("[data-progress-messages]");
    if (list) list.replaceChildren(...(job.messages || []).map((message) => { const li = document.createElement("li"); li.textContent = message; return li; }));
    const error = root.querySelector("[data-progress-error]"); if (error instanceof HTMLElement) { error.textContent = job.errorMessage || ""; error.hidden = !job.errorMessage; }
    if (terminal.has(status)) {
      stopped = true; const completed = status === "completed";
      const actions = root.querySelector("[data-terminal-actions]"), result = root.querySelector("[data-result-link]");
      if (actions instanceof HTMLElement) actions.hidden = !completed; if (result instanceof HTMLElement) result.hidden = !completed;
      setText("[data-progress-summary]", completed ? root.dataset.completedText : root.dataset.failedText);
      if (changed) root.querySelector("[data-progress-summary]")?.focus();
    }
  };
  async function refresh() {
    if (document.hidden || !navigator.onLine) return;
    try {
      const response = await fetch(root.dataset.statusUrl, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status)); render(await response.json()); delay = 2000;
      if (pollStatus) pollStatus.textContent = ""; if (recovery instanceof HTMLElement) recovery.hidden = true;
    } catch { delay = Math.min(delay * 2, 30000); if (pollStatus) pollStatus.textContent = root.dataset.retryText || "Status update failed."; if (recovery instanceof HTMLElement) recovery.hidden = false; }
    schedule();
  }
  root.querySelector("[data-progress-retry]")?.addEventListener("click", () => { clearTimeout(timer); delay = 2000; refresh(); });
  document.addEventListener("visibilitychange", () => { clearTimeout(timer); if (!document.hidden) refresh(); });
  window.addEventListener("online", refresh); window.addEventListener("offline", () => { clearTimeout(timer); if (recovery instanceof HTMLElement) recovery.hidden = false; }); schedule();
})();
