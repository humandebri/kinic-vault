# Scope

- 設計・計画段階。実装着手前に docs/design.md、docs/implementation-plan.md、docs/canister-reuse.md を読む。
- 保存基盤は kinic-wiki の固定版 ic-sqlite-vfs と SQLite 互換層を再利用する。別の MemoryManager や独自 stable-structures store を無検証で追加しない。
- 文書の「提案」をユーザーの確定要件・承認に置き換えない。
- 既存の kinic-wiki と独立させ、接続設定・認証情報・データを無断で複製しない。
- 実際の秘密・パスワード・契約書をテスト、ログ、Git、PR、AI 入力に使わない。

# Cloudflare

- Cloudflare 操作は公式 cf CLI を使う。インストール済みのヘルプで構文を確認する。
- Wrangler のコマンドを名前だけ置換しない。必要なビルド依存は根拠なく削除しない。

# Git

- 作業前に Git の状態を確認し、既存変更を保持する。
- Worktree が必要なら Codex 管理を優先し、/private/tmp に作らない。
- PR のタイトルと本文は英語。コミットは内容を正しく説明する。
