/**
 * collider.js — 3DGS 自動コライダー生成
 * splat-transform (.voxel.json + .voxel.bin) 優先、フォールバックとして
 * .ply / .splat ファイルからボクセルグリッドと床高さマップを生成する。
 */
window.Collider = (function () {
    'use strict';

    var GRID = 96;       // レガシー: ボクセルグリッド 1辺の解像度
    var GRID2 = GRID * GRID;

    var _ready   = false;
    var _enabled = true;
    var _voxels  = null;     // レガシー Uint8Array[GRID^3]
    var _hmap    = null;     // レガシー Float32Array[GRID^2]
    var _bounds  = null;     // レガシー { minX,maxX,minY,maxY,minZ,maxZ,sx,sy,sz }

    // ---- splat-transform SVO (Sparse Voxel Octree) ----
    var _svo     = null;   // { nodes: Uint32Array, leafData: Uint32Array, meta: Object }
    var _ceilmap = null;   // Float32Array[GRID^2] — 天井高さマップ

    // 8ビットのポップカウント（childMask 用）
    function popcount8(v) {
        v = v - ((v >> 1) & 0x55);
        v = (v & 0x33) + ((v >> 2) & 0x33);
        return (v + (v >> 4)) & 0x0F;
    }

    /**
     * SVO ボクセル占有チェック — Laine-Karras エンコーディング
     * ノード形式:
     *   interior : ((childMask & 0xFF) << 24) | (baseOffset & 0xFFFFFF)
     *   solid    : 0xFF000000
     *   mixed    : leafDataIndex (29bit、hi2bit=0)
     */
    function isVoxelOccupied_SVO(vx, vy, vz) {
        var d        = _svo;
        var nodes    = d.nodes;
        var leafData = d.leafData;
        var meta     = d.meta;
        var treeDepth = meta.treeDepth;
        var leafSize  = meta.leafSize;   // 常に 4
        var gMin = meta.gridBounds.min;
        var gMax = meta.gridBounds.max;
        var res  = meta.voxelResolution;

        // グリッド範囲外は空
        var gsX = Math.round((gMax[0] - gMin[0]) / res);
        var gsY = Math.round((gMax[1] - gMin[1]) / res);
        var gsZ = Math.round((gMax[2] - gMin[2]) / res);
        if (vx < 0 || vy < 0 || vz < 0 || vx >= gsX || vy >= gsY || vz >= gsZ) return false;

        var nodeIdx = 0;              // root = nodes[0]
        var lx = vx, ly = vy, lz = vz; // 現在オクタント内のローカル座標

        for (var level = 0; level < treeDepth; level++) {
            var node = nodes[nodeIdx];

            if (node === 0xFF000000) return true;   // solid subtree

            var childMask  = (node >>> 24) & 0xFF;
            var baseOffset = node & 0x00FFFFFF;

            // 子オクタントの 1 辺ボクセル数
            var childSize = leafSize << (treeDepth - level - 1);

            var ox = lx >= childSize ? 1 : 0;
            var oy = ly >= childSize ? 1 : 0;
            var oz = lz >= childSize ? 1 : 0;
            var octant = ox | (oy << 1) | (oz << 2);

            if (!((childMask >> octant) & 1)) return false; // child 不在 → empty

            var childOffset = popcount8(childMask & ((1 << octant) - 1));
            nodeIdx = baseOffset + childOffset;

            if (ox) lx -= childSize;
            if (oy) ly -= childSize;
            if (oz) lz -= childSize;
        }

        // リーフブロック (4×4×4)
        var leafNode = nodes[nodeIdx];
        if (leafNode === 0xFF000000) return true;   // solid leaf

        // mixed leaf — 64bit マスクで個別ボクセルを確認
        var bitIdx = (lx & 3) | ((ly & 3) << 2) | ((lz & 3) << 4);
        if (bitIdx < 32) {
            return !!((leafData[leafNode * 2]     >>> bitIdx)        & 1);
        } else {
            return !!((leafData[leafNode * 2 + 1] >>> (bitIdx - 32)) & 1);
        }
    }

    /** SVO でワールド XZ に対応する天井 Y を返す（上から下へ走査） */
    function getCeilY_SVO(wx, wz) {
        var meta = _svo.meta;
        var res  = meta.voxelResolution;
        var gMin = meta.gridBounds.min;
        var gMax = meta.gridBounds.max;

        var vx    = Math.floor((wx - gMin[0]) / res);
        var vz    = Math.floor((wz - gMin[2]) / res);
        var maxVY = Math.ceil((gMax[1] - gMin[1]) / res);

        for (var vy = maxVY - 1; vy >= 0; vy--) {
            if (isVoxelOccupied_SVO(vx, vy, vz)) {
                return gMin[1] + vy * res;
            }
        }
        return null;
    }

    /** SVO でワールド XZ に対応する床 Y を返す（下から上へ走査） */
    function getFloorY_SVO(wx, wz) {
        var meta = _svo.meta;
        var res  = meta.voxelResolution;
        var gMin = meta.gridBounds.min;
        var gMax = meta.gridBounds.max;

        var vx    = Math.floor((wx - gMin[0]) / res);
        var vz    = Math.floor((wz - gMin[2]) / res);
        var maxVY = Math.ceil((gMax[1] - gMin[1]) / res);

        for (var vy = 0; vy < maxVY; vy++) {
            if (isVoxelOccupied_SVO(vx, vy, vz)) {
                return gMin[1] + vy * res;
            }
        }
        return null;
    }

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

    // ---- PLY ヘッダーのみ解析（頂点データは読まない）----
    function parsePLYHeader(buffer) {
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
                if (bytes[dataStart] === 13) dataStart++;
                if (bytes[dataStart] === 10) dataStart++;
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

        return { n: nV, stride: stride, xo: xo, yo: yo, zo: zo, dataStart: dataStart };
    }

    // ---- 公開 API ----
    return {
        isReady:   function () { return _ready; },
        isEnabled: function () { return _enabled; },
        setEnabled: function (v) { _enabled = !!v; },
        isSVO:     function () { return !!_svo; },   // splat-transform SVO 使用中か

        /**
         * splat-transform CLI が生成した .voxel.json + .voxel.bin を URL から読み込む
         * @param {string}   jsonUrl
         * @param {string}   binUrl
         * @param {function} onDone  (err) => void
         */
        loadVoxelFiles: function (jsonUrl, binUrl, onDone) {
            _ready = false;
            _svo   = null;
            Promise.all([
                fetch(jsonUrl).then(function (r) { return r.json(); }),
                fetch(binUrl).then(function (r)  { return r.arrayBuffer(); })
            ]).then(function (results) {
                window.Collider.loadVoxelBuffer(results[0], results[1], onDone);
            }).catch(function (err) {
                if (onDone) onDone(err);
            });
        },

        /**
         * 既に読み込み済みの meta オブジェクトと ArrayBuffer から SVO を構築
         * ローカルファイル選択時に使用
         * @param {Object}      meta       .voxel.json をパースしたオブジェクト
         * @param {ArrayBuffer} binBuffer  .voxel.bin の ArrayBuffer
         * @param {function}    onDone     (err) => void
         */
        /**
         * 管理者ツールで生成した .hmap.json を読み込む（SVO がある場合はスキップ）
         * @param {Object}   data   .hmap.json をパースしたオブジェクト
         * @param {function} onDone (err) => void
         */
        loadHmapJSON: function (data, onDone) {
            if (_svo) { if (onDone) onDone(null); return; }  // SVO 優先
            _ready  = false;
            _voxels = null;
            try {
                if (!data || !data.bounds || !data.hmap) throw new Error('不正なフォーマット');
                _bounds  = data.bounds;
                _hmap    = new Float32Array(data.hmap);
                _ceilmap = data.ceilmap ? new Float32Array(data.ceilmap) : null;
                _ready   = true;
                console.log('[Collider] hmap 読み込み完了 — grid:', data.grid);
                if (onDone) onDone(null);
            } catch (e) {
                if (onDone) onDone(e);
            }
        },

        /**
         * 現在の床高さマップを JSON エクスポート用オブジェクトとして返す
         * buildAsync 完了後のみ有効
         * @returns {Object|null}
         */
        exportJSON: function () {
            if (!_ready || !_bounds || !_hmap) return null;
            var b = _bounds;
            return {
                format: 'vr-naiken-hmap-v1',
                grid:   GRID,
                bounds: {
                    minX: b.minX, maxX: b.maxX,
                    minY: b.minY, maxY: b.maxY,
                    minZ: b.minZ, maxZ: b.maxZ,
                    sx:   b.sx,   sy:   b.sy,   sz:   b.sz
                },
                hmap:    Array.from(_hmap),
                ceilmap: _ceilmap ? Array.from(_ceilmap) : null,
            };
        },

        loadVoxelBuffer: function (meta, binBuffer, onDone) {
            _ready = false;
            _svo   = null;
            try {
                var nodes    = new Uint32Array(binBuffer, 0,                  meta.nodeCount);
                var leafData = new Uint32Array(binBuffer, meta.nodeCount * 4, meta.leafDataCount);
                _svo   = { nodes: nodes, leafData: leafData, meta: meta };
                _ready = true;
                console.log('[Collider] SVO 読み込み完了 — treeDepth:', meta.treeDepth,
                    'resolution:', meta.voxelResolution, 'm');
                if (onDone) onDone(null);
            } catch (e) {
                if (onDone) onDone(e);
            }
        },

        /**
         * バッファから非同期でコライダーを構築（全フェーズを分割処理）
         * Phase0: ヘッダー解析  Phase1: 頂点データ読み込み
         * Phase2: BBOX 計算    Phase3: ボクセル埋め  Phase4: 床高さマップ
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

            // 1 tick あたりに処理する頂点数（メインスレッドを ~4ms 以内に抑える目安）
            var PARSE_BATCH = 3000;
            var BBOX_BATCH  = 3000;
            var VOXEL_BATCH = 3000;
            var HMAP_ROWS   = 3;

            // --- Phase 0: ヘッダー解析（同期・高速）---
            setTimeout(function () {
                var n, stride, xo, yo, zo, dataStart, isSplat;
                try {
                    if (onProgress) onProgress(1, 'ヘッダーを解析中...');
                    var ext = (filename || '').split('.').pop().toLowerCase();
                    if (ext === 'splat') {
                        isSplat   = true;
                        n         = Math.floor(buffer.byteLength / 32);
                        stride    = 32; xo = 0; yo = 4; zo = 8; dataStart = 0;
                    } else {
                        isSplat = false;
                        var h   = parsePLYHeader(buffer);
                        n = h.n; stride = h.stride;
                        xo = h.xo; yo = h.yo; zo = h.zo;
                        dataStart = h.dataStart;
                    }
                } catch (e) {
                    if (onDone) onDone(e);
                    return;
                }

                // --- Phase 1: 頂点データを分割読み込み ---
                var pts      = new Float32Array(n * 3);
                var dv       = new DataView(buffer, dataStart);
                var parseIdx = 0;

                function parseStep() {
                    var end = Math.min(parseIdx + PARSE_BATCH, n);
                    for (var i = parseIdx; i < end; i++) {
                        var b = i * stride;
                        pts[i * 3]     = dv.getFloat32(b + xo, true);
                        pts[i * 3 + 1] = dv.getFloat32(b + yo, true);
                        pts[i * 3 + 2] = dv.getFloat32(b + zo, true);
                    }
                    parseIdx = end;
                    if (parseIdx < n) {
                        if (onProgress) onProgress(
                            2 + Math.round(parseIdx / n * 23),
                            'ファイルをパース中... ' + Math.round(parseIdx / n * 100) + '%'
                        );
                        setTimeout(parseStep, 0);
                        return;
                    }
                    // Phase 1 完了 → Phase 2
                    if (onProgress) onProgress(25, 'バウンディングボックス計算中...');
                    setTimeout(bboxStep, 0);
                }

                // --- Phase 2: バウンディングボックス（分割）---
                var minX =  Infinity, maxX = -Infinity;
                var minY =  Infinity, maxY = -Infinity;
                var minZ =  Infinity, maxZ = -Infinity;
                var bboxIdx = 0;

                function bboxStep() {
                    var end = Math.min(bboxIdx + BBOX_BATCH, n);
                    for (var i = bboxIdx; i < end; i++) {
                        var c = applyCorrection(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
                        if (c.cx < minX) minX = c.cx; if (c.cx > maxX) maxX = c.cx;
                        if (c.cy < minY) minY = c.cy; if (c.cy > maxY) maxY = c.cy;
                        if (c.cz < minZ) minZ = c.cz; if (c.cz > maxZ) maxZ = c.cz;
                    }
                    bboxIdx = end;
                    if (bboxIdx < n) {
                        if (onProgress) onProgress(
                            25 + Math.round(bboxIdx / n * 15),
                            'バウンディングボックス計算中...'
                        );
                        setTimeout(bboxStep, 0);
                        return;
                    }

                    // BBOX 完了 → bounds 確定
                    var pad = 0.5;
                    minX -= pad; maxX += pad;
                    minY -= pad; maxY += pad;
                    minZ -= pad; maxZ += pad;
                    var sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ;
                    _bounds = { minX:minX, maxX:maxX, minY:minY, maxY:maxY,
                                minZ:minZ, maxZ:maxZ, sx:sx, sy:sy, sz:sz };
                    _voxels = new Uint8Array(GRID * GRID * GRID);

                    if (onProgress) onProgress(40, 'ボクセル占有フラグを構築中...');
                    setTimeout(voxelStep, 0);
                }

                // --- Phase 3: ボクセル埋め（分割）---
                var voxelIdx = 0;

                function voxelStep() {
                    var end = Math.min(voxelIdx + VOXEL_BATCH, n);
                    var b = _bounds;
                    for (var i = voxelIdx; i < end; i++) {
                        var c = applyCorrection(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
                        _voxels[vi(toVox(c.cx, b.minX, b.sx), toVox(c.cy, b.minY, b.sy), toVox(c.cz, b.minZ, b.sz))] = 1;
                    }
                    voxelIdx = end;
                    if (voxelIdx < n) {
                        if (onProgress) onProgress(
                            40 + Math.round(voxelIdx / n * 30),
                            'ボクセル占有フラグを構築中...'
                        );
                        setTimeout(voxelStep, 0);
                        return;
                    }

                    // Phase 3 完了 → Phase 4
                    _hmap    = new Float32Array(GRID2).fill(_bounds.minY);
                    _ceilmap = new Float32Array(GRID2).fill(_bounds.maxY);
                    if (onProgress) onProgress(70, '床・天井マップを構築中...');
                    setTimeout(hmapStep, 0);
                }

                // --- Phase 4: 床高さマップ（分割）---
                var hmapVZ = 0;

                function hmapStep() {
                    var end = Math.min(hmapVZ + HMAP_ROWS, GRID);
                    var b = _bounds;
                    for (var vz = hmapVZ; vz < end; vz++) {
                        for (var vx = 0; vx < GRID; vx++) {
                            var botVY = -1, topVY = -1;
                            for (var vy = 0; vy < GRID; vy++) {
                                if (_voxels[vi(vx, vy, vz)]) { botVY = vy; break; }
                            }
                            for (var vy2 = GRID - 1; vy2 >= 0; vy2--) {
                                if (_voxels[vi(vx, vy2, vz)]) { topVY = vy2; break; }
                            }
                            _hmap[vx + vz * GRID] = botVY >= 0
                                ? b.minY + (botVY / (GRID - 1)) * b.sy
                                : b.minY;
                            _ceilmap[vx + vz * GRID] = topVY >= 0
                                ? b.minY + (topVY / (GRID - 1)) * b.sy
                                : b.maxY;
                        }
                    }
                    hmapVZ = end;
                    if (hmapVZ < GRID) {
                        if (onProgress) onProgress(
                            70 + Math.round(hmapVZ / GRID * 30),
                            '床・天井マップを構築中...'
                        );
                        setTimeout(hmapStep, 0);
                        return;
                    }

                    // 全フェーズ完了
                    _ready = true;
                    if (onProgress) onProgress(100, '完了');
                    if (onDone) onDone(null);
                }

                if (onProgress) onProgress(2, 'ファイルをパース中...');
                setTimeout(parseStep, 0);
            }, 0);
        },

        /**
         * ワールド XZ 位置の床 Y を返す
         * SVO があれば SVO を使用、なければレガシー高さマップを使用
         * @param {number} wx
         * @param {number} wz
         * @returns {number|null}  null = 範囲外
         */
        getFloorY: function (wx, wz) {
            if (!_ready) return null;
            if (_svo) return getFloorY_SVO(wx, wz);
            if (!_bounds) return null;
            var b  = _bounds;
            var vx = toVox(wx, b.minX, b.sx);
            var vz = toVox(wz, b.minZ, b.sz);
            return _hmap[vx + vz * GRID];
        },

        getCeilY: function (wx, wz) {
            if (!_ready) return null;
            if (_svo) return getCeilY_SVO(wx, wz);
            if (!_bounds || !_ceilmap) return null;
            var b  = _bounds;
            var vx = toVox(wx, b.minX, b.sx);
            var vz = toVox(wz, b.minZ, b.sz);
            return _ceilmap[vx + vz * GRID];
        },

        /**
         * カメラ位置に床・天井衝突を適用して補正後の pc.Vec3 を返す
         * @param {pc.Vec3} pos
         * @param {number}  eyeHeight  床から目線までの高さ (m)
         * @returns {pc.Vec3}
         */
        resolvePosition: function (pos, eyeHeight) {
            var out = new pc.Vec3(pos.x, pos.y, pos.z);
            if (!_ready || !_enabled) return out;

            var EYE  = eyeHeight || 1.0;
            var HEAD = 0.15;  // 頭部クリアランス (m)

            var floorY = this.getFloorY(pos.x, pos.z);
            var ceilY  = this.getCeilY(pos.x, pos.z);

            if (floorY !== null) {
                var minY = floorY + EYE;
                if (out.y < minY) out.y = minY;
            }
            if (ceilY !== null) {
                var maxY = ceilY - HEAD;
                if (out.y > maxY) out.y = maxY;
            }

            return out;
        },

        reset: function () {
            _ready   = false;
            _voxels  = null;
            _hmap    = null;
            _ceilmap = null;
            _bounds  = null;
            _svo     = null;
        },
    };
}());
