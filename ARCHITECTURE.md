# VR 内見ビューア アーキテクチャ

## 技術選定

| 項目 | 選択 | 理由 |
|---|---|---|
| レンダリングエンジン | PlayCanvas v2.x (CDN) | 3DGS ネイティブ対応、WebXR 統合が容易 |
| 3DGS API | `pc.GSplatComponent` (ネイティブ) | gsplat.js より統合コストが低い |
| VR | PlayCanvas `app.xr` (WebXR ラッパー) | XrManager と GSplat が自動連携 |
| モジュール方式 | グローバル変数 (ES Module なし) | CDN 読み込みとの互換性を確保 |

---

## ディレクトリ構成

```
vr-naiken/
├── index.html              # メインHTML、PlayCanvas CDN、UI骨格
├── src/
│   ├── main.js             # PlayCanvas app 初期化 + 各モジュール起動
│   ├── gsplat-loader.js    # .ply/.splat ファイルロード (window.GSplatLoader)
│   ├── gsplat-renderer.js  # GSplatComponent セットアップ (window.GSplatRenderer)
│   ├── camera-controller.js # Unity 風フリーカメラ (window.CameraController)
│   ├── vr-mode.js          # WebXR VR モード (window.VRMode)
│   └── ui.js               # UI オーバーレイ (window.UI)
├── assets/                 # .ply/.splat サンプルファイル置き場
├── ARCHITECTURE.md         # このファイル
└── README.md               # 起動方法・使い方
```

---

## モジュール責務とデータフロー

```
index.html
  └─ <script> src/main.js (最後に読み込み)
       │
       ├─ PlayCanvas app 初期化 (canvas取得、カメラ・ライト Entity 生成)
       │
       ├─ UI.init(app, { onFileLoaded, onVRRequested })
       │    └─ ドラッグ&ドロップ / ファイル選択 → onFileLoaded(file)
       │
       ├─ GSplatLoader.loadFromFile(app, file) → Promise<asset>
       │    └─ GSplatRenderer.create(app, asset) → entity (シーンに追加)
       │
       ├─ CameraController.init(app, cameraEntity)
       │    └─ マウス/キー/タッチ入力 → カメラ変換
       │
       └─ VRMode.init(app, cameraEntity)
            └─ VR ボタン → app.xr.start() / end()
```

---

## スクリプト読み込み順序 (index.html)

```html
<script src="https://code.playcanvas.com/playcanvas-stable.min.js"></script>
<script src="src/gsplat-loader.js"></script>
<script src="src/gsplat-renderer.js"></script>
<script src="src/camera-controller.js"></script>
<script src="src/vr-mode.js"></script>
<script src="src/ui.js"></script>
<script src="src/main.js"></script>  <!-- 最後 -->
```

---

## 座標系の注意点

- Nerfstudio 出力の .ply は Y 軸が上下逆になる場合があるため  
  `entity.setLocalEulerAngles(-90, 0, 0)` で補正する
- VR では `XRSPACE_LOCALFLOOR` を使い、床位置を基準とする

---

## ローカル開発サーバー

```bash
python -m http.server 8080
```

`localhost:8080` でアクセス（WebXR は localhost で HTTP 可）。  
LAN デバイス（Quest 等）からテストする場合は HTTPS が必要（mkcert 推奨）。
