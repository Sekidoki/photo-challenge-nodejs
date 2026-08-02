(() => {
  const form = document.querySelector("[data-dashboard-form]");
  if (!(form instanceof HTMLFormElement)) return;

  const sections = Array.from(form.querySelectorAll("[data-workflow-settings]"));
  const actionInputs = Array.from(form.querySelectorAll('input[name="action"]'));

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

  for (const input of actionInputs) input.addEventListener("change", updateSettings);
  updateSettings();
})();
