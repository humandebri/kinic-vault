# Kinic Vault 仕様案

作成：2026-11-10 / 改訂：計画レビュー5件、容量縮小、バックアップ状態とorigin固定の指摘を反映。状態：個人用のローカル実装を開始。現状と未検証事項は[local-validation.md](local-validation.md)を参照。

## 1. 要件と判断の出所

ユーザーの方向性：vetKeys で暗号化する Wiki、パスワードや機密データと契約書の保存、既存 Wiki と別 canister、Cloudflare frontend、KINIC 直下の独立リポジトリ。

今回のユーザー確認に基づき、§7の容量・版数・同時upload制限の縮小を計画に採用する。その後、個人用・合成データ・ローカル実装の開始が承認された。本番配布の承認は含まない。

以下は実装可能な範囲を定める設計者の提案：個人用を先行、共有を第二段階、既存 kinic-wiki の Rust/ic-sqlite-vfs/SQLite 基盤を使う backend、TypeScript/React/Vite frontend、Workers Static Assets、Internet Identity 専用 principal。個人用・Rust/SQLite基盤・React・vetKeys/WebAuthnのローカル実装は後続のユーザー指示で承認された。ドメインと本番運用体制は未決定。

## 2. 最初に提供するもの

- 一人の所有者が複数の保管庫を作成し、機密メモ、認証情報、PDF/その他の添付ファイルを保存・閲覧・更新・削除できる。
- メモは Markdown テキスト。認証情報は label / username / password / URL / notes の構造化データ。すべて暗号化する。
- 添付は元バイト列を保持。PDF はローカル表示、その他は明示的に復号ダウンロード。外部ビューワーへ送らない。
- 解除後にメタデータ・メモを端末で検索。添付本文の OCR・索引化は初期版に含めない。
- 暗号化された版履歴、手動の暗号化バックアップ、独立した復旧ツールを提供する。
- 開発・ステージングでは合成データだけを使う。本物の認証情報を預ける前にリリース条件を満たす。

初期版では小容量・同時upload 1件を前提とする。共有、大容量化、並列upload、自動バックアップは後続の検討事項とし、暗号・認可・独立復旧・競合制御の検証は初期版から必要とする。

初期版に含めない：共有・招待、組織管理、ブラウザ自動入力、TOTP、自動ローテーション、電子署名・締結証跡、法定保存要件への適合保証、MCP/AI 連携、全文検索サーバー、モバイル専用アプリ、オフライン常用。

## 3. 配置と信頼境界

| 構成 | 責務 |
| --- | --- |
| Cloudflare Workers Static Assets | HTML/CSS/JS の静的配信。SSR・秘密を扱う Worker API は作らない |
| 専用 origin | 候補 vault.kinic.xyz。ドメイン名は未確定、DNS は変更しない |
| Browser | 暗号化・復号・検索、短時間のメモリ内鍵保持 |
| Vault canister | 所有者認証、暗号文・暗号化鍵・履歴の永続化、vetKD 呼出し、予算制御 |
| ICP vetKeys | 本番 key_1 による閾値鍵導出。Vault canister の配置 subnet とは独立 |
| 既存 Wiki | 任意の明示的なリンクだけ。本文、秘密、タイトル、鍵、セッションを転送しない |

ブラウザは IC SDK で Vault canister に直接接続する。Cloudflare は静的配信時の接続情報を扱うが、通常の文書操作で平文・秘密鍵を送信しない。配信コードを変更できる Cloudflare 管理者・CI・依存ライブラリは依然として信頼対象。

canister controller はコードを変えて鍵配布を改変できる。この設計は「運営者の悪意からも暗号学的に保護する」保証を持たない。そこを要件にするなら、利用者だけの追加秘密や更新統制を含む別設計が必要。

### 既存 canister の技術を引き継ぐ

[技術引き継ぎ資料](canister-reuse.md)を実装の必読資料とする。参照は kinic-wiki のローカル commit `4f15ac1135a0266d303ccf830f3ad6ed93f9986d`。最新 upstream であるとは扱わない。

保存基盤は固定版 ic-sqlite-vfs 2.0.0 と kinic-sqlite-compat の構成を再利用する。Vault 独自の暗号文・revision・upload・export/import・quota を SQLite の別スキーマで管理する。新 canister の単一DBに永久 MemoryId=10 を割り当て、同じ MemoryManager を init/post_upgrade から再構築する。既存 Wiki の DB や stable memory image は取り込まない。

