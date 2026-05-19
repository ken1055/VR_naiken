/**
 * lcc-parser.js — XGRIDS LCC (Lixel CyberColor) フォーマットパーサー
 * LCC フォルダパッケージを読み込み、PlayCanvas が扱える .splat 形式の ArrayBuffer に変換する。
 *
 * 対応フォーマット:
 *   旧形式: meta.lcc (JSON) + Data.bin  — スケールは log 空間 (uint16 → log lerp → exp)
 *   新形式 v5.0: *.lcc  (JSON, encoding:"COMPRESS") + data.bin — スケールは線形 (uint16 → 直接 lerp)
 *
 * data.bin の 1 スプラットあたりのレイアウト（32 bytes）:
 *   [0–11]   Position XYZ  float32×3
 *   [12–15]  Color RGBA    uint32 packed (R=bits0-7, G=8-15, B=16-23, A=24-31)
 *   [16–21]  Scale XYZ     uint16×3 (*.lcc の min/max で線形補間)
 *   [22–25]  Rotation      uint32 (10-10-10-2 ビット圧縮四元数)
 *   [26–31]  (予約)
 *
 * 出力 .splat の 1 スプラットあたりのレイアウト（32 bytes / Antimatter15 形式）:
 *   [0–11]   Position XYZ  float32×3
 *   [12–23]  Scale XYZ     float32×3
 *   [24–27]  Color RGBA    uint8×4
 *   [28–31]  Rotation XYZW uint8×4 ([-1,1] → [0,255], offset 128)
 */
