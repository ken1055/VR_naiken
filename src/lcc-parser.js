/**
 * lcc-parser.js — XGRIDS LCC (Lixel CyberColor) フォーマットパーサー
 * LCC フォルダパッケージ（meta.lcc + Data.bin）を読み込み、
 * PlayCanvas が扱える .splat 形式の ArrayBuffer に変換する。
 *
 * LCC Data.bin の 1 スプラットあたりのレイアウト（32 bytes）:
 *   [0–11]   Position XYZ  float32×3
 *   [12–15]  Color RGBA    uint32 packed (R=bits0-7, G=8-15, B=16-23, A=24-31)
 *   [16–21]  Scale XYZ     uint16×3 (meta.lcc の min/max で線形補間 → log スケール値)
 *   [22–25]  Rotation      uint32 (10-10-10-2 ビット圧縮四元数)
 *   [26–31]  (予約)
 *
 * 出力 .splat の 1 スプラットあたりのレイアウト（32 bytes / Antimatter15 形式）:
 *   [0–11]   Position XYZ  float32×3
 *   [12–23]  Scale XYZ     float32×3 (exp(log_scale))
 *   [24–27]  Color RGBA    uint8×4
 *   [28–31]  Rotation XYZW uint8×4 ([-1,1] → [0,255], offset 128)
 */
