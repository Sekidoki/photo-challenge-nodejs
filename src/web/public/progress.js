(() => {
  const root = document.querySelector("[data-progress-page]");
  if (!(root instanceof HTMLElement)) return;
  const terminal = new Set(["completed", "failed"]);
  let status = root.dataset.initialStatus || "queued", delay = 2000, timer, stopped = terminal.has(status);
  const progress = root.querySelector('[role="progressbar"]'), pollStatus = root.querySelector("[data-poll-status]"), recovery = root.querySelector("[data-poll-recovery]");
  const schedule = () => { if (!stopped && !document.hidden && navigator.onLine) timer = window.setTimeout(refresh, delay); };
  const setText = (selector, value) => { const node = root.querySelector(selector); if (node) node.textContent = value; };
  const setHidden = (selector, hidden) => { const node = root.querySelector(selector); if (node instanceof HTMLElement) node.hidden = hidden; };

  const markSteps = (failed) => {
    const steps = Array.from(root.querySelectorAll("[data-workflow-steps] li"));
    const runIndex = 1;
    steps.forEach((step, index) => {
      step.classList.remove("is-complete", "is-failed");
      step.removeAttribute("aria-current");
      step.querySelector(".visually-hidden")?.remove();
      const addSuffix = (text) => { const span = document.createElement("span"); span.className = "visually-hidden"; span.textContent = text; step.append(span); };
      const currentIndex = failed ? runIndex : runIndex + 1;
      if (index < currentIndex) { step.classList.add("is-complete"); addSuffix(root.dataset.completedSuffix || ""); }
      if (index === currentIndex) {
        step.setAttribute("aria-current", "step");
        if (failed) { step.classList.add("is-failed"); addSuffix(root.dataset.failedSuffix || ""); }
      }
    });
  };

  const render = (job) => {
    const changed = job.status !== status; status = job.status;
    const percent = Math.max(0, Math.min(100, Number(job.percent) || 0));
    const stepLabel = job.stepLabel || job.currentStep || "";
    progress?.setAttribute("aria-valuenow", String(percent));
    progress?.setAttribute("aria-valuetext", `${percent}% · ${stepLabel}`);
    setText("[data-progress-step]", `${root.dataset.stepPrefix || ""}${stepLabel}`);
    setText("[data-progress-percent]", `${percent}%`);
    const fill = root.querySelector("[data-progress-fill]"); if (fill instanceof HTMLElement) fill.style.width = `${percent}%`;
    const list = root.querySelector("[data-progress-messages]");
    if (list) list.replaceChildren(...(job.messages || []).map((message) => { const li = document.createElement("li"); li.textContent = message; return li; }));
    if (!terminal.has(status)) { if (job.statusLabel) setText("[data-progress-summary]", job.statusLabel); return; }

    stopped = true;
    const completed = status === "completed";
    setHidden("[data-terminal-actions]", !completed);
    setHidden("[data-progress-error]", completed);
    if (!completed) {
      setText("[data-progress-error-text]", job.errorMessage || "");
      if (job.failureHint) setText("[data-progress-hint]", job.failureHint);
      setHidden("[data-progress-status]", true);
      const log = root.querySelector("[data-run-log]"); if (log instanceof HTMLDetailsElement) log.open = true;
    }
    markSteps(!completed);
    setText("[data-progress-summary]", completed ? root.dataset.completedText : root.dataset.failedText);
    if (changed) {
      if (completed) { window.location.reload(); return; }
      root.querySelector("[data-progress-summary]")?.focus();
    }
  };

  async function refresh() {
    if (stopped || document.hidden || !navigator.onLine) return;
    try {
      const response = await fetch(root.dataset.statusUrl, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      render(await response.json()); delay = 2000;
      if (pollStatus) pollStatus.textContent = "";
      if (recovery instanceof HTMLElement) recovery.hidden = true;
    } catch {
      delay = Math.min(delay * 2, 30000);
      if (pollStatus) pollStatus.textContent = root.dataset.retryText || "Status update failed.";
      if (recovery instanceof HTMLElement) recovery.hidden = false;
    }
    schedule();
  }

  root.querySelector("[data-progress-retry]")?.addEventListener("click", () => { clearTimeout(timer); delay = 2000; refresh(); });
  document.addEventListener("visibilitychange", () => { clearTimeout(timer); if (!document.hidden) refresh(); });
  window.addEventListener("online", refresh);
  window.addEventListener("offline", () => { clearTimeout(timer); if (!stopped && recovery instanceof HTMLElement) recovery.hidden = false; });
  schedule();
})();