初期案にあった独立した ic-stable-structures store は採用前提から外す。vetKeys は公式の暗号・management API を利用し、所有者・状態・予算・認証challengeは SQLite に保持する。KeyManager の既定永続層や別 MemoryManager を自動追加しない。SDK 内の追加永続領域が必要なら、同一 MemoryManager との互換性と重複しない MemoryId 配置を先に実証し、仕様改訂する。

Db::update の同期トランザクション内に await/vetKD 呼出しを持ち込まない。要求予約と challenge 消費をSQLで確定してから外部呼出しし、復帰後は新しいトランザクションで状態を再検証する。返り値の Err だけで既書込みがロールバックすると仮定せず、固定版の実挙動をPocketICで検証する。

## 4. 認証と権限

- Internet Identity の Vault 専用 origin/principal を使用する。Wiki の alternative origin / delegation / localStorage を共有しない。
- 独自ドメイン変更で principal が変わらないよう、初回利用前に derivation origin を固定する。IC 上の専用 origin を使う案とカスタム origin 固定案を Task 1 で実証し、採用値を記録する。frontend origin、II derivation origin、WebAuthn RP ID、許可origin一覧を別々に記録し、仮ドメインで登録したcredentialを本番へそのまま移せるとは扱わない。Task 1の実証は合成アカウントで行い、運用用の初回credential登録・保管庫有効化の前に採用ドメインと管理者を確定する。変更時は旧originが使える間の移行または独立復旧を手順化する。
- 初期版は private pilot。install 時に operator が許可 owner principal を1件指定し、空リストでは起動を拒否する。アプリの自己登録・招待・allowlist 追加 API は公開しない。owner の変更は運用手順を伴う管理操作とし、単純に旧保管庫の所有者を差し替えない。
- 全データ API で allowlist と authenticated caller、vault.owner を照合。所有者 ID をリクエスト本文から信用しない。anonymous と未登録 principal は新規保管庫予約・鍵取得・upload の前に拒否する。ログインできることをサービス利用許可とみなさない。
- controller とアプリ上の owner は別概念。controller への暗黙の読取 API は作らないが、コード変更権限の脅威は残る。
- 鍵要求は所有者・入力長・日次予算・同時実行制限を検査してから外部 call。await 後も operation ID と owner/epoch の整合性を確認する。

### ロック解除の認証境界

初期版は鍵取得時に本人確認を要求する。II は owner の識別に用い、保管庫の解除には追加で登録済み WebAuthn credential の新しい assertion を要求する。userVerification=required、RP ID は専用 frontend のホストに固定する。これは今回の指摘を解消するための設計提案であり、追加の実装・検証対象。

- 初回 credential 登録は、許可 owner が最初の保管庫を activate または復旧先の commit_restore するときに一度だけ可能。owner に credential が既にあれば初回登録経路を禁止し、追加保管庫の有効化にも既登録 credential の fresh assertion を要求する。server-generated challenge に対する登録結果の origin/RP ID/challenge/credential public key/UV を backend で検証する。credential 未登録でも文書の鍵を配る運用状態を作らない。
- begin_unlock は owner/vault/epoch/認証操作種別/transport public key のhashに束縛した256-bit challenge を発行、有効期限120秒、owner あたり未完了1件。derive_vault_key は fresh assertion と transport public key を受け、challenge を一度だけ消費してから vetKD を呼ぶ。署名・origin・RP ID・challenge・UP/UV・許可 credential・期限を backend で検証する。既存 II delegation だけでは再取得できない。
- 追加 credential の登録・削除には既登録 credential の fresh assertion が必要。最後の1件を削除できない。同期 passkey の counter が増えないケースを正しく扱い、単純な counter 正値条件を置かない。対応する安全な verifier の選定と署名形式の互換性を Task 1 で実証する。
- credential をすべて失った場合、II ログインだけの再登録バイパスは作らない。バックアップと recovery secret による復旧を使用する。新端末では同期 passkey または既登録端末で認可した追加 credential が必要。
- ロック/ログアウト/identity 切替で unlock generation を増やし、要求中の transport secret と鍵参照を破棄する。ネットワーク abort の成否にかかわらず、古い generation の鍵取得・復号・検索・PDF 処理の結果は状態/DOM に反映しない。ロック後は明示的な解除操作から新しい challenge と本人確認を開始する。
- この保護は悪意ある配信コードや controller に対する保証ではない。RP ID の変更は既登録 credential に影響するため、ドメイン移転には旧 origin が使える間の credential 移行またはオフライン復旧が必要。

