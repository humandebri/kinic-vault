use super::*;
use sha2::{Digest, Sha256};
const OVERHEAD: u64 = 4096;
const ROW_MAX: i64 = 10000;
fn db_error(_: sql::Error) -> Error {
    Error::Storage
}
fn num(db: &Connection, q: &str, vault: &[u8]) -> Result<u64> {
    let n: i64 = db
        .query_row(q, params![vault], |r| sql::row_get(r, 0))
        .map_err(db_error)?;
    Ok(n as u64)
}
fn head(db: &Connection, v: &[u8], o: &[u8]) -> Result<u64> {
    Ok(db
        .query_row(
            "SELECT head FROM objects WHERE vault=?1 AND object=?2",
            params![v, o],
            |r| sql::row_get::<i64>(r, 0),
        )
        .optional()
        .map_err(db_error)?
        .unwrap_or(0) as u64)
}
// Recheck at the write boundary: reservations in other vaults may have committed.
pub(crate) fn check_object_capacity(db: &Connection, v: &[u8], o: &[u8]) -> Result<()> {
    let count: i64 = db
        .query_row("SELECT count(*) FROM objects", params![], |r| {
            sql::row_get(r, 0)
        })
        .map_err(db_error)?;
    if count >= ROW_MAX && head(db, v, o)? == 0 {
        return Err(Error::QuotaExceeded);
    }
    Ok(())
}
pub(crate) fn check_revision_capacity(db: &Connection) -> Result<()> {
    let count: i64 = db
        .query_row("SELECT count(*) FROM revisions", params![], |r| {
            sql::row_get(r, 0)
        })
        .map_err(db_error)?;
    if count >= ROW_MAX {
        return Err(Error::QuotaExceeded);
    }
    Ok(())
}
fn next_sequence(sequence: u64) -> Result<u64> {
    if sequence >= i64::MAX as u64 {
        return Err(Error::QuotaExceeded);
    }
    Ok(sequence + 1)
}
pub fn quota(db: &Connection, v: &[u8]) -> Result<Quota> {
    active(db, v)?;
    let current = num(
        db,
        "SELECT COALESCE(sum(r.plain_size),0) FROM revisions r JOIN objects o ON r.vault=o.vault AND r.object=o.object AND r.revision=o.head WHERE r.vault=?1 AND r.deleted=0",
        v,
    )?;
    let reserved:i64=db.query_row("SELECT (SELECT COALESCE(sum(reserved),0) FROM uploads)+(SELECT COALESCE(sum(reserved+length(pending)),0) FROM restores)",params![],|r|sql::row_get(r,0)).map_err(db_error)?;
    let reserved = reserved as u64;
    let charged = usage(db)?.saturating_sub(reserved);
    Ok(Quota {
        current,
        charged,
        reserved,
        limit: TOTAL_MAX,
    })
}
fn usage(db: &Connection) -> Result<u64> {
    let n:i64=db.query_row("SELECT 262144+(SELECT COALESCE(sum(charge),0) FROM revisions)+(SELECT COALESCE(sum(reserved),0) FROM uploads)+(SELECT COALESCE(sum(length(result)+length(digest)+4096),0) FROM receipts)+(SELECT count(*)*4096 FROM vaults)+(SELECT count(*)*4096 FROM objects)+(SELECT count(*)*4096 FROM exports)+(SELECT COALESCE(sum(reserved+length(pending)),0) FROM restores)",params![],|r|sql::row_get(r,0)).map_err(db_error)?;
    Ok(n as u64)
}
pub fn check_capacity(db: &Connection, extra: u64) -> Result<()> {
    if usage(db)?.checked_add(extra).ok_or(Error::QuotaExceeded)? > TOTAL_MAX {
        return Err(Error::QuotaExceeded);
    }
    Ok(())
}
fn receipt<T: DeserializeOwned>(
    db: &Connection,
    operation: &[u8],
    digest: &[u8],
) -> Result<Option<T>> {
    let prior: Option<(Vec<u8>, String)> = db
        .query_row(
            "SELECT digest,result FROM receipts WHERE operation=?1",
            params![operation],
            |r| Ok((sql::row_get(r, 0)?, sql::row_get(r, 1)?)),
        )
        .optional()
        .map_err(db_error)?;
    prior
        .map(|(d, s)| {
            if d != digest {
                return Err(Error::Conflict);
            }
            if s == "\"Expired\"" {
                return Err(Error::Expired);
            }
            serde_json::from_str(&s).map_err(|_| Error::Storage)
        })
        .transpose()
}
fn record<T: Serialize>(
    db: &Connection,
    operation: &[u8],
    digest: &[u8],
    result: &T,
    now: u64,
) -> Result<()> {
    let count: i64 = db
        .query_row("SELECT count(*) FROM receipts", params![], |r| {
            sql::row_get(r, 0)
        })
        .map_err(db_error)?;
    if count >= ROW_MAX {
        return Err(Error::QuotaExceeded);
    }
    let encoded = serde_json::to_string(result).map_err(|_| Error::Storage)?;
    check_capacity(db, OVERHEAD + encoded.len() as u64 + digest.len() as u64)?;
    db.execute(
        "INSERT INTO receipts VALUES(?1,?2,?3,?4)",
        params![
            operation,
            digest,
            serde_json::to_string(result).map_err(|_| Error::Storage)?,
            (now + DAY) as i64
        ],
    )
    .map_err(db_error)?;
    Ok(())
}
pub fn begin(db: &Connection, r: BeginRevision, now: u64) -> Result<Upload> {
    active(db, &r.vault)?;
    id(&r.object)?;
    id(&r.operation)?;
    if r.expected_revision >= i64::MAX as u64
        || r.plain_size > FILE_MAX
        || r.manifest.is_empty()
        || r.manifest.len() > 65536
        || r.chunk_hashes.len() != r.plain_size.div_ceil(1024 * 1024).max(1) as usize
        || r.chunk_hashes.iter().any(|h| h.len() != 32)
    {
        return Err(Error::InvalidInput);
    }
    let raw = serde_json::to_string(&r).map_err(|_| Error::Storage)?;
    let digest = Sha256::digest(raw.as_bytes()).to_vec();
    // A committed operation is never re-created as a new upload.
    if let Some(rev) = receipt::<Revision>(db, &r.operation, &digest)? {
        return Ok(Upload {
            id: r.operation,
            revision: rev.revision,
            expires: 0,
        });
    }
    let prior: Option<(Vec<u8>, i64)> = db
        .query_row(
            "SELECT digest,expires FROM uploads WHERE id=?1",
            params![r.operation],
            |row| Ok((sql::row_get(row, 0)?, sql::row_get(row, 1)?)),
        )
        .optional()
        .map_err(db_error)?;
    if let Some((d, e)) = prior {
        if d != digest {
            return Err(Error::Conflict);
        }
        if e as u64 <= now {
            return Err(Error::Expired);
        }
        return Ok(Upload {
            id: r.operation,
            revision: r.expected_revision + 1,
            expires: e as u64,
        });
    }
    check_object_capacity(db, &r.vault, &r.object)?;
    if head(db, &r.vault, &r.object)? != r.expected_revision {
        return Err(Error::Conflict);
    }
    check_revision_capacity(db)?;
    let existing: Option<i64> = db
        .query_row(
            "SELECT expires FROM uploads WHERE vault=?1",
            params![r.vault],
            |row| sql::row_get(row, 0),
        )
        .optional()
        .map_err(db_error)?;
    if existing.is_some() {
        return Err(Error::Busy);
    }
    let q = quota(db, &r.vault)?;
    let old = if r.expected_revision > 0 {
        manifest(db, &r.vault, &r.object, r.expected_revision)?.plain_size
    } else {
        0
    };
    if q.current.saturating_sub(old) + r.plain_size > VAULT_MAX {
        return Err(Error::QuotaExceeded);
    }
    let reserved = r.plain_size
        + r.chunk_hashes.len() as u64 * (16 + OVERHEAD)
        + raw.len() as u64 * 2
        + OVERHEAD * 3;
    check_capacity(db, reserved)?;
    db.execute(
        "INSERT INTO uploads VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            r.operation,
            r.vault,
            r.object,
            r.expected_revision as i64,
            (now + DAY) as i64,
            digest,
            raw,
            reserved as i64
        ],
    )
    .map_err(db_error)?;
    Ok(Upload {
        id: r.operation,
        revision: r.expected_revision + 1,
        expires: now + DAY,
    })
}
fn upload(db: &Connection, id: &[u8], now: u64) -> Result<(BeginRevision, Vec<u8>, u64)> {
    vault_types::id(id)?;
    let (raw, d, e): (String, Vec<u8>, i64) = db
        .query_row(
            "SELECT request,digest,expires FROM uploads WHERE id=?1",
            params![id],
            |row| {
                Ok((
                    sql::row_get(row, 0)?,
                    sql::row_get(row, 1)?,
                    sql::row_get(row, 2)?,
                ))
            },
        )
        .optional()
        .map_err(db_error)?
        .ok_or(Error::NotFound)?;
    if e as u64 <= now {
        return Err(Error::Expired);
    }
    let r: BeginRevision = serde_json::from_str(&raw).map_err(|_| Error::Storage)?;
    active(db, &r.vault)?;
    Ok((r, d, e as u64))
}
pub fn put(db: &Connection, id: &[u8], index: u32, bytes: &[u8], now: u64) -> Result<()> {
    let (r, _, _) = upload(db, id, now)?;
    let idx = index as usize;
    if idx >= r.chunk_hashes.len() || bytes.len() > CHUNK_MAX {
        return Err(Error::InvalidInput);
    }
    let expected = (r
        .plain_size
        .saturating_sub(idx as u64 * 1024 * 1024)
        .min(1024 * 1024)
        + 16) as usize;
    if bytes.len() != expected || &Sha256::digest(bytes)[..] != r.chunk_hashes[idx] {
        return Err(Error::InvalidInput);
    }
    let old: Option<Vec<u8>> = db
        .query_row(
            "SELECT data FROM chunks WHERE upload=?1 AND idx=?2",
            params![id, index as i64],
            |row| sql::row_get(row, 0),
        )
        .optional()
        .map_err(db_error)?;
    if let Some(old) = old {
        if old == bytes {
            return Ok(());
        }
        return Err(Error::Conflict);
    }
    db.execute(
        "INSERT INTO chunks VALUES(?1,?2,?3)",
        params![id, index as i64, bytes],
    )
    .map_err(db_error)?;
    Ok(())
}
pub fn commit(db: &Connection, id: &[u8], now: u64) -> Result<Revision> {
    vault_types::id(id)?;
    // Idempotent commit returns the original revision even if its head subsequently advances.
    let prior: Option<String> = db
        .query_row(
            "SELECT result FROM receipts WHERE operation=?1",
            params![id],
            |r| sql::row_get(r, 0),
        )
        .optional()
        .map_err(db_error)?;
    if let Some(raw) = prior {
        if raw == "\"Expired\"" {
            return Err(Error::Expired);
        }
        return serde_json::from_str(&raw).map_err(|_| Error::Conflict);
    }
    let (r, d, _) = upload(db, id, now)?;
    check_object_capacity(db, &r.vault, &r.object)?;
    check_revision_capacity(db)?;
    if head(db, &r.vault, &r.object)? != r.expected_revision {
        return Err(Error::Conflict);
    }
    let n: i64 = db
        .query_row(
            "SELECT count(*) FROM chunks WHERE upload=?1",
            params![id],
            |row| sql::row_get(row, 0),
        )
        .map_err(db_error)?;
    if n as usize != r.chunk_hashes.len() {
        return Err(Error::Conflict);
    }
    let mut h = active(db, &r.vault)?;
    h.sequence = next_sequence(h.sequence)?;
    let rev = Revision {
        vault: r.vault.clone(),
        object: r.object.clone(),
        revision: r.expected_revision + 1,
        plain_size: r.plain_size,
        manifest: r.manifest,
        chunk_hashes: r.chunk_hashes,
        deleted: false,
        sequence: h.sequence,
    };
    let hashes = serde_json::to_string(&rev.chunk_hashes).map_err(|_| Error::Storage)?;
    let charge = rev.plain_size
        + rev.chunk_hashes.len() as u64 * (16 + OVERHEAD)
        + rev.manifest.len() as u64
        + hashes.len() as u64
        + OVERHEAD;
    db.execute(
        "INSERT INTO revisions VALUES(?1,?2,?3,?4,NULL,?5,?6,?7,0,?8)",
        params![
            rev.vault,
            rev.object,
            rev.revision as i64,
            rev.sequence as i64,
            rev.plain_size as i64,
            rev.manifest,
            hashes,
            charge as i64
        ],
    )
    .map_err(db_error)?;
    db.execute(
        "INSERT INTO revision_chunks SELECT ?1,?2,?3,idx,data FROM chunks WHERE upload=?4",
        params![rev.vault, rev.object, rev.revision as i64, id],
    )
    .map_err(db_error)?;
    db.execute("INSERT INTO objects VALUES(?1,?2,?3) ON CONFLICT(vault,object) DO UPDATE SET head=excluded.head",params![rev.vault,rev.object,rev.revision as i64]).map_err(db_error)?;
    db.execute("UPDATE revisions SET retired=?3 WHERE vault=?1 AND object=?2 AND revision<=?4 AND retired IS NULL",params![rev.vault,rev.object,rev.sequence as i64,rev.revision.saturating_sub(10) as i64]).map_err(db_error)?;
    db.execute("DELETE FROM chunks WHERE upload=?1", params![id])
        .map_err(db_error)?;
    db.execute("DELETE FROM uploads WHERE id=?1", params![id])
        .map_err(db_error)?;
    put_header(db, &h)?;
    record(db, id, &d, &rev, now)?;
    Ok(rev)
}
fn row(r: &sql::Row<'_>) -> sql::Result<Revision> {
    let hashes: String = sql::row_get(r, 5)?;
    let hashes = serde_json::from_str(&hashes).map_err(|_| sql::invalid_query())?;
    Ok(Revision {
        vault: sql::row_get(r, 0)?,
        object: sql::row_get(r, 1)?,
        revision: sql::row_get::<i64>(r, 2)? as u64,
        plain_size: sql::row_get::<i64>(r, 3)? as u64,
        manifest: sql::row_get(r, 4)?,
        chunk_hashes: hashes,
        deleted: sql::row_get::<i64>(r, 6)? != 0,
        sequence: sql::row_get::<i64>(r, 7)? as u64,
    })
}
const COLS: &str = "r.vault,r.object,r.revision,r.plain_size,r.manifest,r.hashes,r.deleted,r.born";
pub fn manifest(db: &Connection, v: &[u8], o: &[u8], revision: u64) -> Result<Revision> {
    active(db, v)?;
    id(o)?;
    let rev = if revision == 0 {
        head(db, v, o)?
    } else {
        revision
    };
    if rev > i64::MAX as u64 {
        return Err(Error::InvalidInput);
    }
    db.query_row(&format!("SELECT {COLS} FROM revisions r WHERE r.vault=?1 AND r.object=?2 AND r.revision=?3 AND r.retired IS NULL"),params![v,o,rev as i64],row).optional().map_err(db_error)?.ok_or(Error::NotFound)
}
pub fn chunk(db: &Connection, v: &[u8], o: &[u8], revision: u64, index: u32) -> Result<Vec<u8>> {
    let m = manifest(db, v, o, revision)?;
    if index as usize >= m.chunk_hashes.len() {
        return Err(Error::InvalidInput);
    }
    db.query_row(
        "SELECT data FROM revision_chunks WHERE vault=?1 AND object=?2 AND revision=?3 AND idx=?4",
        params![v, o, m.revision as i64, index as i64],
        |r| sql::row_get(r, 0),
    )
    .optional()
    .map_err(db_error)?
    .ok_or(Error::NotFound)
}
pub fn history(db: &Connection, v: &[u8], o: &[u8], before: u64) -> Result<RevisionPage> {
    active(db, v)?;
    id(o)?;
    let mut s=db.prepare(&format!("SELECT {COLS} FROM revisions r WHERE r.vault=?1 AND r.object=?2 AND r.revision<?3 AND r.retired IS NULL ORDER BY r.revision DESC LIMIT 11")).map_err(db_error)?;
    let entries = sql::query_map(
        &mut s,
        params![v, o, before.min(i64::MAX as u64) as i64],
        row,
    )
    .map_err(db_error)?;
    let mut bytes = 0;
    let mut page = Vec::new();
    let mut more = false;
    for e in entries {
        let size = e.manifest.len() + e.chunk_hashes.len() * 32 + 512;
        if page.len() >= 10 || bytes + size > 800_000 {
            more = true;
            break;
        }
        bytes += size;
        page.push(e)
    }
    let next = if more {
        page.last().map(|r| r.revision)
    } else {
        None
    };
    Ok(RevisionPage {
        entries: page,
        next,
    })
}
pub fn objects(db: &Connection, v: &[u8], after: &[u8]) -> Result<ObjectPage> {
    active(db, v)?;
    if !after.is_empty() {
        id(after)?
    }
    let mut s=db.prepare(&format!("SELECT {COLS} FROM revisions r JOIN objects o ON r.vault=o.vault AND r.object=o.object AND r.revision=o.head WHERE r.vault=?1 AND r.object>?2 ORDER BY r.object LIMIT 101")).map_err(db_error)?;
    let entries = sql::query_map(&mut s, params![v, after], row).map_err(db_error)?;
    let mut page = Vec::new();
    let mut bytes = 0;
    let mut more = false;
    for e in entries {
        let size = e.manifest.len() + e.chunk_hashes.len() * 32 + 512;
        if page.len() >= 100 || bytes + size > 800_000 {
            more = true;
            break;
        }
        bytes += size;
        page.push(e)
    }
    let next = if more {
        page.last().map(|r| r.object.clone())
    } else {
        None
    };
    Ok(ObjectPage {
        entries: page,
        next,
    })
}
pub fn delete(
    db: &Connection,
    v: &[u8],
    o: &[u8],
    expected: u64,
    operation: &[u8],
    now: u64,
) -> Result<Revision> {
    active(db, v)?;
    id(operation)?;
    let d = Sha256::digest([b"delete".as_slice(), v, o, &expected.to_be_bytes()].concat());
    if let Some(r) = receipt(db, operation, &d)? {
        return Ok(r);
    }
    let old = manifest(db, v, o, 0)?;
    if old.revision != expected || old.deleted {
        return Err(Error::Conflict);
    }
    if expected >= i64::MAX as u64 {
        return Err(Error::QuotaExceeded);
    }
    check_revision_capacity(db)?;
    check_capacity(db, OVERHEAD * 2)?;
    let mut h = active(db, v)?;
    h.sequence = next_sequence(h.sequence)?;
    let r = Revision {
        vault: v.to_vec(),
        object: o.to_vec(),
        revision: expected + 1,
        plain_size: 0,
        manifest: vec![],
        chunk_hashes: vec![],
        deleted: true,
        sequence: h.sequence,
    };
    db.execute(
        "INSERT INTO revisions VALUES(?1,?2,?3,?4,NULL,0,x'', '[]',1,4096)",
        params![v, o, r.revision as i64, h.sequence as i64],
    )
    .map_err(db_error)?;
    db.execute(
        "UPDATE objects SET head=?3 WHERE vault=?1 AND object=?2",
        params![v, o, r.revision as i64],
    )
    .map_err(db_error)?;
    db.execute("UPDATE revisions SET retired=?3 WHERE vault=?1 AND object=?2 AND revision<=?4 AND retired IS NULL",params![v,o,h.sequence as i64,r.revision.saturating_sub(10) as i64]).map_err(db_error)?;
    put_header(db, &h)?;
    record(db, operation, &d, &r, now)?;
    Ok(r)
}
pub fn purge(db: &Connection, v: &[u8], o: &[u8], now: u64) -> Result<()> {
    let mut h = active(db, v)?;
    id(o)?;
    let n: i64 = db
        .query_row(
            "SELECT count(*) FROM exports WHERE vault=?1 AND state='Active' AND expires>?2",
            params![v, now as i64],
            |r| sql::row_get(r, 0),
        )
        .map_err(db_error)?;
    if n > 0 {
        return Err(Error::ExportInProgress);
    }
    let uploads: i64 = db
        .query_row(
            "SELECT count(*) FROM uploads WHERE vault=?1 AND object=?2 AND expires>?3",
            params![v, o, now as i64],
            |r| sql::row_get(r, 0),
        )
        .map_err(db_error)?;
    if uploads > 0 {
        return Err(Error::Busy);
    }
    h.sequence = next_sequence(h.sequence)?;
    db.execute(
        "DELETE FROM revision_chunks WHERE vault=?1 AND object=?2",
        params![v, o],
    )
    .map_err(db_error)?;
    db.execute(
        "DELETE FROM revisions WHERE vault=?1 AND object=?2",
        params![v, o],
    )
    .map_err(db_error)?;
    // Preserve head identity after purge so a stale expected_revision cannot recreate or collide with old AAD.
    put_header(db, &h)
}
pub fn gc(db: &Connection, now: u64) -> Result<u64> {
    // Strictly bounded work per call. Expired upload payloads are removed in separate calls if necessary.
    let mut stmt = db
        .prepare("SELECT id FROM uploads WHERE expires<=?1 LIMIT 1")
        .map_err(db_error)?;
    let ids: Vec<Vec<u8>> =
        sql::query_map(&mut stmt, params![now as i64], |r| sql::row_get(r, 0)).map_err(db_error)?;
    for id in ids {
        let digest: Vec<u8> = db
            .query_row("SELECT digest FROM uploads WHERE id=?1", params![id], |r| {
                sql::row_get(r, 0)
            })
            .map_err(db_error)?;
        db.execute("DELETE FROM chunks WHERE upload=?1", params![id])
            .map_err(db_error)?;
        db.execute("DELETE FROM uploads WHERE id=?1", params![id])
            .map_err(db_error)?;
        record(db, &id, &digest, &"Expired", now)?;
    }
    db.execute(
        "UPDATE exports SET state='Expired' WHERE state='Active' AND expires<=?1",
        params![now as i64],
    )
    .map_err(db_error)?;
    let mut stmt=db.prepare("SELECT r.vault,r.object,r.revision FROM revisions r WHERE (retired IS NOT NULL OR r.vault IN(SELECT vault FROM restores WHERE expires<=?1 AND vault IN(SELECT id FROM vaults WHERE expires>0))) AND NOT EXISTS(SELECT 1 FROM exports e WHERE e.vault=r.vault AND e.state='Active' AND e.expires>?1) LIMIT 1").map_err(db_error)?;
    let rows: Vec<(Vec<u8>, Vec<u8>, i64)> = sql::query_map(&mut stmt, params![now as i64], |r| {
        Ok((
            sql::row_get(r, 0)?,
            sql::row_get(r, 1)?,
            sql::row_get(r, 2)?,
        ))
    })
    .map_err(db_error)?;
    for (v, o, r) in &rows {
        db.execute(
            "DELETE FROM revision_chunks WHERE vault=?1 AND object=?2 AND revision=?3",
            params![v.as_slice(), o.as_slice(), *r],
        )
        .map_err(db_error)?;
        db.execute(
            "DELETE FROM revisions WHERE vault=?1 AND object=?2 AND revision=?3",
            params![v.as_slice(), o.as_slice(), *r],
        )
        .map_err(db_error)?;
    }
    db.execute("UPDATE restores SET reserved=0,pending='' WHERE vault IN(SELECT vault FROM restores WHERE expires<=?1 AND (reserved>0 OR pending!='') AND vault IN(SELECT id FROM vaults WHERE expires>0) LIMIT 1)",params![now as i64]).map_err(db_error)?;
    db.execute("DELETE FROM receipts WHERE operation IN(SELECT operation FROM receipts WHERE expires<=?1 LIMIT 100)",params![now as i64]).map_err(db_error)?;
    db.execute("DELETE FROM exports WHERE id IN(SELECT id FROM exports WHERE state!='Active' AND expires<=?1 LIMIT 100)",params![now as i64]).map_err(db_error)?;
    Ok(rows.len() as u64)
}
pub fn begin_export(db: &Connection, vault: &[u8], export: &[u8], now: u64) -> Result<Export> {
    let header = active(db, vault)?;
    id(export)?;
    let previous: Option<String> = db
        .query_row(
            "SELECT snapshot FROM exports WHERE id=?1",
            params![export],
            |r| sql::row_get(r, 0),
        )
        .optional()
        .map_err(db_error)?;
    if let Some(s) = previous {
        let e: Export = serde_json::from_str(&s).map_err(|_| Error::Storage)?;
        if e.vault != vault {
            return Err(Error::Conflict);
        }
        return get_export(db, export, now);
    }
    let n: i64 = db
        .query_row(
            "SELECT count(*) FROM exports WHERE state='Active' AND expires>?1",
            params![now as i64],
            |r| sql::row_get(r, 0),
        )
        .map_err(db_error)?;
    if n > 0 {
        return Err(Error::Busy);
    }
    let all: i64 = db
        .query_row("SELECT count(*) FROM exports", params![], |r| {
            sql::row_get(r, 0)
        })
        .map_err(db_error)?;
    if all >= 10000 {
        return Err(Error::QuotaExceeded);
    }
    check_capacity(db, OVERHEAD)?;
    let (record_count,chunk_count,plain_bytes):(i64,i64,i64)=db.query_row("SELECT count(*),COALESCE(sum(CASE WHEN deleted=1 THEN 0 WHEN plain_size=0 THEN 1 ELSE (plain_size+1048575)/1048576 END),0),COALESCE(sum(plain_size),0) FROM revisions WHERE vault=?1 AND born<=?2 AND (retired IS NULL OR retired>?2)",params![vault,header.sequence as i64],|r|Ok((sql::row_get(r,0)?,sql::row_get(r,1)?,sql::row_get(r,2)?))).map_err(db_error)?;
    let e = Export {
        record_count: record_count as u64,
        chunk_count: chunk_count as u64,
        plain_bytes: plain_bytes as u64,
        id: export.to_vec(),
        vault: vault.to_vec(),
        sequence: header.sequence,
        expires: now + DAY,
        state: "Active".into(),
        header,
    };
    db.execute(
        "INSERT INTO exports VALUES(?1,?2,?3,?4,'Active')",
        params![
            export,
            vault,
            serde_json::to_string(&e).map_err(|_| Error::Storage)?,
            e.expires as i64
        ],
    )
    .map_err(db_error)?;
    Ok(e)
}
pub fn get_export(db: &Connection, id: &[u8], now: u64) -> Result<Export> {
    vault_types::id(id)?;
    let (raw, state): (String, String) = db
        .query_row(
            "SELECT snapshot,state FROM exports WHERE id=?1",
            params![id],
            |r| Ok((sql::row_get(r, 0)?, sql::row_get(r, 1)?)),
        )
        .optional()
        .map_err(db_error)?
        .ok_or(Error::NotFound)?;
    let mut e: Export = serde_json::from_str(&raw).map_err(|_| Error::Storage)?;
    e.state = state;
    if e.state != "Active" {
        return Err(Error::Conflict);
    }
    if e.expires <= now {
        return Err(Error::Expired);
    }
    Ok(e)
}
pub fn export_index(db: &Connection, export: &[u8], after: u64, now: u64) -> Result<ExportPage> {
    let e = get_export(db, export, now)?;
    if after > i64::MAX as u64 {
        return Err(Error::InvalidInput);
    }
    let mut stmt=db.prepare(&format!("SELECT {COLS} FROM revisions r WHERE r.vault=?1 AND r.born<=?2 AND (r.retired IS NULL OR r.retired>?2) AND r.born>?3 ORDER BY r.born LIMIT 101")).map_err(db_error)?;
    let rows = sql::query_map(
        &mut stmt,
        params![e.vault, e.sequence as i64, after as i64],
        row,
    )
    .map_err(db_error)?;
    let mut entries = Vec::new();
    let mut bytes = 0;
    let mut more = false;
    for r in rows {
        let len = r.manifest.len() + r.chunk_hashes.len() * 32 + 512;
        if entries.len() >= 100 || bytes + len > 800_000 {
            more = true;
            break;
        }
        bytes += len;
        entries.push(r)
    }
    let next = if more {
        entries.last().map(|r| r.sequence)
    } else {
        None
    };
    Ok(ExportPage { entries, next })
}
pub fn export_chunk(
    db: &Connection,
    export: &[u8],
    object: &[u8],
    revision: u64,
    index: u32,
    now: u64,
) -> Result<Vec<u8>> {
    let e = get_export(db, export, now)?;
    id(object)?;
    if revision > i64::MAX as u64 || index > 10 {
        return Err(Error::InvalidInput);
    }
    let yes:Option<i64>=db.query_row("SELECT 1 FROM revisions WHERE vault=?1 AND object=?2 AND revision=?3 AND born<=?4 AND (retired IS NULL OR retired>?4)",params![e.vault,object,revision as i64,e.sequence as i64],|r|sql::row_get(r,0)).optional().map_err(db_error)?;
    if yes.is_none() {
        return Err(Error::NotFound);
    }
    db.query_row(
        "SELECT data FROM revision_chunks WHERE vault=?1 AND object=?2 AND revision=?3 AND idx=?4",
        params![e.vault, object, revision as i64, index as i64],
        |r| sql::row_get(r, 0),
    )
    .optional()
    .map_err(db_error)?
    .ok_or(Error::NotFound)
}
pub fn finish_export(db: &Connection, export: &[u8], saved: bool, now: u64) -> Result<Header> {
    id(export)?;
    let (raw, state): (String, String) = db
        .query_row(
            "SELECT snapshot,state FROM exports WHERE id=?1",
            params![export],
            |r| Ok((sql::row_get(r, 0)?, sql::row_get(r, 1)?)),
        )
        .optional()
        .map_err(db_error)?
        .ok_or(Error::NotFound)?;
    let e: Export = serde_json::from_str(&raw).map_err(|_| Error::Storage)?;
    if state == "Finished" && saved {
        return active(db, &e.vault);
    }
    if state == "Aborted" && !saved {
        return active(db, &e.vault);
    }
    if state != "Active" {
        return Err(Error::Conflict);
    }
    if e.expires <= now {
        return Err(Error::Expired);
    }
    let mut h = active(db, &e.vault)?;
    if saved {
        h.backup_sequence = Some(e.sequence);
        h.backup_at = Some(now);
        put_header(db, &h)?;
    }
    db.execute(
        "UPDATE exports SET state=?2 WHERE id=?1",
        params![export, if saved { "Finished" } else { "Aborted" }],
    )
    .map_err(db_error)?;
    Ok(h)
}
pub fn active_export(db: &Connection, now: u64) -> Result<Option<Export>> {
    let id: Option<Vec<u8>> = db
        .query_row(
            "SELECT id FROM exports WHERE state='Active' AND expires>?1 LIMIT 1",
            params![now as i64],
            |r| sql::row_get(r, 0),
        )
        .optional()
        .map_err(db_error)?;
    id.map(|id| get_export(db, &id, now)).transpose()
}
