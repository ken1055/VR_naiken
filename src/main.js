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

    // 管理者ページから参照: 現在読み込まれているシーンの保存先 JSON ファイル名
    window._adminCurrentJSONName = null;

    // ---- UI を最初に起動（PlayCanvas 失敗でも表示される）----
    UI.init(null, {
        onFileLoaded: function (file) {
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
        app.on('update', function () {
            if (cameraEntity) Teleporter.update(cameraEntity.getPosition());
        });

        // UI に app を渡して再コールバック登録
        _rebindCallbacks();

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
        var clean = url.split('?')[0];
        if (clean.endsWith('/') || !/\.(ply|splat)$/i.test(clean)) {
            _loadFromFolderURL(url);
        } else {
            loadAndRender(GSplatLoader.loadFromURL(app, url, function (pct) {
                UI.showLoading('ダウンロード中... ' + pct + '%');
            }), true, url);
        }
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
                _loadFromURL(decodedURL);
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
        UI.showLoading('読み込み中...');
        promise.then(function (asset) {
            Teleporter.reset();
            GSplatRenderer.disposeAll();
            GSplatRenderer.create(app, asset);
            if (sourceURL) {
                _applyCompanionJSON(sourceURL);  // handles fade + pending camera
                _tryLoadCompanionVoxel(sourceURL);
                _tryLoadCompanionHmap(sourceURL);
            } else {
                _applyPendingTeleportState();
            }
            _updateAdminCurrentJSON(asset.name, sourceURL);
            UI.hideLoading();
            UI.hideEmptyState();
            UI.showHelp();
            if (showShare) UI.showShareButton();
        }).catch(function (err) {
            UI.hideLoading();
            UI.showError(err.message || String(err));
            console.error(err);
        });
    }

    // ---- フォルダ一括読み込み → レンダリング ----
    // フォルダ内の PLY/splat + コンパニオンファイルをまとめて読み込む
    function loadFolderAndRender(files) {
        if (!app) { UI.showError('PlayCanvas が初期化されていません'); return; }

        var fileArr = Array.from(files);

        // PLY / splat ファイルを探す
        var plyFile = fileArr.find(function (f) {
            return /\.(ply|splat)$/i.test(f.name);
        });
        if (!plyFile) {
            UI.showError('.ply または .splat ファイルがフォルダ内に見つかりません');
            return;
        }

        // 同名のコンパニオンファイルを探す
        var base      = plyFile.name.replace(/\.(ply|splat)$/i, '');
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

            // カメラ位置 JSON・テレポートを適用
            if (jsonFile) {
                var jr = new FileReader();
                jr.readAsText(jsonFile);
                jr.onload = function () {
                    try {
                        var config = JSON.parse(jr.result);
                        if (config && config.initialCamera) {
                            var c = config.initialCamera;
                            CameraController.teleport(c.x || 0, c.y || 0, c.z || 0, c.yaw || 0, c.pitch || 0);
                        }
                        if (config && config.teleports && config.teleports.length) {
                            Teleporter.load(config.teleports, _onTeleport);
                        }
                    } catch (e) {}
                };
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
            UI.showError(err.message || String(err));
            console.error(err);
        });
    }

    // ---- 管理者用: 現在のシーンに対応する JSON ファイル名を更新 ----
    function _updateAdminCurrentJSON(assetName, sourceURL) {
        var base = (sourceURL ? sourceURL.split('?')[0].split('/').pop() : assetName) || 'scene';
        window._adminCurrentJSONName = base.replace(/\.(ply|splat|lcc)$/i, '.json');
    }

    // ---- 管理者ツール生成の .hmap.json を自動検出 ----
    function _tryLoadCompanionHmap(url) {
        if (!url || !window.Collider) return;
        var base    = url.split('?')[0].replace(/\.(ply|splat)$/i, '');
        var hmapUrl = base + '.hmap.json';

        fetch(hmapUrl, { method: 'HEAD' })
            .then(function (r) {
                if (!r.ok) return;
                fetch(hmapUrl)
                    .then(function (r2) { return r2.json(); })
                    .then(function (data) {
                        Collider.loadHmapJSON(data, function (err) {
                            if (!err) {
                                UI.showColliderBtn();
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
        var base    = url.split('?')[0].replace(/\.(ply|splat)$/i, '');
        var jsonUrl = base + '.voxel.json';
        var binUrl  = base + '.voxel.bin';

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
    function _applyCompanionJSON(url) {
        var base    = url.split('?')[0];
        var jsonURL = base.replace(/\.(ply|splat)$/i, '.json');
        if (jsonURL === base) { _applyPendingTeleportState(); return; }

        fetch(jsonURL)
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (config) {
                if (config && config.initialCamera) {
                    var c = config.initialCamera;
                    CameraController.teleport(c.x || 0, c.y || 0, c.z || 0, c.yaw || 0, c.pitch || 0);
                }
                if (config && config.teleports && config.teleports.length) {
                    Teleporter.load(config.teleports, _onTeleport);
                }
                _applyPendingTeleportState();
            })
            .catch(function () { _applyPendingTeleportState(); });
    }

    function _onTeleport(point) {
        if (!point || !point.destinationUrl) return;
        _pendingTeleportCamera = point.destinationCamera || null;
        UI.showFade();
        setTimeout(function () { _loadFromURL(point.destinationUrl); }, 400);
    }

    function _applyPendingTeleportState() {
        if (_pendingTeleportCamera) {
            var c = _pendingTeleportCamera;
            _pendingTeleportCamera = null;
            CameraController.teleport(c.x || 0, c.y || 0, c.z || 0, c.yaw || 0, c.pitch || 0);
        }
        UI.hideFade();
    }

})();