## 5. 鍵階層

1. 各保管庫にランダム 128-bit vault ID とランダム 256-bit Vault Root Key (VRK) を作る。
2. vetKeys 由来の Key Encryption Key (KEK) で VRK を暗号化する。VRK は平文で canister に置かない。
3. 各文書の各 revision にランダム 256-bit Data Encryption Key (DEK) を作る。VRK で DEK を暗号化する。
4. 本文・添付・メタデータは DEK で AES-256-GCM 暗号化。文書の種類・タイトル・ファイル名も暗号化する。
5. 復旧専用のランダム 256-bit recovery secret から用途分離した鍵を導出し、VRK を別途暗号化する。recovery secret は自動送信・永続キャッシュしない。

vetKD context は UTF-8 `kinic-vault/kek/v1`。input は `vault_id[16] || epoch_u64_be[8]` の24バイト。key_id、canister ID、context、input の生成規則は永続化し、通常アップグレードで変更しない。本番とテストの key_id を同じデータに途中から切り替えない。

transport secret は要求ごとに生成。公開検証鍵は公式 SDK で期待する key_id/canister/context に結び付けて検証し、サーバーから返った任意の公開鍵をそのまま信用しない。vetKey の decrypt-and-verify に失敗した場合は閉じた状態を維持する。

暗号処理は公式 SDK/WebCrypto を利用する。vetKey から AES 鍵への変換は公式 SDK の用途分離 API を使用し、バイト列の切り取りで済ませない。独自の暗号アルゴリズムを作らない。

AES-GCM は96-bitランダム nonce、128-bit tag。各ラップ・メタデータ・チャンクに別 nonce を生成し、同一鍵で再利用しない。AAD の正確なバイナリ形式、SDK の用途分離ラベル、上限使用回数は Task 1 でバージョン付きフォーマット仕様と相互運用ベクトルに固定する。この確定前に保存互換性を約束しない。

## 6. 保存モデルと API 契約

以下はアプリ独自 API 案で、公式 EncryptedMaps の API 名ではない。正式な Candid は Task 1 で型を固定する。

ID = 16-byte blob、revision/epoch = nat64。所有者は principal。可変長引数はデコード後にも上限検査する。

| API | 種別 | 契約 |
| --- | --- | --- |
| reserve_vault | update | client-generated vault_id、operation ID。allowlist 確認後、owner=caller/epoch=0 の Pending を予約。鍵 envelope はまだ不要。同一 ID を上書きしない |
| begin_unlock | update | vault_id、epoch、用途、transport public key。owner と要求に束縛した WebAuthn challenge または登録 challenge を発行。初回の鍵準備は別規則を適用 |
| derive_vault_key | update | vault_id、epoch、transport public key、fresh assertion。Active は本人確認必須。新規 Pending と復旧先の Restoring の初回鍵準備は所有者・予算・期限・未有効化状態を確認して配布し、内容 API はまだ許可しない |
| activate_vault | update | Pending に暗号化 VRK/復旧 envelope と初回 credential 登録結果を登録して Active に一括遷移。同一 operation ID/同一内容の再送のみ成功 |
| get_vault_header | update | Active の暗号化 VRK、復旧 envelope、導出パラメータ、状態、バックアップ状態（現在sequence・最終保存確認sequence/時刻）を owner に返す。ブラウザ再起動後の鍵ラップ取得経路 |
| manage_unlock_credential | update | 既登録 credential の fresh assertion を検証して追加・削除。最後の credential の削除は禁止 |
| list_vaults | update | caller の保管庫 ID と暗号化メタデータだけ。ページングあり |
| begin_revision | update | object_id、expected_revision、上限付き manifest 宣言、operation ID。upload ID を発行 |
| put_chunk | update | upload ID、index、暗号文。所有者確認。完全同一の再送は成功、内容相違は拒否 |
| commit_revision | update | 全チャンク照合後、expected_revision を再確認し一括可視化。競合は Conflict |
| get_manifest | update | 認可済みの current head または特定の過去 revision。暗号化 manifest とチャンクの hash を返す |
| get_chunk | query | 認可して暗号文を返す。client は取得済み manifest と hash/AEAD を照合 |
| list_history | update | revision、暗号化 manifest、削除状態のページング |
| delete_object | update | expected_revision に一致する tombstone を追加。履歴の完全消去とは区別 |
| purge_object | update | 確認済み owner 操作。履歴・チャンクの参照を削除し再利用可能にする |
| begin_export | update | owner の保管庫の commit sequence を固定し、export ID/期限を発行。snapshot はownerあたり同時1件 |
| export_index | update | export ID、cursor。固定された時点の header、object/revision/chunk hash を最大100レコードずつ列挙 |
| get_export_chunk | query | owner/export ID/期限を検査し、固定 snapshot のチャンクだけ返す |
| finish_export / abort_export | update | client検証と利用者の保存確認後に完了を記録、または明示中止で保持を解除。同一 export ID の再送は同じ状態 |
| begin_restore / commit_restore | update | 元 vault ID を予約し、staged import を検証して一括有効化。衝突した既存保管庫を上書きしない |

