# ローカル実装の検証記録

2026-11-10。すべて合成データ。ローカル初期版の実装と試験を記録し、本番安全性の保証や元計画の全チェック完了とは区別する。

## 実装と固定版

Rust canister、Vault専用SQLite schema、認可/鍵/WebAuthn、暗号文保存/履歴/容量予約、snapshot export、stage restore、独立復旧CLI、React画面を実装した。Wikiは変更せず、固定commitから互換層だけを出所とlicense付きで移植した。

Rust 1.97.1、ic-cdk 0.20.1、ic-vetkeys 0.9.0、ic-sqlite-vfs 2.0.0（rev a3a454ff749c5be59b00725ced7ede5ac200496f）、native rusqlite 0.37。JSはNode 24.22、pnpm 11.25、core 5.0、vetkeys 0.7、auth 8.0.1、pic-js 0.21/PocketIC 12.0、Playwright 1.61。依存の解決結果はCargo.lock/pnpm-lock.yamlに固定した。

passkey-auth 0.1.3は純Rust verifierとしてvendor化した。WasmではIC時刻を使い、同期OS乱数を拒否する最小修正を加えた。challengeはアプリ側がmanagement raw_randで作る。署名検証を独自アルゴリズムに置き換えていないが、この選定と変更は独立レビュー未実施。

## 実行して成功した検証

| 検証 | 確認内容 |
| --- | --- |
| Rust workspace tests（11件） | 互換層、owner/予約/期限、transaction rollback、upload/再送/履歴/snapshot、復旧、WebCrypto共通AESベクトル |
| Vitest（11件） | AEADの改ざん・AAD取り違え、型/数値境界、固定ベクトル、archive破損/秘密違い/重複、ロックと期限 |
| PocketIC実Wasm（4シナリオ） | 登録/UV/鍵再取得、key/canister/context/input取り違え、未許可owner、credential追加/最後の削除拒否、失効、1 MiB BLOB、commit再送、snapshot、旧schema v3 Wasm→v4、別canister/ownerへの暗号文そのままの復旧 |
| standalone復旧CLI | 子processでネットワーク経路を拒否し、ファイルのバイト一致、既存出力の拒否、秘密と内容が標準出力へ出ないことを確認 |
| ブラウザE2E | 実canisterと仮想パスキーで保管庫作成、メモ/認証情報/PDF添付、検索、削除済み履歴とpurge、backupの独立検証、再ログイン、ロック後のDOM/キャッシュ/IndexedDB、derive遅延応答の破棄、375/768/1280pxの横あふれ |
| ローカルII | 公式AuthClient→PocketICの実II presetで合成Identityを新規作成、仮想passkeyで署名済みログイン、有効principal取得。アプリoriginのIndexedDBへ認証状態を残さないことも検査 |
| ビルド・型・契約 | TypeScript型検査、Vite production build、Rustfmt/Prettier、Rust生成CandidとJS/TS bindingの一致 |

ブラウザE2Eの主経路は既知の合成署名Identityを使い、II UIそのものを代用する。IIの実接続は別の `pnpm test:ii` で確認する。実端末の生体認証・Safari・同期passkeyサービスまで検証したものではない。

## 画面品質検査

vlmkit 0.23.0で初期画面のintegrity、copy、scroll、interactionsが成功。integrityは375/768/1280pxでsuspectなし。解除後の画面の横あふれと各操作はブラウザE2Eで確認する。

`vlmkit scan handlers http://localhost:5173 --json` は **suspect 1件が残る**。指摘は `drag-source-not-draggable`、対象はReactの `div#root`。実装にはdrag/drop操作がなく、検出面にはReactが委譲登録する全イベントが並ぶ。ツールのhelpにもroot delegationの粒度制約が記載されている。アプリをdraggableに変更したりルールを無効化してpass扱いにはしていない。pointer-only controlの指摘はなく、実際のキーボード操作検査とE2Eは別に成功している。

## 残る条件と運用上の制約

- Cloudflare配布、DNS、本番canister、本番key_1のlatency/cycles、独立セキュリティレビューは未実施。
- 200 MiBに近い実データ、SQLite/VFSの最悪時の割当増幅、1 GiB境界での負荷、長期運用は未測定。容量会計と物理trapは実装したが、候補上限の妥当性は本番前に実測する。
- 長期のVRK使用回数・nonce生涯予算・鍵更新の仕様は本番移行前に確定する。DEKは毎版/毎試行新規で、metadata1件+最大10chunksに用途を制限する。
- 暗号化ファイルの再作成はget_active_exportで同じ未失効snapshotを再利用できる。restoreの低レベルAPIは再送対応だが、ページ再読込後のインポート再開ウィザードはない。
- 復旧先は空の独立canister。既存IDへの上書き/マージはしない。手元ファイルと復旧用秘密が両方必要。
- PDFはダウンロード専用。共有、OCR、ブラウザ自動入力、AI連携、自動バックアップは含めない。
- 配信コード、controller、OS/ブラウザ拡張を信頼するモデル。ロックはこれらの悪意や取得済みコピーから秘密を守る保証ではない。

pnpm 11の依存保存先はプロジェクト内 `.pnpm-store` に統一した。古いnode_modulesからの初回切替で「store不一致」「No TTY」が出る環境では、`CI=true pnpm install --frozen-lockfile --optimistic-repeat-install=false` でlockfileから整合させる。今回の作業ではこの再構築後に通常コマンドを確認する。

## 実装レビューと修正（2026-11-10）

実装・計画・保存境界・非同期の認証状態をコードで確認し、以下を修正した。独立した外部セキュリティレビューの代わりにはしない。

| 問題 | 修正と回帰確認 |
| --- | --- |
| 完全削除後に進行中uploadをcommitすると文書が再出現する | 同じ文書の未失効uploadがあればpurgeをBusyで拒否。既存内容の保持をRust、実Wasmで確認 |
| upload/importの開始後に他の書込みで件数上限に達すると上限を超える | commit、restore stage/finish、削除時にも10000件の上限を再検査。Rustで上限到達後の拒否と既存内容保持を確認 |
| 最大sequenceの復旧後に更新するとSQLite整数が負になる | 保存・削除・完全削除の前にi64上限を検査し、QuotaExceededで拒否。境界テストを追加 |
| ロック前の応答が次の保管庫のheaderや認証状態を上書きする | 応答をローカル変数に受け、世代確認後に公開。バックアップ確認の遅延応答をVitestで検査 |
| 復旧失敗時に復号鍵への参照が残る | 失敗した世代だけをlockしてraw keyを消去。新しい世代を巻き込まないこともVitestで確認。作成・解除の失敗時もtransport鍵を破棄 |
| ファイル読込み中のロック後に復旧が開始する | 読込み前の世代を保存し、復旧APIの呼出し前に再確認。ブラウザでbegin_restoreが送信されないことを検査 |
| archive検証が非正規のID・数値や復旧できないrevision順を許す | base64urlと10進数を正規化済み表現に限定し、i64上限・件数・文書ごとのrevision増加を検査 |

修正後にRust 11件、Vitest 11件、実Wasm/PocketIC 4シナリオ、独立復旧CLI、ブラウザE2E、ローカルIIを再実行し成功。型検査、production build、Rustfmt/Prettier、Candid/binding一致も確認した。本番vetKeysでの実測結果は含まない。
