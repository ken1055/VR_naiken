# VR 内見ビューア

3D Gaussian Splatting (3DGS) で撮影した物件を Web ブラウザだけで内見できるビューアです。
閲覧者は目線の高さが床に固定されたウォークモードで、実際に部屋の中を歩くように移動できます。

- 公開 URL: `https://ken1055.github.io/VR_naiken/`
- 配信データ: GCS バケット `vr_naiken_properties`

---

## 起動方法（ローカル開発）

```bash
cd vr-naiken
python -m http.server 8080
```

`http://localhost:8080` にアクセス。管理ツールは `http://localhost:8080/admin.html`（ローカル専用・git 非管理）。

---

## 物件 URL の発行

### 顧客配布用（プラットフォーム経由・推奨）

物件レジストリ（`worker/` — Cloudflare Worker + D1）に登録すると固有 URL と QR が発行されます。

```
https://<worker>/p/{id}          ← 物件ごとの OGP・掲載期限判定・閲覧計測つき
https://<worker>/p/{id}/qr.svg   ← 店頭ポップ・チラシ用 QR
```

流入元は `?s=sns|portal|qr|mail|web` で記録され、経路別の閲覧数が管理 API で集計できます。
登録・デプロイ手順は [worker/README.md](worker/README.md) を参照。

### 開発・検証用（直接指定）

```
https://ken1055.github.io/VR_naiken/?url=<PLYのURL>&title=<物件名>
```

- `url` … GCS 上の `.ply` / `.splat` / 360度 `.jpg`、または `manifest.json` を含むフォルダ URL
- `title` … ページタイトルに表示される物件名（省略可）

> **セキュリティ**: `?url=` で読み込める先は `https://storage.googleapis.com/vr_naiken_properties/` 配下・同一オリジン・localhost に制限されています（`src/main.js` の `_ALLOWED_URL_PREFIXES`）。バケットを増やす場合はここに追記してください。

---

## 操作方法

### 閲覧者（index.html — ウォークモード）

| 環境 | 操作 | 動作 |
|---|---|---|
| PC | 左右ドラッグ | 視点回転 |
| PC | W / A / S / D | 前後左右移動（高さは床に自動追従） |
| PC | ホイール | 移動速度変更 |
| スマホ | 左ジョイスティック | 前後左右移動 |
| スマホ | 右エリアドラッグ | 視点回転 |
| 共通 | 右上の三本バー | 場所一覧メニュー（各部屋へ直接テレポート） |
| 共通 | 右下の家アイコン | 初期位置に戻る |

- テレポートポイントの半径内に近づくと「ここへ移動」プロンプトが表示されます
- テレポート先が 360度画像の場合はパノラマモードに切り替わり、「元の部屋に戻る」ボタンで復帰できます

### 管理ツール（admin.html — 自由飛行モード）

Q / E の上下移動・オービット回転が使え、テレポートポイント編集・初期カメラ保存・
コリジョン生成（hmap）・手動コリジョン箱（ガラス/鏡）の追加ができます。
保存はローカルフォルダへの書き出しです。**admin.html は .gitignore 済みで公開されません。**

---

## 対応ファイル形式

| 形式 | 説明 |
|---|---|
| `.ply` | PlayCanvas ネイティブ対応（uncompressed / SuperSplat 圧縮） |
| `.splat` | Antimatter15 バイナリ形式 |
| LCC フォルダ | XGRIDS Portalcam 出力（`lcc-parser.js` が .splat に変換） |
| `.jpg` `.jpeg` `.png` | equirectangular 360度画像（Panini 投影で表示） |

---

## コンパニオンファイル仕様

シーンファイル（例 `point_cloud.ply`）と同じ場所に同名で置くと自動読み込みされます。

