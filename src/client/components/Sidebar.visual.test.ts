import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sidebarSource = readFileSync(
  new URL("./Sidebar.tsx", import.meta.url),
  "utf8",
);
const appCss = readFileSync(
  new URL("../styles/app.css", import.meta.url),
  "utf8",
);

describe("sidebar visual identity", () => {
  it("uses the shared gradient surface with accessible navigation focus", () => {
    expect(sidebarSource).toContain('className="app-sidebar');
    expect(sidebarSource).toContain("focus-visible:outline-white/80");
    expect(appCss).toContain(".app-sidebar {");
    expect(appCss).toContain("radial-gradient(");
    expect(appCss).toContain("linear-gradient(");
    expect(appCss).toContain("--color-base-content:");
  });
});
