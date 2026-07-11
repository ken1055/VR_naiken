-- vr-naiken platform D1 schema
-- 適用: npx wrangler d1 execute vr-naiken --local --file=schema.sql   (ローカル)
--       npx wrangler d1 execute vr-naiken --remote --file=schema.sql  (本番・初回のみ)

CREATE TABLE IF NOT EXISTS orgs (
    id         TEXT PRIMARY KEY,                       -- 短いスラッグ (自動生成)
    name       TEXT NOT NULL,                          -- 業者名
    plan       TEXT NOT NULL DEFAULT 'none',           -- none | founder | light | standard
    note       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS properties (
    id         TEXT PRIMARY KEY,                       -- /p/{id} の短いスラッグ (自動生成)
    org_id     TEXT REFERENCES orgs(id),
    title      TEXT NOT NULL,                          -- 物件名 (OGP・ページタイトル)
    description TEXT NOT NULL DEFAULT '',              -- OGP 説明文
    scene_url  TEXT NOT NULL,                          -- GCS の .ply/.splat/フォルダ/.jpg URL
    image_url  TEXT NOT NULL DEFAULT '',               -- OGP 画像 (空なら既定の ogp.png)
    status     TEXT NOT NULL DEFAULT 'active',         -- active | archived | deleted
    expires_at TEXT,                                   -- 掲載期限 (ISO8601)。NULL = 無期限
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id TEXT NOT NULL,
    event       TEXT NOT NULL,                         -- view | scene_loaded | scene_load_error | teleport_used | pano_entered
    source      TEXT NOT NULL DEFAULT '',              -- 流入元: sns | portal | qr | mail | direct ...
    value       REAL,                                  -- load_ms など
    sid         TEXT NOT NULL DEFAULT '',              -- クライアント生成のセッションID
    ua          TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_property ON events (property_id, created_at);
CREATE INDEX IF NOT EXISTS idx_properties_org  ON properties (org_id);
