# Kinic Vault 実装計画

作成：2026-11-10 / 改訂：同日の計画レビュー5件を反映。状態：ユーザー承認を受けローカル実装に着手。既存 canister の技術引き継ぎ、容量縮小、バックアップ状態とorigin固定を反映。チェック欄は元計画の全条件を満たした段階で更新する。一部実装・ローカル検証済みの項目も、未測定の本番条件を含むため未チェックのまま残す。現状は[local-validation.md](local-validation.md)を参照。

目的：Cloudflare frontend と独立した IC canister で、個人用の暗号化 Wiki/文書保管庫を作る。
仕様：[design.md](design.md)。費用・一次資料：[costs-and-sources.md](costs-and-sources.md)。必読の流用資料：[canister-reuse.md](canister-reuse.md)。

当初は提案だったが、後続のユーザー指示により個人用・localhost・合成データでの実装開始が承認された。共有必須の場合は Task 1 前に仕様を改訂し、鍵・権限・復旧を先に設計する。

## 初期版の実装範囲

今回のユーザー確認に基づき、添付10 MiB、メモ256 KiB、保管庫の現行データ100 MiB、所有者・全体各200 MiB、保管庫3個、履歴は現行版込み10版、保管庫ごとの同時upload 1件を採用する。物理割当1 GiBは検証候補であり、SQLite/VFSを含む実測で確定する。共有、大容量化、並列upload、自動バックアップは後続で扱う。5タスクは依存順のまま進め、暗号・認可・復旧・upgradeの検証は削らない。

## 技術と構成の提案

TypeScript + React + Vite、WebCrypto、@icp-sdk/vetkeys 0.7 系と互換の @icp-sdk/core、Rust + ic-cdk 0.20 系 + ic-vetkeys 0.9 系、固定版 ic-sqlite-vfs 2.0.0 + kinic-sqlite-compat の SQLite 構成、PocketIC、Vitest、Playwright、Cloudflare Workers Static Assets、icp-cli、WebAuthn の backend verifier。導入時に互換性と正式配布版を確認し、lockfile で固定する。

保存基盤は既存 Wiki と同じ SQLite 構成に揃える。公式 vetKeys の暗号・management API を利用し、アプリの認可・鍵要求状態・WebAuthn credential/challenge・revision・quota は Vault の SQL スキーマで管理する。KeyManager/EncryptedMaps の既定 canister を丸ごと導入する前提は置かない。追加永続層が必要な場合は同一 MemoryManager と MemoryId 配置の互換性を先に検証し、黙って二つ目の allocator を作らない。

```text
apps/web/                         ブラウザ UI と認証・ロック
packages/contracts/               生成 TS binding と公開型
packages/crypto/                  暗号 envelope・AAD・鍵ラップ
packages/backup/                  バックアップ形式と検証
crates/vault-canister/             公開 API・所有者認証・vetKD
crates/vault-store/                SQLite schema・upload・revision・quota
crates/kinic-sqlite-compat/         既存互換層を出所付きで移植する候補
crates/vault-types/                Candid 型とエラー
apps/recovery/                    ローカル専用の復旧 CLI
pocketic-tests/                    canister 統合・upgrade・障害試験
tests/e2e/                        ブラウザと canister の結合検証
docs/crypto-format.md              固定する wire format とテストベクトル
docs/api.md                        Candid 契約と状態遷移
docs/operations.md                 配布・監視・補充・復旧手順
```

上記は将来作成するファイル配置。当初の計画作成時はscaffold・依存導入を行っていない。後続の実装指示に基づき現在は作成済み。

## 全体の検証原則

- 合成データだけを使用する。実秘密を Git・ログ・AI・CI artifact に入れない。
- 各タスクは失敗を再現する意味のあるテストから開始し、実装後に対象テストを通す。
- 未認可アクセス、破損暗号文、再送、通信切断、同時更新、upgrade、復旧を受け入れ条件にする。
- PocketIC の成功を本番の閾値鍵ネットワーク・待ち時間・費用の検証とはみなさない。
- アプリ更新と既存暗号フォーマット互換性を分けて確認する。

