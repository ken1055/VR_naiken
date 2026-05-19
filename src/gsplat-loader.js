/**
 * GSplatLoader — .ply / .splat ファイルのロードユーティリティ
 * window.GSplatLoader としてグローバルに公開
 *
 * 使い方:
 *   GSplatLoader.loadFromFile(app, file, onProgress) => Promise<pc.Asset>
 *   GSplatLoader.loadFromURL(app, url, onProgress)   => Promise<pc.Asset>
 */
(function () {
    'use strict';

    // ---- ブラウザ互換性チェック ----

    /**
     * WebGL2 が利用可能かどうかを確認する
     * @returns {boolean}
     */
    function _isWebGL2Supported() {
        try {
            var canvas = document.createElement('canvas');
            return !!(window.WebGL2RenderingContext && canvas.getContext('webgl2'));
        } catch (e) {
            return false;
        }
    }

    /**
     * File API が利用可能かどうかを確認する
     * @returns {boolean}
     */
    function _isFileAPISupported() {
        return !!(window.File && window.FileReader && window.Blob && window.URL && window.URL.createObjectURL);
    }

    /**
     * 対応ファイル形式かどうかを確認する
     * @param {string} filename
     * @returns {boolean}
     */
    function _isSupportedFile(filename) {
        var lower = (filename || '').toLowerCase();
        return lower.endsWith('.ply') || lower.endsWith('.splat') || lower.endsWith('.lcc');
    }

    /**
     * URL からファイル名を取得する
     * @param {string} url
     * @returns {string}
     */
    function _nameFromURL(url) {
        try {
            // クエリ文字列・フラグメントを除いた pathname の末尾を取得
            var path = new URL(url, window.location.href).pathname;
            var name = path.split('/').pop();
            return name || 'scene.ply';
        } catch (e) {
            return url.split('/').pop() || 'scene.ply';
        }
    }

    // ---- メインオブジェクト ----

    window.GSplatLoader = {

        /**
         * File API のファイルオブジェクトから GSplat アセットをロード
         *
         * @param {pc.Application} app       PlayCanvas Application インスタンス
         * @param {File}           file      ユーザーが選択した .ply / .splat ファイル
         * @param {function}       [onProgress]  進捗コールバック (percent: 0–100) => void
         * @returns {Promise<pc.Asset>}
         */
        loadFromFile: function (app, file, onProgress) {
            return new Promise(function (resolve, reject) {
                // ---- 事前チェック ----
                if (!_isWebGL2Supported()) {
                    reject(new Error(
                        'このブラウザは WebGL2 に対応していないため、3DGS を表示できません。\n' +
                        'Chrome 90+ / Firefox 91+ / Safari 15+ をご使用ください。'
                    ));
                    return;
                }

                if (!_isFileAPISupported()) {
                    reject(new Error(
                        'このブラウザは File API に対応していません。\n' +
                        '最新のブラウザをご使用ください。'
                    ));
                    return;
                }

                if (!file || !(file instanceof File)) {
                    reject(new Error('有効なファイルオブジェクトを指定してください。'));
                    return;
                }

                if (!_isSupportedFile(file.name)) {
                    reject(new Error(
                        '非対応のファイル形式です。\n' +
                        '.ply または .splat ファイルを使用してください。'
                    ));
                    return;
                }

                if (!app || typeof app.assets === 'undefined') {
                    reject(new Error('有効な PlayCanvas Application インスタンスを指定してください。'));
                    return;
                }

                // ---- Object URL 生成 ----
                var objectURL = null;
                try {
                    objectURL = URL.createObjectURL(file);
                } catch (e) {
                    reject(new Error('Object URL の生成に失敗しました: ' + e.message));
                    return;
                }

                // ---- アセット作成 ----
                // filename は必須: blob URL に拡張子が無いため PlayCanvas がパーサーを判別できない
                var asset = new pc.Asset(file.name, 'gsplat', { url: objectURL, filename: file.name });
                var cleaned = false;

                function cleanup() {
                    if (!cleaned) {
                        cleaned = true;
                        if (objectURL) {
                            URL.revokeObjectURL(objectURL);
                            objectURL = null;
                        }
                    }
                }

                // 進捗イベント
                if (typeof onProgress === 'function') {
                    asset.on('progress', function (received, length) {
                        if (length > 0) {
                            onProgress(Math.min(100, Math.round(received / length * 100)));
                        }
                    });
                }

                // 読み込み成功
                asset.ready(function (loadedAsset) {
                    cleanup();
                    resolve(loadedAsset);
                });

                // 読み込み失敗
                asset.on('error', function (err) {
                    cleanup();
                    reject(new Error(
                        'ファイルの読み込みに失敗しました: ' +
                        (err ? String(err) : 'Unknown error') +
                        '\nファイルが破損していないか確認してください。'
                    ));
                });

                app.assets.add(asset);
                app.assets.load(asset);
            });
        },

        /**
         * URL から GSplat アセットをロード
         *
         * @param {pc.Application} app       PlayCanvas Application インスタンス
         * @param {string}         url       .ply / .splat ファイルの URL
         * @param {function}       [onProgress]  進捗コールバック (percent: 0–100) => void
         * @returns {Promise<pc.Asset>}
         */
        loadFromURL: function (app, url, onProgress) {
            return new Promise(function (resolve, reject) {
                // ---- 事前チェック ----
                if (!_isWebGL2Supported()) {
                    reject(new Error(
                        'このブラウザは WebGL2 に対応していないため、3DGS を表示できません。\n' +
                        'Chrome 90+ / Firefox 91+ / Safari 15+ をご使用ください。'
                    ));
                    return;
                }

                if (typeof url !== 'string' || url.trim() === '') {
                    reject(new Error('有効な URL を指定してください。'));
                    return;
                }

                if (!app || typeof app.assets === 'undefined') {
                    reject(new Error('有効な PlayCanvas Application インスタンスを指定してください。'));
                    return;
                }

                var name = _nameFromURL(url);

                if (!_isSupportedFile(name)) {
                    console.warn('[GSplatLoader] URL に .ply / .splat 拡張子が見当たりません:', url);
                }

                // ---- アセット作成 ----
                // filename を指定して拡張子からパーサーを特定させる
                var asset = new pc.Asset(name, 'gsplat', { url: url, filename: name });

                // 進捗イベント
                if (typeof onProgress === 'function') {
                    asset.on('progress', function (received, length) {
                        if (length > 0) {
                            onProgress(Math.min(100, Math.round(received / length * 100)));
                        }
                    });
                }

                // 読み込み成功
                asset.ready(function (loadedAsset) {
                    resolve(loadedAsset);
                });

                // 読み込み失敗
                asset.on('error', function (err) {
                    reject(new Error(
                        'URL からの読み込みに失敗しました: ' +
                        (err ? String(err) : url) +
                        '\nURL が正しいか、CORS 設定を確認してください。'
                    ));
                });

                app.assets.add(asset);
                app.assets.load(asset);
            });
        },

        /**
         * LCC フォルダ（FileList）からアセットをロード
         * LCCParser で .splat バッファに変換してから PlayCanvas に渡す
         *
         * @param {pc.Application} app
         * @param {FileList}        files       webkitdirectory input から取得したファイル一覧
         * @param {function}       [onProgress] 進捗コールバック (percent: 0–100) => void
         * @returns {Promise<pc.Asset>}
         */
        loadFromLCCFiles: function (app, files, onProgress) {
            if (!window.LCCParser) {
                return Promise.reject(new Error('LCCParser が読み込まれていません'));
            }
            if (!_isWebGL2Supported()) {
                return Promise.reject(new Error(
                    'このブラウザは WebGL2 に対応していないため、3DGS を表示できません。'
                ));
            }
            if (!app || typeof app.assets === 'undefined') {
                return Promise.reject(new Error('有効な PlayCanvas Application インスタンスを指定してください。'));
            }

            return window.LCCParser.loadFromFiles(files, function (pct) {
                if (typeof onProgress === 'function') onProgress(Math.round(pct * 0.7)); // 変換 70%
            }).then(function (result) {
                var splatName  = result.name;
                var objectURL  = null;
                var cleaned    = false;

                function cleanup() {
                    if (!cleaned) { cleaned = true; if (objectURL) URL.revokeObjectURL(objectURL); }
                }

                return new Promise(function (resolve, reject) {
                    try {
                        var blob = new Blob([result.splatBuffer], { type: 'application/octet-stream' });
                        objectURL = URL.createObjectURL(blob);
                    } catch (e) {
                        reject(new Error('Blob の生成に失敗しました: ' + e.message));
                        return;
                    }

                    var asset = new pc.Asset(splatName, 'gsplat', { url: objectURL, filename: splatName });

                    if (typeof onProgress === 'function') {
                        asset.on('progress', function (received, length) {
                            if (length > 0) onProgress(70 + Math.round(received / length * 30));
                        });
                    }

                    asset.ready(function (loadedAsset) {
                        cleanup();
                        resolve({
                            asset:      loadedAsset,
                            plyBuffer:  result.splatBuffer,
                            sceneName:  result.sceneName,
                            spawnWorld: result.spawnWorld
                        });
                    });
                    asset.on('error', function (err) {
                        cleanup();
                        reject(new Error('LCC アセットの読み込みに失敗しました: ' + (err || '')));
                    });

                    app.assets.add(asset);
                    app.assets.load(asset);
                });
            });
        },

        /**
         * 対応ファイル形式チェック（外部からも利用可能）
         * @param {string} filename
         * @returns {boolean}
         */
        isSupportedFile: function (filename) {
            return _isSupportedFile(filename);
        },

        /**
         * 現在の環境で 3DGS が使用可能か確認する
         * @returns {{ supported: boolean, reason: string }}
         */
        checkSupport: function () {
            if (!_isWebGL2Supported()) {
                return { supported: false, reason: 'WebGL2 非対応ブラウザ' };
            }
            if (!_isFileAPISupported()) {
                return { supported: false, reason: 'File API 非対応ブラウザ' };
            }
            return { supported: true, reason: '' };
        }
    };

})();
