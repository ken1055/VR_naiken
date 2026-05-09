/**
 * main.js — VR 内見ビューア エントリーポイント
 */
(function () {
    'use strict';

    // ---- PlayCanvas 読み込み確認 ----
    if (typeof pc === 'undefined') {
        document.body.innerHTML =
            '<div style="color:#fff;font-family:sans-serif;padding:40px;line-height:2">' +
            '<h2>エラー: PlayCanvas が読み込めませんでした</h2>' +
            '<p>インターネット接続を確認して再読み込みしてください。</p></div>';
        return;
    }

    var app = null;
    var cameraEntity = null;

    // ---- UI を最初に起動（PlayCanvas 失敗でも表示される）----
    UI.init(null, {
        onFileLoaded: function (file) {
            loadAndRender(GSplatLoader.loadFromFile(app, file, function (pct) {
                UI.showLoading('読み込み中... ' + pct + '%');
            }), false);
        },
        onURLLoaded: function (url) {
            loadAndRender(GSplatLoader.loadFromURL(app, url, function (pct) {
                UI.showLoading('ダウンロード中... ' + pct + '%');
            }), true);
        },
        onVRRequested: function () {
            if (!app) return;
            if (VRMode.isActive()) VRMode.exit();
            else VRMode.enter();
        }
    });

    // ---- PlayCanvas 初期化 ----
    try {
        var canvas = document.getElementById('application-canvas');

        app = new pc.Application(canvas, {
            mouse:    new pc.Mouse(document.body),
            touch:    new pc.TouchDevice(document.body),
            keyboard: new pc.Keyboard(window),
            graphicsDeviceOptions: { antialias: true }
        });

        app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
        app.setCanvasResolution(pc.RESOLUTION_AUTO);
        // スマホ高DPI画面でGPU負荷を下げるためピクセル比を1.5倍に制限
        if (/Android|iPhone|iPad|iPod/.test(navigator.userAgent)) {
            app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
        }
        // ブラウザのスクロール・スワイプ干渉を防ぐ
        canvas.style.touchAction = 'none';
        app.start();

        window.addEventListener('resize', function () { app.resizeCanvas(); });

        // カメラ
        cameraEntity = new pc.Entity('camera');
        cameraEntity.addComponent('camera', {
            clearColor: new pc.Color(0.04, 0.04, 0.08),
            fov: 60,
            nearClip: 0.01,
            farClip: 1000
        });
        cameraEntity.setLocalPosition(0, 1.6, 5);
        app.root.addChild(cameraEntity);

        // ライト
        var light = new pc.Entity('light');
        light.addComponent('light', {
            type: pc.LIGHTTYPE_DIRECTIONAL,
            intensity: 1
        });
        light.setLocalEulerAngles(45, 30, 0);
        app.root.addChild(light);

        // カメラ・VR コントローラー初期化
        CameraController.init(app, cameraEntity);
        VRMode.init(app, cameraEntity);

        // UI に app を渡して再コールバック登録
        _rebindCallbacks();

        // ?url= パラメータから自動ロード
        _autoLoadFromParam();

        console.log('[VR 内見ビューア] PlayCanvas 起動完了');
    } catch (e) {
        console.error('[VR 内見ビューア] PlayCanvas 初期化失敗:', e);
        UI.showError('WebGL の初期化に失敗しました。ブラウザが WebGL2 に対応しているか確認してください。');
    }

    // ---- URLパラメータから自動ロード ----
    // 使い方: ?url=https://...property.splat&title=物件名
    function _autoLoadFromParam() {
        if (!app) return;
        try {
            var params = new URLSearchParams(window.location.search);
            var paramURL   = params.get('url');
            var paramTitle = params.get('title');

            if (paramTitle) {
                var decoded = decodeURIComponent(paramTitle);
                document.title = decoded + ' | 3D内見ビューア';
                UI.setTitle(decoded);
            }

            if (paramURL) {
                var decodedURL = decodeURIComponent(paramURL);
                loadAndRender(
                    GSplatLoader.loadFromURL(app, decodedURL, function (pct) {
                        UI.showLoading('ダウンロード中... ' + pct + '%');
                    }),
                    true  // URL由来なのでシェアボタンを表示
                );
            }
        } catch (e) {
            console.warn('[Param] URLパラメータの解析に失敗:', e);
        }
    }

    // ---- app 確定後にコールバックを再バインド ----
    function _rebindCallbacks() {
        UI.updateCallbacks({
            onFileLoaded: function (file) {
                if (!app) return;
                loadAndRender(GSplatLoader.loadFromFile(app, file, function (pct) {
                    UI.showLoading('読み込み中... ' + pct + '%');
                }), false);
            },
            onURLLoaded: function (url) {
                if (!app) return;
                loadAndRender(GSplatLoader.loadFromURL(app, url, function (pct) {
                    UI.showLoading('ダウンロード中... ' + pct + '%');
                }), true);
            },
        });
    }

    // ---- GSplat ロード → レンダリング ----
    // showShare: true のとき読み込み完了後にURLコピーボタンを表示
    function loadAndRender(promise, showShare) {
        if (!app) {
            UI.showError('PlayCanvas が初期化されていません');
            return;
        }
        UI.showLoading('読み込み中...');
        promise.then(function (asset) {
            GSplatRenderer.disposeAll();
            GSplatRenderer.create(app, asset);
            UI.hideLoading();
            UI.hideEmptyState();
            if (showShare) UI.showShareButton();
        }).catch(function (err) {
            UI.hideLoading();
            UI.showError(err.message || String(err));
            console.error(err);
        });
    }

})();
