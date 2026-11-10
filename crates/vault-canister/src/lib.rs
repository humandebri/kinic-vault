mod auth;
mod runtime;
use candid::Principal;
use ic_cdk::{init, post_upgrade, update};
use ic_cdk_management_canister as management;
use kinic_sqlite_compat::{Connection, OptionalExtension, params};
use runtime::transaction;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use vault_store as store;
use vault_types::*;

#[derive(Serialize, Deserialize, Clone)]
struct Ceremony {
    request: BeginUnlock,
    challenge: Challenge,
    created: u64,
}
#[derive(Serialize, Deserialize, Clone)]
struct Flight {
    token: u64,
    vault: Id,
    epoch: u64,
    state: VaultState,
    expires: u64,
}
#[derive(Serialize, Deserialize, Default)]
struct Control {
    serial: u64,
    ceremony: Option<Ceremony>,
    random: Option<Flight>,
    derive: Option<Flight>,
    day: u64,
    derives: u64,
    challenges: u64,
}
#[derive(Serialize, Deserialize)]
struct Candidate {
    vault: Id,
    credential: passkey_auth::PasskeyCredential,
    digest: Vec<u8>,
    expires: u64,
}
fn valid_transport(bytes: &[u8]) -> bool {
    let Ok(arr) = <&[u8; 48]>::try_from(bytes) else {
        return false;
    };
    Option::<ic_bls12_381::G1Affine>::from(ic_bls12_381::G1Affine::from_compressed(arr))
        .is_some_and(|p| !bool::from(p.is_identity()))
}
fn control(db: &Connection) -> Result<Control> {
    Ok(store::load(db, "control")?.unwrap_or_default())
}
fn now() -> u64 {
    ic_cdk::api::time() / 1_000_000_000
}
fn caller() -> Principal {
    ic_cdk::api::msg_caller()
}
fn hash<T: Serialize>(r: &T) -> Result<Vec<u8>> {
    Ok(Sha256::digest(serde_json::to_vec(r).map_err(|_| Error::InvalidInput)?).to_vec())
}
fn epoch(h: &Header, e: u64) -> Result<()> {
    if h.epoch != e {
        Err(Error::Conflict)
    } else {
        Ok(())
    }
}
fn live(db: &Connection, v: &[u8], t: u64) -> Result<Header> {
    let h = store::header(db, v)?;
    if h.state != VaultState::Active {
        store::pending(db, v, t)?;
    }
    Ok(h)
}
fn credentials(db: &Connection) -> Result<Vec<passkey_auth::PasskeyCredential>> {
    let mut s = db
        .prepare("SELECT value FROM credentials ORDER BY id LIMIT 10")
        .map_err(|_| Error::Storage)?;
    let raw: Vec<String> =
        kinic_sqlite_compat::query_map(&mut s, params![], |r| kinic_sqlite_compat::row_get(r, 0))
            .map_err(|_| Error::Storage)?;
    raw.iter()
        .map(|s| serde_json::from_str(s).map_err(|_| Error::Storage))
        .collect()
}
fn insert_credential(db: &Connection, c: &passkey_auth::PasskeyCredential) -> Result<()> {
    if credentials(db)?.len() >= 10 {
        return Err(Error::QuotaExceeded);
    }
    let existing: Option<String> = db
        .query_row(
            "SELECT value FROM credentials WHERE id=?1",
            params![c.id.0],
            |r| kinic_sqlite_compat::row_get(r, 0),
        )
        .optional()
        .map_err(|_| Error::Storage)?;
    if existing.is_some() {
        return Err(Error::Conflict);
    }
    db.execute(
        "INSERT INTO credentials(id,value) VALUES(?1,?2)",
        params![
            c.id.0,
            serde_json::to_string(c).map_err(|_| Error::Storage)?
        ],
    )
    .map_err(|_| Error::Storage)?;
    Ok(())
}
fn ceremony(
    db: &Connection,
    v: &[u8],
    purpose: Purpose,
    transport: &[u8],
    target: &[u8],
) -> Result<Ceremony> {
    let mut c = control(db)?;
    let ch = c.ceremony.take().ok_or(Error::InvalidProof)?;
    if ch.challenge.expires <= now() {
        return Err(Error::Expired);
    }
    if ch.request.vault != v
        || ch.request.purpose != purpose
        || ch.request.transport != transport
        || ch.request.target != target
    {
        return Err(Error::InvalidProof);
    }
    let h = live(db, v, now())?;
    epoch(&h, ch.request.epoch)?;
    store::save(db, "control", &c)?;
    Ok(ch)
}
fn assert_proof(db: &Connection, ch: &Ceremony, json: &str) -> Result<()> {
    let cfg = store::config(db)?;
    let creds = credentials(db)?;
    let updated = auth::assertion(&cfg, ch, creds, json)?;
    db.execute(
        "UPDATE credentials SET value=?2 WHERE id=?1",
        params![
            updated.id.0,
            serde_json::to_string(&updated).map_err(|_| Error::Storage)?
        ],
    )
    .map_err(|_| Error::Storage)?;
    Ok(())
}
#[init]
fn initialize(config: Config) {
    if config.owner == Principal::anonymous()
        || config.owner == Principal::management_canister()
        || config.rp_id != "localhost"
        || config.origin != "http://localhost:5173"
        || config.key_name != "test_key_1"
        || config.minimum_cycles < 100_000_000_000
    {
        ic_cdk::trap("Invalid local configuration")
    }
    runtime::initialize();
    transaction(|db| store::save(db, "config", &config))
        .unwrap_or_else(|_| ic_cdk::trap("Storage initialization failed"));
}
#[post_upgrade]
fn upgrade() {
    runtime::initialize();
    transaction(|db| {
        store::config(db)?;
        Ok(())
    })
    .unwrap_or_else(|_| ic_cdk::trap("Configuration missing"));
}
#[update]
fn reserve_vault(request: Reserve) -> Result<Header> {
    transaction(|db| store::reserve(db, caller(), request, now()))
}
#[update]
fn get_vault_header(vault: Id) -> Result<Header> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::active(db, &vault)
    })
}
#[update]
fn list_vaults() -> Result<Vec<Header>> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::list(db)
    })
}
#[update]
fn list_credentials() -> Result<Vec<CredentialInfo>> {
    transaction(|db| {
        store::authorize(db, caller())?;
        Ok(credentials(db)?
            .into_iter()
            .map(|c| CredentialInfo { id: c.id.0 })
            .collect())
    })
}

