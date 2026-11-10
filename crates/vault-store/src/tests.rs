use super::*;
fn fixture() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(&[SCHEMA, CONTENT_SCHEMA, RESTORE_SCHEMA].concat())
        .unwrap();
    save(
        &db,
        "config",
        &Config {
            owner: Principal::self_authenticating([1; 32]),
            origin: "http://localhost:5173".into(),
            rp_id: "localhost".into(),
            key_name: "test_key_1".into(),
            minimum_cycles: 100_000_000_000,
        },
    )
    .unwrap();
    db
}
#[test]
fn reserve_checks_owner_replay_expiry_and_limits() {
    let db = fixture();
    let owner = config(&db).unwrap().owner;
    let r = Reserve {
        vault: vec![1; 16],
        operation: vec![2; 16],
    };
    assert_eq!(
        reserve(&db, Principal::anonymous(), r.clone(), 1).unwrap_err(),
        Error::Unauthorized
    );
    reserve(&db, owner, r.clone(), 1).unwrap();
    assert_eq!(reserve(&db, owner, r.clone(), 1).unwrap().id, r.vault);
    assert_eq!(
        reserve(
            &db,
            owner,
            Reserve {
                vault: vec![3; 16],
                operation: vec![4; 16]
            },
            1
        )
        .unwrap_err(),
        Error::Busy
    );
    assert_eq!(reserve(&db, owner, r, DAY + 1).unwrap_err(), Error::Expired);
}
#[test]
fn explicit_transaction_rolls_back_writes_on_application_error() {
    let mut db = fixture();
    {
        let tx = db.transaction().unwrap();
        reserve(
            &tx,
            config(&tx).unwrap().owner,
            Reserve {
                vault: vec![1; 16],
                operation: vec![2; 16],
            },
            1,
        )
        .unwrap(); /* drop, no commit */
    }
    assert_eq!(header(&db, &[1; 16]).unwrap_err(), Error::NotFound);
}
#[test]
fn upload_is_atomic_bounded_idempotent_and_snapshot_retains_history() {
    use crate::content::*;
    use sha2::{Digest, Sha256};
    let mut db = fixture();

    let owner = config(&db).unwrap().owner;
    let vault = vec![1; 16];
    let object = vec![2; 16];
    let mut h = reserve(
        &db,
        owner,
        Reserve {
            vault: vault.clone(),
            operation: vec![3; 16],
        },
        1,
    )
    .unwrap();
    h.state = VaultState::Active;
    h.sequence = 1;
    put_header(&db, &h).unwrap();
    db.execute("UPDATE vaults SET expires=0", params![])
        .unwrap();
    let bytes = vec![7; 17];
    let mut first = None;
    for i in 0..12 {
        let operation = vec![(10 + i) as u8; 16];
        let request = BeginRevision {
            vault: vault.clone(),
            object: object.clone(),
            expected_revision: i,
            operation: operation.clone(),
            plain_size: 1,
            manifest: vec![99],
            chunk_hashes: vec![Sha256::digest(&bytes).to_vec()],
        };
        {
            let tx = db.transaction().unwrap();
            begin(&tx, request.clone(), 1).unwrap();
            tx.commit().unwrap();
        }
        assert!(commit(&db, &operation, 1).is_err());
        put(&db, &operation, 0, &bytes, 1).unwrap();
        put(&db, &operation, 0, &bytes, 1).unwrap();
        assert!(put(&db, &operation, 0, &[8; 17], 1).is_err());
        {
            let tx = db.transaction().unwrap();
            let r = commit(&tx, &operation, 1).unwrap();
            assert_eq!(r.revision, i + 1);
            tx.commit().unwrap();
        }
        assert_eq!(commit(&db, &operation, 1).unwrap().revision, i + 1);
        assert_eq!(begin(&db, request, 1).unwrap().expires, 0);
        if i == 0 {
            first = Some(begin_export(&db, &vault, &[100; 16], 1).unwrap());
        }
    }
    assert_eq!(
        history(&db, &vault, &object, u64::MAX)
            .unwrap()
            .entries
            .len(),
        10
    );
    let e = first.unwrap();
    assert_eq!(export_index(&db, &e.id, 0, 1).unwrap().entries.len(), 1);
    assert_eq!(export_chunk(&db, &e.id, &object, 1, 0, 1).unwrap(), bytes);
    assert_eq!(
        purge(&db, &vault, &object, 1).unwrap_err(),
        Error::ExportInProgress
    );
    assert_eq!(gc(&db, 1).unwrap(), 0);
    let h = finish_export(&db, &e.id, true, 2).unwrap();
    assert!(h.sequence > h.backup_sequence.unwrap());
    assert_eq!(
        finish_export(&db, &e.id, true, 3).unwrap().backup_at,
        Some(2)
    );
    assert_eq!(gc(&db, 3).unwrap(), 1);
    let mut over = BeginRevision {
        vault: vault.clone(),
        object: vec![9; 16],
        expected_revision: 0,
        operation: vec![9; 16],
        plain_size: FILE_MAX + 1,
        manifest: vec![99],
        chunk_hashes: vec![vec![0; 32]],
    };
    assert_eq!(
        begin(&db, over.clone(), 3).unwrap_err(),
        Error::InvalidInput
    );
    over.plain_size = 1;
    over.chunk_hashes = vec![Sha256::digest(&bytes).to_vec()];
    over.expected_revision = 1;
    assert_eq!(begin(&db, over, 3).unwrap_err(), Error::Conflict);
}
#[test]
fn restore_preserves_ciphertext_and_requires_complete_authenticated_set() {
    use crate::{content, restore};
    use sha2::{Digest, Sha256};
    let db = fixture();
    let owner = config(&db).unwrap().owner;
    let vault = vec![11; 16];
    let e = Envelope {
        version: 1,
        nonce: vec![1; 12],
        ciphertext: vec![2; 48],
    };
    let header = Header {
        id: vault.clone(),
        epoch: 0,
        state: VaultState::Active,
        normal: Some(e.clone()),
        recovery: Some(e),
        sequence: 7,
        backup_sequence: Some(7),
        backup_at: Some(1),
        key_name: "old-source-key".into(),
    };
    let data = vec![7; 17];
    let revision = Revision {
        vault: vault.clone(),
        object: vec![12; 16],
        revision: 4,
        plain_size: 1,
        manifest: vec![8],
        chunk_hashes: vec![Sha256::digest(&data).to_vec()],
        deleted: false,
        sequence: 7,
    };
    let root = Sha256::digest([vec![0; 32], restore::leaf(&revision)].concat()).to_vec();
    let h = restore::begin(
        &db,
        BeginRestore {
            header: header.clone(),
            operation: vec![13; 16],
            count: 1,
            root,
            reserved_bytes: 30000,
        },
        1,
    )
    .unwrap();
    assert_eq!(h.state, VaultState::Restoring);
    assert_eq!(h.backup_at, None);
    assert!(h.normal.is_none());
    assert_eq!(h.key_name, "test_key_1");
    assert!(active(&db, &vault).is_err());
    assert!(restore::ready(&db, &vault, 1).is_err());
    db.execute_batch("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO revisions SELECT x'ff', x'ff', x, x, NULL, 0, x'', '[]', 1, 4096 FROM n").unwrap();
    assert_eq!(
        restore::stage(&db, &vault, revision.clone(), 1).unwrap_err(),
        Error::QuotaExceeded
    );
    db.execute("DELETE FROM revisions WHERE vault=x'ff'", params![])
        .unwrap();
    restore::stage(&db, &vault, revision.clone(), 1).unwrap();
    assert!(restore::finish_record(&db, &vault, 7, 1).is_err());
    assert!(restore::put(&db, &vault, 0, &[9; 17], 1).is_err());
    restore::put(&db, &vault, 0, &data, 1).unwrap();
    db.execute_batch("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO objects SELECT x'ff', CAST(x AS BLOB), 1 FROM n").unwrap();
    assert_eq!(
        restore::finish_record(&db, &vault, 7, 1).unwrap_err(),
        Error::QuotaExceeded
    );
    db.execute("DELETE FROM objects WHERE vault=x'ff'", params![])
        .unwrap();
    let p = restore::finish_record(&db, &vault, 7, 1).unwrap();
    assert_eq!(p.count, 1);
    assert_eq!(restore::finish_record(&db, &vault, 7, 1).unwrap().count, 1);
    restore::ready(&db, &vault, 1).unwrap();
    let mut h = super::header(&db, &vault).unwrap();
    h.state = VaultState::Active;
    h.normal = header.normal;
    put_header(&db, &h).unwrap();
    restore::committed(&db, &vault).unwrap();
    assert_eq!(
        content::chunk(&db, &vault, &revision.object, 4, 0).unwrap(),
        data
    );
    assert_eq!(
        content::manifest(&db, &vault, &revision.object, 4)
            .unwrap()
            .manifest,
        revision.manifest
    );
    assert_eq!(
        authorize(&db, Principal::self_authenticating([99; 32])).unwrap_err(),
        Error::Unauthorized
    );
    assert_eq!(authorize(&db, owner).unwrap().owner, owner);
}

