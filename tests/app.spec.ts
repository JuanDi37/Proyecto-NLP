import { test, expect } from "@playwright/test";
const result =
  "Subject: Thursday class notes\n\nDear Professor,\n\nI am ill and cannot attend class on thursday. Could you send the notes? Is the essay still due fri?\n\nThank you.";
test.beforeEach(async ({ page, context }) => {
  await context.route("https://mail.google.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Mock Gmail</title><h1>Gmail compose</h1>",
    }),
  );
  await page.route("**/ollama/api/tags", (route) =>
    route.fulfill({ json: { models: [{ name: "qwen3.5:4b-q4_K_M" }] } }),
  );
  await page.route("**/ollama/api/generate", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.route("**/ollama/api/chat", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({ message: { content: result } }),
    }),
  );
});
test("rewrite, refinements, numeric feedback, history and cancellation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try an example" }).click();
  await page.getByRole("button", { name: "Polish email" }).click();
  await expect(page.getByLabel("Polished email body")).toHaveValue(
    /Dear Professor/,
  );
  await expect(page.getByLabel("SUBJECT", { exact: true })).toHaveValue(
    "Thursday class notes",
  );
  await page.getByRole("button", { name: "Show highlighted changes" }).click();
  await expect(page.locator(".diff ins").first()).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Rate the response from 1 to 5" }),
  ).toHaveCount(0);
  const gmailPopup = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Open in Gmail" }).click();
  await (await gmailPopup).close();
  await page.getByRole("button", { name: "4 out of 5" }).click();
  let feedback: any;
  await page.route("**/api/feedback", (route) => {
    feedback = route.request().postDataJSON();
    return route.fulfill({ status: 204 });
  });
  await page.getByRole("button", { name: "Save feedback" }).click();
  await expect(
    page.getByRole("button", { name: "Feedback saved" }),
  ).toBeVisible();
  expect(feedback.rating).toBe(4);
  expect(feedback.draft).toContain("hey prof");
  await page.getByRole("button", { name: "Warmer", exact: true }).click();
  await expect(page.getByLabel("Polished email body")).toHaveValue(
    /Dear Professor/,
  );
  await page
    .getByLabel("Polished email body")
    .fill("Edited body with [deadline]");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Save current edits" }).click();
  await page.reload();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .locator(".history-entry")
    .first()
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByLabel("Polished email body")).toHaveValue(
    "Edited body with [deadline]",
  );
  await expect(page.getByText("Fill in [deadline]")).toBeVisible();
  await page.route("**/ollama/api/chat", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route
      .fulfill({ body: JSON.stringify({ message: { content: "partial" } }) })
      .catch(() => {});
  });
  await page.getByRole("button", { name: "Polish email" }).click();
  await page.getByRole("button", { name: "Stop generation" }).click();
  await expect(page.getByLabel("Polished email body")).toHaveValue(
    "Edited body with [deadline]",
  );
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Clear history" }).click();
  await expect(page.locator(".history-entry")).toHaveCount(0);
});

