import { PocketIc, PocketIcServer } from "@dfinity/pic";
import { chromium, expect } from "@playwright/test";
import { Principal } from "@icp-sdk/core/principal";
import { createServer } from "vite";
const server = await PocketIcServer.start();
let pic, browser, web;
try {
  pic = await PocketIc.create(server.getUrl(), {
    ii: { state: { type: "new" } },
    icpFeatures: { ii: "DefaultConfig" },
  });
  const port = await pic.makeLive();
  web = await createServer({
    root: "apps/web",
    mode: "development",
    server: { port: 5174, strictPort: true, host: "localhost" },
    define: {
      "import.meta.env.VITE_II_URL": JSON.stringify(
        `http://rdmx6-jaaaa-aaaaa-aaadq-cai.localhost:${port}/authorize`,
      ),
    },
  });
  await web.listen();
  browser = await chromium.launch();
  const context = await browser.newContext();
  context.on("page", async (p) => {
    const c = await context.newCDPSession(p);
    await c.send("WebAuthn.enable");
    await c.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
  });
  const page = await context.newPage();
  await page.goto("http://localhost:5174/ii-check.html");
  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Sign in with local II" }).click();
  const popup = await opened;
  await popup.waitForLoadState("networkidle");
  await popup
    .getByRole("button", { name: "Continue with passkey", exact: true })
    .click();
  await popup
    .getByRole("button", { name: "Create new identity", exact: true })
    .click();
  await popup.locator("input").first().fill("Synthetic Vault Identity");
  await popup
    .getByRole("button", { name: "Create identity", exact: true })
    .click();
  await popup.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#result")).toHaveText(/^[a-z0-9-]+$/, {
    timeout: 15000,
  });
  Principal.fromText(await page.locator("#result").innerText());
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  console.log(
    "PASS: official AuthClient signed in through local Internet Identity with a synthetic passkey.",
  );
} finally {
  await browser?.close();
  await web?.close();
  await pic?.tearDown();
  await server.stop();
}