## Task 1：鍵・認証・保存契約を実証して固定する

成果：テスト用 canister とブラウザ/テストクライアントで、同じ owner の再取得・別 owner 拒否・暗号化 round trip を証明する。アプリ UI はまだ作らない。

対象：`crates/vault-types/src/lib.rs`、`crates/vault-canister/src/{key_service,webauthn}.rs`、`packages/crypto/src/envelope.ts`、`packages/crypto/src/aad.ts`、`docs/crypto-format.md`、`docs/api.md`、`pocketic-tests/{key-service,webauthn}.test.ts`、`packages/crypto/test/vectors.test.ts`。

消費：design §4–6。生成：正式 Candid、key derivation tuple、バージョン付き envelope、クロスランタイムのテストベクトル、認証 origin 方針。

- [ ] canister-reuse.md の参照コミット・Cargo.toml/Cargo.lock・featuresを再確認し、ic-sqlite-vfsのrevを固定する。kinic-sqlite-compatを移植する場合は出所/ライセンス/必要APIを記録し、兄弟repoへのpath依存をリリース構成に残さない。
- [ ] Wikiの履歴ページング（件数と応答bytesの二重上限）、operation ID再送、競合、upgrade fixtureをcanister-reuse.mdの対応表で比較する。採用・不採用・差分と検証方法を記録し、平文のpayload/ログ/fixtureを移植しない。
- [ ] frontend origin、II derivation origin、WebAuthn RP ID、許可origin一覧と変更時の移行経路を文書化する。合成アカウントの実証後、運用用初回登録前にドメインと管理者を確定する。
- [ ] 新canisterのMemoryId=10とDb::init/init_strictを用意し、wasm32/PocketICでBLOB往復、複数メッセージ間の永続化、SQL失敗時のatomicity、post_upgrade後の再接続を実証する。nativeのrusqliteテストだけで完了としない。
- [ ] vetKD/WebAuthnとSQLの境界を固定する。要求予約/challenge消費の同期SQL→await→状態再検証の同期SQLとし、SQL接続/statement/transactionをawait越しに保持しない。
- [ ] key_id/canister/context/input のどれかを変えると復号不可、別 owner・anonymous・未登録 principal は予約/外部 derive 前に拒否するテストを作る。
- [ ] reserve_vault→Pendingの初回derive→activate_vault→header取得→fresh assertion付き再derive の一巡をテストする。activate再送、24時間失効との競合、Activeへの初回登録再実行、Pendingの内容API拒否も含める。
- [ ] WebAuthn backend verifier と RP ID/origin を選定し、署名・challenge・期限・UP/UV・credential ID を検証する。古い/replayed assertion、別vault用途・別transport public key、IIだけの解除、最後のcredential削除を拒否し、同期passkeyのcounter=0を許容するテストを作る。
- [ ] 現行ライブラリ・II と Cloudflare origin の組合せを合成アカウントで確認する。vetKeysは公式暗号/management APIを使い、追加の永続memoryが暗黙に確保されないことを確認する。
- [ ] Candid 型、AAD の長さ付きバイナリ符号化、用途分離ラベル、nonce 生成/上限、暗号 envelope、recovery envelope の仕様と固定ベクトルを実装する。AADは元vault/object/revision/用途/indexに束縛し、本文/DEK/recovery envelopeにowner/canisterを含めない。
- [ ] `pnpm --filter @kinic-vault/crypto test` と `pnpm test:canister:keys` を実行し、改ざん・取り違え・型境界・所有者認可の全ケースが通ることを確認する。これらのスクリプトも本タスクで定義する。
- [ ] ステージングで本番 key_1 の合成データを1回解除し、実測 latency/差引 cycles を記録する。公開・課金操作は実行段階の対象とする。
- [ ] 契約固定後に小さな論理単位でコミットする。固定できない互換性の問題があれば後続へ進まず仕様を修正する。

