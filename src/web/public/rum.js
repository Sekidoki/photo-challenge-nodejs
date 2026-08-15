(() => {
  if (!globalThis.webVitals) return;
  const path = location.pathname;
  const pageType = path === "/" ? "home" : path === "/maintainers" ? "maintainers" : /\/publish-review$/.test(path) ? "publish-review" : /\/maintenance-review$/.test(path) ? "maintenance-review" : /\/result$/.test(path) ? "result" : /^\/jobs\/[^/]+$/.test(path) ? "progress" : "other";
  const report = ({ name, value, rating }) => {
    const body = JSON.stringify({ name, value, rating, pageType, device: matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop" });
    if (navigator.sendBeacon) navigator.sendBeacon("/web-vitals", new Blob([body], { type: "application/json" }));
    else fetch("/web-vitals", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
  };
  webVitals.onLCP(report); webVitals.onINP(report); webVitals.onCLS(report);
})();
