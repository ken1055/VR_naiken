# VR 内見ビューア アーキテクチャ

## 技術選定

| 項目 | 選択 | 理由 |
|---|---|---|
| レンダリングエンジン | PlayCanvas v2.7.4（`vendor/` に同梱・固定） | 3DGS ネイティブ対応。stable URL 参照だと本番が突然壊れるため同梱 |
| 3DGS API | `pc.GSplatComponent`（ネイティブ） | gsplat.js より統合コストが低い |
| 360度表示 | 自前 WebGL（`pano-renderer.js`） | Panini 投影固定・オンデマンド描画で省電力 |
| コリジョン | 自前ボクセル（SVO / hmap） | 3DGS はメッシュを持たないため物理エンジン不可 |
| モジュール方式 | グローバル変数（ES Module なし） | `<script>` 直読みとの互換性を確保 |

---

## ページ構成

- **index.html** — 閲覧者ページ。`CameraController.setWalkMode(true)` で目線の高さを床に固定。OGP タグ・GA4 計測（`window._track`）を持つ。
- **admin.html** — 管理ツール（**.gitignore 済み・ローカル専用**）。自由飛行モード。src/*.js を `?v=Date.now()` 付きで動的ロードし、テレポート編集・初期カメラ保存・hmap 生成・手動コリジョン箱編集・公開準備（`tools/serve.js` の `/api/pipeline/*` を叩いて水平化→コリジョン→圧縮→アップロードを実行）の UI を注入する。
- **tools/serve.js** — ローカル開発サーバー。静的配信に加え、公開準備 API（フォルダ選択ダイアログ／`level_gaussian_ply.py`・`optimize_scene.py`・`build_collider.js`・`gcloud storage cp` の実行と SSE ログ／`/local/<token>/` でローカルフォルダをビューアに見せる一時マウント）を持つ。127.0.0.1 にだけ bind し、実行するコマンドは固定。
  - **注意**: `src/*.js` は両ページで共有。共有 API の仕様を変えたら admin.html のインラインコードとの整合を確認すること。
- **worker/** — プラットフォーム層（Cloudflare Worker + D1）。物件ごとの固有 URL `/p/{id}` を発行し、
  ビューア HTML に OGP と `window.__PROPERTY__`（物件ID・シーンURL・流入元・beacon先）を注入して配信。
  閲覧イベントを D1 に記録し、管理 API で経路別・日別の閲覧集計を返す。詳細は `worker/README.md`。
  - main.js は `__PROPERTY__` があるときのみ「シーン自動読込（許可リスト不要・サーバー管理値）＋ `_track` ラップで beacon 送信」を行う。
    admin.html・直接アクセスでは no-op。顧客導線は必ず `/p/{id}` を通す（`?url=` は開発・検証用）。

---

## モジュール責務

| モジュール | グローバル | 責務 |
|---|---|---|
| main.js | — | app 初期化、URL/ファイル/フォルダ読込の振り分け、コンパニオンファイル適用、`?url=` 許可リスト、GA4 イベント送信 |
| gsplat-loader.js | GSplatLoader | .ply/.splat/LCC のロード → `pc.Asset` |
| gsplat-renderer.js | GSplatRenderer | GSplat エンティティの生成・破棄 |
| lcc-parser.js / lcc-worker.js | LCCParser | XGRIDS LCC フォルダ → .splat バッファ変換 |
| pano-renderer.js | PanoRenderer | 360度画像の表示（Panini 投影・ドラッグ見回し） |
| collider.js | Collider | SVO / hmap / 手動箱による移動制限・床追従・スイープ判定 |
| camera-controller.js | CameraController | 入力→カメラ姿勢。ウォーク/自由飛行、テレポート、settle（読込直後の即スナップ） |
| teleport.js | Teleporter | テレポートポイント管理・近接プロンプト・場所一覧メニュー連動 |
| ui.js | UI | ローディング/トースト/ヘルプ/ジョイスティック/場所メニュー等のオーバーレイ |
| vr-mode.js | VRMode | WebXR VR モード（現在 UI 非表示・保留中） |

### スクリプト読み込み順（index.html）

```
vendor/playcanvas-2.7.4.min.js
→ collider → lcc-parser → gsplat-loader → gsplat-renderer → pano-renderer
→ camera-controller → vr-mode → ui → teleport → main.js（最後）
```

---

## シーン読込フロー

```
?url= パラメータ（許可リスト判定）/ ドラッグ&ドロップ / 管理ツール
  → main.js が拡張子で振り分け
      .ply/.splat        → GSplatLoader → GSplatRenderer.create
      .jpg 等            → PanoRenderer（パノラマモード: 位置固定・移動UI非表示）
      フォルダ URL       → manifest.json → .ply
  → コンパニオンファイルを自動適用
      scene.json         → initialCamera / teleports / colliderBoxes
      scene.voxel.json+bin → SVO コリジョン（優先）
      scene.hmap.json    → 高さマップコリジョン（フォールバック）
  → Teleporter.load が UI.setPlacesMenu を同期（右上の場所一覧メニュー）
```

- コリジョン読込完了時は `CameraController.requestSettle()` で床追従位置へ即スナップ（初期位置からのワープ防止）
- hmap 生成（`Collider.buildAsync`）の範囲決め: パーセンタイル bbox（上下 0.3% 切り捨て）→ 0.25m の密度格子で「面として密なセル」の最大連結成分（床・壁・天井の殻）＋0.75m 以内の成分を本体とする。窓越しの屋外・空のスプラットが 0.3% を超えると bbox が数十 m に膨らみ、1 ボクセルが 20cm 超になって廊下が丸ごと壁扱いになるため（2026-10-05 修正）。壁の膨らみ（ガウシアン半径のスタンプ）は軸ごとのボクセル数に換算し物理長 7.5cm で頭打ち。回帰確認は `tools/collider_reach.js`（到達面積）。
- 通常シーン→パノラマ遷移時は戻り先（URL + カメラ状態）を記憶し「元の部屋に戻る」で復帰

---

## 座標系の注意点

- Nerfstudio 出力の .ply は Y 軸が上下逆になる場合があるため `entity.setLocalEulerAngles(-90, 0, 0)` で補正する
- テレポートポイントの `position` はカメラ位置（目線）基準

---

## VR モード再有効化時の注意（現在保留中）

`vr-mode.js` は残してあるが UI からは非表示（事業判断）。再有効化する場合、現状の実装には
「カメラエンティティを直接 `translateLocal` しており Collider を通らない」
「XR のヘッドセット姿勢・CameraController の毎フレーム上書きと競合する」問題があるため、
**カメラリグ（親エンティティ）方式**に改修し、リグ移動を Collider 経由にすること。

---

## ローカル開発サーバー

```bash
node tools/serve.js 8080       # 管理ツールの「公開準備」を使うならこちら
python -m http.server 8080     # 閲覧だけならこれでも可
```

`localhost:8080` でアクセス（WebXR は localhost で HTTP 可）。
LAN デバイスからのテストは HTTPS が必要（mkcert 推奨）。