## Task 2：暗号文・履歴・分割 upload の backend

成果：初期版 API が永続化と再送・競合・quota を正しく扱い、upgrade 後にも同じ文書を取得できる。

対象：`crates/vault-store/src/{vaults,revisions,uploads,quotas,receipts}.rs`、`crates/vault-canister/src/{lib,api}.rs`、`pocketic-tests/{uploads,authorization,upgrade}.test.ts`。

消費：Task 1 の Candid/wire format/SQLite実証。生成：design §6 の API、Vault専用SQL schema v1、静的SQL migration、移行fixture。

- [ ] 未許可所有者、期限切れ upload、異なる同一 index の再送、commit 競合、超過サイズ、quota 予約と解放のテストを追加し、失敗を確認する。
- [ ] installの許可owner1件を検査し、未登録principalを複数生成してもreserve/derive/uploadと全体予算を使えないことを検証する。公開の自己登録・allowlist追加APIは作らない。
- [ ] 全体200 MiB/物理割当1 GiB候補、owner200 MiB、同時upload/export/importの予約を一括検査する。0-byte objectやreceiptの増殖も制限し、上限直前の競合で超過しないテストを追加する。
- [ ] 添付10 MiB / 1 MiB chunks、メモ256 KiB、保管庫ごと同時1件、24時間期限、現行版込み10版、保管庫3個、保管庫の現行データ100 MiB/所有者サーバー200 MiB制限を実装する。サーバーは宣言された平文サイズだけを信用せず暗号文の実バイト数も制限する。
- [ ] 各サイズ制限の上限ちょうど/1 byte超過、4個目の保管庫、同一保管庫の2件目uploadを試験する。履歴・export保持・未完了uploadを含む200 MiB境界、10版超過時の退役、容量不足時にhead/履歴を変えず拒否することを確認する。別保管庫間の同時要求にも全体予約は適用する。
- [ ] begin/put/commit と operation receipt を実装する。commitのrevision追加・head更新・quota精算・receiptを同じDb::update内で実行し、途中状態を公開しない。同じcommitの再送は同じ結果を返す。
- [ ] Vault専用のBLOB schema/索引/静的migrationを作る。既存Wikiの平文fs_nodes/FTS/リンク抽出/SQL公開APIは持ち込まない。native互換層とPocketIC実Wasmの両方で認可・競合・失敗・upgradeを確認する。
- [ ] current head/manifest/list は update、chunk は認可済み query とし、ページングと上限付き GC を実装する。GC の処理量もテストする。
- [ ] `cargo test --workspace` と `pnpm test:canister` を実行する。保存 fixture を持つ旧 Wasm→新 Wasm の upgrade 後に認可・revision・暗号 envelope が不変であることを確認する。
- [ ] 対象差分とチェック結果を確認してコミットする。

## Task 3：独立復旧と可搬バックアップ

成果：オンライン鍵サービスと元 canister がなくても、ローカルの暗号化バックアップと recovery secret だけで復号できる。

対象：`packages/backup/src/{format,export,import}.ts`、`apps/recovery/src/main.ts`、`packages/backup/test/recovery.test.ts`、`crates/vault-store/src/{exports,restore}.rs`、`crates/vault-canister/src/api.rs`、`pocketic-tests/{exports,restore}.test.ts`、`docs/recovery.md`。

消費：Task 1 の envelope、Task 2 の export/manifest API。生成：バージョン付きバックアップ、復旧 CLI、インポート契約。

