/**
 * lcc-worker.js — LCC data.bin → PLY 変換 Web Worker
 * メインスレッドをブロックしないよう Worker で実行する
 */
'use strict';

var SQRT2     = Math.sqrt(2.0);
var INV_SQRT2 = 1.0 / SQRT2;
var C0        = 0.28209479177387814; // SH 零次係数スケール

// 回転デコード用の再利用バッファ（毎回 new Float32Array を避ける）
var _qBuf = new Float32Array(4);

function decodeRotation(packed) {
    var c0  = (packed         & 0x3FF) / 1023.0;
    var c1  = ((packed >> 10) & 0x3FF) / 1023.0;
    var c2  = ((packed >> 20) & 0x3FF) / 1023.0;
    var idx = (packed >>> 30) & 0x3;

    var q0 = c0 * SQRT2 - INV_SQRT2;
    var q1 = c1 * SQRT2 - INV_SQRT2;
    var q2 = c2 * SQRT2 - INV_SQRT2;
    var q3 = Math.sqrt(Math.max(0.0, 1.0 - q0*q0 - q1*q1 - q2*q2));

    var si = 0;
    var stored = [q0, q1, q2];
    for (var j = 0; j < 4; j++) {
        _qBuf[j] = (j === idx) ? q3 : stored[si++];
    }
    return _qBuf;
}

function convertToPLY(dataBin, meta) {
    var n  = meta.totalSplats || Math.floor(dataBin.byteLength / 32);
    var src = new DataView(dataBin);
    var sm  = meta.scaleMin;
    var sx  = meta.scaleMax;

    // PLY ヘッダー（ASCII）
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

        // Color uint32 → SH DC係数 (f_dc = (rgb_linear - 0.5) / C0)
        var c = src.getUint32(s + 12, true);
        var r = ((c      ) & 0xFF) / 255.0;
        var g = ((c >>  8) & 0xFF) / 255.0;
        var b = ((c >> 16) & 0xFF) / 255.0;
        var a = ((c >> 24) & 0xFF) / 255.0;
        dst.setFloat32(d + 12, (r - 0.5) / C0, true);
        dst.setFloat32(d + 16, (g - 0.5) / C0, true);
        dst.setFloat32(d + 20, (b - 0.5) / C0, true);

        // Opacity uint8 → logit (sigmoid の逆関数)
        var alpha = a < 1/255 ? 1/255 : (a > 254/255 ? 254/255 : a);
        dst.setFloat32(d + 24, Math.log(alpha / (1.0 - alpha)), true);

        // Scale uint16 → log スケール
        var ls0 = sm[0] + (sx[0] - sm[0]) * src.getUint16(s + 16, true) / 65535.0;
        var ls1 = sm[1] + (sx[1] - sm[1]) * src.getUint16(s + 18, true) / 65535.0;
        var ls2 = sm[2] + (sx[2] - sm[2]) * src.getUint16(s + 20, true) / 65535.0;
        if (meta.useLogScale) {
            dst.setFloat32(d + 28, ls0, true);
            dst.setFloat32(d + 32, ls1, true);
            dst.setFloat32(d + 36, ls2, true);
        } else {
            dst.setFloat32(d + 28, Math.log(ls0 > 1e-6 ? ls0 : 1e-6), true);
            dst.setFloat32(d + 32, Math.log(ls1 > 1e-6 ? ls1 : 1e-6), true);
            dst.setFloat32(d + 36, Math.log(ls2 > 1e-6 ? ls2 : 1e-6), true);
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

self.onmessage = function (e) {
    var msg = e.data;
    try {
        var plyBuffer = convertToPLY(msg.dataBin, msg.meta);
        // Transferable で返す（コピーなし）
        self.postMessage({ ok: true, plyBuffer: plyBuffer }, [plyBuffer]);
    } catch (err) {
        self.postMessage({ ok: false, error: err.message });
    }
};