| ファイル | 内容 |
|---|---|
| `point_cloud.json` | `initialCamera`（初期視点）、`teleports`（場所一覧・近接テレポート）、`colliderBoxes`（手動コリジョン箱） |
| （teleports の各要素） | `label` / `position` / `radius` / `destinationUrl` / `destinationCamera` / `menuOnly`。`menuOnly: true` は場所一覧メニューにのみ表示され近接プロンプトを出さない（3DGS 内に入口が無い部屋＝風呂など向け） |
| `point_cloud.hmap.json` | 床・天井高さマップコリジョン（管理ツールで生成） |
| `point_cloud.voxel.json` + `.voxel.bin` | SVO ボクセルコリジョン（splat-transform 生成、hmap より優先） |
| `manifest.json` | フォルダ URL 読み込み用。`{ "ply": "ファイル名.ply" }` |

360度画像の場合は `initialView`（yaw/pitch）+ `teleports` を持つ同名 `.json` を置きます。

---

## GCS アップロード手順

```bash
# 物件データ一式をアップロード
gsutil -m cp -r ./6月30日 gs://vr_naiken_properties/

# コンパニオンファイルは CDN に古い版が残らないよう Cache-Control を設定する（重要）
gsutil -m setmeta -h "Cache-Control:no-cache" 'gs://vr_naiken_properties/**/*.json'
gsutil -m setmeta -h "Cache-Control:no-cache" 'gs://vr_naiken_properties/**/*.voxel.bin'
```

`.ply` 本体は変更されないためデフォルトのキャッシュ（1時間）のままで問題ありません。
差し替える場合はファイル名を変えるか、同様に setmeta してください。

---

## 運用設定

### GA4 アクセス計測

[index.html](index.html) 内の `GA4_ID = 'G-XXXXXXXXXX'` を GA4 の測定 ID に差し替えると有効になります。
未設定の間は完全に無効（エラーも出ません）。カスタムイベント:
`scene_loaded` (load_ms) / `scene_load_error` / `teleport_used` / `pano_entered`

### OGP 画像（リンク共有時のプレビュー）

`assets/ogp.png`（1200×630）を差し替えると LINE / SNS 共有時の画像が変わります。
実物件のきれいなスクリーンショット推奨。

### PlayCanvas エンジンの更新

エンジンは `vendor/playcanvas-<ver>.min.js` に同梱・バージョン固定しています（突然の破壊的更新と CDN 障害を防ぐため）。
更新する場合は新版を `vendor/` に置き、index.html と admin.html の参照を差し替えて動作確認してからコミットしてください。

---

## ブラウザ要件

- WebGL2 対応ブラウザ（Chrome 90+, Firefox, Edge, Safari 15+）

---

## ファイル構成

```
vr-naiken/
├── index.html               # 閲覧者ページ（ウォークモード・OGP・GA4）
├── admin.html               # 管理ツール（ローカル専用・git 非管理）
├── vendor/
│   └── playcanvas-2.7.4.min.js  # PlayCanvas エンジン（同梱・バージョン固定）
├── src/
│   ├── main.js              # エントリーポイント・シーン読込・コンパニオン適用
│   ├── gsplat-loader.js     # .ply/.splat/LCC ロード
│   ├── gsplat-renderer.js   # GSplatComponent レンダリング
│   ├── lcc-parser.js        # LCC → .splat 変換（lcc-worker.js を使用）
│   ├── lcc-worker.js        # LCC 変換用 Web Worker
│   ├── pano-renderer.js     # 360度画像ビューア（自前 WebGL・Panini 投影）
│   ├── collider.js          # コリジョン（SVO / hmap / 手動箱）
│   ├── camera-controller.js # カメラ（閲覧者=ウォーク / 管理=自由飛行）
│   ├── teleport.js          # テレポート＋場所一覧メニュー連動
│   ├── vr-mode.js           # WebXR VR モード（現在 UI 非表示・保留中）
│   └── ui.js                # UI オーバーレイ（共有）
├── assets/
│   └── ogp.png              # OGP 共有プレビュー画像
├── ARCHITECTURE.md          # 設計ドキュメント
└── README.md                # このファイル
```