- [ ] 正しい鍵でsnapshot時点の全保持版を復元、間違った鍵を拒否、欠落/重複/改変チャンクとobject全体の欠落を拒否するテストを先に作る。
- [ ] begin_exportのsequence固定、100件ページング、ownerあたり1件/24時間保持、get_export_chunk、finish/abortとGC協調をbackendに実装する。同時編集・10版退役・purge拒否・中断再開・期限切れでも集合が混ざらず、finish/abort後に保持が回収されることをテストする。
- [ ] 現在sequence・最終保存確認sequence/時刻を永続化し、get_vault_headerで返す。finish_exportは利用者の保存確認後に記録し、再送では同じ結果を返す。export中の編集、abort/期限切れ、upgrade、新canister復旧でバックアップ状態を誤って最新扱いしないことを試験する。
- [ ] フォーマットと export/import を実装する。recovery secret を引数・URL・標準出力・ログに残さない入力経路を作る。secret のファイル入力は明示したローカルファイルに限定する。
- [ ] allowlistで許可された新 principal と新 canister に、元vault_id/object_id/revision/epochを保持してbegin_restoreする。VRKだけを新vetKEKで再ラップし、新credentialを登録してcommit_restoreする。ID衝突は拒否し、本文/DEK envelope/チャンクのバイト一致と旧owner拒否をテストする。
- [ ] client側のbackup最終manifest認証とbackend側の件数/集合/hash検証、Restoringの不可視性、途中失敗/期限切れ回収、restore commit再送の冪等性を実装する。旧ACLの無認証バイパスは作らない。
- [ ] `pnpm --filter @kinic-vault/backup test` と `pnpm test:recovery:offline` を実行し、復号中の全ネットワークアクセスを禁止して成功を確認する。
- [ ] 実ファイルのハッシュ一致、秘密のログ混入なしを確認してコミットする。

## Task 4：専用 frontend の解除・閲覧・編集

成果：II ログインから保管庫作成、メモ/認証情報/PDF の保存、検索、履歴、バックアップまで端末で完結する。

対象：`apps/web/src/auth/`、`apps/web/src/vault/`、`apps/web/src/documents/`、`apps/web/src/attachments/`、`apps/web/src/backup/`、`tests/e2e/vault.spec.ts`。

消費：Task 1–3 の公開契約。生成：静的 SPA、型検査・UI/E2E の実行スクリプト。

- [ ] 合成メモ/認証情報/PDF の作成→再ログイン→読出し、別 identity への切替、revision 競合、復旧キット確認の E2E を定義する。
- [ ] 認証専用 origin と direct canister 呼出し、初回credential登録・fresh WebAuthn assertionによる解除、メモリ内鍵、非操作5分/非表示60秒/ログアウト即時ロック、復帰時期限確認を実装する。II認証済みでもassertionなしの鍵再取得を許可しない。
- [ ] unlock generationをロック/identity変更時に更新し、要求中transport secretを破棄する。遅延したderive応答・復号・検索・PDF完了が鍵/DOMを復活させないことを遅延応答のE2Eで確認する。再解除には新challengeと本人確認が必要。
- [ ] 同期passkey/既登録端末によるcredential追加、全credential喪失時のオフライン復旧案内を実装する。IIだけの再登録fallbackは作らない。
- [ ] 暗号化メタデータ一覧、ローカル検索、Markdown サニタイズ、パスワードのマスク/表示/コピー、PDF の安全なローカル表示またはダウンロードを実装する。
- [ ] 最終バックアップ保存確認時刻、「未作成」「バックアップ後に変更あり」、復旧可能なsnapshotの範囲を表示する。保存確認の明示操作を設け、ダウンロード開始だけでは完了扱いしない。再ログイン・export中編集・保存取消・通信切断時のE2Eを追加する。
- [ ] 全チャンク upload の進捗・再送・24時間失効・quota 表示を実装する。10 MiB超過の分割/圧縮案内と、容量不足時の拒否・利用者による整理を実装する。エラー画面に平文・内部秘密を出さない。
- [ ] `pnpm typecheck`、`pnpm test`、`pnpm test:e2e` を実行する。script、raw HTML、外部画像、PDF action による自動通信がないことも検査する。
- [ ] 表示中データからログ・localStorage・IndexedDB・Cache Storage・ネットワークへの漏出がないこと、ロック後に DOM/Object URL/検索索引/鍵参照が消えることを確認してコミットする。

