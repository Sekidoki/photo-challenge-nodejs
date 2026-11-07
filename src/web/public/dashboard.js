(() => {
  const form = document.querySelector("[data-dashboard-form]");
  const isForm = form instanceof HTMLFormElement;
  const sections = isForm ? Array.from(form.querySelectorAll("[data-workflow-settings]")) : [];
  const actionInputs = isForm ? Array.from(form.querySelectorAll('input[name="action"]')) : [];
  const modeInputs = isForm ? Array.from(form.querySelectorAll('input[name="publishMode"]')) : [];
  const announcer = isForm ? form.querySelector("[data-settings-announcer]") : null;
  const checkedValue = (inputs) => { const selected = inputs.find((input) => input instanceof HTMLInputElement && input.checked); return selected instanceof HTMLInputElement ? selected.value : ""; };

  const updateSettings = (announce) => {
    const selectedAction = checkedValue(actionInputs);
    for (const section of sections) {
      const active = section.getAttribute("data-workflow-settings") === selectedAction;
      section.hidden = !active;
      for (const control of section.querySelectorAll("input, select, textarea")) {
        if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) control.disabled = !active;
      }
    }
    if (announce && announcer) {
      const label = actionInputs.find((input) => input instanceof HTMLInputElement && input.checked)?.closest("label")?.querySelector(".choice-title")?.textContent ?? "";
      announcer.textContent = label;
    }
  };

  const updateLiveMode = () => {
    if (!isForm) return;
    const live = checkedValue(modeInputs) === "live";
    const ack = form.querySelector("[data-live-ack]");
    if (ack instanceof HTMLElement) ack.hidden = !live;
    const ackInput = form.querySelector("#confirmLive");
    if (ackInput instanceof HTMLInputElement) { ackInput.required = live; if (!live) ackInput.checked = false; }
    const button = form.querySelector("[data-start-button]");
    if (button instanceof HTMLButtonElement) {
      button.classList.toggle("button-destructive", live);
      button.textContent = (live ? button.dataset.liveText : button.dataset.defaultText) || button.textContent;
    }
  };

  if (isForm) {
    for (const input of actionInputs) input.addEventListener("change", () => updateSettings(true));
    for (const input of modeInputs) input.addEventListener("change", updateLiveMode);
    updateSettings(false);
    updateLiveMode();
  }

  const confirmMessageFor = (candidate) => {
    if (candidate === form && checkedValue(modeInputs) === "live") {
      const challenge = form.querySelector("#challenge");
      return (form.dataset.liveConfirm || "").replace("{challenge}", challenge instanceof HTMLInputElement ? challenge.value.trim() : "");
    }
    return candidate.dataset.confirm;
  };

  for (const candidate of document.querySelectorAll("form")) {
    if (!(candidate instanceof HTMLFormElement)) continue;
    candidate.addEventListener("submit", (event) => {
      const message = confirmMessageFor(candidate);
      if (message && !window.confirm(message)) { event.preventDefault(); return; }
      if (candidate.dataset.submitting === "true") { event.preventDefault(); return; }
      candidate.dataset.submitting = "true";
      const buttons = [...candidate.querySelectorAll('button[type="submit"], input[type="submit"]'), ...(candidate.id ? document.querySelectorAll(`button[form="${candidate.id}"]`) : [])];
      for (const button of buttons) {
        button.disabled = true;
        if (button instanceof HTMLButtonElement && button.dataset.processingText) button.textContent = button.dataset.processingText;
      }
    });
  }

  document.querySelector("[data-error-summary]")?.focus();

  let modeNotice = null;
  try { modeNotice = sessionStorage.getItem("mode-change-notice"); } catch { modeNotice = null; }
  if (modeNotice) {
    let savedScroll = NaN;
    try {
      sessionStorage.removeItem("mode-change-notice");
      savedScroll = Number(sessionStorage.getItem("mode-change-scroll"));
      sessionStorage.removeItem("mode-change-scroll");
    } catch { /* storage unavailable */ }
    const notice = document.createElement("div"); notice.className = "message message-toast"; notice.setAttribute("role", "status");
    const text = document.createElement("span"); text.textContent = modeNotice;
    const close = document.createElement("button"); close.type = "button"; close.className = "button-quiet button-small"; close.textContent = document.body.dataset.dismissLabel || "Dismiss";
    const dismiss = () => notice.remove();
    close.addEventListener("click", dismiss);
    notice.append(text, close);
    document.querySelector("h1")?.insertAdjacentElement("afterend", notice);
    if (Number.isFinite(savedScroll)) requestAnimationFrame(() => scrollTo({ top: savedScroll }));
  }
  for (const link of document.querySelectorAll("[data-mode-switch]")) link.addEventListener("click", () => {
    if (!(link instanceof HTMLAnchorElement)) return;
    if (link.hasAttribute("data-preserve-selections")) {
      const url = new URL(link.href); document.querySelectorAll('input[name="selected"]:checked').forEach((input) => url.searchParams.append("selected", input.value)); link.href = url.toString();
    }
    try { sessionStorage.setItem("mode-change-notice", link.dataset.modeMessage || ""); sessionStorage.setItem("mode-change-scroll", String(scrollY)); } catch { /* storage unavailable */ }
  });

  for (const card of document.querySelectorAll("[data-diff-card]")) {
    const first = Array.from(card.querySelectorAll("[data-diff-kind]")).find((row) => row.dataset.diffKind !== "same" && row.dataset.diffKind !== "skip");
    if (first instanceof HTMLElement) { first.tabIndex = -1; card.querySelector("[data-first-difference]")?.addEventListener("click", () => { first.scrollIntoView({ block: "center" }); first.focus({ preventScroll: true }); }); }
    card.querySelector("[data-changes-only]")?.addEventListener("change", (event) => {
      const checked = event.target instanceof HTMLInputElement && event.target.checked;
      card.querySelectorAll('[data-diff-kind="same"], [data-diff-kind="skip"]').forEach((row) => { if (row instanceof HTMLElement) row.hidden = checked; });
    });
  }

  const setSelection = (checked) => document.querySelectorAll('input[name="selected"]:not(:disabled)').forEach((input) => { if (input instanceof HTMLInputElement) input.checked = checked; });
  document.querySelector("[data-select-all]")?.addEventListener("click", () => setSelection(true));
  document.querySelector("[data-select-none]")?.addEventListener("click", () => setSelection(false));
  for (const button of document.querySelectorAll("[data-select-group]")) button.addEventListener("click", () => {
    button.closest("[data-entry-group]")?.querySelectorAll('input[name="selected"]:not(:disabled)').forEach((input) => { if (input instanceof HTMLInputElement) input.checked = true; });
  });

  // Copy buttons are progressive: they stay hidden without the Clipboard API.
  for (const button of document.querySelectorAll("[data-copy-text]")) {
    if (!(button instanceof HTMLButtonElement) || !navigator.clipboard) continue;
    const label = button.textContent;
    button.hidden = false;
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copyText || "");
        button.textContent = button.dataset.copiedLabel || label;
        window.setTimeout(() => { button.textContent = label; }, 2000);
      } catch { /* clipboard permission denied: leave the path selectable */ }
    });
  }

  // A thumbnail that fails to load shows its file name instead of an empty box.
  const markBroken = (img) => img.closest(".result-image-link")?.classList.add("is-broken");
  for (const img of document.querySelectorAll(".result-image-link img")) {
    if (!(img instanceof HTMLImageElement)) continue;
    if (img.complete && img.naturalWidth === 0) markBroken(img);
    else img.addEventListener("error", () => markBroken(img), { once: true });
  }

  // Diff cards can fold; a link to a folded target unfolds it first.
  for (const button of document.querySelectorAll("[data-diff-toggle]")) {
    const body = document.getElementById(button.getAttribute("aria-controls") || "");
    if (!(button instanceof HTMLButtonElement) || !body) continue;
    const label = button.querySelector("[data-diff-toggle-label]");
    button.hidden = false;
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      body.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      if (label) label.textContent = (open ? button.dataset.collapseLabel : button.dataset.expandLabel) || "";
    });
  }
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href^="#target-"]') : null;
    const card = link ? document.getElementById(link.getAttribute("href").slice(1))?.closest("[data-diff-card]") : null;
    const toggle = card?.querySelector('[data-diff-toggle][aria-expanded="false"]');
    if (toggle instanceof HTMLButtonElement) toggle.click();
  });
})();
