/**
 * lcc-parser.js — XGRIDS LCC フォーマットパーサー
 * LCC フォルダパッケージを読み込み、PlayCanvas が扱える PLY 形式の ArrayBuffer に変換する。
 * 変換は lcc-worker.js (Web Worker) で行い、メインスレッドをブロックしない。
 *
 * 対応フォーマット:
 *   旧形式: meta.lcc (JSON) + Data.bin  — スケールは log 空間
 *   新形式 v5.0: *.lcc  (JSON, encoding:"COMPRESS") + data.bin — スケールは線形
 */
window.LCCParser = (function () {
    'use strict';

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
         * @param {FileList} files
         * @param {function} [onProgress]  (percent: 0–100) => void
         * @returns {Promise<{ splatBuffer: ArrayBuffer, name: string }>}
         */
        loadFromFiles: function (files, onProgress) {
            return new Promise(function (resolve, reject) {
                var metaFile = null, dataFile = null, folderName = '';

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
                }

                if (!metaFile) { reject(new Error('LCC フォルダに *.lcc メタファイルが見つかりません')); return; }
                if (!dataFile) { reject(new Error('LCC フォルダに data.bin が見つかりません')); return; }

                if (onProgress) onProgress(5);

                // --- Step 1: メタ JSON 読み込み ---
                var r1 = new FileReader();
                r1.onerror = function () { reject(new Error('LCC メタファイルの読み込みに失敗しました')); };
                r1.onload = function (e) {
                    var meta;
                    try { meta = parseMeta(e.target.result); }
                    catch (err) { reject(new Error('LCC メタファイルの解析に失敗: ' + err.message)); return; }

                    if (onProgress) onProgress(15);

                    // --- Step 2: data.bin 読み込み ---
                    var r2 = new FileReader();
                    r2.onerror = function () { reject(new Error('data.bin の読み込みに失敗しました')); };
                    r2.onload = function (e2) {
                        if (onProgress) onProgress(40);

                        // --- Step 3: Worker で PLY 変換（メインスレッドをブロックしない）---
                        var workerURL = _workerURL || (_workerURL = _getWorkerURL());
                        var worker;
                        try {
                            worker = new Worker(workerURL);
                        } catch (we) {
                            reject(new Error('Web Worker の起動に失敗しました: ' + we.message));
                            return;
                        }

                        worker.onmessage = function (ev) {
                            worker.terminate();
                            var msg = ev.data;
                            if (!msg.ok) {
                                reject(new Error('PLY 変換に失敗: ' + msg.error));
                                return;
                            }
                            if (onProgress) onProgress(100);
                            resolve({
                                splatBuffer: msg.plyBuffer,
                                name: (folderName || 'scene') + '.ply'
                            });
                        };

                        worker.onerror = function (ev) {
                            worker.terminate();
                            reject(new Error('Worker エラー: ' + (ev.message || '不明なエラー')));
                        };

                        // dataBin を Transferable で渡す（ゼロコピー）
                        var dataBin = e2.target.result;
                        worker.postMessage({ dataBin: dataBin, meta: meta }, [dataBin]);

                        if (onProgress) onProgress(50);
                    };
                    r2.readAsArrayBuffer(dataFile);
                };
                r1.readAsText(metaFile);
            });
        }
    };

}());
