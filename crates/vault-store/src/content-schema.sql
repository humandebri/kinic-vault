CREATE TABLE revisions(vault BLOB NOT NULL, object BLOB NOT NULL, revision INTEGER NOT NULL, born INTEGER NOT NULL, retired INTEGER, plain_size INTEGER NOT NULL, manifest BLOB NOT NULL, hashes TEXT NOT NULL, deleted INTEGER NOT NULL, charge INTEGER NOT NULL, PRIMARY KEY(vault,object,revision));
CREATE INDEX revision_sequence ON revisions(vault,born,retired);
CREATE TABLE objects(vault BLOB NOT NULL, object BLOB NOT NULL, head INTEGER NOT NULL, PRIMARY KEY(vault,object));
CREATE TABLE uploads(id BLOB PRIMARY KEY NOT NULL, vault BLOB NOT NULL, object BLOB NOT NULL, expected INTEGER NOT NULL, expires INTEGER NOT NULL, digest BLOB NOT NULL, request TEXT NOT NULL, reserved INTEGER NOT NULL);
CREATE UNIQUE INDEX one_upload_per_vault ON uploads(vault);
CREATE TABLE chunks(upload BLOB NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(upload,idx));
CREATE TABLE revision_chunks(vault BLOB NOT NULL, object BLOB NOT NULL, revision INTEGER NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(vault,object,revision,idx));
CREATE TABLE exports(id BLOB PRIMARY KEY NOT NULL, vault BLOB NOT NULL, snapshot TEXT NOT NULL, expires INTEGER NOT NULL, state TEXT NOT NULL);
