/**
 * collider.js — 3DGS 自動コライダー生成
 * .ply / .splat ファイルのスプラット座標からボクセルグリッドと床高さマップを生成し、
 * カメラの床衝突（重力）を提供する。
 */
window.Collider = (function () {
    'use strict';

    var GRID = 96;       // ボクセルグリッド 1辺の解像度 (96^3 ≈ 88万ボクセル)
    var GRID2 = GRID * GRID;

    var _ready   = false;
    var _enabled = true;
    var _voxels  = null;     // Uint8Array[GRID^3] — 占有フラグ
    var _hmap    = null;     // Float32Array[GRID^2] — XZ列ごとの最高床Y
    var _bounds  = null;     // { minX,maxX,minY,maxY,minZ,maxZ,sx,sy,sz }

    // Nerfstudio 座標補正: entity に setLocalEulerAngles(-90,0,0) が適用されているため
    // PLY 座標 (x,y,z) → ワールド座標 (x, z, -y)
    function applyCorrection(x, y, z) {
        return { cx: x, cy: z, cz: -y };
    }

    function toVox(w, min, size) {
        return Math.max(0, Math.min(GRID - 1, Math.round((w - min) / size * (GRID - 1))));
    }

    function vi(vx, vy, vz) { return vx + vy * GRID + vz * GRID2; }

    // ---- PLY パーサー (binary_little_endian) ----
    function parsePLY(buffer) {
        var bytes = new Uint8Array(buffer);
        var END = 'end_header';
        var dataStart = -1;

        for (var i = 0; i < bytes.length - 12; i++) {
            var ok = true;
            for (var j = 0; j < END.length; j++) {
                if (bytes[i + j] !== END.charCodeAt(j)) { ok = false; break; }
            }
            if (ok) {
                dataStart = i + END.length;
                if (bytes[dataStart] === 13) dataStart++; // CR
                if (bytes[dataStart] === 10) dataStart++; // LF
                break;
            }
        }
        if (dataStart < 0) throw new Error('PLY ヘッダーが見つかりません');

        var hdr   = new TextDecoder().decode(bytes.slice(0, dataStart));
        var lines = hdr.split('\n');
        var nV = 0, props = [], inV = false;

        lines.forEach(function (line) {
            var l = line.trim();
            if (l.startsWith('element vertex')) { nV = parseInt(l.split(' ')[2]); inV = true; }
            else if (l.startsWith('element') && !l.includes('vertex')) { inV = false; }
            else if (l.startsWith('property') && inV) {
                var p = l.split(' ');
                var sz = p[1] === 'double' ? 8 : p[1] === 'uchar' || p[1] === 'uint8' ? 1 : p[1] === 'short' ? 2 : 4;
                props.push({ name: p[2], size: sz });
            }
        });

        var stride = 0, xo = -1, yo = -1, zo = -1;
        props.forEach(function (p) {
            if (p.name === 'x') xo = stride;
            if (p.name === 'y') yo = stride;
            if (p.name === 'z') zo = stride;
            stride += p.size;
        });
        if (xo < 0 || yo < 0 || zo < 0) throw new Error('PLY に x/y/z プロパティが見つかりません');

        var out = new Float32Array(nV * 3);
        var dv  = new DataView(buffer, dataStart);
        for (var vi2 = 0; vi2 < nV; vi2++) {
            var b = vi2 * stride;
            out[vi2 * 3]     = dv.getFloat32(b + xo, true);
            out[vi2 * 3 + 1] = dv.getFloat32(b + yo, true);
            out[vi2 * 3 + 2] = dv.getFloat32(b + zo, true);
        }
        return { pts: out, n: nV };
    }

    // ---- .splat パーサー (32 bytes/splat: xyz scale4 rgba4 rot4) ----
    function parseSplat(buffer) {
        var n   = Math.floor(buffer.byteLength / 32);
        var out = new Float32Array(n * 3);
        var dv  = new DataView(buffer);
        for (var i = 0; i < n; i++) {
            out[i * 3]     = dv.getFloat32(i * 32,     true);
            out[i * 3 + 1] = dv.getFloat32(i * 32 + 4, true);
            out[i * 3 + 2] = dv.getFloat32(i * 32 + 8, true);
        }
        return { pts: out, n: n };
    }

    // ---- ボクセルグリッド + 床高さマップ構築 ----
    function buildGrid(pts, n) {
        var i, c;
        var minX =  Infinity, maxX = -Infinity;
        var minY =  Infinity, maxY = -Infinity;
        var minZ =  Infinity, maxZ = -Infinity;

        // バウンディングボックス計算
        for (i = 0; i < n; i++) {
            c = applyCorrection(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
            if (c.cx < minX) minX = c.cx; if (c.cx > maxX) maxX = c.cx;
            if (c.cy < minY) minY = c.cy; if (c.cy > maxY) maxY = c.cy;
            if (c.cz < minZ) minZ = c.cz; if (c.cz > maxZ) maxZ = c.cz;
        }

        var pad = 0.5;
        minX -= pad; maxX += pad;
        minY -= pad; maxY += pad;
        minZ -= pad; maxZ += pad;

        var sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ;
        _bounds = { minX:minX, maxX:maxX, minY:minY, maxY:maxY, minZ:minZ, maxZ:maxZ, sx:sx, sy:sy, sz:sz };

        // ボクセル占有フラグ
        _voxels = new Uint8Array(GRID * GRID * GRID);
        for (i = 0; i < n; i++) {
            c = applyCorrection(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
            _voxels[vi(toVox(c.cx, minX, sx), toVox(c.cy, minY, sy), toVox(c.cz, minZ, sz))] = 1;
        }

        // 床高さマップ: XZ 列ごとに最上の占有 Y ボクセルをワールド Y に変換
        _hmap = new Float32Array(GRID2).fill(minY);
        for (var vz = 0; vz < GRID; vz++) {
            for (var vx = 0; vx < GRID; vx++) {
                var topVY = -1;
                for (var vy = 0; vy < GRID; vy++) {
                    if (_voxels[vi(vx, vy, vz)]) topVY = vy;
                }
                _hmap[vx + vz * GRID] = topVY >= 0 ? minY + (topVY / (GRID - 1)) * sy : minY;
            }
        }

        _ready = true;
    }

    // ---- 公開 API ----
    return {
        isReady:   function () { return _ready; },
        isEnabled: function () { return _enabled; },
        setEnabled: function (v) { _enabled = !!v; },

        /**
         * バッファから非同期でコライダーを構築
         * @param {ArrayBuffer} buffer
         * @param {string} filename  (.ply または .splat)
         * @param {function} onProgress  (percent:number, msg:string) => void
         * @param {function} onDone      (err:Error|null) => void
         */
        buildAsync: function (buffer, filename, onProgress, onDone) {
            _ready = false;
            _voxels = null;
            _hmap   = null;
            _bounds = null;

            setTimeout(function () {
                try {
                    if (onProgress) onProgress(5, 'ファイルをパース中...');
                    var ext    = (filename || '').split('.').pop().toLowerCase();
                    var parsed = ext === 'splat' ? parseSplat(buffer) : parsePLY(buffer);

                    if (onProgress) onProgress(40, 'ボクセルグリッドを構築中...');

                    // 構築処理を次の tick に渡して UI を更新させる
                    setTimeout(function () {
                        try {
                            buildGrid(parsed.pts, parsed.n);
                            if (onProgress) onProgress(100, '完了');
                            if (onDone) onDone(null);
                        } catch (e2) {
                            if (onDone) onDone(e2);
                        }
                    }, 0);
                } catch (e) {
                    if (onDone) onDone(e);
                }
            }, 0);
        },

        /**
         * ワールド XZ 位置の床 Y を返す
         * @param {number} wx
         * @param {number} wz
         * @returns {number|null}  null = 範囲外
         */
        getFloorY: function (wx, wz) {
            if (!_ready || !_bounds) return null;
            var b  = _bounds;
            var vx = toVox(wx, b.minX, b.sx);
            var vz = toVox(wz, b.minZ, b.sz);
            return _hmap[vx + vz * GRID];
        },

        /**
         * カメラ位置に床衝突を適用して補正後の pc.Vec3 を返す
         * @param {pc.Vec3} pos
         * @param {number}  eyeHeight  目線の高さ (m)
         * @returns {pc.Vec3}
         */
        resolvePosition: function (pos, eyeHeight) {
            var out = new pc.Vec3(pos.x, pos.y, pos.z);
            if (!_ready || !_enabled) return out;
            var floorY = this.getFloorY(pos.x, pos.z);
            if (floorY === null) return out;
            var minY = floorY + (eyeHeight || 1.6);
            if (out.y < minY) out.y = minY;
            return out;
        },

        reset: function () {
            _ready  = false;
            _voxels = null;
            _hmap   = null;
            _bounds = null;
        },
    };
}());
