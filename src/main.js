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
    var _pendingTeleportCamera = null;

    // 現在ロード中のシーンURL (戻り先決定用)
    var _currentSceneURL  = null;
    // 360度画像表示中フラグ
    var _isCurrentlyPano  = false;
    // 360度画像に飛ぶ前のシーン状態 (戻るボタン用)
    var _returnContext    = null;

    // 拡張子で 360度画像か判定する
    function _isPanoURL(url) {
        if (!url) return false;
        var clean = url.split('?')[0].toLowerCase();
        return /\.(jpg|jpeg|png)$/.test(clean);
    }
    function _isPanoFile(file) {
        return file && /\.(jpg|jpeg|png)$/i.test(file.name);
    }

    // コンパニオンファイル（.json / .hmap.json / .voxel.json+bin）を探すときの基準名。
    // 転送量削減で PLY を splat-transform 圧縮すると point_cloud.compressed.ply に
    // なるが、コンパニオンは原本と同じ point_cloud.* のまま運用したい。
    // ここで .compressed を落とさないと point_cloud.compressed.hmap.json を探しにいき、
    // 見つからないまま「コリジョン無しで床をすり抜ける」状態に無言で陥る。
    function _companionBase(pathOrURL) {
        return String(pathOrURL).split('?')[0]
            .replace(/(\.compressed)?\.(ply|splat)$/i, '');
    }

    // companion file (.hmap.json / .voxel.json/.bin) 用のセッション内キャッシュバスタ。
    // GCS の CDN エッジが max-age=3600 でグローバルに hmap/voxel を保持するため、
    // ページロードごとにユニークなクエリを付けて新版を確実に取得する。
    var _companionCB = Date.now();

    // ?url= の読み込み元許可リスト。
    // ※ _autoLoadFromParam は IIFE 実行中に呼ばれるため、この代入は
    //    呼び出しより前（ファイル先頭近く）に置くこと。
    var _ALLOWED_URL_PREFIXES = [
        'https://storage.googleapis.com/vr_naiken_properties/',
    ];

    // 管理者ページから参照: 現在読み込まれているシーンの保存先 JSON ファイル名
    window._adminCurrentJSONName = null;

    // ---- プラットフォーム配信 (/p/{id}) の閲覧イベント送信 ----
    // Worker が window.__PROPERTY__ を注入したときだけ有効。
    // 既存の window._track (GA4) をラップし、同じイベントを Worker の beacon にも送る。
    // 直接アクセスや admin.html では __PROPERTY__ が無いので完全に no-op。
    (function () {
        var prop = window.__PROPERTY__;
        if (!prop || !prop.beacon || !prop.id) return;
        var sid = Math.random().toString(36).slice(2, 10);
        var origTrack = window._track || function () {};
        function send(name, params) {
            try {
                var body = JSON.stringify({
                    p:   prop.id,
                    e:   name,
                    s:   prop.source || '',
                    v:   (params && typeof params.load_ms === 'number') ? params.load_ms : null,
                    sid: sid
                });
                // Content-Type を付けない Blob で simple request にする（プリフライト回避）
                if (navigator.sendBeacon) {
                    navigator.sendBeacon(prop.beacon, new Blob([body]));
                } else {
                    fetch(prop.beacon, { method: 'POST', body: body, keepalive: true });
                }
            } catch (e) { /* 計測失敗で閲覧を止めない */ }
        }
        window._track = function (name, params) {
            origTrack(name, params);
            send(name, params);
        };
        send('view');
    })();

    // ---- UI を最初に起動（PlayCanvas 失敗でも表示される）----
    UI.init(null, {
        onFileLoaded: function (file) {
            if (_isPanoFile(file)) {
                _loadPanoFromFile(file);
                return;
            }
            loadAndRender(GSplatLoader.loadFromFile(app, file, function (pct) {
                UI.showLoading('読み込み中... ' + pct + '%');
            }), false);
        },
        onURLLoaded: function (url) {
            _loadFromURL(url);
        },
        onFolderLoaded: function (files) {
            if (!app) return;
            loadFolderAndRender(files);
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

        // 管理ツールがコリジョン箱の可視化などに使う
        window._vrApp = app;

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

        // テレポートシステム初期化
        Teleporter.init(app);
        Teleporter.setOnActivate(_onTeleport);
        app.on('update', function () {
            if (cameraEntity) Teleporter.update(cameraEntity.getPosition());
        });

        // 360度パノラマレンダラ初期化
        if (window.PanoRenderer) PanoRenderer.init(app);

        // UI に app を渡して再コールバック登録
        _rebindCallbacks();

        // 管理者ページ用公開 API
        window._vrLoad = {
            fromURL: _loadFromURL,
            fromFile: function (file) {
                if (_isPanoFile(file)) { _loadPanoFromFile(file); return; }
                loadAndRender(GSplatLoader.loadFromFile(app, file, function (pct) {
                    UI.showLoading('読み込み中... ' + pct + '%');
                }), false);
            },
            fromFolder: loadFolderAndRender,
            isPano:     function () { return _isCurrentlyPano; },
        };

        // ?url= パラメータから自動ロード
        _autoLoadFromParam();

        console.log('[VR 内見ビューア] PlayCanvas 起動完了');
    } catch (e) {
        console.error('[VR 内見ビューア] PlayCanvas 初期化失敗:', e);
        UI.showError('WebGL の初期化に失敗しました。ブラウザが WebGL2 に対応しているか確認してください。');
    }

    // ---- GCS フォルダURL から manifest.json を読んでロード ----
    // フォルダ内に {"ply": "ファイル名.ply"} の manifest.json が必要
    // listing API を使わないためバケット一覧権限が不要
    function _loadFromFolderURL(folderUrl) {
        var base = folderUrl.split('?')[0].replace(/\/$/, '');
        var manifestUrl = base + '/manifest.json';

        UI.showLoading('読み込み中...');
        fetch(manifestUrl)
            .then(function (r) {
                if (!r.ok) throw new Error(
                    'manifest.json が見つかりません (HTTP ' + r.status + ')\n' +
                    'フォルダ内に manifest.json を配置してください'
                );
                return r.json();
            })
            .then(function (manifest) {
                if (!manifest.ply) throw new Error('manifest.json に "ply" フィールドがありません');
                var plyUrl = base + '/' + manifest.ply;
                loadAndRender(
                    GSplatLoader.loadFromURL(app, plyUrl, function (pct) {
                        UI.showLoading('ダウンロード中... ' + pct + '%');
                    }),
                    true,
                    plyUrl
                );
            })
            .catch(function (err) {
                UI.hideLoading();
                UI.showError('読み込みに失敗しました: ' + (err.message || String(err)));
            });
    }

    // ---- URLがフォルダかファイルかを判定して振り分け ----
    function _loadFromURL(url) {
        if (!app) { UI.showError('PlayCanvas が初期化されていません'); return; }
        // URL から新シーンに切り替えるので、ローカルフォルダの紐付けを切る
        // （別物件のフォルダに誤って保存しないため）
        if (window._adminClearFolderHandle) window._adminClearFolderHandle();
        var clean = url.split('?')[0];
        if (_isPanoURL(url)) {
            _loadPanoFromURL(url);
        } else if (clean.endsWith('/') || !/\.(ply|splat)$/i.test(clean)) {
            _loadFromFolderURL(url);
        } else {
            loadAndRender(GSplatLoader.loadFromURL(app, url, function (pct) {
                UI.showLoading('ダウンロード中... ' + pct + '%');
            }), true, url);
        }
    }

    // ---- ?url= 許可リスト判定 ----
    // 誰でも ?url= 付きリンクを作れるため、自社ドメイン上で任意コンテンツを
    // 表示させられないよう読み込み元を制限する。
    // 管理ツールの URL 入力パネルやテレポート先（管理者作成の JSON 由来）は対象外。
    function _isAllowedParamURL(url) {
        try {
            var abs = new URL(url, window.location.href);
            // 同一オリジン（相対 URL・自サイト配下）と開発用 localhost は許可
            if (abs.origin === window.location.origin) return true;
            if (abs.hostname === 'localhost' || abs.hostname === '127.0.0.1') return true;
            return _ALLOWED_URL_PREFIXES.some(function (p) {
                return abs.href.indexOf(p) === 0;
            });
        } catch (e) {
            return false;
        }
    }

    // ---- URLパラメータから自動ロード ----
    // 使い方: ?url=https://...property.splat&title=物件名
    function _autoLoadFromParam() {
        if (!app) return;
        try {
            // /p/{id} 経由: Worker が注入した物件設定を最優先で読む。
            // sceneUrl は D1 管理値（サーバー側で登録済み）のため許可リスト判定は不要。
            var prop = window.__PROPERTY__;
            if (prop && prop.sceneUrl) {
                if (prop.title) {
                    document.title = prop.title + ' | 3D内見ビューア';
                    UI.setTitle(prop.title);
                }
                _loadFromURL(prop.sceneUrl);
                return;
            }

            var params = new URLSearchParams(window.location.search);
            var paramURL   = params.get('url');
            var paramTitle = params.get('title');

            // URLSearchParams.get() はデコード済みの値を返すため再デコードしない
            // （% を含むファイル名・物件名で URIError になり黙って読み込み失敗する）
            if (paramTitle) {
                document.title = paramTitle + ' | 3D内見ビューア';
                UI.setTitle(paramTitle);
            }

            if (paramURL) {
                if (_isAllowedParamURL(paramURL)) {
                    _loadFromURL(paramURL);
                } else {
                    console.warn('[Param] 許可されていない読み込み元:', paramURL);
                    UI.showError('この URL からは読み込めません。');
                }
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
                _loadFromURL(url);
            },
            onFolderLoaded: function (files) {
                if (!app) return;
                loadFolderAndRender(files);
            },
        });
    }

    // ---- GSplat ロード → レンダリング ----
    // showShare:  true のとき読み込み完了後にURLコピーボタンを表示
    // sourceURL:  指定時にコンパニオン JSON（同名 .json）から初期カメラを適用
    function loadAndRender(promise, showShare, sourceURL) {
        if (!app) {
            UI.showError('PlayCanvas が初期化されていません');
            return;
        }
        var loadStart = Date.now();
        UI.showLoading('読み込み中...');
        promise.then(function (asset) {
            // パノラマモードの解除 (3DGSロード時は必ず通常モードに戻す)
            _exitPanoMode();
            Teleporter.reset();
            GSplatRenderer.disposeAll();
            GSplatRenderer.create(app, asset);
            _currentSceneURL = sourceURL || null;
            if (sourceURL) {
                _applyCompanionJSON(sourceURL);  // handles fade + pending camera
                _tryLoadCompanionVoxel(sourceURL);
                _tryLoadCompanionHmap(sourceURL);
            } else {
                // 単一ファイル読み込み（コンパニオン無し）: 前シーンのコリジョン/箱を持ち越さない
                if (window.Collider) Collider.reset();
                _applyColliderBoxes(null);
                _applyPendingTeleportState();
            }
            _updateAdminCurrentJSON(asset.name, sourceURL);
            UI.hideLoading();
            UI.hideEmptyState();
            UI.showHelp();
            if (showShare) UI.showShareButton();
            // KPI 計測（index.html で GA4 有効時のみ送信される。admin では no-op）
            if (window._track) window._track('scene_loaded', {
                scene_url: sourceURL || 'local-file',
                load_ms:   Date.now() - loadStart
            });
        }).catch(function (err) {
            UI.hideLoading();
            UI.hideFade();
            UI.showError(err.message || String(err));
            console.error(err);
            if (window._track) window._track('scene_load_error', {
                scene_url: sourceURL || 'local-file'
            });
        });
    }

    // ---- 360度画像ロード → レンダリング (URL) ----
    function _loadPanoFromURL(url) {
        if (!app || !window.PanoRenderer) {
            UI.showError('PanoRenderer が利用できません');
            return;
        }
        // 通常シーン → パノラマ への遷移時に戻り先を記憶
        if (_currentSceneURL && !_isCurrentlyPano) {
            _returnContext = {
                url: _currentSceneURL,
                camera: window.CameraController ? CameraController.getState() : null
            };
        }
        UI.showLoading('360度画像を読み込み中...');
        PanoRenderer.loadFromURL(app, url)
            .then(function (asset) { _renderPano(asset, url); })
            .catch(function (err) {
                UI.hideLoading();
                UI.hideFade();
                UI.showError(err.message || String(err));
            });
    }

    // ---- 360度画像ロード → レンダリング (File) ----
    function _loadPanoFromFile(file) {
        if (!app || !window.PanoRenderer) {
            UI.showError('PanoRenderer が利用できません');
            return;
        }
        UI.showLoading('360度画像を読み込み中...');
        PanoRenderer.loadFromFile(app, file)
            .then(function (asset) { _renderPano(asset, null, file.name); })
            .catch(function (err) {
                UI.hideLoading();
                UI.showError(err.message || String(err));
            });
    }

    // ---- 360度画像表示 (共通) ----
    function _renderPano(asset, sourceURL, fileName) {
        if (window._track) window._track('pano_entered', {
            scene_url: sourceURL || fileName || 'local-file'
        });
        Teleporter.reset();
        GSplatRenderer.disposeAll();
        PanoRenderer.create(app, asset, { yaw: 0 });
        _enterPanoMode();
        _currentSceneURL = sourceURL || null;
        _updateAdminCurrentJSON(fileName || (sourceURL ? sourceURL.split('/').pop() : 'panorama'), sourceURL);

        if (sourceURL) {
            // コンパニオン JSON 内で initialView と pending teleport の適用を行う
            _applyPanoCompanionJSON(sourceURL);
        } else {
            if (window._adminSetInitialCamera) window._adminSetInitialCamera(null);
            if (window._adminSetTeleports)     window._adminSetTeleports([]);
            _applyPendingTeleportState();
        }
        UI.hideLoading();
        UI.hideEmptyState();
    }

    // ---- パノラマモードに入る (カメラ固定・移動UI非表示・戻るボタン表示) ----
    function _enterPanoMode() {
        _isCurrentlyPano = true;
        if (window.CameraController) {
            var c = PanoRenderer.getCenter();
            CameraController.setLockPosition(true, c);
        }
        if (window.UI) {
            UI.setPanoMode(true);
            if (_returnContext) {
                UI.setBackButton(function () {
                    var ctx = _returnContext;
                    _returnContext = null;
                    UI.showFade();
                    if (ctx.camera) _pendingTeleportCamera = ctx.camera;
                    setTimeout(function () { _loadFromURL(ctx.url); }, 400);
                }, '元の部屋に戻る');
            } else {
                UI.setBackButton(null);
            }
        }
    }

    // ---- パノラマモードを抜ける (通常3DGS表示に戻る前処理) ----
    function _exitPanoMode() {
        _isCurrentlyPano = false;
        if (window.PanoRenderer) PanoRenderer.dispose();
        if (window.CameraController) CameraController.setLockPosition(false);
        if (window.UI) {
            UI.setPanoMode(false);
            UI.setBackButton(null);
        }
    }

    // ---- パノラマ用コンパニオン JSON 適用 ----
    // JSON 形式: { "initialView": { "yaw": 0, "pitch": 0 }, "teleports": [...] }
    function _applyPanoCompanionJSON(url) {
        var base    = url.split('?')[0];
        var jsonURL = base.replace(/\.(jpg|jpeg|png)$/i, '.json');
        if (jsonURL === base) {
            if (window._adminSetInitialCamera) window._adminSetInitialCamera(null);
            if (window._adminSetTeleports)     window._adminSetTeleports([]);
            _applyPendingTeleportState();
            return;
        }

        fetch(jsonURL, { cache: 'no-store' })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (config) {
                var initialView = (config && config.initialView) || null;
                var teleports   = (config && config.teleports)   || [];
                if (initialView) {
                    var yaw   = initialView.yaw   || 0;
                    var pitch = initialView.pitch || 0;
                    // 実際の見回しは PanoRenderer が担う（PlayCanvas カメラは背後で不可視）
                    if (window.PanoRenderer) PanoRenderer.setView(yaw, pitch);
                    if (window.CameraController) {
                        var c = PanoRenderer.getCenter();
                        CameraController.teleport(c.x, c.y, c.z, yaw, pitch);
                    }
                }
                if (teleports.length) Teleporter.load(teleports, _onTeleport);
                if (window._adminSetInitialCamera) window._adminSetInitialCamera(initialView);
                if (window._adminSetTeleports)     window._adminSetTeleports(teleports);
                _applyPendingTeleportState();
            })
            .catch(function () {
                if (window._adminSetInitialCamera) window._adminSetInitialCamera(null);
                if (window._adminSetTeleports)     window._adminSetTeleports([]);
                _applyPendingTeleportState();
            });
    }

    // ---- フォルダ一括読み込み → レンダリング ----
    // フォルダ内の PLY/splat (または 360度画像) + コンパニオンファイルをまとめて読み込む
    function loadFolderAndRender(files) {
        if (!app) { UI.showError('PlayCanvas が初期化されていません'); return; }

        var fileArr = Array.from(files);

        // 360度画像が含まれていればそれを優先
        var panoFile = fileArr.find(function (f) {
            return /\.(jpg|jpeg|png)$/i.test(f.name);
        });
        if (panoFile) {
            _loadPanoFolder(fileArr, panoFile);
            return;
        }

        // PLY / splat ファイルを探す
        var plyFile = fileArr.find(function (f) {
            return /\.(ply|splat)$/i.test(f.name);
        });
        if (!plyFile) {
            UI.showError('.ply / .splat / .jpg ファイルがフォルダ内に見つかりません');
            return;
        }

        // 同名のコンパニオンファイルを探す
        var base      = _companionBase(plyFile.name);
        var jsonFile  = fileArr.find(function (f) { return f.name === base + '.json'; });
        var hmapFile  = fileArr.find(function (f) { return f.name === base + '.hmap.json'; });
        var voxelJson = fileArr.find(function (f) { return f.name === base + '.voxel.json'; });
        var voxelBin  = fileArr.find(function (f) { return f.name === base + '.voxel.bin'; });

        UI.showLoading('読み込み中...');

        GSplatLoader.loadFromFile(app, plyFile, function (pct) {
            UI.showLoading('読み込み中... ' + pct + '%');
        }).then(function (asset) {
            Teleporter.reset();
            GSplatRenderer.disposeAll();
            GSplatRenderer.create(app, asset);
            _updateAdminCurrentJSON(asset.name, null);
            UI.hideLoading();
            UI.hideEmptyState();
            UI.showHelp();

            // カメラ位置 JSON・テレポートを適用（管理者状態は常に同期）
            if (jsonFile) {
                var jr = new FileReader();
                jr.readAsText(jsonFile);
                jr.onload = function () {
                    var initialCam = null;
                    var teleports  = [];
                    try {
                        var config = JSON.parse(jr.result);
                        if (config) {
                            initialCam = config.initialCamera || null;
                            teleports  = config.teleports     || [];
                        }
                    } catch (e) {}
                    if (initialCam) {
                        CameraController.teleport(
                            initialCam.x || 0, initialCam.y || 0, initialCam.z || 0,
                            initialCam.yaw || 0, initialCam.pitch || 0
                        );
                    }
                    if (teleports.length) Teleporter.load(teleports, _onTeleport);
                    if (window._adminSetInitialCamera) window._adminSetInitialCamera(initialCam);
                    if (window._adminSetTeleports)     window._adminSetTeleports(teleports);
                    _applyColliderBoxes(config);
                };
            } else {
                // JSON ファイル自体がない → 前シーンの値が残らないようリセット
                if (window._adminSetInitialCamera) window._adminSetInitialCamera(null);
                if (window._adminSetTeleports)     window._adminSetTeleports([]);
                _applyColliderBoxes(null);
            }
            _applyPendingTeleportState();

            // コリジョン適用 (SVO 優先 → hmap フォールバック)
            if (voxelJson && voxelBin && window.Collider) {
                Collider.reset();
                var vr = new FileReader();
                vr.readAsText(voxelJson);
                vr.onload = function () {
                    try {
                        var meta = JSON.parse(vr.result);
                        var br = new FileReader();
                        br.readAsArrayBuffer(voxelBin);
                        br.onload = function () {
                            Collider.loadVoxelBuffer(meta, br.result, function (err) {
                                if (!err) { UI.showColliderBtn(); UI.showInfo('Voxelコリジョン読み込み完了'); }
                            });
                        };
                    } catch (e) {}
                };
            } else if (hmapFile && window.Collider) {
                Collider.reset();
                var hr = new FileReader();
                hr.readAsText(hmapFile);
                hr.onload = function () {
                    try {
                        var data = JSON.parse(hr.result);
                        Collider.loadHmapJSON(data, function (err) {
                            if (!err) UI.showColliderBtn();
                        });
                    } catch (e) {}
                };
            }
        }).catch(function (err) {
            UI.hideLoading();
            UI.hideFade();
            UI.showError(err.message || String(err));
            console.error(err);
        });
    }

    // ---- フォルダから 360度画像 + コンパニオン JSON を読み込む ----
    function _loadPanoFolder(fileArr, panoFile) {
        var base     = panoFile.name.replace(/\.(jpg|jpeg|png)$/i, '');
        var jsonFile = fileArr.find(function (f) { return f.name === base + '.json'; });

        UI.showLoading('360度画像を読み込み中...');
        PanoRenderer.loadFromFile(app, panoFile).then(function (asset) {
            if (window._track) window._track('pano_entered', { scene_url: panoFile.name });
            Teleporter.reset();
            GSplatRenderer.disposeAll();
            PanoRenderer.create(app, asset, { yaw: 0 });
            _enterPanoMode();
            _currentSceneURL = null;  // ローカルファイルなのでURL紐付けなし
            _updateAdminCurrentJSON(panoFile.name, null);

            if (jsonFile) {
                var jr = new FileReader();
                jr.readAsText(jsonFile);
                jr.onload = function () {
                    var initialView = null, teleports = [];
                    try {
                        var config = JSON.parse(jr.result);
                        if (config) {
                            initialView = config.initialView || null;
                            teleports   = config.teleports   || [];
                        }
                    } catch (e) {}
                    if (initialView) {
                        if (window.PanoRenderer) PanoRenderer.setView(initialView.yaw || 0, initialView.pitch || 0);
                        if (window.CameraController) {
                            var c = PanoRenderer.getCenter();
                            CameraController.teleport(c.x, c.y, c.z, initialView.yaw || 0, initialView.pitch || 0);
                        }
                    }
                    if (teleports.length) Teleporter.load(teleports, _onTeleport);
                    if (window._adminSetInitialCamera) window._adminSetInitialCamera(initialView);
                    if (window._adminSetTeleports)     window._adminSetTeleports(teleports);
                    _applyPendingTeleportState();
                };
            } else {
                if (window._adminSetInitialCamera) window._adminSetInitialCamera(null);
                if (window._adminSetTeleports)     window._adminSetTeleports([]);
                _applyPendingTeleportState();
            }
            UI.hideLoading();
            UI.hideEmptyState();
        }).catch(function (err) {
            UI.hideLoading();
            UI.showError(err.message || String(err));
        });
    }

    // ---- 管理者用: 現在のシーンに対応する JSON ファイル名を更新 ----
    function _updateAdminCurrentJSON(assetName, sourceURL) {
        var base = (sourceURL ? sourceURL.split('?')[0].split('/').pop() : assetName) || 'scene';
        window._adminCurrentJSONName =
            base.replace(/(\.compressed)?\.(ply|splat|lcc|jpg|jpeg|png)$/i, '') + '.json';
    }

    // ---- 管理者ツール生成の .hmap.json を自動検出 ----
    function _tryLoadCompanionHmap(url) {
        if (!url || !window.Collider) return;
        var base    = _companionBase(url);
        // GCS の CDN エッジが古い版を保持するのでキャッシュバスト
        // セッション内では同じバスタを使うので無駄なfetchは増えない
        var hmapUrl = base + '.hmap.json?cb=' + _companionCB;

        fetch(hmapUrl, { method: 'HEAD' })
            .then(function (r) {
                if (!r.ok) return;
                fetch(hmapUrl)
                    .then(function (r2) { return r2.json(); })
                    .then(function (data) {
                        Collider.loadHmapJSON(data, function (err) {
                            if (!err) {
                                UI.showColliderBtn();
                                // 初期カメラ適用より後にコライダーが揃った場合、床追従の
                                // 高さへ即スナップさせて初期位置からのワープを防ぐ
                                if (window.CameraController && CameraController.requestSettle) {
                                    CameraController.requestSettle();
                                }
                                console.log('[Hmap] コンパニオン適用済み:', hmapUrl);
                            }
                        });
                    })
                    .catch(function () {});
            })
            .catch(function () {});
    }

    // ---- splat-transform コンパニオン Voxel ファイルを自動検出 ----
    // scene.ply と同じ場所にある scene.voxel.json + scene.voxel.bin を取得する
    // ファイルが存在しない場合は何もしない（エラーは無視）
    function _tryLoadCompanionVoxel(url) {
        if (!url || !window.Collider) return;
        var base    = _companionBase(url);
        var jsonUrl = base + '.voxel.json?cb=' + _companionCB;
        var binUrl  = base + '.voxel.bin?cb=' + _companionCB;

        // HEAD リクエストで存在確認してから本読み込み
        fetch(jsonUrl, { method: 'HEAD' })
            .then(function (r) {
                if (!r.ok) return;
                UI.showStatus('Voxelコリジョン読み込み中...');
                Collider.loadVoxelFiles(jsonUrl, binUrl, function (err) {
                    UI.hideStatus();
                    if (err) {
                        console.warn('[Voxel] コンパニオン読み込み失敗:', err);
                    } else {
                        UI.showColliderBtn();
                        // 初期カメラ適用より後にコライダーが揃った場合、床追従の
                        // 高さへ即スナップさせて初期位置からのワープを防ぐ
                        if (window.CameraController && CameraController.requestSettle) {
                            CameraController.requestSettle();
                        }
                        UI.showInfo('splat-transform Voxelコリジョン読み込み完了');
                        console.log('[Voxel] SVO コンパニオン適用済み:', jsonUrl);
                    }
                });
            })
            .catch(function () { /* コンパニオン未存在は正常 */ });
    }

    // ---- コンパニオン JSON から初期カメラを適用 ----
    // scene.ply と同じ場所にある scene.json を取得する
    // ファイルが存在しない場合は何もしない（エラーは無視）
    // 手動コリジョン箱（ガラス/鏡）をシーン .json から Collider と管理UIへ反映
    function _applyColliderBoxes(config) {
        var boxes = (config && config.colliderBoxes) || [];
        if (window.Collider && Collider.setManualBoxes) Collider.setManualBoxes(boxes);
        if (window._adminSetBoxes) window._adminSetBoxes(boxes);
    }

    function _applyCompanionJSON(url) {
        var base    = url.split('?')[0];
        var jsonURL = _companionBase(url) + '.json';
        if (jsonURL === base) { _applyColliderBoxes(null); _applyPendingTeleportState(); return; }

        fetch(jsonURL, { cache: 'no-store' })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (config) {
                var initialCam = (config && config.initialCamera) || null;
                var teleports  = (config && config.teleports)     || [];
                if (initialCam) {
                    CameraController.teleport(
                        initialCam.x || 0, initialCam.y || 0, initialCam.z || 0,
                        initialCam.yaw || 0, initialCam.pitch || 0
                    );
                }
                if (teleports.length) Teleporter.load(teleports, _onTeleport);
                // 管理者状態は常に同期する（前シーンの値が残らないように）
                if (window._adminSetInitialCamera) window._adminSetInitialCamera(initialCam);
                if (window._adminSetTeleports)     window._adminSetTeleports(teleports);
                _applyColliderBoxes(config);
                _applyPendingTeleportState();
            })
            .catch(function () {
                if (window._adminSetInitialCamera) window._adminSetInitialCamera(null);
                if (window._adminSetTeleports)     window._adminSetTeleports([]);
                _applyColliderBoxes(null);
                _applyPendingTeleportState();
            });
    }

    function _onTeleport(point) {
        if (!point || !point.destinationUrl) return;
        if (window._track) window._track('teleport_used', {
            destination: point.destinationUrl,
            label:       point.label || ''
        });
        _pendingTeleportCamera = point.destinationCamera || null;
        UI.showFade();
        setTimeout(function () { _loadFromURL(point.destinationUrl); }, 400);
    }

    function _applyPendingTeleportState() {
        if (_pendingTeleportCamera) {
            var c = _pendingTeleportCamera;
            _pendingTeleportCamera = null;
            if (_isCurrentlyPano && window.PanoRenderer) {
                // パノラマ表示中は見回しをビューアに反映（位置は固定）
                PanoRenderer.setView(c.yaw || 0, c.pitch || 0);
            } else {
                CameraController.teleport(c.x || 0, c.y || 0, c.z || 0, c.yaw || 0, c.pitch || 0);
            }
        }
        UI.hideFade();
    }

})();