### 保管庫の作成状態

`Absent → Pending → Active`。reserve_vault は暗号化前に owner と epoch を予約し、Pending の owner は初回ラップ作成のための vetKey を取得できる。クライアントは鍵検証・VRK生成・両 envelope の作成・復旧キット保持確認・初回 credential 登録を経て activate_vault を呼ぶ。Pending は内容の読書き・検索・バックアップ対象にしない。activate の再送が成功したことを get_vault_header でも確認できる。

Pending は24時間で失効し、ownerあたり同時1件・保管庫3個の枠に含める。失効後は ID を再利用せず期限付き操作 receipt で再送を Expired として扱う。activate と期限切れ GC の競合では同一メッセージ内で状態・期限を検査し、片方だけを成立させる。鍵配布の await 後に失効/取消されていたら結果を返さない。Pending で envelope を受け付けるのは activate のみで、Active の envelope/owner を初回登録経路から変更できない。

一覧・head/manifest は初期版では update にして合意済み状態を取得する。query は整合性を確認できるチャンク読出しに限定し、任意の query 応答で権限や current head の判断をしない。get_manifest 後に他の編集が進む場合はその revision のスナップショットを表示する。

stable storage：vault/owner/状態、暗号化 envelope、objects/revisions、upload session/chunks、operation receipt、quota counters、WebAuthn credential/challenge、export sequence/保持情報、restore session。鍵の平文は保存しない。UUID、owner、件数、時刻、サイズ、アクセス頻度は backend に見える。ファイルの長さは概ね漏れる。サイズ隠蔽は初期版の保証外。

## 7. 制限と障害時の動作

今回採用する初期制限：1ファイル10 MiB、平文1チャンク1 MiB、メモ256 KiB、保管庫の現行データ合計100 MiB、所有者あたり保管庫3個、各 object の保存履歴10版。暗号化・索引分を含めたサーバーの所有者 quota は200 MiBとし、開始時に予約、終了・失敗時に精算する。現行データの容量は各headの宣言平文サイズ合計で判定し、サーバー側は暗号文の実バイト数も独立して検査する。履歴・暗号化・索引・処理中データを含む所有者quotaと、現行データ容量を画面に示す。10 MiBを超える添付は分割・圧縮を案内して拒否し、自動変換しない。

全体のアプリ管理データ上限も200 MiBとし、Pending/Restoring、未完了upload、exportにより保持中の履歴、receipt/索引/metadataを含めて予約する。物理割当メモリの別上限は1 GiBを検証候補とし、空き領域を再利用しても上限に達した場合は増加を伴う操作を拒否する。Wasm/管理用とSQLite/VFSのページ・overlayの余裕を含む割当計測・安全域は Task 2/5 で検証する。200 MiBの論理quotaが物理1 GiB内で動くことは未実証であり、不適合なら本番前に仕様と予算を改訂する。owner quota と全体上限を同一予約処理で検査し、複数uploadの競合で超過しない。管理レコード数にも上限を置き、0-byte object/receipt/challenge の大量生成を容量計上外にしない。

