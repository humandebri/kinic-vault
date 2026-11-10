import { readFile } from "node:fs/promises";
import { openArchive } from "../../packages/backup/src/index.ts";
import { unb64 } from "../../packages/crypto/src/documents.ts";
import { test, expect } from "@playwright/test";
test("real canister: passkey setup, encrypted note, credential, attachment, backup, relogin and lock", async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const outgoing: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      outgoing.push(url.origin);
  });
  await page.goto("/");
  await page.getByRole("button", { name: "合成Identityでログイン" }).click();
  await expect(
    page.getByRole("heading", { name: "保管庫", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "＋ 保管庫を作成" }).click();
  const secret = await page.locator("output.secret").textContent();
  expect(secret).toBeTruthy();
  await page.getByLabel("保存した値を再入力").fill(secret!);
  await page.getByRole("button", { name: "パスキーを登録して作成" }).click();
  await expect(
    page.getByRole("heading", { name: "保管庫の文書" }),
  ).toBeVisible();
  await page.getByLabel("タイトル", { exact: true }).fill("Synthetic note");
  await page
    .getByLabel("本文（Markdown）")
    .fill(
      'Synthetic searchable body\n<img src="https://example.invalid/leak">\n<script>window.bad=true</script>',
    );
  await page
    .getByRole("button", { name: "暗号化して保存", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Synthetic note/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Synthetic note/ }).click();
  await expect(page.getByLabel("本文（Markdown）")).toHaveValue(
    /Synthetic searchable body/,
  );
  await expect(page.locator(".preview img,.preview script")).toHaveCount(0);
  await page.getByLabel("文書を検索").fill("searchable body");
  await expect(
    page.getByRole("button", { name: /Synthetic note/ }),
  ).toBeVisible();
  await page.getByLabel("文書を検索").fill("");
  await page.getByRole("button", { name: "＋ 新しい文書" }).click();
  await page
    .getByRole("combobox", { name: "種類", exact: true })
    .selectOption("credential");
  await page.getByLabel("タイトル", { exact: true }).fill("Synthetic login");
  await page.getByLabel("ユーザー名", { exact: true }).fill("test-user");
  await page
    .getByLabel("パスワード", { exact: true })
    .fill("synthetic-only-password");
  await page
    .getByRole("button", { name: "暗号化して保存", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Synthetic login/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Synthetic login/ }).click();
  await expect(page.getByLabel("パスワード", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await page.getByRole("button", { name: "＋ 新しい文書" }).click();
  await page
    .getByRole("combobox", { name: "種類", exact: true })
    .selectOption("attachment");
  await page.getByLabel("タイトル", { exact: true }).fill("Synthetic PDF");
  await page.getByLabel("ファイル（10 MiBまで）").setInputFiles({
    name: "synthetic.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nsynthetic fixture only"),
  });
  await page
    .getByRole("button", { name: "暗号化して保存", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Synthetic PDF/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "＋ 新しい文書" }).click();
  await page
    .getByLabel("タイトル", { exact: true })
    .fill("Synthetic temporary");
  await page.getByLabel("本文（Markdown）").fill("Temporary synthetic fixture");
  await page
    .getByRole("button", { name: "暗号化して保存", exact: true })
    .click();
  await page.getByRole("button", { name: /Synthetic temporary/ }).click();
  await page.getByRole("button", { name: "文書を削除", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /削除済み.*Synthetic temporary/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /削除済み.*Synthetic temporary/ })
    .click();
  await expect(
    page.getByRole("button", { name: "暗号化して保存", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "履歴を表示", exact: true }).click();
  await expect(page.getByRole("heading", { name: "版の履歴" })).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await page
    .getByRole("button", { name: "履歴ごと完全削除", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Synthetic temporary/ }),
  ).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "バックアップを保存", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("kinic-vault.kvault");
  const archive = await openArchive(
    new Uint8Array(await readFile((await file.path())!)),
    unb64(secret!),
  );
  expect(archive.records.length).toBe(3);
  archive.rootRaw.fill(0);
  await expect(
    page.getByRole("button", { name: "保存できました" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存できました" }).click();
  await expect(page.getByText("保存確認済み", { exact: false })).toBeVisible();
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: test.info().outputPath("synthetic-vault.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "ロック", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "保管庫はロックされています" }),
  ).toBeVisible();
  await expect(page.getByLabel("パスワード", { exact: true })).toHaveCount(0);
  expect(await page.locator("body").textContent()).not.toContain(
    "Synthetic searchable body",
  );
  const persisted = await page.evaluate(async () => ({
    local: JSON.stringify(localStorage),
    session: JSON.stringify(sessionStorage),
    databases: await indexedDB.databases(),
    caches: await caches.keys(),
  }));
  expect(persisted.local).not.toContain("synthetic");
  expect(persisted.session).not.toContain("synthetic");
  expect(persisted.databases).toEqual([]);
  expect(persisted.caches).toEqual([]);
  await page.getByRole("button", { name: "パスキーで解除" }).click();
  await expect(
    page.getByRole("button", { name: /Synthetic note/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await page.getByRole("button", { name: "合成Identityでログイン" }).click();
  await page.getByRole("button", { name: "保管庫 1" }).click();
  await page.getByRole("button", { name: "パスキーで解除" }).click();
  await expect(
    page.getByRole("button", { name: /Synthetic PDF/ }),
  ).toBeVisible();
  // Hold a real derive request until after locking; its late result must never restore the editor.
  await expect(page.getByRole("button", { name: "一覧を更新" })).toBeEnabled();
  await page.getByRole("button", { name: "ロック", exact: true }).click();
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let intercepted!: () => void;
  const ready = new Promise<void>((resolve) => (intercepted = resolve));
  await page.route("**/api/**/canister/**/call", async (route) => {
    if (
      route
        .request()
        .postDataBuffer()
        ?.includes(Buffer.from("derive_vault_key"))
    ) {
      intercepted();
      await held;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "パスキーで解除" }).click();
  await ready;
  await page.getByRole("button", { name: "ロック", exact: true }).click();
  release();
  await expect(page.getByRole("status")).toHaveCount(0, { timeout: 15000 });
  await expect(
    page.getByRole("heading", { name: "保管庫はロックされています" }),
  ).toBeVisible();
  expect(await page.locator("body").textContent()).not.toContain(
    "Synthetic searchable body",
  );
  // File reads are asynchronous too: locking during restore must cancel before any canister write.
  await page.getByText("バックアップから復旧", { exact: true }).click();
  await page.getByLabel("バックアップ", { exact: true }).setInputFiles({
    name: "synthetic.kvault",
    mimeType: "application/octet-stream",
    buffer: await readFile((await file.path())!),
  });
  await page.getByLabel("復旧用秘密", { exact: true }).fill(secret!);
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      await new Promise<void>((resolve) => {
        Object.assign(window, { releaseVaultFile: resolve });
      });
      return original.call(this);
    };
  });
  const restores: string[] = [];
  page.on("request", (r) => {
    if (r.postDataBuffer()?.includes(Buffer.from("begin_restore")))
      restores.push(r.url());
  });
  await page.getByRole("button", { name: "検証して復旧" }).click();
  await page.waitForFunction(() => "releaseVaultFile" in window);
  await page.getByRole("button", { name: "ロック", exact: true }).click();
  await page.evaluate(() => {
    (window as unknown as { releaseVaultFile: () => void }).releaseVaultFile();
  });
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "保管庫はロックされています" }),
  ).toBeVisible();
  expect(restores).toEqual([]);
  expect(errors).toEqual([]);
  expect(outgoing).toEqual([]);
});
