"""Browser pass for public/widget.js against schemaVersion 2026-08-20."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3001"
OUT = Path(__file__).resolve().parent / "widget-browser-pass-artifacts"
OUT.mkdir(parents=True, exist_ok=True)

FIXTURE = {
    "schemaVersion": "2026-08-20",
    "auditMode": "public_baseline",
    "status": "PARTIAL",
    "domain": "example.com",
    "generatedAt": "2026-08-20T12:00:00.000Z",
    "summary": {
        "reputationRiskScore": {
            "status": "NOT_COMPUTED",
            "value": None,
            "reason": "No reconciled reputation evidence was acquired for this audit.",
        },
        "overallDataConfidence": {
            "status": "NOT_COMPUTED",
            "value": None,
            "reason": "Confidence requires metric-level factors and corroborating evidence.",
        },
    },
    "layers": {
        "search": {
            "status": "AVAILABLE",
            "organicTraffic": 321,
            "organicKeywords": 45,
            "fetchedAt": "2026-08-20T12:00:00.000Z",
            "dataAsOf": None,
            "provider": "dataforseo",
            "integration": "domain_rank_overview_live",
            "sourceClass": "estimated",
            "locationCode": 2124,
            "locationLabel": "Canada",
            "languageCode": "en",
            "completeness": "complete",
            "reconciliationStatus": "UNRESOLVED",
            "confidence": None,
            "confidenceReason": "A single estimated provider response is not corroborated evidence.",
        },
        "website": {"status": "NOT_RUN", "reason": "crawler not connected"},
        "reputation": {"status": "UNAVAILABLE", "reason": "not fetched"},
        "analytics": {"status": "NOT_CONNECTED", "reason": "oauth required"},
        "brand": {"status": "NOT_RUN", "reason": "not run"},
        "execution": {"status": "NOT_CONNECTED", "reason": "no workspace"},
    },
    "discrepancies": [],
    "findings": [],
    "report": {
        "available": False,
        "reason": "PDF export requires a persisted canonical audit snapshot, which this endpoint does not create yet.",
    },
}


def main() -> int:
    failures: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.route(
            "**/api/widget/audit",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps(FIXTURE),
            )
            if route.request.method == "POST"
            else route.fulfill(status=204),
        )

        page.goto(f"{BASE}/widget-demo.html", wait_until="networkidle")
        page.wait_for_timeout(500)

        host = page.locator("#lunar-audit-widget-host")
        if host.count() != 1:
            failures.append("widget host missing")

        # Shadow DOM: query via JS
        title = page.evaluate(
            """() => {
              const host = document.querySelector('#lunar-audit-widget-host');
              const root = host && host.shadowRoot;
              const el = root && root.querySelector('.title');
              return el ? el.textContent.trim() : null;
            }"""
        )
        if title != "Get Your Free Digital Audit":
            failures.append(f"unexpected form title: {title!r}")

        # Style isolation: host page Georgia should not apply inside shadow
        font = page.evaluate(
            """() => {
              const host = document.querySelector('#lunar-audit-widget-host');
              const root = host.shadowRoot;
              const el = root.querySelector('.title');
              return getComputedStyle(el).fontFamily;
            }"""
        )
        if "Georgia" in (font or ""):
            failures.append(f"style leak into shadow: {font}")

        page.screenshot(path=str(OUT / "01-form.png"), full_page=True)

        page.evaluate(
            """() => {
              const root = document.querySelector('#lunar-audit-widget-host').shadowRoot;
              root.getElementById('domain-input').value = 'example.com';
              root.getElementById('email-input').value = 'qa@example.com';
              root.getElementById('audit-form').requestSubmit();
            }"""
        )
        page.wait_for_timeout(800)

        results = page.evaluate(
            """() => {
              const root = document.querySelector('#lunar-audit-widget-host').shadowRoot;
              const view = root.querySelector('[data-view="results"]');
              return {
                display: view && view.style.display,
                html: view ? view.innerHTML : '',
                text: view ? view.innerText : '',
              };
            }"""
        )

        text = results.get("text") or ""
        html = results.get("html") or ""

        checks = [
            ("Public Baseline Audit" in text, "missing results title"),
            ("—" in text or "–" in text, "expected NOT_COMPUTED em dash"),
            ("68" not in text and "41" not in text, "fabricated scores leaked into UI"),
            ("Organic keywords" in text and "45" in text, "missing search keywords"),
            ("UNAVAILABLE" in text or "NOT CONNECTED" in text or "NOT RUN" in text, "missing layer statuses"),
            ("PDF export requires" in text or "persisted" in text, "PDF should be gated with reason"),
            ("Download Boardroom-Ready PDF" not in html, "PDF CTA should be hidden when report.available=false"),
        ]
        for ok, msg in checks:
            if not ok:
                failures.append(msg)

        page.screenshot(path=str(OUT / "02-results.png"), full_page=True)

        # Live API smoke (no intercept): expect honest error without fabricated body
        page.unroute("**/api/widget/audit")
        page.evaluate(
            """() => {
              const root = document.querySelector('#lunar-audit-widget-host').shadowRoot;
              root.querySelector('[data-action="again"]').click();
            }"""
        )
        page.wait_for_timeout(300)
        live = page.evaluate(
            """async () => {
              const res = await fetch('/api/widget/audit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain: 'example.com', email: 'qa@example.com' }),
              });
              const body = await res.json().catch(() => null);
              return { status: res.status, body };
            }"""
        )
        Path(OUT / "live-api.json").write_text(json.dumps(live, indent=2), encoding="utf-8")
        body = live.get("body") or {}
        if live.get("status") == 200:
            # Must not look like the old fabricated contract
            if isinstance(body, dict) and "reputationRiskScore" in body and isinstance(
                body.get("reputationRiskScore"), (int, float)
            ):
                failures.append("live API returned legacy numeric reputationRiskScore")
            if body.get("schemaVersion") != "2026-08-20":
                failures.append(f"unexpected schemaVersion: {body.get('schemaVersion')}")
        else:
            err = (body.get("error") or {}) if isinstance(body, dict) else {}
            if not (isinstance(err, dict) and err.get("code") and err.get("message")):
                failures.append(f"live API error shape unexpected: {body!r}")

        page.screenshot(path=str(OUT / "03-after-live.png"), full_page=True)
        browser.close()

    report = {"base": BASE, "failures": failures, "artifacts": str(OUT)}
    Path(OUT / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
