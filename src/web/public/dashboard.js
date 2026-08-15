(() => {
  const form = document.querySelector("[data-dashboard-form]");
  const sections = form instanceof HTMLFormElement ? Array.from(form.querySelectorAll("[data-workflow-settings]")) : [];
  const actionInputs = form instanceof HTMLFormElement ? Array.from(form.querySelectorAll('input[name="action"]')) : [];

  const updateSettings = () => {
    const selected = actionInputs.find((input) => input instanceof HTMLInputElement && input.checked);
    const selectedAction = selected instanceof HTMLInputElement ? selected.value : "";

    for (const section of sections) {
      const active = section.getAttribute("data-workflow-settings") === selectedAction;
      section.hidden = !active;
      for (const control of section.querySelectorAll("input, select, textarea")) {
        if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
          control.disabled = !active;
        }
      }
    }
  };

  if (form instanceof HTMLFormElement) {
    for (const input of actionInputs) input.addEventListener("change", updateSettings);
    updateSettings();
  }

  for (const candidate of document.querySelectorAll("form")) {
    if (!(candidate instanceof HTMLFormElement)) continue;
    candidate.addEventListener("submit", (event) => {
      const message = candidate.dataset.confirm;
      if (message && !window.confirm(message)) { event.preventDefault(); return; }
      if (candidate.dataset.submitting === "true") { event.preventDefault(); return; }
      candidate.dataset.submitting = "true";
      for (const button of candidate.querySelectorAll('button[type="submit"], input[type="submit"]')) {
        button.disabled = true;
        if (button instanceof HTMLButtonElement && button.dataset.processingText) button.textContent = button.dataset.processingText;
      }
    });
  }

  document.querySelector("[data-error-summary]")?.focus();

  const modeNotice = sessionStorage.getItem("mode-change-notice");
  if (modeNotice) {
    sessionStorage.removeItem("mode-change-notice");
    const notice = document.createElement("div"); notice.className = "notice"; notice.setAttribute("role", "status"); notice.textContent = modeNotice;
    document.querySelector("h1")?.insertAdjacentElement("afterend", notice);
    const savedScroll = Number(sessionStorage.getItem("mode-change-scroll")); sessionStorage.removeItem("mode-change-scroll");
    if (Number.isFinite(savedScroll)) requestAnimationFrame(() => scrollTo({ top: savedScroll }));
  }
  for (const link of document.querySelectorAll("[data-mode-switch]")) link.addEventListener("click", () => {
    if (!(link instanceof HTMLAnchorElement)) return;
    if (link.hasAttribute("data-preserve-selections")) {
      const url = new URL(link.href); document.querySelectorAll('input[name="selected"]:checked').forEach((input) => url.searchParams.append("selected", input.value)); link.href = url.toString();
    }
    sessionStorage.setItem("mode-change-notice", link.dataset.modeMessage || ""); sessionStorage.setItem("mode-change-scroll", String(scrollY));
  });
  for (const card of document.querySelectorAll("[data-diff-card]")) {
    const first = Array.from(card.querySelectorAll("[data-diff-kind]")).find((row) => row.dataset.diffKind !== "same" && row.dataset.diffKind !== "skip");
    if (first instanceof HTMLElement) { first.tabIndex = -1; card.querySelector("[data-first-difference]")?.addEventListener("click", () => first.focus()); }
    card.querySelector("[data-changes-only]")?.addEventListener("change", (event) => {
      const checked = event.target instanceof HTMLInputElement && event.target.checked;
      card.querySelectorAll('[data-diff-kind="same"], [data-diff-kind="skip"]').forEach((row) => { if (row instanceof HTMLElement) row.hidden = checked; });
    });
  }
})();
