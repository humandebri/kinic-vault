import type { Challenge } from "../../../packages/contracts/vault.did.js";
import { b64 } from "../../../packages/crypto/src/documents.ts";
const bytes = (b: Uint8Array | number[]) => new Uint8Array(b);
export async function register(ch: Challenge, owner: Uint8Array) {
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: bytes(ch.bytes),
      rp: { id: "localhost", name: "Kinic Vault" },
      user: {
        id: new Uint8Array(owner),
        name: "Vault owner",
        displayName: "Vault owner",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -8 },
      ],
      timeout: 120000,
      attestation: "none",
      authenticatorSelection: {
        userVerification: "required",
        residentKey: "preferred",
      },
      excludeCredentials: ch.credential_ids.map((id) => ({
        type: "public-key",
        id: bytes(id),
      })),
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw Error("InvalidProof");
  const r = credential.response as AuthenticatorAttestationResponse;
  return JSON.stringify({
    id: b64(new Uint8Array(credential.rawId)),
    attestationObject: b64(new Uint8Array(r.attestationObject)),
    clientDataJSON: b64(new Uint8Array(r.clientDataJSON)),
    transports: r.getTransports?.() ?? [],
  });
}
export async function assertCredential(ch: Challenge) {
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: bytes(ch.bytes),
      rpId: "localhost",
      timeout: 120000,
      userVerification: "required",
      allowCredentials: ch.credential_ids.map((id) => ({
        type: "public-key",
        id: bytes(id),
      })),
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw Error("InvalidProof");
  const r = credential.response as AuthenticatorAssertionResponse;
  return JSON.stringify({
    id: b64(new Uint8Array(credential.rawId)),
    authenticatorData: b64(new Uint8Array(r.authenticatorData)),
    clientDataJSON: b64(new Uint8Array(r.clientDataJSON)),
    signature: b64(new Uint8Array(r.signature)),
    userHandle: r.userHandle ? b64(new Uint8Array(r.userHandle)) : null,
  });
}
