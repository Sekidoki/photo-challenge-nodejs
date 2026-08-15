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
})();
