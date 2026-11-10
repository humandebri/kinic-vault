import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
const did = execFileSync(
  "cargo",
  ["run", "-p", "vault-canister", "--example", "export", "--locked"],
  { encoding: "utf8" },
);
const base = "packages/contracts/vault.did";
if (process.argv.includes("--check")) {
  if (readFileSync(base, "utf8") !== did) throw Error("Candid drift");
} else {
  writeFileSync(base, did);
}
for (const [target, path] of [
  ["js", base + ".js"],
  ["ts", base + ".d.ts"],
]) {
  const source = execFileSync("didc", ["bind", "-t", target, base], {
    encoding: "utf8",
  });
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== source) throw Error("Binding drift");
  } else {
    writeFileSync(path, source);
  }
}