window.LCCParser = (function () {
    'use strict';

    var SQRT2     = Math.sqrt(2.0);
    var INV_SQRT2 = 1.0 / SQRT2;

    // ---- meta.lcc の解析 ----
    function parseMeta(text) {
        var meta = JSON.parse(text);

        // スケールの min/max (log スケール値、デフォルト [-10, 10])
        var scaleMin = [-10, -10, -10];
        var scaleMax = [ 10,  10,  10];

        (meta.attributes || []).forEach(function (attr) {
            if (attr.name === 'scale' && Array.isArray(attr.min) && Array.isArray(attr.max)) {
                scaleMin = attr.min.slice(0, 3);
                scaleMax = attr.max.slice(0, 3);
            }
        });

        return {
            totalSplats: meta.totalSplats || 0,
            scaleMin:    scaleMin,
            scaleMax:    scaleMax
        };
    }

    // ---- 圧縮四元数のデコード (10-10-10-2 bit packing) ----
    // bits 0–9:  component 0、bits 10–19: component 1、bits 20–29: component 2
    // bits 30–31: idx（最大成分の位置 → 保存されなかった成分）
    function decodeRotation(packed) {
        var c0  = (packed         & 0x3FF) / 1023.0;
        var c1  = ((packed >> 10) & 0x3FF) / 1023.0;
        var c2  = ((packed >> 20) & 0x3FF) / 1023.0;
        var idx = (packed >>> 30) & 0x3;

        var q0 = c0 * SQRT2 - INV_SQRT2;
        var q1 = c1 * SQRT2 - INV_SQRT2;
        var q2 = c2 * SQRT2 - INV_SQRT2;
        // 最大成分は四元数のノルム制約から復元
        var q3 = Math.sqrt(Math.max(0.0, 1.0 - q0*q0 - q1*q1 - q2*q2));

        // idx 番目に最大成分を挿入して 4 成分に復元
        var stored = [q0, q1, q2];
        var result = new Float32Array(4);
        var si = 0;
        for (var j = 0; j < 4; j++) {
            result[j] = (j === idx) ? q3 : stored[si++];
        }
        return result;
    }

    // ---- LCC Data.bin → .splat ArrayBuffer 変換 ----
    function convertToSplat(dataBin, meta) {
        var n   = meta.totalSplats || Math.floor(dataBin.byteLength / 32);
        var src = new DataView(dataBin);
        var dst = new DataView(new ArrayBuffer(n * 32));
        var sm  = meta.scaleMin;
        var sx  = meta.scaleMax;

        for (var i = 0; i < n; i++) {
            var s = i * 32; // Data.bin 側オフセット
            var d = i * 32; // .splat 側オフセット

            // Position float32×3 → .splat bytes 0–11 (直接コピー)
            dst.setFloat32(d,      src.getFloat32(s,     true), true);
            dst.setFloat32(d + 4,  src.getFloat32(s + 4, true), true);
            dst.setFloat32(d + 8,  src.getFloat32(s + 8, true), true);

            // Scale uint16×3 → .splat bytes 12–23 (log→linear に変換)
            var ls0 = sm[0] + (sx[0] - sm[0]) * src.getUint16(s + 16, true) / 65535.0;
            var ls1 = sm[1] + (sx[1] - sm[1]) * src.getUint16(s + 18, true) / 65535.0;
            var ls2 = sm[2] + (sx[2] - sm[2]) * src.getUint16(s + 20, true) / 65535.0;
            dst.setFloat32(d + 12, Math.exp(ls0), true);
            dst.setFloat32(d + 16, Math.exp(ls1), true);
            dst.setFloat32(d + 20, Math.exp(ls2), true);

            // Color uint32 RGBA → .splat bytes 24–27
            var c = src.getUint32(s + 12, true);
            dst.setUint8(d + 24, (c)       & 0xFF); // R
            dst.setUint8(d + 25, (c >>  8) & 0xFF); // G
            dst.setUint8(d + 26, (c >> 16) & 0xFF); // B
            dst.setUint8(d + 27, (c >> 24) & 0xFF); // A

            // Rotation uint32 → .splat bytes 28–31 (uint8, offset 128)
            var q = decodeRotation(src.getUint32(s + 22, true));
            dst.setUint8(d + 28, Math.min(255, Math.max(0, (q[0] * 128 + 128) | 0)));
            dst.setUint8(d + 29, Math.min(255, Math.max(0, (q[1] * 128 + 128) | 0)));
            dst.setUint8(d + 30, Math.min(255, Math.max(0, (q[2] * 128 + 128) | 0)));
            dst.setUint8(d + 31, Math.min(255, Math.max(0, (q[3] * 128 + 128) | 0)));
        }

        return dst.buffer;
    }

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
                    var f     = files[i];
                    var parts = (f.webkitRelativePath || f.name).split('/');
                    if (!folderName && parts.length > 1) folderName = parts[0];
                    var fname = parts[parts.length - 1];
                    if (fname === 'meta.lcc') metaFile = f;
                    else if (fname === 'Data.bin') dataFile = f;
                }

                if (!metaFile) { reject(new Error('LCC フォルダに meta.lcc が見つかりません')); return; }
                if (!dataFile) { reject(new Error('LCC フォルダに Data.bin が見つかりません')); return; }

                if (onProgress) onProgress(5);

                var r1 = new FileReader();
                r1.onerror = function () { reject(new Error('meta.lcc の読み込みに失敗しました')); };
                r1.onload = function (e) {
                    var meta;
                    try { meta = parseMeta(e.target.result); }
                    catch (err) { reject(new Error('meta.lcc の解析に失敗: ' + err.message)); return; }

                    if (onProgress) onProgress(20);

                    var r2 = new FileReader();
                    r2.onerror = function () { reject(new Error('Data.bin の読み込みに失敗しました')); };
                    r2.onload = function (e2) {
                        if (onProgress) onProgress(60);
                        var splatBuffer;
                        try { splatBuffer = convertToSplat(e2.target.result, meta); }
                        catch (err2) { reject(new Error('スプラット変換に失敗: ' + err2.message)); return; }
                        if (onProgress) onProgress(100);
                        resolve({
                            splatBuffer: splatBuffer,
                            name: (folderName || 'scene') + '.splat'
                        });
                    };
                    r2.readAsArrayBuffer(dataFile);
                };
                r1.readAsText(metaFile);
            });
        }
    };

}());
