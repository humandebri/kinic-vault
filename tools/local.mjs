import { PocketIc, PocketIcServer } from "@dfinity/pic";
import { IDL } from "@icp-sdk/core/candid";
import { Principal } from "@icp-sdk/core/principal";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { createServer } from "vite";
import { idlFactory, init } from "../packages/contracts/vault.did.js";
const args = process.argv.slice(2);
const ownerIndex = args.indexOf("--owner");
const real = ownerIndex >= 0;
const owner = real
  ? Principal.fromText(args[ownerIndex + 1])
  : Ed25519KeyIdentity.fromSecretKey(
      new Uint8Array(32).fill(31),
    ).getPrincipal();
if (real && !process.env.VITE_II_URL)
  throw Error("Set the local VITE_II_URL for the specified owner");
let pic, web;
const server = await PocketIcServer.start();
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await web?.close();
  await pic?.tearDown();
  await server.stop();
};
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => void close().finally(() => process.exit()));
try {
  pic = await PocketIc.create(server.getUrl(), {
    fiduciary: { state: { type: "new" } },
    icpConfig: { betaFeatures: "Enabled" },
  });
  const { canisterId } = await pic.setupCanister({
    sender: owner,
    idlFactory,
    wasm: new URL(
      "../target/wasm32-unknown-unknown/release/vault_canister.wasm",
      import.meta.url,
    ).pathname,
    arg: IDL.encode(init({ IDL }), [
      {
        owner,
        origin: "http://localhost:5173",
        rp_id: "localhost",
        key_name: "test_key_1",
        minimum_cycles: 100_000_000_000n,
      },
    ]),
    cycles: 100_000_000_000_000n,
  });
  const port = await pic.makeLive();
  web = await createServer({
    root: "apps/web",
    mode: real ? "development" : "test",
    define: {
      "import.meta.env.VITE_CANISTER_ID": JSON.stringify(canisterId.toText()),
      "import.meta.env.VITE_IC_HOST": JSON.stringify(
        "http://127.0.0.1:" + port,
      ),
    },
  });
  await web.listen();
  console.log(
    "Kinic Vault local synthetic-data environment: http://localhost:5173",
  );
} catch (e) {
  await close();
  throw e;
}
