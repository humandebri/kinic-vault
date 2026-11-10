# 計画レビューへの対応

2026-11-10。対象は文書の改訂。実装・動作試験・本番安全性の検証完了を意味しない。

| 指摘 | 仕様での対応 | 実装計画での検証 |
| --- | --- | --- |
| P1 保管庫作成の循環 | §6 reserve→Pending初回鍵取得→activate。header読出しと再送・失効を定義 | Task 1/2：初回一巡、再送、期限切れGC競合、Active上書き拒否 |
| P1 登録と全体予算 | §4/7 許可owner1件、自己登録なし、全体200 MiB/物理1 GiB候補、課金前の認可・予約 | Task 1/2/5：複数の未登録principal、並行予約、0-byte増殖、全体枠消費の拒否 |
| P1 バックアップ整合性 | §9 exportのcommit sequence固定、24時間保持、GC/purgeとの協調、完成manifest認証 | Task 3：編集中export、10版退役、purge、再開、失効、欠落検出 |
| P2 ロックと遅延応答 | §4/7 fresh WebAuthn assertionをbackendで検証。unlock generationで遅延結果を破棄 | Task 1/4：IIのみの解除拒否、replay/UV/transport取り違え、ロック後の応答 |
| P2 復旧ID/AAD | §9 元vault/object/revision/epochを保持。本文/DEK/recovery AADにowner/canisterを含めず、VRKだけ再ラップ | Task 1/3：新canister/principal、バイト一致、ID衝突、旧owner拒否、途中importの不可視性 |

追加の設計判断：パスキーによる本人確認を導入する案を明記した。対応端末/ブラウザ、backend verifier、credential喪失時の復旧をTask 1/3/4で確認する。ユーザーがこれを承認済みであるとは扱わない。

文書を読み合わせ、状態遷移、認証の初回登録例外、backendが検証できる情報とclientだけが検証できるMAC、費用計算を整合させた。自動チェックはローカルリンク・旧API名の残存・必要な検証項目・計算式を対象とする。製品コードのテストは未実施。

## 容量と運用の追加指摘への対応

今回のユーザー確認に基づく文書改訂。実装開始・配布の承認は含まない。

| 指摘 | 文書での対応 | 未実施の検証 |
| --- | --- | --- |
| 個人用として容量が大きい | 添付10 MiB、メモ256 KiB、保管庫の現行データ100 MiB、owner/全体各200 MiB、保管庫3個、現行版込み10版、保管庫ごと同時upload 1件 | Task 2：境界値、履歴/保持/予約の総量、失敗時の非破壊性 |
| 小容量でも物理割当が増え得る | 物理1 GiBを検証候補に縮小。SQLite/VFSの増幅を含めて検証し、費用資料も既存単価から再計算 | Task 2/5：実Wasmの割当・安全域・cycles実測 |
| 初期版の範囲が広い | 大容量・並列upload・共有・自動バックアップは後続。安全性と独立復旧は維持 | Task 1の適合性確認後に工数を見積もる |
| 手動バックアップの取り忘れ | 最終保存確認sequence/時刻、未作成/変更あり、snapshot以降は復旧不可と明記 | Task 3/4：保存確認・export中編集・再ログイン・upgrade・復旧先での状態 |
| ドメイン移転が認証に影響 | frontend origin/II derivation origin/RP ID/許可originを区別。運用用初回登録前に固定し移行経路を記録 | Task 1/4：合成アカウントで実証。ドメイン自体は未確定 |
| Wikiの実装をさらに参照 | 固定commitの履歴ページング、再送receipt、競合・upgrade試験を実コードで確認し、canister-reuse.mdに追加 | Task 1/2：Vault向け適合性と失敗注入。元コードの成功をVaultの検証完了とはみなさない |
