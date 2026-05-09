# VR 内見ビューア

3D Gaussian Splatting (3DGS) を Web ブラウザ上でリアルタイム描画し、Unity 風の自由視点カメラと VR ヘッドセット対応を備えた内見アプリです。

## 起動方法

### 1. HTTP サーバーを起動

```bash
cd vr-naiken
python -m http.server 8080
```

または Node.js の場合:

```bash
npx serve . -p 8080
```

### 2. ブラウザでアクセス

```
http://localhost:8080
```

> **VR テスト（LAN 経由）**: WebXR は HTTPS が必要です。`mkcert` で自己署名証明書を作成してください。

---

## 使い方

### ファイルの読み込み

- **ドラッグ&ドロップ**: `.ply` または `.splat` ファイルを画面にドロップ
- **ファイル選択ボタン**: ヘッダーの「ファイルを開く」ボタンから選択

### カメラ操作（デスクトップ）

| 操作 | 動作 |
|---|---|
| マウス右ドラッグ | 視点回転（FPS スタイル） |
| マウス左ドラッグ | オービット回転（注視点中心） |
| WASD / 矢印キー | 前後左右移動 |
| Q / E | 上下移動 |
| マウスホイール | 移動速度の増減 |
| F キー | 原点にリセット |

### カメラ操作（モバイル）

| 操作 | 動作 |
|---|---|
| 1本指ドラッグ | 視点回転 |
| 2本指ピンチ | 移動速度の増減 |

### VR モード

「VR で見る」ボタンをタップすると WebXR VR セッションが開始されます。

| 操作 | 動作 |
|---|---|
| 左スティック | 前後左右移動 |
| 右スティック X 軸 | スナップ回転 |

---

## 対応ファイル形式

| 形式 | 説明 |
|---|---|
| `.ply` | PlayCanvas ネイティブ対応（uncompressed / SuperSplat 圧縮） |
| `.splat` | Antimatter15 バイナリ形式 |

> Nerfstudio 出力の場合、座標系補正（-90° 回転）が自動適用されます。

---

## ブラウザ要件

- WebGL2 対応ブラウザ（Chrome 90+, Firefox, Edge, Safari 15+）
- VR: WebXR 対応ブラウザ + VR ヘッドセット（Meta Quest Browser, SteamVR + Chrome/Edge）

---

## ファイル構成

```
vr-naiken/
├── index.html              # メイン HTML
├── src/
│   ├── main.js             # PlayCanvas 初期化・エントリーポイント
│   ├── gsplat-loader.js    # .ply/.splat ファイルロード
│   ├── gsplat-renderer.js  # GSplatComponent レンダリング
│   ├── camera-controller.js # フリーカメラコントローラー
│   ├── vr-mode.js          # WebXR VR モード
│   └── ui.js               # UI オーバーレイ
├── assets/                 # サンプル .ply/.splat ファイル置き場
└── ARCHITECTURE.md         # 設計ドキュメント
```
