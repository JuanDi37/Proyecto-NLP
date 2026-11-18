import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

test("five-slide deck works offline with five-minute notes and navigation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(resolve("presentacion.html")).href);
  await expect(page.locator(".slide")).toHaveCount(5);
  await expect(page.locator(".slide:visible")).toHaveCount(1);
  expect(await page.locator(".slide").evaluateAll(slides => slides.reduce((sum, slide) => sum + Number((slide as HTMLElement).dataset.seconds), 0))).toBe(300);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#page-counter")).toHaveText("02 / 05");
  await page.keyboard.press("n");
  await expect(page.locator("#notes")).toBeVisible();
  await expect(page.locator("#note-title")).toHaveText("NOTAS / 70 s");
  await page.keyboard.press("End");
  await expect(page.locator("#next")).toBeDisabled();
  await page.locator("#index-button").click();
  await page.locator("#toc button").nth(2).click();
  await expect(page.locator("#page-counter")).toHaveText("03 / 05");
  await page.locator("#view-button").click();
  await expect(page.locator(".slide:visible")).toHaveCount(5);
  await page.locator("#view-button").click();
  await expect(page.locator(".slide:visible")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("presentation uses actual results and quoted infrastructure rather than inferred savings", async ({ page }) => {
  await page.goto("/presentacion.html#2");
  await expect(page.locator("#qwen-approval")).toContainText("82.5");
  await expect(page.locator("#gemma-approval")).toContainText("55");
  await expect(page.locator("#outlier-note")).toContainText("117.16");
  await page.goto("/presentacion.html#3");
  await expect(page.locator("#qwen-quote")).toContainText("confirme la compra antes");
  await expect(page.locator("#gemma-quote")).toContainText("no confirme la compra");
  await expect(page.locator("#case-qwen")).toHaveClass(/critical/);
  await page.locator("#case-select").selectOption("EN06");
  await expect(page.locator("#qwen-quote")).toContainText("Please send the report");
  await expect(page.locator("#gemma-quote")).toContainText("I’m sending the report");
  await expect(page.locator("#case-gemma")).toHaveClass(/critical/);
  await page.goto("/presentacion.html#4");
  await expect(page.locator("#revenue-chart")).toBeVisible();
  await expect(page.locator('#revenue-bars circle[data-users="40"]')).toHaveAttribute("data-income", "200");
  await expect(page.locator('#revenue-bars circle[data-users="100"]')).toHaveAttribute("data-income", "500");
  await expect(page.locator("#revenue-cost")).toContainText("197.40");
  await expect(page.locator('#revenue-bars circle[data-users="0"]')).toHaveAttribute("data-income", "0");
  await expect(page.locator("#minimum-users")).toHaveText("40");
  await expect(page.locator('#rental-breakdown')).toContainText('Runpod');
  await expect(page.locator('#rental-breakdown')).toContainText('RTX A5000, 24 GB VRAM');
  await expect(page.locator('#rental-breakdown')).toContainText('USD 0.27/h');
  await expect(page.locator('#rental-breakdown')).toContainText('10 GB contenedor + 20 GB persistente');
  await expect(page.locator('#rental-breakdown')).toContainText('Total: USD 197.40/mes');
  await expect(page.locator("#users-slider")).toHaveCount(0);
  await expect(page.locator(".axis-guide")).toContainText("Eje X: usuarios de pago");
  await expect(page.locator(".advanced-cost")).toHaveCount(0);
  await expect(page.locator('[aria-labelledby="title-4"] details, [aria-labelledby="title-4"] select')).toHaveCount(0);
  await page.getByRole("button", { name: "8 h · 22 días", exact: true }).click();
  await expect(page.locator('#revenue-bars circle[data-users="11"]')).toHaveAttribute("data-cost", "51.28");
  await expect(page.locator("#strategy-break-even")).toContainText("11 usuarios");
  await expect(page.locator("#minimum-users")).toHaveText("11");
  await expect(page.locator('#rental-breakdown')).toContainText('176 h = USD 47.52/mes');
  await expect(page.locator('#rental-breakdown')).toContainText('Total: USD 51.28/mes');
  await expect(page.getByRole('button', {name:'Bajo demanda',exact:true})).toHaveCount(0);
  await expect(page.locator('#load-controls, #startup-seconds, #requests-slider')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(720);
  const embedded = await page.locator("#benchmark-data").textContent();
  expect(JSON.parse(embedded!).run_id).toBe(JSON.parse(readFileSync("public/benchmark-results/summary.json", "utf8")).run_id);
});

test("mobile slides and local artifact download links work", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (let i = 1; i <= 5; i++) {
    await page.goto(`/presentacion.html#${i}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  for (const link of await page.locator("[data-artifact]").all()) {
    const href = await link.getAttribute("href");
    expect((await request.get(href!)).status()).toBe(200);
  }
  await page.goto(pathToFileURL(resolve("presentacion.html")).href + "#5");
  await expect(page.locator('[data-artifact="generations.csv"]')).toHaveAttribute("href", /\/public\/benchmark-results\/generations\.csv$/);
});

test("laptop deck fits its viewport and prints exactly five pages", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  for (let i = 1; i <= 5; i++) {
    await page.goto(`/presentacion.html#${i}`);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(720);
  }
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".slide:visible")).toHaveCount(5);
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(5);
});
