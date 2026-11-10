#[cfg(target_arch = "wasm32")]
use ic_sqlite_vfs::db::migrate::Migration;
#[cfg(target_arch = "wasm32")]
use ic_sqlite_vfs::{Db, DefaultMemoryImpl, MemoryId, MemoryManager};
use kinic_sqlite_compat::Connection;
use vault_types::{Error, Result};
#[cfg(target_arch = "wasm32")]
thread_local! { static MEMORY: MemoryManager<DefaultMemoryImpl> = MemoryManager::init_strict(DefaultMemoryImpl::default()).expect("foreign stable image"); }
#[cfg(target_arch = "wasm32")]
pub fn initialize() {
    MEMORY
        .with(|m| Db::init(m.get(MemoryId::new(10))))
        .expect("DB initialization failed");
    Db::migrate(&[
        Migration {
            version: 1,
            sql: vault_store::SCHEMA,
        },
        Migration {
            version: 2,
            sql: vault_store::CONTENT_SCHEMA,
        },
        Migration {
            version: 3,
            sql: vault_store::RESTORE_SCHEMA,
        },
        #[cfg(not(feature="schema-v3-fixture"))]
        Migration {version:4,sql:"CREATE INDEX uploads_expiry ON uploads(expires); CREATE INDEX exports_expiry ON exports(state,expires); CREATE INDEX restores_expiry ON restores(expires);"},
    ])
    .expect("migration failed");
}
#[cfg(target_arch = "wasm32")]
pub fn transaction<T>(f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    let mut app_error = None;
    let before =
        ic_cdk::stable::stable_size() * 65536 + core::arch::wasm32::memory_size(0) as u64 * 65536;
    let result = Db::update(|db| match f(db) {
        Ok(v) => Ok(v),
        Err(e) => {
            app_error = Some(e);
            Err(kinic_sqlite_compat::invalid_query())
        }
    })
    .map_err(|_| app_error.unwrap_or(Error::Storage));
    let after =
        ic_cdk::stable::stable_size() * 65536 + core::arch::wasm32::memory_size(0) as u64 * 65536;
    if after > before && after > 1024 * 1024 * 1024 {
        ic_cdk::trap("Memory quota exceeded")
    }
    result
}
#[cfg(not(target_arch = "wasm32"))]
thread_local! {static DB:std::cell::RefCell<Connection>=std::cell::RefCell::new(Connection::open_in_memory().unwrap());}
#[cfg(not(target_arch = "wasm32"))]
pub fn initialize() {
    DB.with(|db| {
        db.borrow()
            .execute_batch(
                &[
                    vault_store::SCHEMA,
                    vault_store::CONTENT_SCHEMA,
                    vault_store::RESTORE_SCHEMA,
                ]
                .concat(),
            )
            .unwrap()
    });
}
#[cfg(not(target_arch = "wasm32"))]
pub fn transaction<T>(f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    DB.with(|db| {
        let mut conn = db.borrow_mut();
        let tx = conn.transaction().map_err(|_| Error::Storage)?;
        let r = f(&tx)?;
        tx.commit().map_err(|_| Error::Storage)?;
        Ok(r)
    })
}
#[cfg(target_arch = "wasm32")]
pub fn read<T>(f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    Db::query(|db| Ok(f(db))).map_err(|_| Error::Storage)?
}
#[cfg(not(target_arch = "wasm32"))]
pub fn read<T>(f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    DB.with(|db| f(&db.borrow()))
}
