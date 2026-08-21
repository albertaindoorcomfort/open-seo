/**
 * Lunar Digital Audit Widget — embeddable lead-capture script.
 * Install: <script src="https://openseo.dev/widget.js"></script>
 * Styles and markup live inside Shadow DOM; parent page CSS cannot leak in.
 */
(function () {
  "use strict";

  if (window.__LUNAR_AUDIT_WIDGET__) return;
  window.__LUNAR_AUDIT_WIDGET__ = true;

  var PRIMARY = "#005EA6";
  var ACCENT = "#FF7A00";

  function resolveApiBase() {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || "";
      if (src.indexOf("widget.js") !== -1) {
        try {
          return new URL(src).origin;
        } catch (e) {
          /* fall through */
        }
      }
    }
    return "https://openseo.dev";
  }

  var API_BASE = resolveApiBase();

  var host = document.createElement("div");
  host.id = "lunar-audit-widget-host";
  host.setAttribute("data-lunar-widget", "1");
  document.body.appendChild(host);

  var shadow = host.attachShadow({ mode: "open" });

  var style = document.createElement("style");
  style.textContent = [
    ":host { all: initial; }",
    "*",
    "*::before,",
    "*::after { box-sizing: border-box; }",
    ".card {",
    "  position: fixed; bottom: 20px; right: 20px; z-index: 2147483646;",
    "  width: 360px; max-width: calc(100vw - 32px);",
    "  background: #ffffff; border: 1px solid #e2e8f0;",
    "  border-radius: 12px;",
    "  box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.18);",
    "  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
    "  padding: 16px; color: #0f172a; line-height: 1.4;",
    "}",
    ".title { margin: 0 0 6px; font-size: 16px; font-weight: 700; color: #0f172a; }",
    ".sub { margin: 0 0 14px; font-size: 13px; color: #64748b; }",
    ".input {",
    "  display: block; width: 100%; margin: 0 0 10px; padding: 10px 12px;",
    "  border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px;",
    "  font-family: inherit; color: #0f172a; background: #fff;",
    "}",
    ".input:focus { outline: 2px solid " + PRIMARY + "; outline-offset: 1px; border-color: " + PRIMARY + "; }",
    ".btn {",
    "  display: block; width: 100%; border: none; border-radius: 6px;",
    "  padding: 11px 16px; font-size: 14px; font-weight: 600;",
    "  font-family: inherit; cursor: pointer; color: #fff; background: " + PRIMARY + ";",
    "}",
    ".btn:hover { filter: brightness(1.05); }",
    ".btn:disabled { opacity: 0.65; cursor: wait; }",
    ".btn-accent { background: " + ACCENT + "; margin-top: 12px; }",
    ".loading { text-align: center; padding: 18px 8px; }",
    ".spinner {",
    "  width: 28px; height: 28px; margin: 0 auto 12px;",
    "  border: 3px solid #e2e8f0; border-top-color: " + PRIMARY + ";",
    "  border-radius: 50%; animation: lunar-spin 0.8s linear infinite;",
    "}",
    "@keyframes lunar-spin { to { transform: rotate(360deg); } }",
    ".pulse { animation: lunar-pulse 1.4s ease-in-out infinite; color: #64748b; font-size: 13px; }",
    "@keyframes lunar-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }",
    ".score-row { display: flex; gap: 10px; margin: 0 0 12px; }",
    ".score {",
    "  flex: 1; background: #f8fafc; border: 1px solid #e2e8f0;",
    "  border-radius: 8px; padding: 10px; text-align: center;",
    "}",
    ".score-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.02em; }",
    ".score-value { font-size: 22px; font-weight: 800; color: " + PRIMARY + "; margin-top: 2px; }",
    ".score-value.risk-high { color: #dc2626; }",
    ".checks { margin: 0 0 4px; padding: 0; list-style: none; }",
    ".check {",
    "  font-size: 12px; padding: 8px 0; border-bottom: 1px solid #f1f5f9;",
    "  display: flex; justify-content: space-between; gap: 8px; align-items: flex-start;",
    "}",
    ".check:last-child { border-bottom: none; }",
    ".badge {",
    "  flex-shrink: 0; font-size: 10px; font-weight: 700; padding: 2px 6px;",
    "  border-radius: 999px; text-transform: uppercase;",
    "}",
    ".badge-conflict { background: #fef2f2; color: #dc2626; }",
    ".badge-ok { background: #f0fdf4; color: #16a34a; }",
    ".meta { font-size: 12px; color: #64748b; margin: 8px 0 0; }",
    ".error { color: #dc2626; font-size: 13px; margin: 0 0 10px; }",
    ".close {",
    "  position: absolute; top: 8px; right: 10px; border: none; background: transparent;",
    "  color: #94a3b8; font-size: 18px; line-height: 1; cursor: pointer; padding: 4px;",
    "  font-family: inherit;",
    "}",
    ".close:hover { color: #475569; }",
    ".card-inner { position: relative; }",
  ].join("\n");
  shadow.appendChild(style);

  var card = document.createElement("div");
  card.className = "card";
  card.innerHTML =
    '<div class="card-inner">' +
    '<button type="button" class="close" aria-label="Close widget" data-action="close">&times;</button>' +
    '<div data-view="form">' +
    '<h3 class="title">Get Your Free Digital Audit</h3>' +
    '<p class="sub">Instantly check your website for trust contradictions and traffic leaks.</p>' +
    '<form id="audit-form" novalidate>' +
    '<input class="input" id="domain-input" type="text" placeholder="yourdomain.com" required autocomplete="url" />' +
    '<input class="input" id="email-input" type="email" placeholder="you@email.com" required autocomplete="email" />' +
    '<p class="error" id="form-error" style="display:none;"></p>' +
    '<button type="submit" class="btn">Run Diagnostics</button>' +
    "</form>" +
    "</div>" +
    '<div data-view="loading" style="display:none;" class="loading">' +
    '<div class="spinner" aria-hidden="true"></div>' +
    '<p class="pulse">Analyzing your domain... querying search indices... evaluating reputation footprint...</p>' +
    "</div>" +
    '<div data-view="results" style="display:none;"></div>' +
    "</div>";
  shadow.appendChild(card);

  var formView = shadow.querySelector('[data-view="form"]');
  var loadingView = shadow.querySelector('[data-view="loading"]');
  var resultsView = shadow.querySelector('[data-view="results"]');
  var form = shadow.getElementById("audit-form");
  var formError = shadow.getElementById("form-error");
  var domainInput = shadow.getElementById("domain-input");
  var emailInput = shadow.getElementById("email-input");

  function showView(name) {
    formView.style.display = name === "form" ? "block" : "none";
    loadingView.style.display = name === "loading" ? "block" : "none";
    resultsView.style.display = name === "results" ? "block" : "none";
  }

  function statusBadge(status) {
    var conflicting = String(status).toUpperCase() === "CONFLICTING";
    var cls = conflicting ? "badge badge-conflict" : "badge badge-ok";
    var label = conflicting ? "Conflict" : "OK";
    return '<span class="' + cls + '">' + label + "</span>";
  }

  function checkRow(label, item) {
    if (!item) return "";
    return (
      '<li class="check"><span>' +
      label +
      "</span>" +
      statusBadge(item.status) +
      "</li>"
    );
  }

  function renderResults(data, domain, email) {
    var risk = Number(data.reputationRiskScore);
    var confidence = Number(data.overallDataConfidence);
    var riskClass = risk >= 50 ? " score-value risk-high" : "score-value";
    var report = data.reconciliationReport || {};
    var keywords =
      data.searchOverview && data.searchOverview.organicKeywords != null
        ? data.searchOverview.organicKeywords
        : "—";
    var pdfUrl =
      API_BASE +
      "/api/widget/pdf?domain=" +
      encodeURIComponent(domain) +
      "&email=" +
      encodeURIComponent(email);

    resultsView.innerHTML =
      '<h3 class="title">Audit Results</h3>' +
      '<p class="sub" style="margin-bottom:10px;">' +
      (data.domain || domain) +
      "</p>" +
      '<div class="score-row">' +
      '<div class="score"><div class="score-label">Reputation Risk</div>' +
      '<div class="' +
      riskClass +
      '">' +
      risk +
      "/100</div></div>" +
      '<div class="score"><div class="score-label">Data Confidence</div>' +
      '<div class="score-value">' +
      confidence +
      "%</div></div>" +
      "</div>" +
      '<ul class="checks">' +
      checkRow("Review rating", report.review_rating) +
      checkRow("Review count", report.review_count) +
      checkRow("BBB rating", report.bbb_rating) +
      "</ul>" +
      '<p class="meta">Organic keywords: <strong>' +
      keywords +
      "</strong></p>" +
      '<button type="button" class="btn btn-accent" data-action="pdf">Download Boardroom-Ready PDF</button>' +
      '<button type="button" class="btn" style="margin-top:8px;background:#64748b;" data-action="again">Run Another Audit</button>';

    var pdfBtn = resultsView.querySelector('[data-action="pdf"]');
    if (pdfBtn) {
      pdfBtn.addEventListener("click", function () {
        window.open(pdfUrl, "_blank", "noopener,noreferrer");
      });
    }
    var againBtn = resultsView.querySelector('[data-action="again"]');
    if (againBtn) {
      againBtn.addEventListener("click", function () {
        formError.style.display = "none";
        showView("form");
      });
    }
  }

  shadow.querySelector('[data-action="close"]').addEventListener("click", function () {
    host.remove();
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    formError.style.display = "none";

    var domain = (domainInput.value || "").trim();
    var email = (emailInput.value || "").trim();
    if (!domain || !email) {
      formError.textContent = "Domain and email are required.";
      formError.style.display = "block";
      return;
    }

    showView("loading");

    fetch(API_BASE + "/api/widget/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: domain, email: email }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) {
            throw new Error(body && body.error ? body.error : "Audit request failed");
          }
          return body;
        });
      })
      .then(function (data) {
        renderResults(data, domain, email);
        showView("results");
      })
      .catch(function (err) {
        formError.textContent =
          (err && err.message) || "Audit failed. Please try again.";
        formError.style.display = "block";
        showView("form");
      });
  });
})();