- upload 有効期限24時間、保管庫ごと同時1件。期限切れチャンクは上限付き GC で回収する。
- 履歴は現行版を含む最大10版。成功したcommitで超過版を論理退役させるが、export保持中は物理回収しない。容量不足時は版数未満の履歴を黙って削除せず、新規保存・更新を拒否する。失敗した更新で旧headや履歴を失わない。利用者にバックアップの完了/中止、明示的なpurgeを案内する。
- expected_revision は begin と commit の両方で確認。manifest/チャンク/nonce を途中の別版と混ぜない。
- commit 前のデータは一覧・head に出さない。再送・通信切断後の同一 operation ID で二重課金するアプリ処理や二重 revision を作らない。
- derive は caller あたり日100回、全体日1,000回、同時実行 caller あたり1件を初期値とする。UTC 日界で集計。失敗した外部呼出しも使用枠に計上して濫用を防ぐ。
- canister 側に最低運転残高を設定し、それを割る鍵要求・新規 upload は拒否。数値はステージング計測と保存量から決める。
- auto-lock は非操作5分、タブ非表示60秒、ログアウト/identity 変更時。復帰時に期限を再計算する。鍵はメモリのみ、background tab の timer 遅延を考慮する。解除には §4 の fresh WebAuthn assertion を必須とし、自動再取得しない。
- JavaScript の GC の都合から完全なメモリ消去を保証しない。DOM・検索索引・Object URL・参照を破棄し、持続する Worker/キャッシュに復号結果を残さない。

## 8. 文書表示と漏えい防止

Markdown の raw HTML は無効化し、レンダリング結果もサニタイズする。外部画像・リンクプレビュー・自動 fetch は禁止。外部リンクは操作時に明示し、referrer を送らない。パスワードは初期マスク、表示/コピーは明示操作。clipboard の内容を後で確実に消せるという保証はしない。

PDF viewer は依存を同梱し、PDF 内 JavaScript、外部リソース、自動 action を無効化。安全な設定を検証できない場合はダウンロード専用に縮退する。

外部 analytics・セッション録画・第三者タグは使わない。アプリログは固定エラーコードと非機密の操作種別だけ。URL・コンソール・例外・CSP report・CI artifact に平文を含めない。DOM に表示中の秘密を同一 origin の悪意あるコードから守れるとは主張しない。

CSP、frame-ancestors、no-referrer、nosniff を設定し、IC/II の必要な通信先だけ許可する。Service Worker によるオフラインキャッシュは作らない。HTML は更新確認を要求し、hash 付き JS/CSS は長期キャッシュする。アプリと暗号フォーマットの互換性を別バージョンとして扱う。

## 9. 復旧・削除・更新

復旧キットは256-bit recovery secret の base64url 表現と説明書。バックアップは暗号文、VRK の復旧 envelope、形式・導出パラメータ、snapshot 時点で保持されている全 revision/chunk を含み、recovery secret 自体を含めない。過去に10版制限や purge で既に除去された版は含まない。初回は recovery secret の再入力で保持を確認し、バックアップの取得を促す。

### バックアップの状態と復旧範囲

各保管庫に現在のcommit sequenceと、最後に利用者が保存確認したバックアップのsnapshot sequence/確認時刻を保持する。保管庫作成・文書更新・削除・purge・header変更などバックアップ対象の変更で現在sequenceを進める。保存確認の時刻/sequence自体はarchive対象から外し、finish_exportによる記録だけでは現在sequenceを進めない。未取得なら「バックアップ未作成」、現在sequenceが保存確認sequenceより新しければ「バックアップ後に変更あり」を解除後の画面に表示する。確認時刻をバックアップに含まれる最新データの時刻と混同しない。

完成archiveの検証とファイル保存後、利用者が保存を確認してからfinish_exportを呼び、snapshot sequenceとサーバー確認時刻を永続化する。再送で確認時刻を書き換えず、途中失敗・中止・期限切れでは成功状態を記録しない。ブラウザやbackendが手元ファイルの永続保持を保証する表示はしない。export中に編集された場合、完了しても「変更あり」を維持する。再ログイン・upgrade後も状態を取得でき、復旧先では元サーバーの保存確認を引き継がず未作成から始める。

初期版は手動バックアップ。最後に保存したsnapshot以降の変更は、そのバックアップから復旧できない。recovery secretだけではデータを復元できず、バックアップファイルと別に保管する必要があることを作成時とバックアップ画面で説明する。

### バックアップの一貫性

