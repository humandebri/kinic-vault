# 費用と一次資料

調査日：2026-11-10。価格は変更され得る。以下は実測でなく公開単価の概算。

## 計算条件

13ノードの application subnet に Vault backend、production key_1 を使用。1兆 cycles = 1 XDR。換算は仮定として 1 XDR = $1.37、月30日、GiB = 2^30 bytes。為替相場を取得した値ではない。

| 項目 | cycles | この仮定による USD |
| --- | ---: | ---: |
| key_1 の vetKey 取得1回 | 26,153,846,153 | 0.03583077 |
| test_key_1 の取得1回 | 10,000,000,000 | 0.0137 |
| 保存1 GiB・1秒、13ノード | 127,000 | — |
| 保存1 GiB・30日、13ノード | 329,184,000,000 | 0.45098208 |
| ingress 1 byte 受信、13ノード | 2,000 | — |
| ingress 1 GiB 受信のバイト料金 | 2,147,483,648,000 | 2.94205260 |
| canister 作成、13ノード | 500,000,000,000 | 0.685 |
| compute allocation 1%・30日 | 25,920,000,000,000 | 35.5104 |

公開鍵 API 自体は無料。query の現行 cycles 料金は無料。通常の update、鍵要求のラッパー、CPU、受信の基本料金などは別。production vetKeys の料金は鍵の subnet に従い、呼出元を13ノードにしても上表の key_1 料金は変わらない。

## 利用例

`月額概算 USD = (実割当メモリ GiB × 127000 × 2592000 + 鍵取得回数 × 26153846153) / 10^12 × 1.37`

| 保存量 | 鍵取得/月 | 保存 | 鍵取得 | 合計 |
| --- | ---: | ---: | ---: | ---: |
| 200 MiB（論理quotaと同量を仮置き） | 60 | $0.09 | $2.15 | $2.24 |
| 1 GiB（物理割当の検証候補上限） | 60 | $0.45 | $2.15 | $2.60 |
| 10 GiB | 440 | $4.51 | $15.77 | $20.28 |
| 100 GiB | 2,200 | $45.10 | $78.83 | $123.93 |

10/100 GiB は将来拡張時の例であり、初期 quota を変更せず保存できるという意味ではない。60回は個人が毎日2回解除する例。複数の保管庫を解除すればその分増える。10,000回の鍵取得だけなら約$358.31。

10 MiB のPDFを1回送るバイト料金は約$0.0287。すべて再送すれば受信料金も再度必要。初期 upload と毎月の保存料金を混同しない。

履歴、削除後の再利用可能領域、metadata、索引、Wasm heap、複製した snapshot、受信/実行料金、バックアップ先、監視、ドメイン、開発・外部レビュー費用は上表に含まない。purge 後も stable memory の割当が縮むとは限らない。ネットワークのレプリカ数をさらに掛ける必要はなく、13ノードの単価に複製分が含まれる。

## Private pilot の予算上限

初期の許可ownerは1件、日100回の鍵要求が上限なので鍵取得の最大額は約$3.58/日、30日で約$107.49。全体1,000回/日は二次的な上限であり、登録ownerが増えた場合の安全な予算を保証しない。許可ownerを増やす段階で全体予算を見直す。未登録principalは外部derive前に拒否するが、拒否メッセージ自体の受信・実行コストをゼロにはできない。

全体・所有者のアプリ管理データ上限は各200 MiB、保管庫の現行データは100 MiB、添付は10 MiBに縮小する。物理割当上限は1 GiBを検証候補とする。既存の上記単価・換算仮定による再計算では、200 MiB相当の保存は約$0.0881/月、物理1 GiBがすべて保存課金対象なら約$0.4510/月。論理quotaだけから実割当や請求額は確定できず、SQLite/VFSの増幅分を含めて検証する。今回の改訂で単価の再調査は行っていない。実際のWasm/管理メモリ・予約・snapshot保持による一時容量を計測して運転残高を決める。バックアップ中の履歴保持もquotaに含める。利用者追加を無料・無制限に受け付ける予算ではない。

WebAuthn はブラウザ本人確認と署名検証を追加する。新たな外部認証サービスへの従量課金を前提にしないが、challenge管理・検証の通常update/CPU料金は実測対象。

## Cloudflare

Workers Static Assets の静的ファイルへのリクエストは現行無料・無制限。Worker コードを実行するリクエストは別の Workers 料金。初期案は SSR/API を持たない静的 SPA とし、文書を Cloudflare の asset としてアップロードしない。

単一静的 asset の25 MiB上限は frontend build に対するもの。IC に直接送る契約書の10 MiB上限とは別。実際のbuild/asset数/ドメイン/プラン要件は実装時に確認する。

## 運転資金と費用の確定

月次消費に加えて freezing threshold と最低残高を満たす cycles が必要。subnet の使用量次第ではストレージ割当時に cycles が予約される。前払いの保有額と消費を区別する。初期値は compute_allocation=0 を候補とし、メモリも不要な固定予約を避ける。

開発・監査の工数は未見積り。Task 1 でライブラリ互換性、解除待ち時間、転送、実消費を測ってから予算を更新する。

## 一次資料

- [vetKeys 概要・API・料金](https://docs.internetcomputer.org/concepts/vetkeys/)
- [vetKD API と鍵所在・課金 subnet](https://legacy.internetcomputer.org/docs/building-apps/network-features/vetkeys/api)
- [管理 canister の正式 API](https://docs.internetcomputer.org/references/ic-interface-spec/management-canister/)
- [一般の cycles 単価・予約料金](https://docs.internetcomputer.org/references/cycle-costs/)
- [メッセージとメモリの上限](https://docs.internetcomputer.org/references/resource-limits/)
- [公式 EncryptedMaps 案内](https://skills.internetcomputer.org/skills/encrypted-maps/)
- [公式 frontend キャッシュ仕様](https://dfinity.github.io/vetkeys/classes/_icp-sdk_vetkeys_encrypted_maps.EncryptedMaps.html)
- [Rust ライブラリ更新履歴](https://github.com/dfinity/vetkeys/blob/main/backend/rs/ic_vetkeys/CHANGELOG.md)
- [ic-vetkeys 0.9.0 のソース・依存](https://docs.rs/crate/ic-vetkeys/0.9.0/source/)
- [canister 移転と ID の維持](https://cli.internetcomputer.org/1.7/guides/canister-migration/)
- [II の origin/principal 仕様](https://docs.internetcomputer.org/references/internet-identity-spec/)
- [IC のセキュリティモデル](https://docs.internetcomputer.org/concepts/security/)
- [Cloudflare 静的配信の料金](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Cloudflare の asset 上限](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare の CSP](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/content-security-policies/)

公式資料間に旧パッケージ名・旧版の記載が残る。SDK の版は概要ページだけでなく正式配布物と更新履歴で確認する。無料・上限・料金を永続的な保証とは扱わない。

計画レビュー対応の追加根拠：[W3C WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)（challenge、origin、RP ID、UP/UV、署名検証とsignature counter）。具体的なverifier/ブラウザ互換性はTask 1で実証する。
