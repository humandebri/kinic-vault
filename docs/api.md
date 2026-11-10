# APIと状態遷移

正式な型は `packages/contracts/vault.did`。Rustの公開関数から生成し、JS/TS bindingとの一致を `node tools/contracts.mjs --check` で確認する。

全データAPIはinstall時のowner1件とcallerを照合する。ownerはリクエスト本文から受け取らない。公開の自己登録、allowlist追加、任意SQLのAPIはない。

## 作成・解除

`reserve_vault → Pending → derive_vault_key → begin_unlock(Activate) → activate_vault → Active`。Pending/Restoringの内容は一般APIから不可視。初回登録後、追加保管庫のactivateにも既存credentialのfresh assertionが必要。Pendingは24時間失効しIDを再利用しない。

Activeの解除は `begin_unlock(Unlock) → WebAuthn assertion → derive_vault_key`。challengeはvault/epoch/用途/transport/targetをサーバー状態に束縛し、120秒・1回限り。UP/UV、署名、RP ID、origin、credential ID、crossOrigin、期限を検証する。同期passkeyのcounter=0を受け付ける。II認証だけでActiveの鍵を取得する経路はない。

鍵取得前に認可、入力、残高、日100回・同時1件を確認し、await後にtoken/状態/epoch/期限を再検査する。失敗した外部呼出しも回数を消費する。private pilotはowner1件なので全体1,000回より厳しい上限になる。

credential追加は、登録challenge→`prepare_unlock_credential`による候補検証→候補digestに束縛した新challenge→既存credentialのassertion→`manage_unlock_credential`。削除は削除対象IDに束縛したchallengeとassertionを使う。最後の1件は削除できない。

## 保存

`begin_revision → put_chunk* → commit_revision`。expected_revisionは開始とcommit時の両方で検査する。operation/upload IDは16バイト。同一index・同一bytesの再送だけ成功する。manifest/全chunkが揃うまでheadを公開しない。

revision・head・quota・receiptを同期SQL transactionで更新する。アプリErrorをSQLの失敗へ変換して必ずrollbackし、外部callはSQLの外で行う。receiptは成功から24時間保持し、期限を過ぎた再送の同じ結果は保証しない。GC前の期限切れuploadはExpired、GCでそのdigestを持つExpired receiptを作る。

manifest/list/historyはupdate、chunkは認可済みquery。clientは取得済みmanifest/hashとAEADを照合する。一覧は100件・概算800,000 response bytes、履歴は10件・同じbytes上限。管理record数も制限する。

保管庫現行データ100 MiB、所有者/全体の課金用予約・保持量200 MiB。公開quotaは現行保管庫容量と全体のcharged/reservedを返す。暗号文、履歴、chunk/recordの余裕、JSON receipt、export、復旧中予約、設定の余裕を計上する。実SQLite物理サイズとは別の保守的な会計である。

MemoryId=10の単一DB。物理割当候補1 GiBはstable+Wasm heapの増加後に検査し、超過するmessageをtrapしてIC側でrollbackする。200 MiB相当の最大実データを使う負荷試験は未実施。

## バックアップ・復旧・削除

begin_exportはheaderとsequence、件数・chunk数・総平文サイズを固定する。export_indexはsequence順にページングする。get_active_exportで未失効のsnapshotを取得し、ダウンロードを最初から再作成しても同じ集合を使う。GCは有効exportのある保管庫の退役版を保持し、purgeはExportInProgressで拒否する。finishはclient検証と保存確認後に呼び、保存確認sequence/時刻を保持する。中止・失効を成功として記録しない。

復旧は `begin_restore → (begin_restore_revision → put_restore_chunk* → commit_restore_revision)* → commit_restore`。元ID/版/epoch/sequence/暗号文を保持し、通常利用用VRK envelopeだけ新canisterのKEKで包み直す。既存IDは上書きしない。集合root、件数、各hash、quotaを照合してから新credentialと共に一括有効化する。activate_vaultからRestoringを有効化するバイパスはない。復旧先のバックアップ状態は未作成から始める。

deleteはtombstone版を追加する。UIでは削除済み文書もタイトルと履歴を表示し、残った版のダウンロードと明示purgeができる。purge後もheadのIDを予約したままにして、古いAADのID/版を再利用しない。過去バックアップや取得済みコピーは消さない。

collect_garbageは期限切れupload最大1件、回収可能なrevision最大1件、期限切れreceipt/export各最大100件を処理する。更新開始・画面一覧更新でも実行する。期限切れrestoreは予約を解放し、後続GCで段階的にchunkを回収する。
