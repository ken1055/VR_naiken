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

## 転送量の削減（初回表示速度）

生の 3DGS PLY は 1 スプラット 68 バイトあり、実測で 87万スプラット = **59MB** になります。
splat-transform の圧縮 PLY 形式は 16 バイト/スプラットで、**13.5MB（-77%）** まで落ちます。
同一視点で描画を比較したところ 64 ブロック平均の絶対差 0.4/255・最大 2/255 で、見た目の差は
ほぼありません。拡張子が `.ply` のままなのでビューア側は無改修で読めます。

```bash
# 圧縮 + アップロードコマンドの生成（末尾に gsutil コマンドが出力される）
python tools/optimize_scene.py <物件フォルダ>/point_cloud.ply \
       --bucket "gs://vr_naiken_properties/<物件名>"
```

処理順序を守ること（後戻りできません）:

1. **水平化** `python tools/level_gaussian_ply.py point_cloud.ply -o point_cloud.ply`
2. **コリジョン生成** admin.html で hmap を作る → `point_cloud.hmap.json`
3. **圧縮** `python tools/optimize_scene.py point_cloud.ply`
4. **アップロード**（3 が出力したコマンド）

`level_gaussian_ply.py` と admin のコリジョン生成はどちらも「全プロパティが float の PLY」を
前提に自前パースしているため、**圧縮 PLY を入力にできません**。原本はローカルに残すこと。

配信するのは `point_cloud.compressed.ply` だけで、コンパニオンは**原本と同じ基準名のまま**
（`point_cloud.json` / `point_cloud.hmap.json`）置きます。main.js の `_companionBase` が
`.compressed` を落として探すためです。

### キャッシュ設定

```bash
# 圧縮 PLY 本体: 内容を変えるときはファイル名を変える前提で長期キャッシュ
gsutil -h "Cache-Control:public,max-age=31536000,immutable" \
       cp 'point_cloud.compressed.ply' 'gs://vr_naiken_properties/<物件名>/'

# コンパニオン JSON: -Z で gzip 転送（hmap.json は実測 11.6 倍圧縮）
gsutil -m -h "Cache-Control:public,max-age=300" \
       cp -Z 'point_cloud'*.json 'gs://vr_naiken_properties/<物件名>/'
```

`.hmap.json` は 2.25MB ありますが gzip で **0.19MB** になります。main.js が `?cb=` を付けて
毎回取得するファイルなので、`-Z` を付け忘れると毎訪問 2MB を余分に転送します。

### SOGS について

同梱の PlayCanvas 2.7.4 は SOGS（`gsplatSogs*` シェーダ）にも対応していますが、
この素材は高次 SH（`f_rest_*`）を持たないため SOGS の利点が薄く、9.9MB と圧縮 PLY の
13.5MB に対して 3.6MB の差しかありません。一方で meta.json + webp×5 のディレクトリ構成に
なりローダーと URL 振り分けの改修が要るため、現時点では採用していません。

---

## 運用設定

### GA4 アクセス計測

[index.html](index.html) 内の `GA4_ID = 'G-XXXXXXXXXX'` を GA4 の測定 ID に差し替えると有効になります。
未設定の間は完全に無効（エラーも出ません）。カスタムイベント:
`scene_loaded` (load_ms) / `scene_load_error` / `teleport_used` / `pano_entered`

### OGP 画像（リンク共有時のプレビュー）

`assets/ogp.png`（1200×630）を差し替えると LINE / SNS 共有時の画像が変わります。
実物件のきれいなスクリーンショット推奨。

### JS 更新時のキャッシュバスタ（重要）

index.html の `<script src="src/*.js?v=YYYYMMDD">` の **`?v=` は src/*.js を変更してデプロイするたびに必ず日付を上げる**。
バージョン無しだと、再訪ブラウザが「新 index.html + 旧キャッシュ JS」の混在状態になり、
モジュール間 API の不一致（例: `UI.setPlacesMenu is not a function`）で読み込みが止まる。
症状は「以前開いたことのある人だけ真っ黒/無反応、初見の人は正常」。

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
├── tools/
│   ├── level_gaussian_ply.py  # 3DGS PLY の傾き自動補正
│   └── optimize_scene.py      # PLY 圧縮 + アップロードコマンド生成
├── assets/
│   └── ogp.png              # OGP 共有プレビュー画像
├── ARCHITECTURE.md          # 設計ドキュメント
└── README.md                # このファイル
```
