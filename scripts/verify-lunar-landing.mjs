import { chromium } from "@playwright/test";

const baseUrl = process.env.LUNAR_LANDING_URL ?? "http://127.0.0.1:3300";
const outputDirectory = process.env.LUNAR_LANDING_OUTPUT;
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const response = await page.goto(`${baseUrl}/welcome`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.locator("h1").waitFor({ timeout: 15_000 });
    const title = await page.title();
    const heading = await page.locator("h1").innerText();
    const signup = await page
      // "Create your account" while sign-up is invite-only.
      .getByRole("link", { name: /create your (workspace|account)/i })
      .first()
      .getAttribute("href");
    const pricing = await page.locator(".lo-pricing").innerText();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    const sections = await page.evaluate(() => ({
      count: document.querySelectorAll(".lo-section").length,
      capabilities: document
        .querySelector("#capabilities")
        ?.getBoundingClientRect().top,
      mainHeight: document.querySelector(".lo-page")?.getBoundingClientRect()
        .height,
      bodyHeight: document.body.scrollHeight,
    }));
    console.log(JSON.stringify({ width, sections }));
    if (outputDirectory) {
      await page.screenshot({
        path: `${outputDirectory}/lunar-optimize-${width}.png`,
      });
      await page.locator("#capabilities h2").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${outputDirectory}/lunar-optimize-capabilities-${width}.png`,
      });
      await page.locator(".lo-pricing").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${outputDirectory}/lunar-optimize-pricing-${width}.png`,
      });
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() =>
      document.activeElement?.textContent?.trim(),
    );
    console.log(
      JSON.stringify({
        width,
        status: response?.status(),
        title,
        heading,
        signup,
        overflow,
        firstFocus: focus,
      }),
    );
    if (
      response?.status() !== 200 ||
      !title.includes("Lunar Optimize") ||
      !signup?.startsWith("/sign-up") ||
      !pricing.includes("$99") ||
      !pricing.includes("$20.00") ||
      overflow ||
      focus !== "Skip to content"
    ) {
      process.exitCode = 1;
    }
    await page.close();
  }
} finally {
  await browser.close();
}
