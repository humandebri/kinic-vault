# kinic-wiki canister 技術引き継ぎ

作成：2026-11-10。目的：Vault実装者が既存の保存・upgrade・試験基盤を再利用し、別方式を理由なく作り直さないようにする。

## 1. 参照対象と確認範囲

参照checkout：`ICME-Lab/kinic-wiki` のローカルcheckout。参照commit：`4f15ac1135a0266d303ccf830f3ad6ed93f9986d`。調査時のtracked変更はなし。ローカルmainはorigin/mainより10コミット後方であり、最新upstreamを調べた資料ではない。

この資料はローカルコード・manifest・lockfileの静的調査。Vaultへの移植・build・PocketICの再実行は未実施。依存互換性や性能の実証はTask 1で行う。元repoが手元にない場合も下記の固定commit/revと構成を使って参照を復元し、未固定の最新版へ置換しない。

## 2. 現在の基盤

| 項目 | 確認した内容 |
| --- | --- |
| Rust | edition 2024。canisterはcdylib/rlib |
| IC CDK | canisterの要求はic-cdk 0.20.0、固定lockではVFSが0.20.1を参照。実際の解決版をVaultのlockでも確認する |
| SQLite VFS | ic-sqlite-vfs 2.0.0、git `https://github.com/humandebri/ic-sqlite-vfs`、rev `a3a454ff749c5be59b00725ced7ede5ac200496f` |
| feature | workspaceはdefault-features=false。wasm32依存ではsqlite-precompiledを有効化 |
| host互換 | kinic-sqlite-compat：非wasmはrusqlite 0.37.0 bundled/hooks、wasm32は上記VFS |
| 永続領域 | VFSのMemoryManager/MemoryId/Db/DbHandleを使用。OSファイル/WASI/stable-fs経由ではない |
| 初期化 | MemoryManager::init_strict、index DBはMemoryId=10、追加DBはmount_idごとにDbHandleを復元 |
| upgrade | post_upgradeでSQLite初期化→DB再接続→migration→runtime再生成 |
| 試験 | native Rustテストと、実Wasmを動かす@dfinity/pic/PocketICを併用。既存JSはnode:test |

根拠：[Cargo.toml](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/Cargo.toml)、[Cargo.lock](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/Cargo.lock)、[canister依存](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/crates/vfs_canister/Cargo.toml)、[runtime依存](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/crates/vfs_runtime/Cargo.toml)、[compat依存](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/crates/kinic_sqlite_compat/Cargo.toml)。

## 3. 流用マップ

| 元ファイル | 読む・流用する内容 | Vaultでの受け先 |
| --- | --- | --- |
| [vfs_canister/src/lib.rs](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/crates/vfs_canister/src/lib.rs) | MEMORY_MANAGER、init/post_upgrade、initialize_sqlite_storage、database_handle | vault-canisterのstorage初期化とupgrade hook。Wikiの公開API全体はコピーしない |
| [kinic_sqlite_compat/src/lib.rs](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/crates/kinic_sqlite_compat/src/lib.rs) | cfg分岐、Connection/Transaction/params/row型の差の吸収 | 出所とライセンスを記録して必要範囲を移植し、native/wasmで同じstoreロジックを試験 |
| [vfs_runtime/src/lib.rs](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/crates/vfs_runtime/src/lib.rs) | service/store分離、wasmのDb/DbHandleとnative接続の境界 | Vault runtimeとSQL storeの責務分離 |
| [vfs_runtime/src/index_schema.rs](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/crates/vfs_runtime/src/index_schema.rs) | 初期化とupgradeで異なるmigration入口、同期transaction | Vault独自schema/migrationとupgrade試験 |
| [vfs_store/src/schema.rs](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/crates/vfs_store/src/schema.rs) | migration管理、静的SQL、schema検査の構成 | 暗号文専用のtables/indexesとバージョン管理 |
| [vfs_store/src/sqlite.rs](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/crates/vfs_store/src/sqlite.rs) | compatの再exportでSQL呼出しを共通化 | vault-storeのSQL adapter |
| [vfs_store/src/fs_store/revisions.rs](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/crates/vfs_store/src/fs_store/revisions.rs) | revisionと競合処理を読む参考 | 暗号化revision/expected_revisionの独自実装。平文モデルは移植しない |
| [PocketIC package.json](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/pocketic-tests/package.json) | --lockedでWasmをbuildし、実Wasmに対して試験する構成 | Vault独自のbuild/testスクリプト |
| [learning-revisions.test.mjs](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/pocketic-tests/integration/learning-revisions.test.mjs) | owner/outsider、revision identity、upgradeのfixture | Vaultのowner/暗号文/revision/upgradeテスト |
| [ic-sqlite-vfs-probe.test.mjs](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/pocketic-tests/tests/ic-sqlite-vfs-probe.test.mjs) | VFSのcanister実行検証 | 初期ストレージ実証 |
| [ic_sqlite_vfs_probe/src/lib.rs](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/crates/ic_sqlite_vfs_probe/src/lib.rs) | DbHandle probeとnative実行時の注意 | nativeだけで永続性を保証しないための検証参考 |

