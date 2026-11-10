use candid::Principal;
use kinic_sqlite_compat::{self as sql, Connection, OptionalExtension, params};
use serde::{Serialize, de::DeserializeOwned};
use vault_types::*;

pub use kinic_sqlite_compat;
pub const SCHEMA: &str = include_str!("schema.sql");

// Store functions are synchronous. The caller must provide one transaction per operation.
pub fn load<T: DeserializeOwned>(db: &Connection, key: &str) -> Result<Option<T>> {
    let raw: Option<String> = db
        .query_row(
            "SELECT value FROM settings WHERE key=?1",
            params![key],
            |r| sql::row_get(r, 0),
        )
        .optional()
        .map_err(|_| Error::Storage)?;
    raw.map(|s| serde_json::from_str(&s).map_err(|_| Error::Storage))
        .transpose()
}
pub fn save<T: Serialize>(db: &Connection, key: &str, value: &T) -> Result<()> {
    let text = serde_json::to_string(value).map_err(|_| Error::Storage)?;
    db.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,text]).map_err(|_|Error::Storage)?;
    Ok(())
}
pub fn config(db: &Connection) -> Result<Config> {
    load(db, "config")?.ok_or(Error::Storage)
}
pub fn authorize(db: &Connection, caller: Principal) -> Result<Config> {
    let c = config(db)?;
    if caller == Principal::anonymous() || caller != c.owner {
        return Err(Error::Unauthorized);
    }
    Ok(c)
}
pub fn header(db: &Connection, vault: &[u8]) -> Result<Header> {
    id(vault)?;
    let text: Option<String> = db
        .query_row(
            "SELECT header FROM vaults WHERE id=?1",
            params![vault],
            |r| sql::row_get(r, 0),
        )
        .optional()
        .map_err(|_| Error::Storage)?;
    serde_json::from_str(&text.ok_or(Error::NotFound)?).map_err(|_| Error::Storage)
}
pub fn put_header(db: &Connection, h: &Header) -> Result<()> {
    let text = serde_json::to_string(h).map_err(|_| Error::Storage)?;
    db.execute(
        "UPDATE vaults SET header=?2 WHERE id=?1",
        params![h.id, text],
    )
    .map_err(|_| Error::Storage)?;
    Ok(())
}
pub fn active(db: &Connection, vault: &[u8]) -> Result<Header> {
    let h = header(db, vault)?;
    if h.state != VaultState::Active {
        return Err(Error::Conflict);
    }
    Ok(h)
}
pub fn reserve(db: &Connection, caller: Principal, r: Reserve, now: u64) -> Result<Header> {
    let c = authorize(db, caller)?;
    id(&r.vault)?;
    id(&r.operation)?;
    let previous: Option<Vec<u8>> = db
        .query_row(
            "SELECT operation FROM vaults WHERE id=?1",
            params![r.vault],
            |row| sql::row_get(row, 0),
        )
        .optional()
        .map_err(|_| Error::Storage)?;
    if let Some(op) = previous {
        if op != r.operation {
            return Err(Error::Conflict);
        }
        let h = header(db, &r.vault)?;
        if h.state != VaultState::Pending {
            return Err(Error::Conflict);
        }
        pending(db, &r.vault, now)?;
        return Ok(h);
    }
    let ever: i64 = db
        .query_row("SELECT count(*) FROM vaults", params![], |r| {
            sql::row_get(r, 0)
        })
        .map_err(|_| Error::Storage)?;
    if ever >= 10000 {
        return Err(Error::QuotaExceeded);
    }
    content::check_capacity(db, 4096)?;
    let total: i64 = db
        .query_row(
            "SELECT count(*) FROM vaults WHERE expires=0 OR expires>?1",
            params![now as i64],
            |row| sql::row_get(row, 0),
        )
        .map_err(|_| Error::Storage)?;
    if total >= 3 {
        return Err(Error::QuotaExceeded);
    }
    let pending: i64 = db
        .query_row(
            "SELECT count(*) FROM vaults WHERE expires>?1",
            params![now as i64],
            |row| sql::row_get(row, 0),
        )
        .map_err(|_| Error::Storage)?;
    if pending > 0 {
        return Err(Error::Busy);
    }
    let h = Header {
        id: r.vault,
        epoch: 0,
        state: VaultState::Pending,
        normal: None,
        recovery: None,
        sequence: 0,
        backup_sequence: None,
        backup_at: None,
        key_name: c.key_name,
    };
    let raw = serde_json::to_string(&h).map_err(|_| Error::Storage)?;
    db.execute(
        "INSERT INTO vaults(id,operation,expires,header) VALUES(?1,?2,?3,?4)",
        params![h.id, r.operation, (now + DAY) as i64, raw],
    )
    .map_err(|_| Error::Storage)?;
    Ok(h)
}
pub fn pending(db: &Connection, vault: &[u8], now: u64) -> Result<Header> {
    let h = header(db, vault)?;
    if h.state != VaultState::Pending && h.state != VaultState::Restoring {
        return Err(Error::Conflict);
    }
    let expires: i64 = db
        .query_row(
            "SELECT expires FROM vaults WHERE id=?1",
            params![vault],
            |r| sql::row_get(r, 0),
        )
        .map_err(|_| Error::Storage)?;
    if expires as u64 <= now {
        return Err(Error::Expired);
    }
    Ok(h)
}
pub fn list(db: &Connection) -> Result<Vec<Header>> {
    let mut stmt = db
        .prepare("SELECT header FROM vaults WHERE expires=0 ORDER BY id LIMIT 3")
        .map_err(|_| Error::Storage)?;
    let raw: Vec<String> =
        sql::query_map(&mut stmt, params![], |r| sql::row_get(r, 0)).map_err(|_| Error::Storage)?;
    raw.into_iter()
        .map(|s| serde_json::from_str(&s).map_err(|_| Error::Storage))
        .collect()
}
pub mod content;
#[cfg(test)]
mod tests;
pub const CONTENT_SCHEMA: &str = include_str!("content-schema.sql");
pub mod restore;
pub const RESTORE_SCHEMA: &str = include_str!("restore-schema.sql");
