# Kinic Vault

Kinic Vaultは、メモ・認証情報・添付ファイルをブラウザで暗号化して保存する個人用の保管庫です。Internet Computerのcanisterに暗号文と版履歴を保存します。保管庫の解除にはvetKeysとWebAuthnパスキーを使います。

**合成データで動かすローカル開発版です。** 実際のパスワードや機密文書を入れずにお試しください。本番のvetKeys計測と独立セキュリティレビューは未実施です。

## ローカルで試す

Node.js 24、pnpm 11.25.0、Rust（検証版1.97.1）と、WebAuthnに対応するブラウザを用意します。

```sh
git clone https://github.com/humandebri/kinic-vault.git
cd kinic-vault
rustup target add wasm32-unknown-unknown
pnpm install --frozen-lockfile
pnpm dev:local
```

1. ブラウザで [localhost:5173](http://localhost:5173) を開き、合成Identityでログインします。
2. 保管庫を作り、表示された復旧用秘密を控え、パスキーを登録します。
3. 合成データで文書の保存、ロックと解除、暗号化バックアップを試します。

終了は Ctrl+C です。起動ごとに新しいPocketIC環境を作るため、次回も残したい試験データは終了前に暗号化バックアップを保存してください。

### ローカルInternet Identityで試す

実際のローカルInternet Identityで試す場合は、自分で用意した**ローカルIIの公開URLとそのorigin用principal**を使う。WikiのIdentityや設定は流用しない。

```sh
pnpm build:canister
VITE_II_URL='http://<local-II-host>/authorize' node tools/local.mjs --owner '<local-owner-principal>'
```

この経路は公式AuthClientを使い、アプリの認証状態もメモリ内に保持する。II自体を確認する使い捨て試験は `pnpm test:ii`。

## 実装した機能

- 所有者1件の認可、Pending→Activeの作成、vetKeysによる鍵取得、解除ごとのWebAuthn本人確認、パスキー追加・削除。
- メモ・認証情報・添付のブラウザ暗号化、分割upload、再送、競合検出、履歴、削除・完全削除、容量制御。
- ローカル検索、安全なMarkdown表示、添付の復号ダウンロード、自動ロックと古い非同期結果の破棄。
- snapshot固定の暗号化バックアップ、保存確認状態、独立オフライン復旧、別canister・別ownerへのインポート。

| 対象 | 上限 |
| --- | ---: |
| 添付1ファイル | 10 MiB |
| メモ・認証情報1件 | 256 KiB |
| 保管庫の現行データ | 100 MiB |
| 所有者・canister全体（履歴と予約を含む） | 各200 MiB |
| 保管庫 | 3個 |
| 履歴 | 現行版を含めて10版 |
| 保管庫ごとの同時アップロード | 1件 |

容量不足の更新は既存データを保持して拒否します。PDFは復号ダウンロードで開けます。

## 検証

ブラウザ試験の前に `pnpm exec playwright install chromium` を実行します。Candidと生成済みバインディングの照合には `didc` が必要です。

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

## ライセンス

同梱する依存コードのライセンスと出所は各ディレクトリに記載しています。Kinic Vault本体のライセンスは未指定です。 [SQLite互換層](crates/kinic-sqlite-compat/NOTICE.md) · [passkey-auth](vendor/passkey-auth/NOTICE.md)