元repoのツール/テストは参考であり、Vaultでそのまま実行可能とみなさない。課金/IAP/補充/公開HTTPなどWiki専用のfixtureや設定は取り除く。型生成は[tools/candid](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/tools/candid/package.json)を参考に、Vault独自Candidとbindingの一致を検査する。

## 4. Vaultの保存方式

初期版は独立canisterの単一SQLite DB、MemoryId=10を固定する。複数の保管庫はDB内のvault_idで区別し、Wikiのindex DB＋利用者DBごとの動的mount構成をそのまま増設しない。既存Wikiのデータ・メモリイメージ・認証/課金設定は移さない。

SQLiteに保存するもの：allowlist、vault state、暗号化VRK/recovery envelope、WebAuthn public credential/challenge、暗号化revision/manifest/chunk、upload/operation receipt、quota予約、exportのcommit sequence/保持、restore session。本文・ファイル名・検索語・VRK/DEKの平文は保存しない。

vetKeysは公式暗号/management APIを使う。KeyManagerの既定stable領域や別のic-stable-structures MemoryManagerを自動生成しない。もしライブラリが追加のstable領域を要求する場合は、VFS側とのtrait/メモリlayout/allocator互換性を確認して同一MemoryManager内の永久ID表を更新してから採用する。

暗号文の単純保管に既存VfsService/fs_nodesのドメインモデルを無理に合わせない。SQL/互換層/初期化を流用し、Vaultの新tablesを作る。

## 5. 外してはいけない制約

- MemoryIdの所有権は永久。init/post_upgradeで同じIDを再接続し、他allocatorや別stable構造に同じ領域を割り当てない。foreign imageを初期化し直してエラーを消さない。
- SQLite接続・statement・transactionは同期メッセージ境界内で閉じる。vetKD await前に予約/challenge消費を確定し、await後に新transactionでowner/state/epochを検査する。
- commit_revisionのhead更新、quota精算、receipt記録は一つのDb::updateにまとめる。外部callを跨いだSQL transactionを設計しない。
- アプリのResult::ErrとSQL transaction rollback/IC trap rollbackを混同しない。固定版で失敗注入テストを行い、失敗後にhead/quota/receiptが部分更新されないことを確認する。
- host SQLiteのWAL/fsync/ローカルファイルバックアップの手順を持ち込まない。PRAGMAは固定VFSの対応を確認する。暗号化バックアップはアプリの論理exportを使う。
- SQLのrandom()/randomblob()を暗号鍵・nonce・tokenに使わない。ブラウザWebCryptoまたはICの安全な乱数源を使い、IC乱数取得のawaitもSQL外に置く。
- BLOB/ページング/GCを上限付きにし、1 MiBチャンクでもSQL page overlay・Candid・instructionの実消費をPocketICで計測する。
- 全文検索FTS、リンク抽出、raw SQL公開、本文の自動解析・要約・ログは流用しない。暗号文を入れただけで既存Wiki全体が安全になるとみなさない。

## 6. 文書の古さ・依存の取り違えを避ける