#[update]
async fn begin_unlock(request: BeginUnlock) -> Result<Challenge> {
    let token = transaction(|db| {
        store::authorize(db, caller())?;
        let h = live(db, &request.vault, now())?;
        epoch(&h, request.epoch)?;
        if request.transport.len() != 48 || request.target.len() > 1024 {
            return Err(Error::InvalidInput);
        }
        if request.purpose == Purpose::Unlock {
            if !valid_transport(&request.transport) {
                return Err(Error::InvalidInput);
            }
        } else if request.transport != vec![0; 48] {
            return Err(Error::InvalidInput);
        }
        if matches!(request.purpose, Purpose::Unlock) && h.state != VaultState::Active {
            return Err(Error::Conflict);
        }
        if matches!(request.purpose, Purpose::Activate) && h.state == VaultState::Active {
            return Err(Error::Conflict);
        }
        if matches!(
            request.purpose,
            Purpose::AddCredential | Purpose::RemoveCredential
        ) && h.state != VaultState::Active
        {
            return Err(Error::Conflict);
        }
        let creds = credentials(db)?;
        if creds.is_empty() && request.purpose != Purpose::Activate {
            return Err(Error::InvalidProof);
        }
        let mut c = control(db)?;
        let t = now();
        if c.random.as_ref().is_some_and(|f| f.expires > t)
            || c.ceremony
                .as_ref()
                .is_some_and(|ch| ch.challenge.expires > t)
        {
            return Err(Error::Busy);
        }
        if c.day != t / DAY {
            c.day = t / DAY;
            c.derives = 0;
            c.challenges = 0
        }
        if c.challenges >= 100 {
            return Err(Error::QuotaExceeded);
        }
        c.challenges += 1;
        c.serial = c.serial.checked_add(1).ok_or(Error::QuotaExceeded)?;
        let token = c.serial;
        c.random = Some(Flight {
            token,
            vault: request.vault.clone(),
            epoch: h.epoch,
            state: h.state,
            expires: t + 120,
        });
        store::save(db, "control", &c)?;
        Ok(token)
    })?;
    let random = management::raw_rand().await.map_err(|_| Error::KeyService);
    transaction(|db| {
        store::authorize(db, caller())?;
        let mut c = control(db)?;
        let f = c
            .random
            .take()
            .filter(|f| f.token == token)
            .ok_or(Error::Expired)?;
        if f.expires <= now() {
            return Err(Error::Expired);
        }
        let h = live(db, &f.vault, now())?;
        epoch(&h, f.epoch)?;
        if h.state != f.state {
            return Err(Error::Conflict);
        }
        let bytes = random?;
        if bytes.len() != 32 {
            return Err(Error::KeyService);
        }
        let creds = credentials(db)?;
        let ch = Challenge {
            bytes,
            expires: now() + 120,
            registration: creds.is_empty()
                || (request.purpose == Purpose::AddCredential && request.target.is_empty()),
            credential_ids: creds.into_iter().map(|x| x.id.0).collect(),
        };
        c.ceremony = Some(Ceremony {
            request,
            challenge: ch.clone(),
            created: now(),
        });
        store::save(db, "control", &c)?;
        Ok(ch)
    })
}
#[update]
async fn derive_vault_key(request: Derive) -> Result<KeyReply> {
    let (cfg, token) = transaction(|db| {
        let cfg = store::authorize(db, caller())?;
        if !valid_transport(&request.transport)
            || request.assertion.as_ref().is_some_and(|s| s.len() > 65536)
        {
            return Err(Error::InvalidInput);
        }
        let h = live(db, &request.vault, now())?;
        epoch(&h, request.epoch)?;
        if h.state == VaultState::Active {
            let ch = ceremony(db, &request.vault, Purpose::Unlock, &request.transport, &[])?;
            assert_proof(
                db,
                &ch,
                request.assertion.as_deref().ok_or(Error::InvalidProof)?,
            )?;
        }
        let mut c = control(db)?;
        let t = now();
        if c.derive.as_ref().is_some_and(|f| f.expires > t) {
            return Err(Error::Busy);
        }
        if c.day != t / DAY {
            c.day = t / DAY;
            c.derives = 0;
            c.challenges = 0
        }
        if c.derives >= 100 {
            return Err(Error::QuotaExceeded);
        }
        if ic_cdk::api::canister_cycle_balance() < cfg.minimum_cycles as u128 + 30_000_000_000 {
            return Err(Error::QuotaExceeded);
        }
        c.derives += 1;
        c.serial = c.serial.checked_add(1).ok_or(Error::QuotaExceeded)?;
        let token = c.serial;
        c.derive = Some(Flight {
            token,
            vault: h.id,
            epoch: h.epoch,
            state: h.state,
            expires: t + 120,
        });
        store::save(db, "control", &c)?;
        Ok((cfg, token))
    })?;
    let key_id = management::VetKDKeyId {
        curve: management::VetKDCurve::Bls12_381_G2,
        name: cfg.key_name,
    };
    let result = async {
        let public = management::vetkd_public_key(&management::VetKDPublicKeyArgs {
            canister_id: None,
            context: CONTEXT.to_vec(),
            key_id: key_id.clone(),
        })
        .await
        .map_err(|_| Error::KeyService)?;
        let key = management::vetkd_derive_key(&management::VetKDDeriveKeyArgs {
            input: key_input(&request.vault, request.epoch)?,
            context: CONTEXT.to_vec(),
            transport_public_key: request.transport,
            key_id,
        })
        .await
        .map_err(|_| Error::KeyService)?;
        ic_vetkeys::DerivedPublicKey::deserialize(&public.public_key)
            .map_err(|_| Error::KeyService)?;
        ic_vetkeys::EncryptedVetKey::deserialize(&key.encrypted_key)
            .map_err(|_| Error::KeyService)?;
        Ok(KeyReply {
            encrypted_key: key.encrypted_key,
            public_key: public.public_key,
        })
    }
    .await;
    // Clear only this flight. Never roll back failure accounting or overwrite a newer request.
    transaction(|db| {
        store::authorize(db, caller())?;
        let mut c = control(db)?;
        let f = c
            .derive
            .take()
            .filter(|f| f.token == token)
            .ok_or(Error::Expired)?;
        store::save(db, "control", &c)?;
        if f.expires <= now() {
            return Ok(Err(Error::Expired));
        }
        match live(db, &f.vault, now()) {
            Ok(h) if h.epoch == f.epoch && h.state == f.state => Ok(result),
            _ => Ok(Err(Error::Expired)),
        }
    })?
}
#[update]
fn activate_vault(request: Activate) -> Result<Header> {
    activate_inner(request, false)
}
fn activate_inner(request: Activate, restoring: bool) -> Result<Header> {
    transaction(|db| {
        let cfg = store::authorize(db, caller())?;
        id(&request.operation)?;
        envelope(&request.normal)?;
        envelope(&request.recovery)?;
        if request.normal.nonce == request.recovery.nonce {
            return Err(Error::InvalidInput);
        }
        let digest = hash(&request)?;
        let prior: Option<(Vec<u8>, String)> = db
            .query_row(
                "SELECT digest,result FROM receipts WHERE operation=?1",
                params![request.operation],
                |r| {
                    Ok((
                        kinic_sqlite_compat::row_get(r, 0)?,
                        kinic_sqlite_compat::row_get(r, 1)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| Error::Storage)?;
        if let Some((d, result)) = prior {
            if d != digest {
                return Err(Error::Conflict);
            }
            return serde_json::from_str(&result).map_err(|_| Error::Storage);
        }
        let mut h = store::pending(db, &request.vault, now())?;
        if restoring {
            if h.state != VaultState::Restoring {
                return Err(Error::Conflict);
            }
            store::restore::ready(db, &request.vault, now())?;
            if h.recovery.as_ref() != Some(&request.recovery) {
                return Err(Error::InvalidInput);
            }
        } else if h.state != VaultState::Pending {
            return Err(Error::Conflict);
        }
        let ch = ceremony(db, &request.vault, Purpose::Activate, &vec![0; 48], &[])?;
        if credentials(db)?.is_empty() {
            let credential = auth::registration(
                &cfg,
                &ch,
                request.registration.as_deref().ok_or(Error::InvalidProof)?,
            )?;
            insert_credential(db, &credential)?;
        } else {
            assert_proof(
                db,
                &ch,
                request.assertion.as_deref().ok_or(Error::InvalidProof)?,
            )?;
        }
        h.state = VaultState::Active;
        h.normal = Some(request.normal);
        h.recovery = Some(request.recovery);
        if restoring {
            store::restore::committed(db, &h.id)?;
        } else {
            h.sequence = 1;
        }
        store::put_header(db, &h)?;
        db.execute("UPDATE vaults SET expires=0 WHERE id=?1", params![h.id])
            .map_err(|_| Error::Storage)?;
        let result = serde_json::to_string(&h).map_err(|_| Error::Storage)?;
        db.execute(
            "INSERT INTO receipts(operation,digest,result,expires) VALUES(?1,?2,?3,?4)",
            params![request.operation, digest, result, (now() + DAY) as i64],
        )
        .map_err(|_| Error::Storage)?;
        Ok(h)
    })
}
#[update]
fn manage_unlock_credential(request: ManageCredential) -> Result<()> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::active(db, &request.vault)?;
        let purpose = if request.remove.is_some() {
            Purpose::RemoveCredential
        } else {
            Purpose::AddCredential
        };
        let target = if let Some(ref id) = request.remove {
            id.clone()
        } else {
            hash(&request.registration)?
        };
        let ch = ceremony(db, &request.vault, purpose, &vec![0; 48], &target)?;
        assert_proof(db, &ch, &request.assertion)?;
        if let Some(id) = request.remove {
            let creds = credentials(db)?;
            if creds.len() <= 1 {
                return Err(Error::Conflict);
            }
            if !creds.iter().any(|c| c.id.0 == id) {
                return Err(Error::NotFound);
            }
            db.execute("DELETE FROM credentials WHERE id=?1", params![id])
                .map_err(|_| Error::Storage)?;
        } else {
            // Registration uses the same bound ceremony challenge; the existing credential signs its digest.
            let candidate: Candidate = store::load(db, "candidate")?.ok_or(Error::InvalidProof)?;
            if candidate.vault != request.vault
                || candidate.digest != target
                || candidate.expires <= now()
            {
                return Err(Error::InvalidProof);
            }
            insert_credential(db, &candidate.credential)?;
            db.execute("DELETE FROM settings WHERE key='candidate'", params![])
                .map_err(|_| Error::Storage)?;
        }
        Ok(())
    })
}
#[update]
fn prepare_unlock_credential(vault: Id, registration: String) -> Result<Vec<u8>> {
    transaction(|db| {
        let cfg = store::authorize(db, caller())?;
        store::active(db, &vault)?;
        let ch = ceremony(db, &vault, Purpose::AddCredential, &vec![0; 48], &[])?;
        let credential = auth::registration(&cfg, &ch, &registration)?;
        let digest = hash(&Some(registration))?;
        store::save(
            db,
            "candidate",
            &Candidate {
                vault,
                credential,
                digest: digest.clone(),
                expires: now() + 120,
            },
        )?;
        Ok(digest)
    })
}
#[update]
fn begin_revision(request: BeginRevision) -> Result<Upload> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::content::gc(db, now())?;
        store::content::begin(db, request, now())
    })
}
#[update]
fn put_chunk(upload: Id, index: u32, data: Vec<u8>) -> Result<()> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::content::put(db, &upload, index, &data, now())
    })
}
#[update]
fn commit_revision(upload: Id) -> Result<Revision> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::content::commit(db, &upload, now())
    })
}
#[update]
fn get_manifest(vault: Id, object: Id, revision: u64) -> Result<Revision> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::content::manifest(db, &vault, &object, revision)
    })
}
#[ic_cdk::query]
fn get_chunk(vault: Id, object: Id, revision: u64, index: u32) -> Result<Vec<u8>> {
    runtime::read(|db| {
        store::authorize(db, caller())?;
        store::content::chunk(db, &vault, &object, revision, index)
    })
}
#[update]
fn list_history(vault: Id, object: Id, before: u64) -> Result<RevisionPage> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::content::history(db, &vault, &object, before)
    })
}
#[update]
fn list_objects(vault: Id, after: Id) -> Result<ObjectPage> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::content::objects(db, &vault, &after)
    })
}
#[update]
fn get_quota(vault: Id) -> Result<Quota> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::content::quota(db, &vault)
    })
}
#[update]
fn delete_object(vault: Id, object: Id, expected_revision: u64, operation: Id) -> Result<Revision> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::content::delete(db, &vault, &object, expected_revision, &operation, now())
    })
}
#[update]
fn purge_object(vault: Id, object: Id) -> Result<()> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::content::purge(db, &vault, &object, now())
    })
}
#[update]
fn collect_garbage() -> Result<u64> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::content::gc(db, now())
    })
}
#[update]
fn begin_export(vault: Id, export: Id) -> Result<Export> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::content::begin_export(db, &vault, &export, now())
    })
}
#[update]
fn export_index(export: Id, after: u64) -> Result<ExportPage> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::content::export_index(db, &export, after, now())
    })
}
#[ic_cdk::query]
fn get_export_chunk(export: Id, object: Id, revision: u64, index: u32) -> Result<Vec<u8>> {
    runtime::read(|db| {
        store::authorize(db, caller())?;
        store::content::export_chunk(db, &export, &object, revision, index, now())
    })
}
#[update]
fn finish_export(export: Id, saved: bool) -> Result<Header> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::content::finish_export(db, &export, saved, now())
    })
}
#[update]
fn abort_export(export: Id) -> Result<Header> {
    finish_export(export, false)
}
#[update]
fn begin_restore(request: BeginRestore) -> Result<Header> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::restore::begin(db, request, now())
    })
}
#[update]
fn begin_restore_revision(vault: Id, revision: Revision) -> Result<()> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::restore::stage(db, &vault, revision, now())
    })
}
#[update]
fn put_restore_chunk(vault: Id, index: u32, data: Vec<u8>) -> Result<()> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::restore::put(db, &vault, index, &data, now())
    })
}
#[update]
fn commit_restore_revision(vault: Id, sequence: u64) -> Result<RestoreProgress> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::restore::finish_record(db, &vault, sequence, now())
    })
}
#[update]
fn commit_restore(request: Activate) -> Result<Header> {
    activate_inner(request, true)
}
#[update]
fn get_active_export() -> Result<Option<Export>> {
    transaction(|db| {
        store::authorize(db, caller())?;
        store::content::active_export(db, now())
    })
}
ic_cdk::export_candid!();
pub fn candid_interface() -> String {
    __export_service()
}
#[cfg(test)]
mod vectors {
    #[test]
    fn webcrypto_aes_gcm_vector() {
        use aes_gcm::{
            Aes256Gcm, KeyInit,
            aead::{Aead, Payload},
        };
        let v: serde_json::Value =
            serde_json::from_str(include_str!("../../../packages/crypto/test/vector.json"))
                .unwrap();
        let bytes = |k: &str| hex::decode(v[k].as_str().unwrap()).unwrap();
        let key = bytes("key");
        let nonce = aes_gcm::Nonce::from(<[u8; 12]>::try_from(bytes("nonce")).unwrap());
        let aad = bytes("aad");
        let plaintext = bytes("plaintext");
        let expected = bytes("ciphertext");
        let c = Aes256Gcm::new_from_slice(&key).unwrap();
        assert_eq!(
            c.encrypt(
                &nonce,
                Payload {
                    msg: &plaintext,
                    aad: &aad
                }
            )
            .unwrap(),
            expected
        );
    }
}