window.LCCParser = (function () {
    'use strict';

    var SQRT2     = Math.sqrt(2.0);
    var INV_SQRT2 = 1.0 / SQRT2;

    // ---- メタ JSON の解析 ----
    function parseMeta(text) {
        var meta = JSON.parse(text);

        // v5.0 / encoding:"COMPRESS" は線形スケール、旧形式は log スケール
        var isNewFormat = (meta.encoding === 'COMPRESS') ||
                          (parseFloat(meta.version || '0') >= 5.0);

        // スケールの min/max (旧形式はlog値でデフォルト[-10,10]、新形式は実スケール値)
        var scaleMin = isNewFormat ? [0, 0, 0] : [-10, -10, -10];
        var scaleMax = isNewFormat ? [1, 1, 1] : [ 10,  10,  10];

        (meta.attributes || []).forEach(function (attr) {
            if (attr.name === 'scale' && Array.isArray(attr.min) && Array.isArray(attr.max)) {
                scaleMin = attr.min.slice(0, 3);
                scaleMax = attr.max.slice(0, 3);
            }
        });

        return {
            totalSplats:  meta.totalSplats || 0,
            scaleMin:     scaleMin,
            scaleMax:     scaleMax,
            useLogScale:  !isNewFormat
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

    // SH 零次係数スケール (3DGS 標準)
    var C0 = 0.28209479177387814;

    // ---- LCC data.bin → PLY ArrayBuffer 変換 ----
    // PlayCanvas gsplat は PLY 形式のみ安定対応のため PLY を生成する
    function convertToPLY(dataBin, meta) {
        var n   = meta.totalSplats || Math.floor(dataBin.byteLength / 32);
        var src = new DataView(dataBin);
        var sm  = meta.scaleMin;
        var sx  = meta.scaleMax;

        // PLY ヘッダー (ASCII)
        var header = [
            'ply',
            'format binary_little_endian 1.0',
            'element vertex ' + n,
            'property float x',
            'property float y',
            'property float z',
            'property float f_dc_0',
            'property float f_dc_1',
            'property float f_dc_2',
            'property float opacity',
            'property float scale_0',
            'property float scale_1',
            'property float scale_2',
            'property float rot_0',
            'property float rot_1',
            'property float rot_2',
            'property float rot_3',
            'end_header',
            ''
        ].join('\n');

        var headerBytes = new Uint8Array(header.length);
        for (var hi = 0; hi < header.length; hi++) {
            headerBytes[hi] = header.charCodeAt(hi);
        }

        var BYTES_PER_VERTEX = 14 * 4; // 14 × float32
        var outBuf = new ArrayBuffer(headerBytes.length + n * BYTES_PER_VERTEX);
        new Uint8Array(outBuf).set(headerBytes, 0);
        var dst = new DataView(outBuf, headerBytes.length);

        for (var i = 0; i < n; i++) {
            var s = i * 32;
            var d = i * BYTES_PER_VERTEX;

            // Position
            dst.setFloat32(d,     src.getFloat32(s,     true), true);
            dst.setFloat32(d + 4, src.getFloat32(s + 4, true), true);
            dst.setFloat32(d + 8, src.getFloat32(s + 8, true), true);

            // Color uint32 → SH DC 係数 (f_dc = (rgb - 0.5) / C0)
            var c = src.getUint32(s + 12, true);
            var r = ((c      ) & 0xFF) / 255.0;
            var g = ((c >>  8) & 0xFF) / 255.0;
            var b = ((c >> 16) & 0xFF) / 255.0;
            var a = ((c >> 24) & 0xFF) / 255.0;
            dst.setFloat32(d + 12, (r - 0.5) / C0, true);
            dst.setFloat32(d + 16, (g - 0.5) / C0, true);
            dst.setFloat32(d + 20, (b - 0.5) / C0, true);

            // Opacity uint8 → logit (sigmoid の逆)
            var alpha = Math.max(1 / 255, Math.min(254 / 255, a));
            dst.setFloat32(d + 24, Math.log(alpha / (1.0 - alpha)), true);

            // Scale uint16 → log scale
            var ls0 = sm[0] + (sx[0] - sm[0]) * src.getUint16(s + 16, true) / 65535.0;
            var ls1 = sm[1] + (sx[1] - sm[1]) * src.getUint16(s + 18, true) / 65535.0;
            var ls2 = sm[2] + (sx[2] - sm[2]) * src.getUint16(s + 20, true) / 65535.0;
            if (meta.useLogScale) {
                // 旧形式: 既に log 値
                dst.setFloat32(d + 28, ls0, true);
                dst.setFloat32(d + 32, ls1, true);
                dst.setFloat32(d + 36, ls2, true);
            } else {
                // 新形式: 線形値 → log
                dst.setFloat32(d + 28, Math.log(Math.max(1e-6, ls0)), true);
                dst.setFloat32(d + 32, Math.log(Math.max(1e-6, ls1)), true);
                dst.setFloat32(d + 36, Math.log(Math.max(1e-6, ls2)), true);
            }

            // Rotation uint32 → float32 quaternion
            var q = decodeRotation(src.getUint32(s + 22, true));
            dst.setFloat32(d + 40, q[0], true);
            dst.setFloat32(d + 44, q[1], true);
            dst.setFloat32(d + 48, q[2], true);
            dst.setFloat32(d + 52, q[3], true);
        }

        return outBuf;
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

                var r1 = new FileReader();
                r1.onerror = function () { reject(new Error('LCC メタファイルの読み込みに失敗しました')); };
                r1.onload = function (e) {
                    var meta;
                    try { meta = parseMeta(e.target.result); }
                    catch (err) { reject(new Error('LCC メタファイルの解析に失敗: ' + err.message)); return; }

                    if (onProgress) onProgress(20);

                    var r2 = new FileReader();
                    r2.onerror = function () { reject(new Error('data.bin の読み込みに失敗しました')); };
                    r2.onload = function (e2) {
                        if (onProgress) onProgress(60);
                        var plyBuffer;
                        try { plyBuffer = convertToPLY(e2.target.result, meta); }
                        catch (err2) { reject(new Error('PLY 変換に失敗: ' + err2.message)); return; }
                        if (onProgress) onProgress(100);
                        resolve({
                            splatBuffer: plyBuffer,
                            name: (folderName || 'scene') + '.ply'
                        });
                    };
                    r2.readAsArrayBuffer(dataFile);
                };
                r1.readAsText(metaFile);
            });
        }
    };

}());