[DEPENDENCY_FORKS.md](https://github.com/ICME-Lab/kinic-wiki/blob/4f15ac1135a0266d303ccf830f3ad6ed93f9986d/docs/internal/DEPENDENCY_FORKS.md)にはstable-structuresのu16 forkに関する記載が残る。一方、調査したroot Cargo.tomlのpatchはic-agentのみで、Cargo.lockにic-stable-structuresパッケージは見つからなかった。現行コードはVFSが公開するu16のMemoryIdを使う。したがって古い文書のfork設定を機械的に復活させず、固定sourceとlockを優先する。

同様に一般的なMemoryIdのu8上限をこの固定版に無条件で当てはめない。Vault初期値10はどちらの範囲にも収まるが、将来領域を増やすときは実際のVFS layoutを調べる。

ic-agentのvendor patchはCLI/clientの事情も含む。canister単体に必要かを調べずコピーしない。license/NOTICEと元commitを記録し、依存更新は別の検証可能な変更にする。

## 7. 実装者への引き継ぎチェック

- Task 1で固定rev/features、compat移植範囲、MemoryId表とinit/upgradeを確定する。
- nativeのrusqlite試験と実Wasm/PocketIC試験の両方を用意する。元probeにはnative終了処理に関するignoreがあり、native成功だけでVFS実行を保証しない。
- Task 2でVault SQL schema、原子的なrevision/quota/receipt、失敗時挙動、upgrade fixtureを確認する。
- 元repoの相対path依存を配布物に残さず、必要コードを出所付きで独立させる。秘密・本番設定・DBは移さない。
- 参照元を更新するときはcommit差分とlock/featuresを再確認し、この資料の参照commitも更新する。

## 8. 今回追加で照合した履歴・再送・試験の設計

2026-11-10、同じ固定commitの実コードを再確認した。以下は静的確認であり、元repoのテストも今回再実行していない。

| 確認箇所 | Wikiの実装 | Vaultへの適用 |
| --- | --- | --- |
| `vfs_store/src/fs_store/revisions.rs` の `node_history` | limitを1〜100件に制限し、さらに `HISTORY_BYTES_MAX=1_000_000` で応答bytesを制限。読みながら上限で止め、全履歴を先にメモリへ集めない | manifest/履歴/export indexに件数とbytesの二重上限を設ける。暗号化metadataが最大サイズのときも試験。上限値とCandidの余裕はVaultで確定する |
| 同ファイルの `publish_learning_with_publication_outcome` | 同一transaction内でoperation IDを照合。同じrequestなら保存済みresult、別payloadの同じIDは拒否。scope/revisionの検査と書込みも同一transaction | commit_revision/activate/restore/finish_exportの再送receiptを参考にする。Vaultでは必要な暗号文・要求digest・固定結果だけを保持し、平文のrequest JSONや秘密を保存しない |
| `pocketic-tests/integration/learning-revisions.test.mjs` | 実Wasmでrevision identity、削除/再作成、ページング、upgrade、再送、古い参照、途中失敗、owner/reader/outsiderを試験する構成 | Vault用の合成暗号文fixtureで競合・認可・再送・旧Wasm→新Wasmを再検証する。Wikiの共有権限やlearning/publicationの用途は移植しない |

Task 1で参照元・採用範囲・不採用理由を確定し、Task 2でVault固有の10 MiB添付/200 MiB総量、暗号文BLOB、quota/receiptの原子性に対する試験へ落とし込む。Wikiのrevision triggerをそのまま移すと不要な暗号文複製やquota不整合を招き得るため、head・revision・chunk参照・予約精算の一括更新をVault側で設計する。

追加調査の対象はソースと試験構造のみ。WikiのDB・接続設定・認証情報・実データは読み込まず、既存repoは変更しない。

## ローカル実装での適用状況

互換層は `crates/kinic-sqlite-compat` に出所・MIT license付きで独立移植した。固定VFS、MemoryId=10、同一MemoryManager、同期transactionを採用し、Wiki本体は変更していない。Vault独自の履歴・receipt・quota・snapshot・restore tablesを作成した。native SQLiteに加え、PocketICで1 MiB BLOB、認証失敗後のrollback、schema v3旧Wasmからv4へのupgrade、別canisterへの復旧を試験する。結果と未検証事項は[local-validation.md](local-validation.md)に記録する。
