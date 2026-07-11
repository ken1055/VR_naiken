# vr-naiken platform worker

物件ごとの固有URL `/p/{id}` を発行する Cloudflare Worker。
ビューア本体（GitHub Pages）は静的なまま、この Worker が D1 の物件レジストリを引いて
OGP・シーン設定を注入して配信する。閲覧イベント（beacon）も受けて D1 に貯める。

```
GET  /p/{id}          物件ビューア（OGP注入・期限判定。?s=sns|portal|qr|mail で流入元を記録）
GET  /p/{id}/qr.svg   QRコード（?s= を焼き込み。既定 "qr"）
POST /api/e           閲覧イベント beacon（main.js が自動送信）
*    /api/admin/...   物件・業者CRUD + 集計（Authorization: Bearer ADMIN_TOKEN）
```

---

## ローカル開発

```bash
cd vr-naiken/worker
npm install
npm run db:init                 # ローカル D1 にスキーマ適用（初回のみ）
npm run dev                     # http://127.0.0.1:8787
```

- `.dev.vars`（git非管理）: `ADMIN_TOKEN=dev-local-token` / `VIEWER_ORIGIN=http://127.0.0.1:8099`
- ビューア側は別ターミナルで `python -m http.server 8099 --directory vr-naiken`
- Claude Code からは `.claude/launch.json` の `vr-naiken` と `platform-worker` を preview 起動

## 本番デプロイ（初回）

```bash
cd vr-naiken/worker
npx wrangler login
npx wrangler d1 create vr-naiken        # 表示された database_id を wrangler.toml に貼る
npm run db:init:remote                  # 本番 D1 にスキーマ適用
npx wrangler secret put ADMIN_TOKEN     # 長いランダム文字列を設定
npx wrangler deploy
```

デプロイ後は `https://vr-naiken-platform.<account>.workers.dev`。
独自ドメイン（例 `view.〜.jp`）は Cloudflare ダッシュボード → Workers → Custom Domains で追加。

## 物件の登録・運用（curl 例）

> **Windows 注意**: 日本語を含む JSON は `-d '{...}'` で直接渡すと CP932 で化ける。
> **必ず UTF-8 のファイルに保存して `--data-binary @file.json` で送ること。**

```bash
TOKEN="..."; BASE="https://..."

# 業者登録
echo '{"name":"○○不動産","plan":"founder"}' > org.json
curl -X POST "$BASE/api/admin/orgs" -H "Authorization: Bearer $TOKEN" --data-binary @org.json

# 物件登録（url と qr が返る）
cat > prop.json <<'EOF'
{
  "org_id": "xxxxxx",
  "title": "○○マンション 101号室",
  "description": "駅徒歩5分・2LDK。実際の部屋を歩ける3D内見です。",
  "scene_url": "https://storage.googleapis.com/vr_naiken_properties/<物件フォルダ>/",
  "image_url": "https://storage.googleapis.com/vr_naiken_properties/<物件フォルダ>/ogp.jpg"
}
EOF
curl -X POST "$BASE/api/admin/properties" -H "Authorization: Bearer $TOKEN" --data-binary @prop.json

# 一覧（閲覧数つき） / 詳細（経路別・日別集計つき）
curl "$BASE/api/admin/properties" -H "Authorization: Bearer $TOKEN"
curl "$BASE/api/admin/properties/{id}" -H "Authorization: Bearer $TOKEN"

# 掲載終了（成約時）: status を archived に
curl -X PATCH "$BASE/api/admin/properties/{id}" -H "Authorization: Bearer $TOKEN" -d '{"status":"archived"}'
```

`scene_url` は README.md 記載の従来 `?url=` に渡していた URL と同じもの
（`.ply` / `.splat` / 360度 `.jpg` / `manifest.json` を含むフォルダ URL）。

## 流入元の使い分け（URL の配り方）

| 配布先 | URL |
|---|---|
| SNS（プロフィール・説明欄） | `/p/{id}?s=sns` |
| 問い合わせ客へのメール/LINE | `/p/{id}?s=mail` |
| 店頭ポップ・チラシ | QR は `/p/{id}/qr.svg`（s=qr 焼き込み済み） |
| 業者自社サイト | `/p/{id}?s=web` |

経路別の閲覧数が `/api/admin/properties/{id}` で見える（月次KPIレポートの元データ）。

## 設計メモ

- ビューア HTML は `VIEWER_ORIGIN` から取得し、HTMLRewriter で `<base>`・OGP・`window.__PROPERTY__` を注入。
  重い資産（vendor/src/シーン）は base 先＝静的側から配信されるので Worker の転送量はごく小さい
- `main.js` は `__PROPERTY__` があるときだけ beacon を送る（admin.html・直接アクセスでは完全 no-op）
- 掲載期限（expires_at）切れ・archived は 410「掲載終了」ページ。物件レコードは消さない（KPI保全）