test("offline setup is actionable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/ollama/api/tags", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByText("ollama serve", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Polish email" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});

test("recovers automatically when Ollama starts or a model finishes installing", async ({ page }) => {
  await page.clock.install();
  let availability: "offline" | "no-model" | "ready" = "offline";
  await page.route("**/ollama/api/tags", route => {
    if (availability === "offline") return route.abort();
    return route.fulfill({ json: { models: availability === "ready" ? [{ name: "qwen3.5:4b-q4_K_M" }] : [] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(page.locator(".status")).toContainText("Ollama offline");
  availability = "no-model";
  await page.clock.fastForward(10000);
  await expect(page.locator(".status")).toContainText("Model not installed");
  availability = "ready";
  await page.clock.fastForward(10000);
  await expect(page.locator(".status")).toContainText("Local model ready");
  await expect(page.getByRole("button", { name: "Polish email" })).toBeEnabled();
  await expect(page.locator(".setup")).toHaveCount(0);
});

test("rechecks an offline connection when returning to the window", async ({ page }) => {
  await page.route("**/ollama/api/tags", route => route.abort());
  await page.goto("/");
  await expect(page.locator(".status")).toContainText("Ollama offline");
  await page.route("**/ollama/api/tags", route => route.fulfill({ json: { models: [{ name: "qwen3.5:4b-q4_K_M" }] } }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".status")).toContainText("Local model ready");
});

test("model selection persists and feedback keeps the model that generated the result", async ({ page, context }) => {
  await page.route("**/ollama/api/tags", route => route.fulfill({ json: { models: [{ name: "qwen3.5:4b-q4_K_M" }, { name: "gemma3:4b" }] } }));
  const generated: string[] = [];
  const warmed: string[] = [];
  const feedback: any[] = [];
  await page.route("**/ollama/api/generate", route => { warmed.push(route.request().postDataJSON().model); return route.fulfill({ json: {} }); });
  await page.route("**/ollama/api/chat", async route => {
    generated.push(route.request().postDataJSON().model);
    await route.fulfill({ body: JSON.stringify({ message: { content: result } }) });
  });
  await page.route("**/api/feedback", route => { feedback.push(route.request().postDataJSON()); return route.fulfill({ status: 204 }); });
  await page.goto("/");
  const selector = page.getByRole("combobox", { name: "Modelo de Ollama" });
  await selector.selectOption("gemma3:4b");
  await expect(page.getByText("Local model ready")).toBeVisible();
  await page.getByRole("button", { name: "Try an example" }).click();
  await page.getByRole("button", { name: "Polish email" }).click();
  await expect(page.locator(".model-attribution")).toContainText("Gemma 3");
  expect(generated).toEqual(["gemma3:4b"]);
  expect(warmed).toContain("gemma3:4b");
  await selector.selectOption("qwen3.5:4b-q4_K_M");
  await page.getByRole("combobox", { name: "Context" }).selectOption("work");
  const popup = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Open in Gmail" }).click();
  await (await popup).close();
  await page.getByRole("button", { name: "4 out of 5" }).click();
  await page.getByRole("button", { name: "Save feedback", exact: true }).click();
  await expect(page.getByRole("button", { name: "Feedback saved" })).toBeVisible();
  expect(feedback[0]).toMatchObject({ model: "gemma3:4b", setting: "academic", tone: "formal", rating: 4 });
  await page.reload();
  await expect(selector).toHaveValue("qwen3.5:4b-q4_K_M");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.locator(".history-entry").first().getByRole("button").first().click();
  await expect(selector).toHaveValue("gemma3:4b");
  await expect(page.locator(".model-attribution")).toContainText("Gemma 3");
  await page.getByRole("button", { name: "Shorter", exact: true }).click();
  await expect(page.locator(".model-attribution")).toBeVisible();
  expect(generated).toEqual(["gemma3:4b", "gemma3:4b"]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("availability and install instructions follow the selected model", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try an example" }).click();
  const selector = page.getByRole("combobox", { name: "Modelo de Ollama" });
  await selector.selectOption("gemma3:4b");
  await expect(page.getByText("ollama pull gemma3:4b", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Polish email" })).toBeDisabled();
  await page.reload();
  await expect(selector).toHaveValue("gemma3:4b");
  await page.route("**/ollama/api/tags", route => route.fulfill({ json: { models: [{ name: "gemma3:4b" }] } }));
  await page.getByRole("button", { name: "Recheck" }).click();
  await expect(page.getByText("Local model ready")).toBeVisible();
  await selector.selectOption("qwen3.5:4b-q4_K_M");
  await expect(page.getByText("ollama pull qwen3.5:4b-q4_K_M", { exact: true })).toBeVisible();
});

test("feedback endpoint rejects bad ratings and foreign origins", async ({
  request,
}) => {
  for (const rating of [0, 6, "good", 2.5]) {
    const res = await request.post("/api/feedback", { data: { rating } });
    expect(res.status()).toBe(400);
  }
  const res = await request.post("/api/feedback", {
    headers: { Origin: "https://example.com" },
    data: { rating: 5 },
  });
  expect(res.status()).toBe(403);
});

// Pure checks complement the browser workflow with exact detail/diff cases.
test("detail checks catch changed lowercase weekdays, names, amounts and links", async () => {
  const { detailWarnings, diffWords } = await import("../src/email");
  const warnings = detailWarnings(
    "Tell Maria: thursday, $50, https://example.com",
    "Tell Maria: friday, $60, https://other.com",
  );
  expect(warnings).toContain("Check original detail: thursday");
  expect(warnings).toContain("Check original detail: $50");
  expect(warnings).toContain("Check added detail: $60");
  expect(warnings).toContain("Check original detail: https://example.com");
  expect(detailWarnings("Ask Maria", "Ask Jane")).toContain(
    "Check original detail: Ask Maria",
  );
  const edits = diffWords("please send notes", "please send the notes");
  expect(
    edits
      .filter((x) => x.type !== "removed")
      .map((x) => x.text)
      .join(""),
  ).toBe("please send the notes");
  expect(
    edits
      .filter((x) => x.type !== "added")
      .map((x) => x.text)
      .join(""),
  ).toBe("please send notes");
});

test("desktop layout and missing-model recovery", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/ollama/api/tags", (route) =>
    route.fulfill({ json: { models: [] } }),
  );
  await page.goto("/");
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    ),
  ).toBe("dark");
  await expect(
    page.getByText("ollama pull qwen3.5:4b-q4_K_M", { exact: true }),
  ).toBeVisible();
  await page.route("**/ollama/api/tags", (route) =>
    route.fulfill({ json: { models: [{ name: "qwen3.5:4b-q4_K_M" }] } }),
  );
  await page.getByRole("button", { name: "Recheck" }).click();
  await expect(page.getByText("Local model ready")).toBeVisible();
  await page.screenshot({
    path: "test-results/desktop-empty.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Try an example" }).click();
  await page.getByRole("button", { name: "Polish email" }).click();
  await expect(page.getByLabel("Polished email body")).toHaveValue(
    /Dear Professor/,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
});

test("opens Gmail with the exact edited subject and body, without login or automatic sending", async ({
  page,
  context,
}) => {
  const googleRequests: string[] = [];
  page.on("request", (request) => {
    if (/accounts\.google\.com|googleapis\.com/.test(request.url()))
      googleRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Log in/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Try an example" }).click();
  await page.getByRole("button", { name: "Polish email" }).click();
  const subject = "Reuni\u00f3n ma\u00f1ana \u2728 & next steps";
  const body =
    "Hola, \u00bfpuedes venir?\n\nLink: https://example.com/?x=1&bcc=ignored\nThank you + cheers #1";
  await page.getByLabel("SUBJECT", { exact: true }).fill(subject);
  await page.getByLabel("Polished email body").fill(body);
  const link = page.getByRole("link", { name: "Open in Gmail" });
  const href = await link.getAttribute("href");
  const url = new URL(href!);
  expect(url.origin).toBe("https://mail.google.com");
  expect(url.pathname).toBe("/mail/u/1/");
  expect(url.searchParams.get("su")).toBe(subject);
  expect(url.searchParams.get("body")).toBe(body);
  expect(url.searchParams.has("to")).toBe(false);
  expect(url.searchParams.has("bcc")).toBe(false);
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  const popupPromise = context.waitForEvent("page");
  await link.click();
  const popup = await popupPromise;
  await popup.waitForURL("https://mail.google.com/**");
  expect(new URL(popup.url()).searchParams.get("body")).toBe(body);
  expect(googleRequests).toEqual([]);
  await expect(page.getByRole("status")).not.toContainText("Email sent");
  await popup.close();
});

test("remembers recent recipients across reloads and supports reuse, forgetting and clearing", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try an example" }).click();
  await page.getByRole("button", { name: "Polish email" }).click();
  const recipient = page.getByLabel("Recipient (optional)", { exact: true });
  await recipient.fill("Maria <maria@example.com>");
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("link", { name: "Open in Gmail" }).click();
  const popup = await popupPromise;
  await popup.waitForURL("https://mail.google.com/**");
  expect(new URL(popup.url()).searchParams.get("to")).toBe("maria@example.com");
  await popup.close();
  await expect(
    page
      .locator(".recent-recipients")
      .getByRole("button", { name: "Maria", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .locator(".history-entry")
    .first()
    .getByRole("button")
    .first()
    .click();
  await page
    .locator(".recent-recipients")
    .getByRole("button", { name: "Maria", exact: true })
    .click();
  await expect(recipient).toHaveValue("maria@example.com");
  const href = await page
    .getByRole("link", { name: "Open in Gmail" })
    .getAttribute("href");
  expect(new URL(href!).searchParams.get("to")).toBe("maria@example.com");
  await page
    .getByRole("button", { name: "Forget maria@example.com", exact: true })
    .click();
  await expect(page.locator(".recipient-shortcut")).toHaveCount(0);
  await recipient.fill("bob@example.com");
  const secondPopup = context.waitForEvent("page");
  await page.getByRole("link", { name: "Open in Gmail" }).click();
  await (await secondPopup).close();
  await page.getByRole("button", { name: "Clear recipients" }).click();
  await expect(page.locator(".recipient-shortcut")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("mail-polish-recipients-v1"),
    ),
  ).toBe("[]");
});

test("placeholder and recipient validation protect Gmail handoff; helper bounds recent recipients", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try an example" }).click();
  await page.getByRole("button", { name: "Polish email" }).click();
  await page
    .getByLabel("Polished email body")
    .fill("Please reply by [deadline].");
  await expect(
    page.getByRole("button", { name: "Open in Gmail" }),
  ).toBeDisabled();
  await expect(page.locator(".gmail-compose-hint")).toContainText(
    "Fill in bracketed placeholders",
  );
  await page.getByLabel("Polished email body").fill("Please reply by Friday.");
  await page
    .getByLabel("Recipient (optional)", { exact: true })
    .fill("Unknown Person");
  await expect(
    page.getByRole("button", { name: "Open in Gmail" }),
  ).toBeDisabled();
  await page.getByLabel("Recipient (optional)", { exact: true }).fill("");
  await expect(page.getByRole("link", { name: "Open in Gmail" })).toBeVisible();
  const { rememberRecipient, resolveRecipient } = await import("../src/gmail");
  let recent: ReturnType<typeof rememberRecipient> = [];
  for (let i = 0; i < 10; i++)
    recent = rememberRecipient(recent, {
      email: `user${i}@example.com`,
      name: "",
      lastUsed: "",
    });
  expect(recent).toHaveLength(8);
  recent = rememberRecipient(recent, {
    email: "USER4@example.com",
    name: "Four",
    lastUsed: "",
  });
  expect(recent).toHaveLength(8);
  expect(recent[0].name).toBe("Four");
  expect(resolveRecipient("four", recent)?.email).toBe("USER4@example.com");
});

test("history and Gmail handoff fit mobile; invalid recipient storage is recovered", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("mail-polish-recipients-v1", "{broken"),
  );
  await page.goto("/");
  for (const width of [360, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close panel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Email history", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Try an example" }).click();
  await page.getByRole("button", { name: "Polish email" }).click();
  await expect(page.getByRole("link", { name: "Open in Gmail" })).toBeVisible();
  await page.screenshot({
    path: "test-results/mobile-gmail.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("recipient greeting and saved sender name survive changes and feedback waits for Gmail handoff", async ({
  page,
}) => {
  let prompt = "";
  await page.route("**/ollama/api/chat", (route) => {
    prompt = route.request().postDataJSON().messages[0].content;
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({
        message: {
          content:
            "Subject: Consulta\n\nEstimado {nombre}:\n\nQuisiera consultar sobre la tarea.\n\nAtentamente,\n[Tu nombre]",
        },
      }),
    });
  });
  await page.goto("/");
  await page.getByLabel("Para:", { exact: true }).fill("Ana Torres");
  await page.getByLabel("Tu nombre:", { exact: true }).fill("Juan Lopez");
  await page
    .getByLabel("Your draft", { exact: true })
    .fill(
      "hola, tengo una pregunta sobre la tarea de la clase, gracias por su ayuda",
    );
  await page.getByRole("button", { name: "Polish email" }).click();
  await expect(page.getByLabel("Polished email body")).toHaveValue(
    /Hola Ana Torres,/,
  );
  await expect(page.getByLabel("Polished email body")).toHaveValue(
    /Juan Lopez$/,
  );
  expect(prompt).toContain("Ana Torres");
  expect(prompt).toContain("Juan Lopez");
  await expect(
    page.getByRole("group", { name: "Rate the response from 1 to 5" }),
  ).toHaveCount(0);
  const popup = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Open in Gmail" }).click();
  await (await popup).close();
  await expect(
    page.getByRole("group", { name: "Rate the response from 1 to 5" }),
  ).toBeVisible();
  await page.getByLabel("Tu nombre:", { exact: true }).fill("Juan Perez");
  await page.reload();
  await expect(page.getByLabel("Tu nombre:", { exact: true })).toHaveValue(
    "Juan Perez",
  );
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .locator(".history-entry")
    .first()
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByLabel("Para:", { exact: true })).toHaveValue(
    "Ana Torres",
  );
  await expect(page.getByLabel("Tu nombre:", { exact: true })).toHaveValue(
    "Juan Perez",
  );
  await expect(
    page.getByRole("group", { name: "Rate the response from 1 to 5" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Polish email" }).click();
  await expect(page.getByLabel("Polished email body")).toHaveValue(
    /Juan Perez$/,
  );
  await page.getByLabel("Tu nombre:", { exact: true }).fill("");
  await page.reload();
  await expect(page.getByLabel("Tu nombre:", { exact: true })).toHaveValue("");
});

test("name placeholders never remain in a generic greeting or signature", async () => {
  const { personalizeEmail } = await import("../src/email");
  const result = personalizeEmail(
    "Subject: Consulta\n\nEstimado {nombre}:\n\nNecesito los apuntes.\n\nSaludos,\n[Tu nombre]",
    "",
    "",
    "Spanish",
  );
  expect(result.body).toBe("Hola,\n\nNecesito los apuntes.\n\nSaludos,");
  const named = personalizeEmail(
    "Subject: Notes\n\nDear Professor,\n\nPlease send notes.\n\nBest regards,\nInvented Name",
    "Dr. Kim",
    "Alex",
    "English",
  );
  expect(named.body).toBe(
    "Dear Dr. Kim,\n\nPlease send notes.\n\nBest regards,\nAlex",
  );
});

test("new emails remove reply prefixes and open the institutional Gmail account", async ({
  page,
  context,
}) => {
  await page.route("**/ollama/api/chat", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({
        message: {
          content:
            "Subject: Re: Re[2]: Mi nueva app para enviar correos\n\nHola,\n\nMi ejemplo conserva Re: dentro del mensaje.\n\nSaludos.",
        },
      }),
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Try an example" }).click();
  await page.getByRole("button", { name: "Polish email" }).click();
  const subject = page.getByLabel("SUBJECT", { exact: true });
  await expect(subject).toHaveValue("Mi nueva app para enviar correos");
  await expect(page.getByLabel("Polished email body")).toHaveValue(
    /conserva Re: dentro/,
  );
  await page.getByRole("button", { name: "Warmer", exact: true }).click();
  await expect(subject).toHaveValue("Mi nueva app para enviar correos");
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("link", { name: "Open in Gmail" }).click();
  const popup = await popupPromise;
  await popup.waitForURL("https://mail.google.com/**");
  const url = new URL(popup.url());
  expect(url.pathname).toBe("/mail/u/1/");
  expect(url.searchParams.get("su")).toBe("Mi nueva app para enviar correos");
  await popup.close();
  await page.reload();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .locator(".history-entry")
    .first()
    .getByRole("button")
    .first()
    .click();
  await expect(subject).toHaveValue("Mi nueva app para enviar correos");
  const { cleanGeneratedSubject, splitEmail } = await import("../src/email");
  expect(cleanGeneratedSubject("Reunion del equipo")).toBe(
    "Reunion del equipo",
  );
  expect(splitEmail("Asunto: re: Hola\n\nMensaje").subject).toBe("Hola");
});