## Task 5：配信・予算制御・合成データの試験運用

成果：Cloudflare 静的配信と本番 vetKeys を使う隔離環境で、復旧・更新・費用を実測できる。まだ実秘密を保存しない。

対象：`apps/web/public/` の security headers、`icp.yaml`、cf CLI の公式構成ファイル、`docs/{operations,staging-results}.md`、`pocketic-tests/budgets.test.ts`。

- [ ] 鍵取得の日次100回/caller・1,000回/全体、同時1件/caller、最低運転残高、await 中の重複要求/状態変更に関する失敗テストを追加する。許可owner以外が全体枠を減らせないことと、失効/取消Pendingの外部応答を破棄することも確認する。
- [ ] quota と固定コードの運用ログを実装する。CI の秘密分離、依存固定、CSP/フレーム禁止/referrer 制限、静的キャッシュを設定する。
- [ ] cf CLI と icp-cli のインストール済みヘルプで正しい構文を確認し、静的配信と canister の構成を記録する。Cloudflare は Wrangler で操作しない。
- [ ] owner が指定したステージング先へ配布し、解除 latency p50/p95、10 MiB upload/download、cycles 実測、異常時の拒否動作を記録する。測定回数と時刻を添え、架空の SLA を作らない。
- [ ] controller/配信更新者の最小権限、MFA、cycles 補充と残高警告、バックアップ・復旧・旧形式の upgrade を訓練する。
- [ ] 独立セキュリティレビューで暗号・認可・XSS・復旧・更新経路を確認し、未解決の高リスク事項を明記する。実施者/方法/結果の記録がないレビューを完了扱いしない。
- [ ] 差分と実測を確認してコミットする。本番移行には未決定事項の解消と受け入れ結果を提示する。

## 本番に移せる条件

仕様の全テスト・upgrade・独立復旧が成功し、危険な未解決事項がなく、実測予算と運用担当が決まり、controller/配信コードの信頼モデルを説明できること。自動ロックが OS/ブラウザ拡張/悪意ある配信コードから秘密を守るという誤解を UI/文書に残さない。

## 計画の自己点検

- SQLite/VFS流用とメモリ配置 → Task 1/2、固定rev、MemoryId=10、SQL/await境界、実Wasmとnativeの差を検証。
- 初回作成の循環 → Task 1/2、Pendingから暗号化前に鍵を取得しactivateする状態遷移と再送/失効競合を検証。
- 未登録principalによる費用/容量の消費 → Task 1/2/5、allowlistと全体予約上限を課金前に検査。
- 小容量化・履歴容量 → Task 2/5、各境界、全体予約、容量不足時の非破壊的な拒否、SQLite/VFSの物理割当を検証。
- バックアップ忘れ → Task 3/4、保存確認sequenceを永続化し、未作成・変更ありを表示。
- originの固定 → Task 1/4、運用用初回登録前にII/WebAuthn/配信の採用値と移行経路を確定。
- snapshot中の編集/GC → Task 3、sequence固定と期限付き保持で集合一致を検証。
- 復旧と canister ID 依存 → Task 1/3、元データIDを保持し本文AADを変えずVRKだけを再ラップ。
- 部分 upload・並行更新・quota 枯渇 → Task 2、expected_revision を commit 時にも再確認。
- identity 切替・background 復帰・ロック → Task 1/4、fresh assertionとunlock generationで再取得/遅延応答による復活を防ぐ。
- Markdown/PDF の能動的コンテンツ・通信 → Task 4/5、表示形式ごとの漏出試験。
- 高額 derive の濫用・await 中の変更・cycles 枯渇 → Task 1/5、課金前検査と予算実測。

共有機能は別の実装計画とする。日付や開発工数は性能・ライブラリ適合を Task 1 で確認するまで確約しない。
