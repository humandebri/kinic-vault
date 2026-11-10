# Kinic Vault

個人用の暗号化メモ・認証情報・文書保管庫。Rust canister、SQLite/VFS、vetKeys、WebAuthn、Reactで構成する。

現在は**合成データ用のローカル実装**。本番への配布、実秘密の保存、本番vetKeysの実測、独立セキュリティレビューは行っていない。

## ローカル起動

Node 24以上、pnpm 11.25、Rustとwasm32-unknown-unknown target、Candid生成用のdidcが必要。

```sh
pnpm install --frozen-lockfile
cargo fetch --locked
pnpm dev:local
```

[localhost:5173](http://localhost:5173)を開く。起動ごとに独立したPocketIC環境を作り、合成Identityを利用する。パスキー登録・解除にはブラウザのWebAuthnを使う。終了はCtrl+C。ローカル環境のデータは永続運用用ではない。

実際のローカルInternet Identityで試す場合は、自分で用意した**ローカルIIの公開URLとそのorigin用principal**を使う。WikiのIdentityや設定は流用しない。

```sh
VITE_II_URL='http://<local-II-host>/authorize' node tools/local.mjs --owner '<local-owner-principal>'
```

この経路は公式AuthClientを使い、アプリの認証状態もメモリ内に保持する。II自体を確認する使い捨て試験は `pnpm test:ii`。

## 実装した機能

- 所有者1件の認可、Pending→Activeの作成、vetKeysによる鍵取得、解除ごとのWebAuthn本人確認、パスキー追加・削除。
- メモ・認証情報・添付のブラウザ暗号化、分割upload、再送、競合検出、履歴、削除・完全削除、容量制御。
- ローカル検索、安全なMarkdown表示、添付の復号ダウンロード、自動ロックと古い非同期結果の破棄。
- snapshot固定の暗号化バックアップ、保存確認状態、独立オフライン復旧、別canister・別ownerへのインポート。

添付10 MiB、メモ・認証情報256 KiB、保管庫の現行データ100 MiB、履歴・予約等込みの所有者/全体各200 MiB。保管庫3個、現行版込み履歴10版、保管庫ごとの同時upload 1件。容量不足では既存データを保持して更新を拒否する。PDFはダウンロード専用。

## 検証

```sh
pnpm typecheck
pnpm test
cargo test --workspace --locked
pnpm test:canister
pnpm test:recovery:offline
pnpm test:e2e
pnpm test:ii
pnpm format:check
node tools/contracts.mjs --check
```

`test:canister` はschema v3の旧Wasmとv4の現行WasmをbuildしてPocketICで試験する。E2Eは合成Identityと仮想パスキーを使用し、別のII試験は公式AuthClientとローカルIIを実際に接続する。試験サーバー用のlocalhost接続が必要。

## オフライン復旧

```sh
node apps/recovery/src/main.mjs --backup /path/to/backup.kvault --output /path/to/new-directory
```

復旧用秘密は非表示入力する。明示したローカルファイルから読む場合だけ `--secret-file /path/to/secret` を指定できる。秘密そのものを引数・URLに渡さない。出力先は新規ディレクトリに限定し、全保持版をIDベースのファイル名で復号する。復号ファイルとindex.jsonは平文なので利用者が管理する。

## 資料

- [検証結果と制約](docs/local-validation.md)
- [仕様](docs/design.md) / [実装計画](docs/implementation-plan.md)
- [Wikiからの技術引き継ぎ](docs/canister-reuse.md)
- [暗号形式](docs/crypto-format.md) / [APIと状態遷移](docs/api.md)
- [復旧手順](docs/recovery.md) / [費用と一次資料](docs/costs-and-sources.md)

既存Wikiのコードは出所付きで保存基盤のみ参照・移植し、データ・設定・認証情報は複製していない。共有・自動入力・AI連携・オフライン常用は対象外。配信コードの更新者とcanister controllerは信頼対象に残る。
