import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
const args = [
  "build",
  "-p",
  "vault-canister",
  "--release",
  "--target",
  "wasm32-unknown-unknown",
  "--locked",
];
execFileSync("cargo", [...args, "--features", "schema-v3-fixture"], {
  stdio: "inherit",
});
copyFileSync(
  "target/wasm32-unknown-unknown/release/vault_canister.wasm",
  "target/vault-schema-v3.wasm",
);
execFileSync("cargo", args, { stdio: "inherit" });