fn active_fixture(db: &Connection) -> Vec<u8> {
    let v = vec![1; 16];
    let mut h = reserve(
        db,
        config(db).unwrap().owner,
        Reserve {
            vault: v.clone(),
            operation: vec![3; 16],
        },
        1,
    )
    .unwrap();
    h.state = VaultState::Active;
    put_header(db, &h).unwrap();
    db.execute("UPDATE vaults SET expires=0", params![])
        .unwrap();
    v
}
fn pending_revision(db: &Connection, v: &[u8], expected: u64, op: u8) {
    use sha2::{Digest, Sha256};
    let data = vec![7; 17];
    content::begin(
        db,
        BeginRevision {
            vault: v.to_vec(),
            object: vec![2; 16],
            expected_revision: expected,
            operation: vec![op; 16],
            plain_size: 1,
            manifest: vec![99],
            chunk_hashes: vec![Sha256::digest(&data).to_vec()],
        },
        1,
    )
    .unwrap();
    content::put(db, &[op; 16], 0, &data, 1).unwrap();
}
#[test]
fn purge_blocks_in_flight_upload_and_preserves_existing_content() {
    let db = fixture();
    let v = active_fixture(&db);
    pending_revision(&db, &v, 0, 10);
    content::commit(&db, &[10; 16], 1).unwrap();
    pending_revision(&db, &v, 1, 11);
    assert_eq!(
        content::purge(&db, &v, &[2; 16], 1).unwrap_err(),
        Error::Busy
    );
    assert_eq!(content::manifest(&db, &v, &[2; 16], 0).unwrap().revision, 1);
    content::commit(&db, &[11; 16], 1).unwrap();
    content::purge(&db, &v, &[2; 16], 1).unwrap();
    assert!(content::manifest(&db, &v, &[2; 16], 0).is_err());
}
#[test]
fn sequence_exhaustion_rejects_save_delete_and_purge_before_writes() {
    let db = fixture();
    let v = active_fixture(&db);
    pending_revision(&db, &v, 0, 10);
    content::commit(&db, &[10; 16], 1).unwrap();
    pending_revision(&db, &v, 1, 11);
    let mut h = header(&db, &v).unwrap();
    h.sequence = i64::MAX as u64;
    put_header(&db, &h).unwrap();
    assert_eq!(
        content::commit(&db, &[11; 16], 1).unwrap_err(),
        Error::QuotaExceeded
    );
    assert_eq!(
        content::delete(&db, &v, &[2; 16], 1, &[12; 16], 1).unwrap_err(),
        Error::QuotaExceeded
    );
    // Expired upload no longer prevents purge, but sequence exhaustion still does.
    assert_eq!(
        content::purge(&db, &v, &[2; 16], DAY + 1).unwrap_err(),
        Error::QuotaExceeded
    );
    assert_eq!(content::manifest(&db, &v, &[2; 16], 0).unwrap().revision, 1);
    assert_eq!(header(&db, &v).unwrap().sequence, i64::MAX as u64);
}
#[test]
fn commit_rechecks_record_capacity_after_upload_was_reserved() {
    for objects in [false, true] {
        let db = fixture();
        let v = active_fixture(&db);
        pending_revision(&db, &v, 0, 10);
        if objects {
            db.execute_batch("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO objects SELECT x'ff', CAST(x AS BLOB), 1 FROM n").unwrap();
        } else {
            db.execute_batch("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO revisions SELECT x'ff', x'ff', x, x, NULL, 0, x'', '[]', 1, 4096 FROM n").unwrap();
        }
        assert_eq!(
            content::commit(&db, &[10; 16], 1).unwrap_err(),
            Error::QuotaExceeded
        );
        assert!(content::manifest(&db, &v, &[2; 16], 0).is_err());
        assert_eq!(header(&db, &v).unwrap().sequence, 0);
    }
}
