import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import DOMPurify from "dompurify";
import { marked, Renderer } from "marked";
import { VaultClient, ok, bytes, type Item } from "./api.ts";
import { utf8, randomBytes } from "../../../packages/crypto/src/index.ts";
import { b64, type Metadata } from "../../../packages/crypto/src/documents.ts";
import type {
  Header,
  Revision,
  CredentialInfo,
  Quota,
} from "../../../packages/contracts/vault.did.js";
import "./style.css";
const renderer = new Renderer();
renderer.html = () => "";
renderer.image = () => "";
renderer.link = ({ text, href }) =>
  `${DOMPurify.sanitize(text, { ALLOWED_TAGS: [] })} (${DOMPurify.sanitize(href, { ALLOWED_TAGS: [] })})`;
const markdown = (text: string) =>
  DOMPurify.sanitize(marked.parse(text, { renderer, async: false }) as string, {
    ALLOWED_TAGS: [
      "p",
      "h1",
      "h2",
      "h3",
      "h4",
      "ul",
      "ol",
      "li",
      "strong",
      "em",
      "pre",
      "code",
      "blockquote",
      "hr",
      "br",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    ALLOWED_ATTR: [],
  });
const messages: Record<string, string> = {
  Unauthorized:
    "このIdentityは許可されていません。所有者の設定を確認してください。",
  Conflict:
    "ほかの更新と競合しました。一覧を更新して、もう一度開いてください。",
  QuotaExceeded:
    "保存容量または操作回数の上限です。バックアップの完了・中止やデータ整理を確認してください。",
  SizeLimit:
    "サイズの上限です。添付は10 MiB、メモ・認証情報は256 KiBまでです。",
  Busy: "処理中の操作があります。完了または期限切れを待ってください。",
  Expired: "操作が期限切れです。もう一度開始してください。",
  Locked: "ロックしました。もう一度本人確認して解除してください。",
  RecoveryConfirmationMismatch:
    "復旧用秘密が一致しません。保管した値を再入力してください。",
  LocalConfigurationRequired:
    "ローカルcanisterの設定がありません。ローカル起動手順を確認してください。",
  LocalIIConfigurationRequired:
    "ローカルInternet IdentityのURLを設定してください。",
  ExportInProgress:
    "バックアップ中は完全削除できません。先に完了または中止してください。",
  ConnectionInterrupted:
    "通信が中断しました。同じ操作の再送に失敗しました。アップロードは24時間で失効します。",
};
function App() {
  const client = useRef(new VaultClient()).current;
  const [logged, setLogged] = useState(false),
    [vaults, setVaults] = useState<Header[]>([]),
    [selected, setSelected] = useState<Header>(),
    [unlocked, setUnlocked] = useState(false),
    [items, setItems] = useState<Item[]>([]),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [generation, setGeneration] = useState(0),
    [quota, setQuota] = useState<Quota>();
  const [kit, setKit] =
      useState<Awaited<ReturnType<VaultClient["createKit"]>>>(),
    [confirm, setConfirm] = useState(""),
    [current, setCurrent] = useState<Item>(),
    [title, setTitle] = useState(""),
    [kind, setKind] = useState<Metadata["kind"]>("note"),
    [body, setBody] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [url, setUrl] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [file, setFile] = useState<File>(),
    [preview, setPreview] = useState(""),
    [history, setHistory] = useState<Revision[]>([]),
    [credentials, setCredentials] = useState<CredentialInfo[]>([]),
    [progress, setProgress] = useState(0),
    [backup, setBackup] = useState<{
      exportId: Uint8Array;
      data: Uint8Array;
    }>(),
    [restoreFile, setRestoreFile] = useState<File>(),
    [restoreSecret, setRestoreSecret] = useState("");
  const resetEditor = () => {
    setCurrent(undefined);
    setTitle("");
    setBody("");
    setUsername("");
    setPassword("");
    setUrl("");
    setPreview("");
    setHistory([]);
    setFile(undefined);
    setShowPassword(false);
  };
  useEffect(() => {
    client.session.onLock = () => {
      setUnlocked(false);
      setItems([]);
      setQuery("");
      resetEditor();
      setKit(undefined);
      setConfirm("");
      setRestoreSecret("");
      setRestoreFile(undefined);
      setBackup(undefined);
      setCredentials([]);
      setQuota(undefined);
      setGeneration(client.session.generation);
    };
    const activity = () => client.session.activity(),
      visible = () => client.session.visible(document.hidden),
      pagehide = () => client.session.lock();
    for (const event of ["pointerdown", "keydown"])
      window.addEventListener(event, activity);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pagehide", pagehide);
    const timer = setInterval(() => client.session.expire(), 1000);
    return () => {
      clearInterval(timer);
      for (const e of ["pointerdown", "keydown"])
        window.removeEventListener(e, activity);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pagehide", pagehide);
      client.session.lock();
    };
  }, [client]);
  const work = async (f: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await f();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setError(
        messages[code] ??
          "処理に失敗しました。本人確認・バックアップ・接続設定を確認して再試行してください。",
      );
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    const g = client.session.capture();
    ok(await client.actor.collect_garbage());
    client.session.check(g);
    const list = await client.items();
    const q = ok(await client.actor.get_quota(client.header!.id));
    client.session.check(g);
    setItems(list);
    setSelected(client.header);
    setQuota(q);
    const vaults = ok(await client.actor.list_vaults());
    client.session.check(g);
    setVaults(vaults);
  };
  const openItem = async (item: Item) => {
    const g = client.session.capture();
    if (item.revision.deleted) {
      resetEditor();
      setCurrent(item);
      setKind(item.metadata.kind);
      setTitle(item.metadata.title);
      return;
    }
    const doc = await client.read(item.revision);
    client.session.check(g);
    resetEditor();
    setCurrent(item);
    setKind(doc.metadata.kind);
    setTitle(doc.metadata.title);
    if (doc.metadata.kind === "credential") {
      const v = JSON.parse(new TextDecoder().decode(doc.plaintext));
      setUsername(v.username ?? "");
      setPassword(v.password ?? "");
      setUrl(v.URL ?? "");
      setBody(v.notes ?? "");
    } else if (doc.metadata.kind === "note") {
      setBody(new TextDecoder().decode(doc.plaintext));
      setPreview(new TextDecoder().decode(doc.plaintext));
    }
    doc.plaintext.fill(0);
  };
  const backupStatus =
    selected?.backup_sequence[0] === undefined
      ? "バックアップ未作成"
      : selected.sequence > selected.backup_sequence[0]
        ? "バックアップ後に変更あり"
        : "保存確認済み";
  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            K
          </span>
          <span>
            KINIC <b>VAULT</b>
          </span>
        </div>
        <div className="top-actions">
          <span className={"state " + (unlocked ? "open" : "")}>
            {unlocked ? "解除中" : "ロック中"}
          </span>
          {logged && (
            <>
              <button onClick={() => client.session.lock()}>ロック</button>
              <button
                onClick={() => {
                  client.session.lock();
                  setLogged(false);
                  setVaults([]);
                  setSelected(undefined);
                  void client
                    .logout()
                    .catch(() =>
                      setError(
                        "ログアウト処理に失敗しました。ページを閉じてください。",
                      ),
                    );
                }}
              >
                ログアウト
              </button>
            </>
          )}
        </div>
      </header>
      <main>
        {import.meta.env.MODE === "test" && (
          <p className="notice">
            合成データ専用のローカル環境です。実際の秘密は保存しないでください。
          </p>
        )}
        <div className="intro">
          <p className="eyebrow">PRIVATE WORKSPACE</p>
          <h1>大切な情報を、ひとつの保管庫へ。</h1>
          <p>メモ、認証情報、文書を暗号化して保管します。</p>
        </div>
        <div className="alerts" aria-live="polite">
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && <p className="notice">{notice}</p>}
          {busy && (
            <p role="status">処理中… {progress > 0 ? `${progress}%` : ""}</p>
          )}
        </div>
        {!logged ? (
          <section className="welcome panel">
            <div className="welcome-copy">
              <p className="eyebrow">YOUR PRIVATE ARCHIVE</p>
              <h2>まずはログイン</h2>
              <p>
                Internet
                Identityで所有者を確認します。保管庫を開くときは、登録したパスキーでも本人確認します。
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void work(async () => {
                    const list = await client.login();
                    setVaults(list);
                    setLogged(true);
                  })
                }
              >
                {import.meta.env.MODE === "test"
                  ? "合成Identityでログイン"
                  : "Internet Identityでログイン"}
              </button>
              <p className="small">
                初期版は個人用です。復旧には暗号化バックアップと復旧用秘密の両方が必要です。
              </p>
            </div>
            <div className="vault-illustration" aria-hidden="true">
              <div className="vault-door">
                <span>PRIVATE</span>
                <div className="dial">✳</div>
                <small>KINIC VAULT</small>
              </div>
            </div>
          </section>
        ) : (
          <div className="workspace">
            <aside className="sidebar panel">
              <h2>保管庫</h2>
              <p className="small">最大3個 · 各100 MiB</p>
              <div className="vault-list">
                {vaults.map((v, i) => (
                  <button
                    key={b64(bytes(v.id))}
                    className={
                      selected && b64(bytes(selected.id)) === b64(bytes(v.id))
                        ? "selected"
                        : ""
                    }
                    disabled={busy}
                    onClick={() => {
                      client.session.lock();
                      client.header = v;
                      setSelected(v);
                    }}
                  >
                    保管庫 {i + 1}
                    <span>›</span>
                  </button>
                ))}
              </div>
              <button
                disabled={busy || vaults.length >= 3}
                onClick={() =>
                  void work(async () => {
                    const kit = await client.createKit();
                    setSelected(undefined);
                    setKit(kit);
                  })
                }
              >
                ＋ 保管庫を作成
              </button>
              <p className="small">
                履歴・処理中データを含めて合計200 MiBまで。
              </p>
              <details>
                <summary>バックアップから復旧</summary>
                <p className="small">
                  新しいcanisterへの復旧用です。既存の保管庫は上書きしません。
                </p>
                <label>
                  バックアップ
                  <input
                    key={"restore-" + generation}
                    type="file"
                    accept=".kvault"
                    onChange={(e) => setRestoreFile(e.target.files?.[0])}
                  />
                </label>
                <label>
                  復旧用秘密
                  <input
                    type="password"
                    autoComplete="off"
                    value={restoreSecret}
                    onChange={(e) => setRestoreSecret(e.target.value)}
                  />
                </label>
                <button
                  disabled={busy || !restoreFile || !restoreSecret}
                  onClick={() =>
                    void work(async () => {
                      const file = restoreFile!;
                      if (file.size > 256 * 1024 * 1024)
                        throw Error("SizeLimit");
                      const secret = restoreSecret;
                      setRestoreSecret("");
                      const g = client.session.capture();
                      const data = new Uint8Array(await file.arrayBuffer());
                      client.session.check(g);
                      await client.restore(data, secret);
                      setUnlocked(true);
                      setRestoreFile(undefined);
                      await refresh();
                    })
                  }
                >
                  検証して復旧
                </button>
              </details>
            </aside>
            <section className="content panel">
              {kit ? (
                <div className="setup">
                  <h2>復旧用秘密を保管してください</h2>
                  <p>
                    別の安全な場所に保管し、確認のため再入力してください。この値だけでは復旧できません。
                  </p>
                  <label>
                    今回の復旧用秘密
                    <output className="secret">{kit.secret}</output>
                  </label>
                  <button
                    onClick={() =>
                      void work(async () => {
                        await navigator.clipboard.writeText(kit.secret);
                        setNotice(
                          "復旧用秘密をコピーしました。クリップボードは自動消去されません。",
                        );
                      })
                    }
                  >
                    復旧用秘密をコピー
                  </button>
                  <label>
                    保存した値を再入力
                    <input
                      type="password"
                      autoComplete="off"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={busy || !confirm}
                    onClick={() =>
                      void work(async () => {
                        await client.activate(kit, confirm);
                        setKit(undefined);
                        setConfirm("");
                        setUnlocked(true);
                        await refresh();
                        setNotice(
                          "保管庫を作成しました。最初のバックアップを保存してください。",
                        );
                      })
                    }
                  >
                    パスキーを登録して作成
                  </button>
                  <button onClick={() => client.session.lock()}>
                    中止してロック
                  </button>
                </div>
              ) : !unlocked ? (
                <div className="locked">
                  <div className="lock-symbol" aria-hidden="true">
                    ◇
                  </div>
                  <h2>
                    {selected
                      ? "保管庫はロックされています"
                      : "保管庫を選択してください"}
                  </h2>
                  <p>解除すると、この端末で文書を閲覧・編集できます。</p>
                  {selected && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void work(async () => {
                          await client.unlock(selected);
                          setUnlocked(true);
                          await refresh();
                        })
                      }
                    >
                      パスキーで解除
                    </button>
                  )}
                  <p className="small">
                    パスキーを失った場合は、バックアップから復旧してください。
                  </p>
                </div>
              ) : (
                <>
                  <div className="section-head">
                    <div>
                      <h2>保管庫の文書</h2>
                      <p className="small">
                        {quota
                          ? `${(Number(quota.current) / 1048576).toFixed(2)} / 100 MiB`
                          : "容量を取得中"}{" "}
                        · 最大10版
                        {quota && (
                          <span>
                            {" "}
                            · 履歴・処理中込み{" "}
                            {(
                              (Number(quota.charged) + Number(quota.reserved)) /
                              1048576
                            ).toFixed(2)}{" "}
                            / 200 MiB
                          </span>
                        )}
                      </p>
                    </div>
                    <button disabled={busy} onClick={() => void work(refresh)}>
                      一覧を更新
                    </button>
                  </div>
                  <div className="backup-strip">
                    <span>
                      {backupStatus}
                      {selected?.backup_at[0] !== undefined && (
                        <small>
                          最終保存確認{" "}
                          {new Date(
                            Number(selected.backup_at[0]) * 1000,
                          ).toLocaleString("ja-JP")}
                        </small>
                      )}
                    </span>
                    <button
                      disabled={busy || !!backup}
                      onClick={() =>
                        void work(async () => {
                          const result = await client.backup();
                          setBackup(result);
                          client.session.download(
                            result.data,
                            "kinic-vault.kvault",
                          );
                        })
                      }
                    >
                      バックアップを保存
                    </button>
                  </div>
                  {backup && (
                    <div className="notice">
                      <p>
                        ファイルの保存を確認してください。バックアップのsnapshot以降の変更は、そのファイルから復旧できません。
                      </p>
                      <button
                        onClick={() =>
                          void work(async () => {
                            await client.confirmBackup(backup.exportId, true);
                            setBackup(undefined);
                            setSelected(client.header);
                          })
                        }
                      >
                        保存できました
                      </button>
                      <button
                        onClick={() =>
                          void work(async () => {
                            await client.confirmBackup(backup.exportId, false);
                            setBackup(undefined);
                          })
                        }
                      >
                        中止
                      </button>
                    </div>
                  )}
                  <div className="documents">
                    <div className="document-list">
                      <label>
                        文書を検索
                        <input
                          type="search"
                          placeholder="タイトル・メモを検索"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                      <button
                        disabled={busy}
                        onClick={() => {
                          resetEditor();
                          setKind("note");
                        }}
                      >
                        ＋ 新しい文書
                      </button>
                      {items
                        .filter((i) =>
                          (i.searchText ?? i.metadata.title)
                            .toLocaleLowerCase()
                            .includes(query.toLocaleLowerCase()),
                        )
                        .map((item) => (
                          <button
                            className="document"
                            key={b64(bytes(item.revision.object))}
                            disabled={busy}
                            onClick={() => void work(() => openItem(item))}
                          >
                            <span>
                              {item.revision.deleted ? "[削除済み] " : ""}
                              {item.metadata.title || "名称未設定"}
                            </span>
                            <small>
                              {item.metadata.kind === "note"
                                ? "メモ"
                                : item.metadata.kind === "credential"
                                  ? "認証情報"
                                  : "添付"}{" "}
                              · 第{String(item.revision.revision)}版
                            </small>
                          </button>
                        ))}
                      {items.length === 0 && (
                        <p className="small empty">
                          文書はまだありません。右のフォームから最初の文書を保存できます。
                        </p>
                      )}
                    </div>
                    <form
                      key={"editor-" + generation}
                      className="editor"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void work(async () => {
                          const g = client.session.capture();
                          let plain: Uint8Array;
                          let metadata: Metadata = { kind, title };
                          if (kind === "attachment") {
                            if (!file) throw Error("FileRequired");
                            if (file.size > 10485760) throw Error("SizeLimit");
                            metadata = {
                              ...metadata,
                              filename: file.name,
                              mime: file.type,
                            };
                            plain = new Uint8Array(await file.arrayBuffer());
                            client.session.check(g);
                          } else {
                            plain = utf8.encode(
                              kind === "credential"
                                ? JSON.stringify({
                                    label: title,
                                    username,
                                    password,
                                    URL: url,
                                    notes: body,
                                  })
                                : body,
                            );
                          }
                          try {
                            await client.save(
                              metadata,
                              plain,
                              current,
                              setProgress,
                            );
                            resetEditor();
                            await refresh();
                            setProgress(0);
                            setNotice(
                              "暗号化して保存しました。バックアップも更新してください。",
                            );
                          } finally {
                            plain.fill(0);
                          }
                        });
                      }}
                    >
                      <div className="section-head">
                        <h3>{current ? "文書を編集" : "新しい文書"}</h3>
                        {current && (
                          <small>
                            {current.revision.deleted
                              ? "削除済み · 履歴からダウンロードできます"
                              : "第" + String(current.revision.revision) + "版"}
                          </small>
                        )}
                      </div>
                      <label>
                        種類
                        <select
                          value={kind}
                          disabled={!!current}
                          onChange={(e) =>
                            setKind(e.target.value as Metadata["kind"])
                          }
                        >
                          <option value="note">メモ</option>
                          <option value="credential">認証情報</option>
                          <option value="attachment">添付ファイル</option>
                        </select>
                      </label>
                      <label>
                        タイトル
                        <input
                          required
                          maxLength={512}
                          value={title}
                          autoComplete="off"
                          onChange={(e) => setTitle(e.target.value)}
                        />
                      </label>
                      {kind === "credential" && (
                        <>
                          <label>
                            ユーザー名
                            <input
                              value={username}
                              autoComplete="off"
                              onChange={(e) => setUsername(e.target.value)}
                            />
                          </label>
                          <label>
                            パスワード
                            <input
                              type={showPassword ? "text" : "password"}
                              autoComplete="new-password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                            />
                          </label>
                          <div className="row">
                            <button
                              type="button"
                              onClick={() => setShowPassword((v) => !v)}
                            >
                              {showPassword
                                ? "パスワードを隠す"
                                : "パスワードを表示"}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void work(async () => {
                                  await navigator.clipboard.writeText(password);
                                  setNotice(
                                    "コピーしました。クリップボードは自動消去されません。",
                                  );
                                })
                              }
                            >
                              パスワードをコピー
                            </button>
                          </div>
                          <label>
                            URL
                            <input
                              value={url}
                              autoComplete="off"
                              onChange={(e) => setUrl(e.target.value)}
                            />
                          </label>
                        </>
                      )}
                      {kind !== "attachment" ? (
                        <label>
                          {kind === "note" ? "本文（Markdown）" : "メモ"}
                          <textarea
                            rows={10}
                            value={body}
                            autoComplete="off"
                            onChange={(e) => setBody(e.target.value)}
                          />
                        </label>
                      ) : (
                        <label>
                          ファイル（10 MiBまで）
                          <input
                            type="file"
                            onChange={(e) => setFile(e.target.files?.[0])}
                          />
                          <small>PDFも復号ダウンロードで開きます。</small>
                        </label>
                      )}
                      <div className="row">
                        <button
                          className="primary"
                          type="submit"
                          disabled={busy || !!current?.revision.deleted}
                        >
                          暗号化して保存
                        </button>
                        {kind === "note" && (
                          <button
                            type="button"
                            onClick={() => setPreview(body)}
                          >
                            プレビュー
                          </button>
                        )}
                        {current && !current.revision.deleted && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void work(async () => {
                                const g = client.session.capture();
                                const doc = await client.read(current.revision);
                                client.session.check(g);
                                client.session.download(
                                  doc.plaintext,
                                  doc.metadata.mime === "application/pdf"
                                    ? "document.pdf"
                                    : "document.bin",
                                );
                                doc.plaintext.fill(0);
                              })
                            }
                          >
                            復号ダウンロード
                          </button>
                        )}
                      </div>
                      {preview && (
                        <article
                          className="preview"
                          aria-label="Markdownプレビュー"
                          dangerouslySetInnerHTML={{
                            __html: markdown(preview),
                          }}
                        />
                      )}
                      {current && (
                        <div className="document-actions">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void work(async () => {
                                const g = client.session.capture();
                                const page = ok(
                                  await client.actor.list_history(
                                    current.revision.vault,
                                    current.revision.object,
                                    18446744073709551615n,
                                  ),
                                );
                                client.session.check(g);
                                setHistory(page.entries);
                              })
                            }
                          >
                            履歴を表示
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void work(async () => {
                                const g = client.session.capture();
                                ok(
                                  await client.actor.delete_object(
                                    current.revision.vault,
                                    current.revision.object,
                                    current.revision.revision,
                                    randomBytes(16),
                                  ),
                                );
                                client.session.check(g);
                                resetEditor();
                                const header = ok(
                                  await client.actor.get_vault_header(
                                    client.header!.id,
                                  ),
                                );
                                client.session.check(g);
                                client.header = header;
                                await refresh();
                              })
                            }
                          >
                            文書を削除
                          </button>
                          <button
                            className="danger"
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void work(async () => {
                                if (
                                  !window.confirm(
                                    "履歴を含めて完全削除します。手元のバックアップは消えません。",
                                  )
                                )
                                  return;
                                const g = client.session.capture();
                                ok(
                                  await client.actor.purge_object(
                                    current.revision.vault,
                                    current.revision.object,
                                  ),
                                );
                                client.session.check(g);
                                resetEditor();
                                const header = ok(
                                  await client.actor.get_vault_header(
                                    client.header!.id,
                                  ),
                                );
                                client.session.check(g);
                                client.header = header;
                                await refresh();
                              })
                            }
                          >
                            履歴ごと完全削除
                          </button>
                        </div>
                      )}
                      {history.length > 0 && (
                        <div className="history">
                          <h3>版の履歴</h3>
                          {history.map((r) => (
                            <div className="row" key={String(r.revision)}>
                              <span>
                                第{String(r.revision)}版{" "}
                                {r.deleted ? "削除済み" : ""}
                              </span>
                              {!r.deleted && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void work(async () => {
                                      const g = client.session.capture();
                                      const doc = await client.read(r);
                                      client.session.check(g);
                                      client.session.download(
                                        doc.plaintext,
                                        "revision-" +
                                          String(r.revision) +
                                          ".bin",
                                      );
                                      doc.plaintext.fill(0);
                                    })
                                  }
                                >
                                  この版をダウンロード
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </form>
                  </div>
                  <details className="credentials">
                    <summary>解除用パスキー</summary>
                    <p className="small">
                      追加・削除には既登録パスキーでの本人確認が必要です。最後の1件は削除できません。
                    </p>
                    <div className="row">
                      <button
                        disabled={busy}
                        onClick={() =>
                          void work(async () => {
                            await client.addCredential();
                            setNotice("解除用パスキーを追加しました。");
                          })
                        }
                      >
                        パスキーを追加
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void work(async () => {
                            const g = client.session.capture();
                            const list = ok(
                              await client.actor.list_credentials(),
                            );
                            client.session.check(g);
                            setCredentials(list);
                          })
                        }
                      >
                        登録一覧を表示
                      </button>
                    </div>
                    {credentials.map((c, i) => (
                      <div className="row" key={b64(bytes(c.id))}>
                        <span>パスキー {i + 1}</span>
                        <button
                          disabled={busy || credentials.length <= 1}
                          onClick={() =>
                            void work(async () => {
                              const g = client.session.capture();
                              await client.removeCredential(bytes(c.id));
                              client.session.check(g);
                              const list = ok(
                                await client.actor.list_credentials(),
                              );
                              client.session.check(g);
                              setCredentials(list);
                            })
                          }
                        >
                          このパスキーを削除
                        </button>
                      </div>
                    ))}
                  </details>
                </>
              )}
            </section>
          </div>
        )}
        <footer>
          非操作5分・タブ非表示60秒でロック。表示中の情報は、端末や配信コードを信頼して扱ってください。
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