begin_export は保管庫の commit sequence を記録して、有効期限24時間・ownerあたり1件の保持を作る。各レコードの生成/退役sequenceからその時点の集合をページングで読む。begin 内で全チャンクの走査やコピーは行わない。GC は有効な snapshot に必要な revision/chunk/header を物理削除しない。以後の編集は新しい sequence で進め、固定集合へ混ぜない。

snapshot 保持分も quota に含めるため、保持中の更新が容量不足で拒否される場合はバックアップ完了/中止を案内する。purge_object は対象が有効 snapshot に含まれる間 ExportInProgress を返し、黙って欠落させない。10版制限の論理退役と物理 GC を区別する。

再開は同じ export ID/cursor を使用し、期限延長はしない。期限切れ/中止時は ExportExpired/ExportAborted として終了し、別 snapshot の結果で続行しない。client は全件数・ID/revision集合・chunk hash/長さを検証し、VRK由来の別用途鍵で最終archive manifestを認証してから完了ファイルを確定する。途中ファイルを復旧可能な完成バックアップと表示しない。finish_export は完成ファイルの検証と利用者の保存確認後に呼ぶ。GC・同時更新・中断再開・期限切れを含む試験で固定時点の集合一致を確認する。

独立したオフラインツールが、ネットワークなしでバックアップを検証・復号できることを必須条件にする。復旧ツールも秘密をログに出さない。鍵だけあってもバックアップのデータがなければ復旧できないことを説明する。

### 復旧の ID と暗号文の扱い

復旧先は operator が新しい owner principal を許可した別 canister とする。begin_restore はバックアップの元 vault_id をそのまま Pending/Restoring として予約する。vault_id/object_id/revision/epoch は保持し、既存 ID が存在すれば RestoreConflict で拒否する。自動リネーム・マージ・上書きはしない。

AAD は暗号フォーマットversion・元 vault_id/object_id/revision・用途・chunk index に束縛し、owner principal と配置先 canister ID は本文/DEK/recovery envelope の AAD に含めない。これらは backend の認可と vetKD の検証tupleで別途拘束する。元データの DEK envelope・manifest・チャンクは同じバイト列で移す。新 canister の vetKEK で VRK の通常利用用 envelope だけを新しいnonceで再ラップし、移転前のものと分けて保存する。元の導出情報は出所として残し、移転後の鍵取得に使用しない。

復旧用の Restoring では初回鍵準備と新 credential 登録のみを許可し、内容は一般の一覧/読出しから隠す。クライアントが送信前にバックアップ最終manifestの認証と復号を検証する。backend はVRKを持たずそのMACを検証できないため、commit_restore は宣言集合・hash・quota・新 envelope/credential の構造/登録結果を検証して一括有効化し、失敗/期限切れでは未完了 import を回収する。新 owner への認可は新 backend が行い、旧 ACL を復活させない。旧 owner の認証を失った状態で旧サーバーから勝手に暗号文を取得できる API は作らない。

stable schema と暗号フォーマットを区別。バックアップだけ新 ID にコピーしても vetKey は復元されない。通常の upgrade は ID・context・key_id を保持し、upgrade 前後に実データ形式の検証をする。コード更新権限・CI・Cloudflare 配信の多要素認証と最小権限を整える。

purge は論理参照削除と空き領域再利用。stable memory の割当サイズが縮んで保存料金が即座に下がる保証はない。過去バックアップ、ネットワークの snapshot、取得済みコピーまで消す保証もない。

## 10. 次の段階：共有

Read / ReadWrite / Manage、招待・解除、鍵世代、退職者対応、復旧権限を別の仕様として作る。解除済み利用者が持つ旧鍵で新しい版を読めないことを検証する。既取得の本文は取り消せない。初期版の API に未実装の共有権限を公開しない。

## 11. 実装前と本番前の判断

実装着手前：個人用を先行するスコープと、合成アカウントで使う認証originを確認する。運用用の初回登録前：frontend origin、II derivation origin、WebAuthn RP ID/許可origin、初期controllerとfrontend更新担当者を確定する。ドメインと担当者は未決定であり、今はデプロイしない。容量制限の縮小は今回採用済みで、実装時に境界試験を行う。

本番前：暗号フォーマット/復旧の相互運用テスト、認可・並行更新・upgrade・障害試験、独立したセキュリティレビュー、実測の料金/解除時間/10 MiB転送、復旧訓練、cycles 補充運用を完了する。外部レビューを行う場合も合成データのみを使う。
