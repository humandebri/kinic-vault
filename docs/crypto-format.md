# 暗号形式 v1

ローカル実装で使用する形式。実装は `packages/crypto`、固定ベクトルは `packages/crypto/test/vector.json`。同じベクトルをWebCryptoとRust aes-gcmで検証する。

## 鍵とenvelope

保管庫IDは16バイト、VRK/DEK/recovery secretは各32バイト。ブラウザのWebCryptoで生成する。文書の各版で新しいDEKを作る。

AES-256-GCM、96-bitランダムnonce、128-bit tag。envelopeはversion=1、nonce、ciphertext（暗号文末尾にtag）。32バイトの鍵を包むenvelopeのciphertextは48バイト。JSON内のバイト列はbase64url・paddingなし、Candidではblob。鍵はnon-extractable CryptoKeyとしてimportする。

vetKDはkey_name=`test_key_1`、context=UTF-8 `kinic-vault/kek/v1`、input=`vault_id[16] || epoch_u64_be[8]`。ローカルcanisterは他のkey_name/originをinstall時に拒否する。SDKに埋め込まれたPocketICのmaster public keyから期待するcanister/contextの公開鍵を導出し、返された公開鍵を信頼の起点にしない。transport secretはSessionにだけ参照を保持し、ロックで破棄する。

vetKeyからKEKへの変換は公式SDK `deriveSymmetricKey('kinic-vault/vrk-wrap/v1',32)`。recovery secret→復旧鍵、VRK→archive認証鍵はHKDF-SHA256、salt=32個の0、infoはそれぞれUTF-8 `kinic-vault/recovery/v1` / `kinic-vault/archive/v1`。

1 DEKの用途はmetadata1件と最大10チャンク。nonceを各暗号化で新規生成し、DEKを版や失敗した保存の次の試行へ再利用しない。VRKの長期利用・nonce使用回数の厳密な生涯予算と鍵更新は、本番移行前の暗号レビュー対象として残す。JavaScriptによる完全なメモリ消去は保証しない。

## AAD

各fieldを `length_u32_be || bytes` として、次の順に連結する。

1. UTF-8 `kinic-vault/envelope/v1`
2. vault ID（16バイト）
3. object ID（16バイト）
4. revision（u64 big-endian）
5. UTF-8用途名
6. chunk index（u32 big-endian）

用途はnormal/recovery/dek/metadata/chunk/archive。normal/recoveryではobject ID=全0、revision=epoch、index=0。archiveではobject ID=全0、revision=snapshot sequence、index=0。文書では元object ID/revisionを使用する。owner/canisterは本文・DEK・recoveryのAADへ含めず、backend認可とvetKDの検証tupleで拘束する。

## 文書manifest

UTF-8 JSONでversion、暗号化DEK、暗号化metadata、各chunkのnonceを保存する。metadataには種類・タイトル・ファイル名・MIMEを含めて暗号化する。メモはUTF-8、認証情報はlabel/username/password/URL/notesのJSON、添付は元バイト列。

各chunkの暗号文とtagを生のblobで保存し、manifestに対応するSHA-256を公開契約として送る。平文は1チャンク1 MiB、空文書もtag付き1チャンク。最終チャンク長は宣言サイズと一致させる。nonce・暗号文・AADの取り違えはAEADで拒否する。

## バックアップ

magicはASCII `KVLT0001`。続くframeは `length_u32_be || payload`。

- 最初のframe：headerとrecord件数のJSON。headerにはvault/epoch/sequence、鍵情報、両VRK envelope、snapshotのrecord件数・chunk件数・平文総バイト数を含む。
- 各record：ID・版・sequence・サイズ・manifest・chunk hash・削除状態のJSON frame。その後にそのrecordの各chunk frame。
- 全recordの後：長さ0の終端、最後に認証用envelopeのJSON frame。

認証用envelopeは、終端より前の全バイトのSHA-256・件数・長さをJSONにし、archive鍵/AADでAES-GCM暗号化したもの。全体上限256 MiB、record上限10,000、record JSON上限100,000 bytes。重複・非単調sequence・件数/サイズ不一致・欠落・余剰バイトを拒否する。復旧時は復旧envelopeからVRKを得て最終認証と全DEK/metadata/chunkのAEADを検証する。

restoreの集合照合は、sequence順のrecordについて次のleafを作り、初期値32個の0から `chain=SHA256(chain || leaf)` を計算する。

`leaf=SHA256(UTF8('kinic-vault/restore-record/v1') || vault[16] || object[16] || revision_u64_be || sequence_u64_be || plain_size_u64_be || deleted_u8 || manifest_length_u32_be || manifest || hash_count_u32_be || chunk_hashes)`

backendはこれと宣言件数・各hash・容量を検証する。VRKを持たないbackendがarchive認証を検証したとは扱わず、送信前のclient検証を必須とする。
