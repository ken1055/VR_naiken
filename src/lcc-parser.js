/**
 * lcc-parser.js — XGRIDS LCC フォーマットパーサー
 * LCC フォルダパッケージを読み込み、PlayCanvas が扱える PLY 形式の ArrayBuffer に変換する。
 * 変換は lcc-worker.js (Web Worker) で行い、メインスレッドをブロックしない。
 *
 * 対応フォーマット:
 *   旧形式: meta.lcc (JSON) + Data.bin  — スケールは log 空間
 *   新形式 v5.0: *.lcc  (JSON, encoding:"COMPRESS") + data.bin — スケールは線形
 *
 * attrs.lcp から spawnPoint と sceneName を取得し、返り値に含める。
 */
window.LCCParser = (function () {
    'use strict';

    // ---- ファイル読み込みヘルパー ----

    /**
     * File をテキストとして読み込む
     * @param {File} file
     * @returns {Promise<string>}
     */
    function readFileAsText(file) {
        return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onerror = function () { reject(new Error(file.name + ' の読み込みに失敗しました')); };
            r.onload  = function (e) { resolve(e.target.result); };
            r.readAsText(file);
        });
    }

    /**
     * File を ArrayBuffer として読み込む
     * @param {File} file
     * @returns {Promise<ArrayBuffer>}
     */
    function readFileAsArrayBuffer(file) {
        return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onerror = function () { reject(new Error(file.name + ' の読み込みに失敗しました')); };
            r.onload  = function (e) { resolve(e.target.result); };
            r.readAsArrayBuffer(file);
        });
    }

    // ---- メタ JSON の解析 ----
    function parseMeta(text) {
        var meta = JSON.parse(text);

        // v5.0 / encoding:"COMPRESS" は線形スケール、旧形式は log スケール
        var isNewFormat = (meta.encoding === 'COMPRESS') ||
                          (parseFloat(meta.version || '0') >= 5.0);

        var scaleMin = isNewFormat ? [0, 0, 0] : [-10, -10, -10];
        var scaleMax = isNewFormat ? [1, 1, 1] : [ 10,  10,  10];

        (meta.attributes || []).forEach(function (attr) {
            if (attr.name === 'scale' && Array.isArray(attr.min) && Array.isArray(attr.max)) {
                scaleMin = attr.min.slice(0, 3);
                scaleMax = attr.max.slice(0, 3);
            }
        });

        return {
            totalSplats: meta.totalSplats || 0,
            scaleMin:    scaleMin,
            scaleMax:    scaleMax,
            useLogScale: !isNewFormat
        };
    }

    // ---- Worker URL（lcc-worker.js は同じ src/ フォルダに配置）----
    // document.currentScript で現在のスクリプトのパスを基準にする
    function _getWorkerURL() {
        var base = '';
        if (document.currentScript && document.currentScript.src) {
            base = document.currentScript.src.replace(/\/[^/]*$/, '/');
        } else {
            // フォールバック: パスを手動解決
            var scripts = document.getElementsByTagName('script');
            for (var i = 0; i < scripts.length; i++) {
                if (scripts[i].src && scripts[i].src.indexOf('lcc-parser') !== -1) {
                    base = scripts[i].src.replace(/\/[^/]*$/, '/');
                    break;
                }
            }
        }
        return base + 'lcc-worker.js';
    }

    var _workerURL = null;

    // ---- 公開 API ----
    return {

        /**
         * FileList（webkitdirectory で取得）から LCC パッケージを読み込み変換
         * attrs.lcp から sceneName と spawnWorld を取得して返す
         *
         * @param {FileList} files
         * @param {function} [onProgress]  (percent: 0–100) => void
         * @returns {Promise<{ splatBuffer: ArrayBuffer, name: string, sceneName: string, spawnWorld: {x,y,z}|null }>}
         */
        loadFromFiles: function (files, onProgress) {
            return new Promise(function (resolve, reject) {
                var metaFile  = null;
                var dataFile  = null;
                var attrsFile = null;
                var folderName = '';

                for (var i = 0; i < files.length; i++) {
                    var f          = files[i];
                    var parts      = (f.webkitRelativePath || f.name).split('/');
                    if (!folderName && parts.length > 1) folderName = parts[0];
                    var fname      = parts[parts.length - 1];
                    var fnameLower = fname.toLowerCase();

                    // メタファイル: meta.lcc を優先、なければ任意の *.lcc
                    if (fnameLower === 'meta.lcc') {
                        metaFile = f;
                    } else if (fnameLower.endsWith('.lcc') && !metaFile) {
                        metaFile = f;
                    }
                    // データファイル: Data.bin / data.bin どちらも対応
                    if (fnameLower === 'data.bin') dataFile = f;
                    // attrs.lcp: スポーンポイント・シーン名
                    if (fnameLower === 'attrs.lcp') attrsFile = f;
                }

                if (!metaFile) { reject(new Error('LCC フォルダに *.lcc メタファイルが見つかりません')); return; }
                if (!dataFile) { reject(new Error('LCC フォルダに data.bin が見つかりません')); return; }

                if (onProgress) onProgress(5); // ファイル探索完了

                // --- 並列読み込み: メタ / attrs / data ---
                var readPromises = [
                    readFileAsText(metaFile),
                    attrsFile ? readFileAsText(attrsFile) : Promise.resolve(null),
                    readFileAsArrayBuffer(dataFile)
                ];

                Promise.all(readPromises).then(function (results) {
                    var metaText  = results[0];
                    var attrsText = results[1];
                    var dataBin   = results[2];

                    if (onProgress) onProgress(30); // 読み込み完了

                    // メタ解析
                    var meta;
                    try { meta = parseMeta(metaText); }
                    catch (err) { reject(new Error('LCC メタファイルの解析に失敗: ' + err.message)); return; }

                    // attrs.lcp 解析（オプション）
                    var sceneName  = folderName || 'scene';
                    var spawnWorld = null;

                    if (attrsText) {
                        try {
                            var attrs = JSON.parse(attrsText);
                            if (attrs.name) sceneName = attrs.name;
                            if (attrs.spawnPoint && Array.isArray(attrs.spawnPoint.position)) {
                                // LCC→World 座標変換: PLY(x,y,z) → World(x, z, -y)
                                // entity が -90° X 回転するため
                                var spawnPos = attrs.spawnPoint.position;
                                spawnWorld = {
                                    x: spawnPos[0],
                                    y: spawnPos[2],
                                    z: -spawnPos[1]
                                };
                            }
                        } catch (e) {
                            console.warn('[LCCParser] attrs.lcp の解析に失敗（スキップ）:', e.message);
                        }
                    }

                    // --- Worker で PLY 変換（メインスレッドをブロックしない）---
                    var workerURL = _workerURL || (_workerURL = _getWorkerURL());
                    var worker;
                    try {
                        worker = new Worker(workerURL);
                    } catch (we) {
                        reject(new Error('Web Worker の起動に失敗しました: ' + we.message));
                        return;
                    }

                    if (onProgress) onProgress(50); // Worker 送信済み

                    worker.onmessage = function (ev) {
                        worker.terminate();
                        var msg = ev.data;
                        if (!msg.ok) {
                            reject(new Error('PLY 変換に失敗: ' + msg.error));
                            return;
                        }
                        if (onProgress) onProgress(100); // 変換完了
                        resolve({
                            splatBuffer: msg.plyBuffer,
                            name:        sceneName + '.ply',
                            sceneName:   sceneName,
                            spawnWorld:  spawnWorld
                        });
                    };

                    worker.onerror = function (ev) {
                        worker.terminate();
                        reject(new Error('Worker エラー: ' + (ev.message || '不明なエラー')));
                    };

                    // dataBin を Transferable で渡す（ゼロコピー）
                    worker.postMessage({ dataBin: dataBin, meta: meta }, [dataBin]);

                }).catch(function (err) {
                    reject(err);
                });
            });
        }
    };

}());
