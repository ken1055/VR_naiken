/**
 * collider.js — 3DGS 自動コライダー生成
 * splat-transform (.voxel.json + .voxel.bin) 優先、フォールバックとして
 * .ply / .splat ファイルからボクセルグリッドと床高さマップを生成する。
 */
window.Collider = (function () {
    'use strict';

    var GRID  = 128;            // ボクセルグリッド 1辺の解像度（Phase2: シーンに応じ可変）
    var GRID2 = GRID * GRID;
    var GRID3 = GRID * GRID * GRID;

    // Phase 2: 解像度をシーンサイズに合わせる。薄壁が潰れないよう ~2.5cm/voxel を狙い、
    // メモリ/ファイルの上限として GRID_MAX で頭打ちにする（超広域は splat-transform SVO を推奨）。
    var TARGET_VOXEL_M = 0.025;
    var GRID_MIN = 128, GRID_MAX = 192;
    function _setGrid(g) {
        GRID  = g | 0;
        GRID2 = GRID * GRID;
        GRID3 = GRID * GRID * GRID;
    }

    // ロバスト bbox: 全点の min/max ではなくパーセンタイルで bbox を決める
    // ノイズフロートに引きずられて grid 分解能が落ちるのを防ぐ
    var HIST_BUCKETS  = 256;
    var ROBUST_LOW    = 0.003;   // 下側 0.3% を切り捨て
    var ROBUST_HIGH   = 0.997;   // 上側 0.3% を切り捨て

    // 連結成分フィルタ: ノイズフロートを「孤立した小さなクラスタ」として削除する
    // splat-transform の --filter-cluster と同じ発想（接続性で判定）
    var MIN_CLUSTER_VOXELS = 100;    // 絶対最小サイズ（〜10cm³ 相当）
    var MIN_CLUSTER_RATIO  = 0.01;   // 最大クラスタに対する比率（1%以下のクラスタは削除）

    var _ready    = false;
    var _enabled  = true;
    var _walkMode = false;   // ウォークモード: resolvePosition で目線を床に固定追従する（閲覧者向け）
    var _voxels   = null;    // Uint8Array[GRID^3] — buildAsync 中の3D solid mask
    var _hmap     = null;    // Float32Array[GRID^2] — 床高さマップ
    var _bounds   = null;    // { minX,maxX,minY,maxY,minZ,maxZ,sx,sy,sz }
    var _wallmask = null;    // Uint8Array[GRID^2] — XZ 2D 壁マスク (1=壁/不通、0=通れる)
                             // .hmap.json に保存される（_voxels が無い読み込み時の壁判定用）

    // ---- splat-transform SVO (Sparse Voxel Octree) ----
    var _svo     = null;   // { nodes: Uint32Array, leafData: Uint32Array, meta: Object }
    var _ceilmap = null;   // Float32Array[GRID^2] — 天井高さマップ

    // Phase 3c: 手動コリジョン箱（ガラス・鏡など自動検出できない面）。ワールド AABB。
    // シーン .json の colliderBoxes から復元（main.js 経由）。
    var _manualBoxes = [];  // [ [minX,minY,minZ, maxX,maxY,maxZ], ... ]

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

    // ---- 水平方向の壁コリジョン（XZ平面の押し出し）----
    // カメラを半径 radius の円柱として扱い、占有ボクセルと重なった分を押し返す
    function resolveWall(wx, wy, wz, radius) {
        // 腰の高さでチェック（目線から 0.5m 下）
        var checkY = wy - 0.5;
        // resolveWallBand と同じく、押し出しは合算せず各軸の正負最大値のみ採用する
        //（合算は重なった列の数だけ過剰に押してしまい、壁際の跳ね返り・ガタつきになる）
        var pushXPos = 0, pushXNeg = 0, pushZPos = 0, pushZNeg = 0;
        function addPush(px, pz) {
            if (px > pushXPos) pushXPos = px; else if (px < pushXNeg) pushXNeg = px;
            if (pz > pushZPos) pushZPos = pz; else if (pz < pushZNeg) pushZNeg = pz;
        }

        if (_svo) {
            var meta    = _svo.meta;
            var res     = meta.voxelResolution;
            var gMin    = meta.gridBounds.min;
            var gMax    = meta.gridBounds.max;
            var maxVX   = Math.ceil((gMax[0] - gMin[0]) / res);
            var maxVY   = Math.ceil((gMax[1] - gMin[1]) / res);
            var maxVZ   = Math.ceil((gMax[2] - gMin[2]) / res);
            var searchR = Math.ceil(radius / res) + 1;
            var cvx = Math.floor((wx - gMin[0]) / res);
            var cvy = Math.max(0, Math.min(maxVY - 1, Math.floor((checkY - gMin[1]) / res)));
            var cvz = Math.floor((wz - gMin[2]) / res);

            for (var dvx = -searchR; dvx <= searchR; dvx++) {
                for (var dvz = -searchR; dvz <= searchR; dvz++) {
                    var vx = cvx + dvx, vz = cvz + dvz;
                    if (vx < 0 || vz < 0 || vx >= maxVX || vz >= maxVZ) continue;
                    if (!isVoxelOccupied_SVO(vx, cvy, vz)) continue;
                    var vMinX = gMin[0] + vx * res;
                    var vMinZ = gMin[2] + vz * res;
                    var nearX = Math.max(vMinX, Math.min(wx, vMinX + res));
                    var nearZ = Math.max(vMinZ, Math.min(wz, vMinZ + res));
                    var dx = wx - nearX, dz = wz - nearZ;
                    var dist = Math.sqrt(dx * dx + dz * dz);
                    var ov = radius - dist;
                    if (ov > 0) {
                        if (dist < 1e-4) addPush(radius, 0);
                        else addPush((dx / dist) * ov, (dz / dist) * ov);
                    }
                }
            }
        } else if ((_wallmask || _voxels) && _bounds) {
            // 壁判定は 2D 壁マスク（床+0.3〜1.6m を OR したもの）を優先する。
            // 3DGS の壁は「穴あきの厚さ1ボクセル面」になりやすく、単層 voxel だと
            // 薄壁を取りこぼす。帯を OR 済みの _wallmask を使うことで穴を埋める。
            // _wallmask が無い古いデータのときだけ _voxels にフォールバックし、
            // その場合も単層ではなく人の高さ帯を OR で見る。
            var b        = _bounds;
            var voxelW   = b.sx / (GRID - 1);
            var voxelD   = b.sz / (GRID - 1);
            var searchR2 = Math.ceil(radius / Math.min(voxelW, voxelD)) + 1;
            var cvx2 = Math.max(0, Math.min(GRID - 1, Math.round((wx - b.minX) / b.sx * (GRID - 1))));
            var cvz2 = Math.max(0, Math.min(GRID - 1, Math.round((wz - b.minZ) / b.sz * (GRID - 1))));

            // _voxels フォールバック用の縦帯（腰基準 -0.2〜+0.9m ≒ 床+0.3〜1.4m）
            var bandLoVY = 0, bandHiVY = 0;
            if (!_wallmask && _voxels) {
                bandLoVY = Math.max(0, Math.min(GRID - 1, Math.round((checkY - 0.2 - b.minY) / b.sy * (GRID - 1))));
                bandHiVY = Math.max(0, Math.min(GRID - 1, Math.round((checkY + 0.9 - b.minY) / b.sy * (GRID - 1))));
                if (bandHiVY < bandLoVY) { var _t = bandLoVY; bandLoVY = bandHiVY; bandHiVY = _t; }
            }

            for (var dvx2 = -searchR2; dvx2 <= searchR2; dvx2++) {
                for (var dvz2 = -searchR2; dvz2 <= searchR2; dvz2++) {
                    var vx2 = cvx2 + dvx2, vz2 = cvz2 + dvz2;
                    if (vx2 < 0 || vz2 < 0 || vx2 >= GRID || vz2 >= GRID) continue;
                    var blocked;
                    if (_wallmask) {
                        blocked = !!_wallmask[vx2 + vz2 * GRID];
                    } else {
                        blocked = false;
                        for (var bvy = bandLoVY; bvy <= bandHiVY; bvy++) {
                            if (_voxels[vi(vx2, bvy, vz2)]) { blocked = true; break; }
                        }
                    }
                    if (!blocked) continue;
                    var vMinX2 = b.minX + vx2 * voxelW;
                    var vMinZ2 = b.minZ + vz2 * voxelD;
                    var nearX2 = Math.max(vMinX2, Math.min(wx, vMinX2 + voxelW));
                    var nearZ2 = Math.max(vMinZ2, Math.min(wz, vMinZ2 + voxelD));
                    var dx2 = wx - nearX2, dz2 = wz - nearZ2;
                    var dist2 = Math.sqrt(dx2 * dx2 + dz2 * dz2);
                    var ov2 = radius - dist2;
                    if (ov2 > 0) {
                        if (dist2 < 1e-4) addPush(radius, 0);
                        else addPush((dx2 / dist2) * ov2, (dz2 / dist2) * ov2);
                    }
                }
            }
        }

        var pushX = pushXPos + pushXNeg;
        var pushZ = pushZPos + pushZNeg;

        // 安全弁: 1回の押し出し量を制限（不完全なコライダーでの吹き飛ばし防止）
        var plen0 = Math.sqrt(pushX * pushX + pushZ * pushZ);
        if (plen0 > 0.25) { pushX = pushX / plen0 * 0.25; pushZ = pushZ / plen0 * 0.25; }

        return { x: wx + pushX, z: wz + pushZ };
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

    // ================================================================
    // Phase 1: 真の 3D カプセル判定用ヘルパー（_voxels / SVO 共通）
    // ================================================================
    // ワールド座標→ボクセル添字（生成時と同じ floor((w-min)/s*GRID) 規約）
    function _wvx(w, min, s) { return Math.floor((w - min) / s * GRID); }

    // 体の縦帯 [bandLoY, bandHiY] に重なる占有ボクセルから XZ 押し出しを計算する。
    // 単層ではなく「足元+段差〜頭」の帯で見るので、薄壁を高さに関係なく捕捉できる。
    // _voxels（生成直後 / 新 hmap の 3D 復元）と SVO の両方に対応。
    function resolveWallBand(wx, wz, radius, bandLoY, bandHiY) {
        // 押し出しの集計は「合算」ではなく各軸の正負それぞれ最大値を採る。
        // 平面壁では半径内の多数のボクセル列が同方向に重なって働くため、合算すると
        // 実際に必要な量の数倍を一気に押してしまい、壁際で跳ね返り・ガタつきになる
        // （半径 0.20 では十数列が重なり顕著）。最深部 1 列分＝ちょうど必要な量だけ押す。
        // 入隅は直交 2 面がそれぞれの軸の最大を占めるので両軸とも正しく解決される。
        var pushXPos = 0, pushXNeg = 0, pushZPos = 0, pushZNeg = 0;
        function addPush(px, pz) {
            if (px > pushXPos) pushXPos = px; else if (px < pushXNeg) pushXNeg = px;
            if (pz > pushZPos) pushZPos = pz; else if (pz < pushZNeg) pushZNeg = pz;
        }

        if (_svo) {
            var meta = _svo.meta, res = meta.voxelResolution;
            var gMin = meta.gridBounds.min, gMax = meta.gridBounds.max;
            var maxVX = Math.ceil((gMax[0] - gMin[0]) / res);
            var maxVZ = Math.ceil((gMax[2] - gMin[2]) / res);
            var maxVY = Math.ceil((gMax[1] - gMin[1]) / res);
            var loVY  = Math.max(0, Math.floor((bandLoY - gMin[1]) / res));
            var hiVY  = Math.min(maxVY - 1, Math.floor((bandHiY - gMin[1]) / res));
            var searchR = Math.ceil(radius / res) + 1;
            var cvx = Math.floor((wx - gMin[0]) / res);
            var cvz = Math.floor((wz - gMin[2]) / res);
            for (var dx = -searchR; dx <= searchR; dx++) {
                for (var dz = -searchR; dz <= searchR; dz++) {
                    var vx = cvx + dx, vz = cvz + dz;
                    if (vx < 0 || vz < 0 || vx >= maxVX || vz >= maxVZ) continue;
                    var hit = false;
                    for (var vy = loVY; vy <= hiVY; vy++) {
                        if (isVoxelOccupied_SVO(vx, vy, vz)) { hit = true; break; }
                    }
                    if (!hit) continue;
                    var vMinX = gMin[0] + vx * res, vMinZ = gMin[2] + vz * res;
                    var nearX = Math.max(vMinX, Math.min(wx, vMinX + res));
                    var nearZ = Math.max(vMinZ, Math.min(wz, vMinZ + res));
                    var ddx = wx - nearX, ddz = wz - nearZ;
                    var dist = Math.sqrt(ddx * ddx + ddz * ddz);
                    var ov = radius - dist;
                    if (ov > 0) {
                        if (dist < 1e-4) addPush(radius, 0);
                        else addPush((ddx / dist) * ov, (ddz / dist) * ov);
                    }
                }
            }
        } else if (_voxels && _bounds) {
            var b = _bounds;
            var voxelW = b.sx / GRID, voxelD = b.sz / GRID;
            var loVY2 = Math.max(0, _wvx(bandLoY, b.minY, b.sy));
            var hiVY2 = Math.min(GRID - 1, _wvx(bandHiY, b.minY, b.sy));
            var searchR2 = Math.ceil(radius / Math.min(voxelW, voxelD)) + 1;
            var cvx2 = _wvx(wx, b.minX, b.sx), cvz2 = _wvx(wz, b.minZ, b.sz);
            for (var ex = -searchR2; ex <= searchR2; ex++) {
                for (var ez = -searchR2; ez <= searchR2; ez++) {
                    var ax = cvx2 + ex, az = cvz2 + ez;
                    if (ax < 0 || az < 0 || ax >= GRID || az >= GRID) continue;
                    var hit2 = false;
                    for (var vy2 = loVY2; vy2 <= hiVY2; vy2++) {
                        if (_voxels[vi(ax, vy2, az)]) { hit2 = true; break; }
                    }
                    if (!hit2) continue;
                    var vMinX2 = b.minX + ax * voxelW, vMinZ2 = b.minZ + az * voxelD;
                    var nearX2 = Math.max(vMinX2, Math.min(wx, vMinX2 + voxelW));
                    var nearZ2 = Math.max(vMinZ2, Math.min(wz, vMinZ2 + voxelD));
                    var gx = wx - nearX2, gz = wz - nearZ2;
                    var dist2 = Math.sqrt(gx * gx + gz * gz);
                    var ov2 = radius - dist2;
                    if (ov2 > 0) {
                        if (dist2 < 1e-4) addPush(radius, 0);
                        else addPush((gx / dist2) * ov2, (gz / dist2) * ov2);
                    }
                }
            }
        }

        // Phase 3c: 手動コリジョン箱（ガラス・鏡）。縦帯 [bandLoY,bandHiY] と Y が重なるものだけ。
        for (var mb = 0; mb < _manualBoxes.length; mb++) {
            var box = _manualBoxes[mb];
            if (bandHiY < box[1] || bandLoY > box[4]) continue;
            var bnx = Math.max(box[0], Math.min(wx, box[3]));
            var bnz = Math.max(box[2], Math.min(wz, box[5]));
            var bdx = wx - bnx, bdz = wz - bnz;
            var bdist = Math.sqrt(bdx * bdx + bdz * bdz);
            var bov = radius - bdist;
            if (bov > 0) {
                if (bdist < 1e-4) addPush(radius, 0);
                else addPush((bdx / bdist) * bov, (bdz / bdist) * bov);
            }
        }

        var pushX = pushXPos + pushXNeg;
        var pushZ = pushZPos + pushZNeg;

        // 安全弁: 1回の押し出し量を上限で制限する。壁だらけの不完全なコライダーでも
        // カメラが部屋の外へ「吹き飛ばされる」のを防ぐ（スイープで徐々に解決される）。
        var plen = Math.sqrt(pushX * pushX + pushZ * pushZ);
        var MAX_PUSH = 0.25;
        if (plen > MAX_PUSH) { pushX = pushX / plen * MAX_PUSH; pushZ = pushZ / plen * MAX_PUSH; }

        return { x: wx + pushX, z: wz + pushZ };
    }

    // (wx,wz) で「立てる面の上端ワールド Y」。maxY 以下で最も高い占有ボクセルの上端。
    // 段差・台の上に乗れるようにする。無ければ null。
    function supportTopWorld(wx, wz, maxY) {
        if (_svo) {
            var meta = _svo.meta, res = meta.voxelResolution, gMin = meta.gridBounds.min, gMax = meta.gridBounds.max;
            var vx = Math.floor((wx - gMin[0]) / res), vz = Math.floor((wz - gMin[2]) / res);
            var maxVX = Math.ceil((gMax[0] - gMin[0]) / res), maxVZ = Math.ceil((gMax[2] - gMin[2]) / res);
            var maxVY = Math.ceil((gMax[1] - gMin[1]) / res);
            if (vx < 0 || vz < 0 || vx >= maxVX || vz >= maxVZ) return null;
            var topVY = Math.min(maxVY - 1, Math.floor((maxY - gMin[1]) / res));
            for (var vy = topVY; vy >= 0; vy--) {
                if (isVoxelOccupied_SVO(vx, vy, vz)) return gMin[1] + (vy + 1) * res;
            }
            return null;
        }
        if (_voxels && _bounds) {
            var b = _bounds;
            var ax = _wvx(wx, b.minX, b.sx), az = _wvx(wz, b.minZ, b.sz);
            if (ax < 0 || az < 0 || ax >= GRID || az >= GRID) return null;
            var top = Math.min(GRID - 1, _wvx(maxY, b.minY, b.sy));
            for (var vy2 = top; vy2 >= 0; vy2--) {
                if (_voxels[vi(ax, vy2, az)]) return b.minY + (vy2 + 1) / GRID * b.sy;
            }
            return null;
        }
        return null;
    }

    // (wx,wz) で fromY より上にある最も低い占有ボクセルの下端（＝天井）。無ければ null。
    function ceilBottomWorld(wx, wz, fromY) {
        if (_svo) {
            var meta = _svo.meta, res = meta.voxelResolution, gMin = meta.gridBounds.min, gMax = meta.gridBounds.max;
            var vx = Math.floor((wx - gMin[0]) / res), vz = Math.floor((wz - gMin[2]) / res);
            var maxVX = Math.ceil((gMax[0] - gMin[0]) / res), maxVZ = Math.ceil((gMax[2] - gMin[2]) / res);
            var maxVY = Math.ceil((gMax[1] - gMin[1]) / res);
            if (vx < 0 || vz < 0 || vx >= maxVX || vz >= maxVZ) return null;
            var startVY = Math.max(0, Math.floor((fromY - gMin[1]) / res) + 1);
            for (var vy = startVY; vy < maxVY; vy++) {
                if (isVoxelOccupied_SVO(vx, vy, vz)) return gMin[1] + vy * res;
            }
            return null;
        }
        if (_voxels && _bounds) {
            var b = _bounds;
            var ax = _wvx(wx, b.minX, b.sx), az = _wvx(wz, b.minZ, b.sz);
            if (ax < 0 || az < 0 || ax >= GRID || az >= GRID) return null;
            var startVY2 = Math.max(0, _wvx(fromY, b.minY, b.sy) + 1);
            for (var vy2 = startVY2; vy2 < GRID; vy2++) {
                if (_voxels[vi(ax, vy2, az)]) return b.minY + vy2 / GRID * b.sy;
            }
            return null;
        }
        return null;
    }

    // ---- 3D 占有ビットのパック/アンパック（.hmap.json 保存でビューアにも 3D を渡す）----
    function _packVoxels(v) {
        var bytes = new Uint8Array((v.length + 7) >> 3);
        for (var i = 0; i < v.length; i++) if (v[i]) bytes[i >> 3] |= (1 << (i & 7));
        var bin = '', CH = 0x8000;
        for (var o = 0; o < bytes.length; o += CH) {
            bin += String.fromCharCode.apply(null, bytes.subarray(o, Math.min(o + CH, bytes.length)));
        }
        return btoa(bin);
    }
    function _unpackVoxels(b64) {
        var bin = atob(b64), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var v = new Uint8Array(GRID3);
        for (var j = 0; j < v.length; j++) v[j] = (bytes[j >> 3] >> (j & 7)) & 1;
        return v;
    }

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
    // 3DGS の場合は scale_0/1/2 と opacity も拾うことで、ガウシアンの実サイズに
    // 基づいたボクセル占有を計算できる（平面の壁が「中心点だけ」では密度不足で
    // コライダーから抜け落ちるのを防ぐ）。
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
        var s0o = -1, s1o = -1, s2o = -1, opao = -1;
        props.forEach(function (p) {
            if (p.name === 'x') xo = stride;
            if (p.name === 'y') yo = stride;
            if (p.name === 'z') zo = stride;
            if (p.name === 'scale_0') s0o = stride;
            if (p.name === 'scale_1') s1o = stride;
            if (p.name === 'scale_2') s2o = stride;
            if (p.name === 'opacity') opao = stride;
            stride += p.size;
        });
        if (xo < 0 || yo < 0 || zo < 0) throw new Error('PLY に x/y/z プロパティが見つかりません');

        return {
            n: nV, stride: stride, xo: xo, yo: yo, zo: zo,
            s0o: s0o, s1o: s1o, s2o: s2o, opao: opao,
            dataStart: dataStart
        };
    }

    // ---- 公開 API ----
    return {
        isReady:   function () { return _ready; },
        isEnabled: function () { return _enabled; },
        setEnabled: function (v) { _enabled = !!v; },
        isWalkMode: function () { return _walkMode; },
        setWalkMode: function (v) { _walkMode = !!v; },   // true=床に高さ固定追従
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
            _ready    = false;
            _voxels   = null;
            _wallmask = null;
            try {
                if (!data || !data.bounds || !data.hmap) throw new Error('不正なフォーマット');
                _bounds = data.bounds;
                _setGrid(data.grid || 128);   // Phase 2: 生成時の解像度に合わせる
                // JSON シリアライズで NaN → null になっているので NaN に戻す
                function toFloatArrayWithNaN(src) {
                    var arr = new Float32Array(src.length);
                    for (var i = 0; i < src.length; i++) {
                        arr[i] = src[i] == null ? NaN : src[i];
                    }
                    return arr;
                }
                _hmap    = toFloatArrayWithNaN(data.hmap);
                _ceilmap = data.ceilmap  ? toFloatArrayWithNaN(data.ceilmap) : null;
                _wallmask = data.wallmask ? new Uint8Array(data.wallmask) : null;
                // v3: 3D 占有ボクセルがあれば復元 → 実行時に 3D カプセル判定が使える
                if (data.vox) {
                    try { _voxels = _unpackVoxels(data.vox); }
                    catch (e) { _voxels = null; console.warn('[Collider] vox 復元失敗:', e); }
                }
                _ready   = true;
                console.log(
                    '[Collider] hmap 読み込み完了 — grid:', data.grid,
                    'format:', data.format || 'v1',
                    'wallmask:', _wallmask ? 'あり' : 'なし',
                    '3Dvox:', _voxels ? 'あり' : 'なし'
                );
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
                format: 'vr-naiken-hmap-v3',   // v3: vox（3D占有ビット）追加 / v2: wallmask
                grid:   GRID,
                bounds: {
                    minX: b.minX, maxX: b.maxX,
                    minY: b.minY, maxY: b.maxY,
                    minZ: b.minZ, maxZ: b.maxZ,
                    sx:   b.sx,   sy:   b.sy,   sz:   b.sz
                },
                hmap:     Array.from(_hmap),
                ceilmap:  _ceilmap  ? Array.from(_ceilmap)  : null,
                wallmask: _wallmask ? Array.from(_wallmask) : null,
                // 3D カプセル判定用の占有ボクセル（base64 bitpacked GRID^3）。
                // これによりビューアでも段差・薄壁・すり抜けを 3D で判定できる。
                vox:      _voxels   ? _packVoxels(_voxels)  : null,
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
         *   Phase 0: ヘッダー解析
         *   Phase 1: 頂点データ読み込み
         *   Phase 2: 生 BBOX → パーセンタイル BBOX（フロート除去）
         *   Phase 3: ボクセル密度を集計（Uint16）
         *   Phase 4: 二値化 → 連結成分フィルタ（小さなクラスタ = 浮遊ノイズを削除）
         *   Phase 5: 床・天井マップを生成（未検出セルは NaN）
         *
         * splat-transform の --filter-cluster と同じ発想で接続性によってノイズを除く。
         * SVO ファイル（.voxel.json/.bin）が用意できる場合はそちらを優先（loadVoxelFiles）。
         *
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
            var HIST_BATCH  = 3000;
            var VOXEL_BATCH = 3000;
            var HMAP_ROWS   = 3;

            // --- Phase 0: ヘッダー解析（同期・高速）---
            setTimeout(function () {
                var n, stride, xo, yo, zo, dataStart, isSplat;
                var s0o = -1, s1o = -1, s2o = -1, opao = -1;
                try {
                    if (onProgress) onProgress(1, 'ヘッダーを解析中...');
                    var ext = (filename || '').split('.').pop().toLowerCase();
                    if (ext === 'splat') {
                        // antimatter15 splat: x,y,z (float32×3), scale_x/y/z (float32×3,
                        // 既に exp 済み), rgba (uint8×4), rot_quat (uint8×4) = 32B
                        isSplat   = true;
                        n         = Math.floor(buffer.byteLength / 32);
                        stride    = 32; xo = 0; yo = 4; zo = 8; dataStart = 0;
                        s0o = 12; s1o = 16; s2o = 20;
                    } else {
                        isSplat = false;
                        var h   = parsePLYHeader(buffer);
                        n = h.n; stride = h.stride;
                        xo = h.xo; yo = h.yo; zo = h.zo;
                        s0o = h.s0o; s1o = h.s1o; s2o = h.s2o; opao = h.opao;
                        dataStart = h.dataStart;
                    }
                } catch (e) {
                    if (onDone) onDone(e);
                    return;
                }

                // 3DGS パラメータ
                // - scale: PLY は log 値 (exp で半径)、splat は既に半径 (m)
                // - opacity (PLY のみ): logit 値、sigmoid > 0.1 ⇔ raw > -2.197
                var hasScale = (s0o >= 0 && s1o >= 0 && s2o >= 0);
                var hasOpa   = (opao >= 0);
                // Phase 3a: ガラス・薄い半透明面を拾うため閾値を緩和（-3.5 ≒ 不透明度 2.9%）。
                // 増えるノイズは連結成分フィルタとロバスト bbox で除去する。
                var OPACITY_THRESH = -3.5;   // これ未満（ほぼ透明）のみ無視
                var MAX_RADIUS_M   = 0.20;   // スタンプ半径の上限 (m)。これより大きい
                                             // ガウシアンは sky/floater の可能性が高い

                // --- Phase 1: 頂点データを分割読み込み ---
                var pts      = new Float32Array(n * 3);
                var radii    = new Float32Array(n);  // ガウシアン半径 (m)。
                                                     // 0 = scale なし、-1 = opacity フィルタ
                var dv       = new DataView(buffer, dataStart);
                var parseIdx = 0;

                function parseStep() {
                    var end = Math.min(parseIdx + PARSE_BATCH, n);
                    for (var i = parseIdx; i < end; i++) {
                        var b = i * stride;
                        pts[i * 3]     = dv.getFloat32(b + xo, true);
                        pts[i * 3 + 1] = dv.getFloat32(b + yo, true);
                        pts[i * 3 + 2] = dv.getFloat32(b + zo, true);

                        if (hasOpa) {
                            var op = dv.getFloat32(b + opao, true);
                            if (op < OPACITY_THRESH) { radii[i] = -1; continue; }
                        }
                        if (hasScale) {
                            var sa = dv.getFloat32(b + s0o, true);
                            var sb = dv.getFloat32(b + s1o, true);
                            var sc = dv.getFloat32(b + s2o, true);
                            var maxS = sa > sb ? (sa > sc ? sa : sc) : (sb > sc ? sb : sc);
                            var r = isSplat ? maxS : Math.exp(maxS);
                            if (r > MAX_RADIUS_M) r = MAX_RADIUS_M;
                            radii[i] = r;
                        }
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
                        if (radii[i] < 0) continue;  // 透明ガウシアンは bbox に含めない
                        var c = applyCorrection(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
                        if (c.cx < minX) minX = c.cx; if (c.cx > maxX) maxX = c.cx;
                        if (c.cy < minY) minY = c.cy; if (c.cy > maxY) maxY = c.cy;
                        if (c.cz < minZ) minZ = c.cz; if (c.cz > maxZ) maxZ = c.cz;
                    }
                    bboxIdx = end;
                    if (bboxIdx < n) {
                        if (onProgress) onProgress(
                            25 + Math.round(bboxIdx / n * 10),
                            'バウンディングボックス計算中...'
                        );
                        setTimeout(bboxStep, 0);
                        return;
                    }

                    // 生 BBOX 完了 → ヒストグラムでロバスト bbox を計算
                    rawMinX = minX; rawMaxX = maxX;
                    rawMinY = minY; rawMaxY = maxY;
                    rawMinZ = minZ; rawMaxZ = maxZ;
                    rangeX = rawMaxX - rawMinX || 1;
                    rangeY = rawMaxY - rawMinY || 1;
                    rangeZ = rawMaxZ - rawMinZ || 1;
                    histX = new Uint32Array(HIST_BUCKETS);
                    histY = new Uint32Array(HIST_BUCKETS);
                    histZ = new Uint32Array(HIST_BUCKETS);

                    if (onProgress) onProgress(35, 'バウンディングボックスを精密化中...');
                    setTimeout(histStep, 0);
                }

                // --- Phase 2b: パーセンタイル bbox（ノイズフロート除去）---
                var rawMinX, rawMaxX, rawMinY, rawMaxY, rawMinZ, rawMaxZ;
                var rangeX, rangeY, rangeZ;
                var histX, histY, histZ;
                var histIdx = 0;

                function histStep() {
                    var end = Math.min(histIdx + HIST_BATCH, n);
                    var LAST = HIST_BUCKETS - 1;
                    for (var i = histIdx; i < end; i++) {
                        if (radii[i] < 0) continue;
                        var c = applyCorrection(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
                        var ix = Math.floor((c.cx - rawMinX) / rangeX * HIST_BUCKETS);
                        var iy = Math.floor((c.cy - rawMinY) / rangeY * HIST_BUCKETS);
                        var iz = Math.floor((c.cz - rawMinZ) / rangeZ * HIST_BUCKETS);
                        if (ix < 0) ix = 0; else if (ix > LAST) ix = LAST;
                        if (iy < 0) iy = 0; else if (iy > LAST) iy = LAST;
                        if (iz < 0) iz = 0; else if (iz > LAST) iz = LAST;
                        histX[ix]++; histY[iy]++; histZ[iz]++;
                    }
                    histIdx = end;
                    if (histIdx < n) {
                        if (onProgress) onProgress(
                            35 + Math.round(histIdx / n * 10),
                            'バウンディングボックスを精密化中...'
                        );
                        setTimeout(histStep, 0);
                        return;
                    }

                    function pct(hist, total, p) {
                        var target = total * p;
                        var cumul  = 0;
                        for (var i = 0; i < HIST_BUCKETS; i++) {
                            cumul += hist[i];
                            if (cumul >= target) return i;
                        }
                        return HIST_BUCKETS - 1;
                    }

                    // パーセンタイルの分母は「不透明度フィルタで残った点数」を使う。
                    // 全点数 n を使うと、除外分だけ高位パーセンタイルがヒストグラム総和を超え、
                    // 上側トリミングが無効化されてフローターで bbox が膨張する（キッチンで発覚）。
                    var keptN = 0;
                    for (var kb = 0; kb < HIST_BUCKETS; kb++) keptN += histX[kb];
                    if (keptN < 1) keptN = 1;
                    var loX = pct(histX, keptN, ROBUST_LOW), hiX = pct(histX, keptN, ROBUST_HIGH);
                    var loY = pct(histY, keptN, ROBUST_LOW), hiY = pct(histY, keptN, ROBUST_HIGH);
                    var loZ = pct(histZ, keptN, ROBUST_LOW), hiZ = pct(histZ, keptN, ROBUST_HIGH);

                    minX = rawMinX + loX       / HIST_BUCKETS * rangeX;
                    maxX = rawMinX + (hiX + 1) / HIST_BUCKETS * rangeX;
                    minY = rawMinY + loY       / HIST_BUCKETS * rangeY;
                    maxY = rawMinY + (hiY + 1) / HIST_BUCKETS * rangeY;
                    minZ = rawMinZ + loZ       / HIST_BUCKETS * rangeZ;
                    maxZ = rawMinZ + (hiZ + 1) / HIST_BUCKETS * rangeZ;

                    var pad = 0.3;
                    minX -= pad; maxX += pad;
                    minY -= pad; maxY += pad;
                    minZ -= pad; maxZ += pad;
                    var sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ;
                    _bounds = { minX:minX, maxX:maxX, minY:minY, maxY:maxY,
                                minZ:minZ, maxZ:maxZ, sx:sx, sy:sy, sz:sz };
                    // Phase 2: シーンの最大辺が ~TARGET_VOXEL_M になる解像度を選ぶ（[GRID_MIN,GRID_MAX] にクランプ）
                    var maxDim = Math.max(sx, sy, sz);
                    _setGrid(Math.max(GRID_MIN, Math.min(GRID_MAX, Math.round(maxDim / TARGET_VOXEL_M))));
                    console.log('[Collider] adaptive grid =', GRID, '(maxDim=' + maxDim.toFixed(2) + 'm, ~' + (maxDim / GRID * 100).toFixed(1) + 'cm/voxel)');
                    _voxels = new Uint16Array(GRID * GRID * GRID);  // 占有 → 点数カウント

                    // ヒストグラムは不要になったので解放
                    histX = histY = histZ = null;

                    if (onProgress) onProgress(45, 'ボクセル密度を集計中...');
                    setTimeout(voxelStep, 0);
                }

                // --- Phase 3: ボクセル埋め（分割）---
                var voxelIdx   = 0;
                var solidCount = 0;   // Phase 3→4 をまたぐ統計

                function voxelStep() {
                    var end = Math.min(voxelIdx + VOXEL_BATCH, n);
                    var b = _bounds;
                    var voxelSizeM = Math.min(b.sx, b.sy, b.sz) / GRID;
                    for (var i = voxelIdx; i < end; i++) {
                        if (radii[i] < 0) continue;  // opacity フィルタ
                        var c = applyCorrection(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
                        // bbox 外のフロートは数えない（edge にクランプすると密度が偽造される）
                        if (c.cx < b.minX || c.cx > b.maxX) continue;
                        if (c.cy < b.minY || c.cy > b.maxY) continue;
                        if (c.cz < b.minZ || c.cz > b.maxZ) continue;
                        var vx = Math.min(GRID - 1, Math.floor((c.cx - b.minX) / b.sx * GRID));
                        var vy = Math.min(GRID - 1, Math.floor((c.cy - b.minY) / b.sy * GRID));
                        var vz = Math.min(GRID - 1, Math.floor((c.cz - b.minZ) / b.sz * GRID));

                        // ガウシアン半径分のスタンプ。3DGS では平らな壁面が大きな
                        // ガウシアン 1 個でカバーされ、中心点だけ集計すると密度不足で
                        // 抜け落ちる。半径分のボクセルに書き込むことで壁を埋める。
                        // 球状で書き込み、最大 3 ボクセル（〜30cm）で頭打ち。
                        var radVox = radii[i] > 0
                            ? Math.min(3, Math.round(radii[i] / voxelSizeM))
                            : 0;
                        if (radVox === 0) {
                            var idx = vi(vx, vy, vz);
                            if (_voxels[idx] < 0xFFFF) _voxels[idx]++;
                        } else {
                            var rSq = radVox * radVox;
                            for (var dz_ = -radVox; dz_ <= radVox; dz_++) {
                                var nvz = vz + dz_;
                                if (nvz < 0 || nvz >= GRID) continue;
                                for (var dy_ = -radVox; dy_ <= radVox; dy_++) {
                                    var nvy = vy + dy_;
                                    if (nvy < 0 || nvy >= GRID) continue;
                                    for (var dx_ = -radVox; dx_ <= radVox; dx_++) {
                                        if (dx_*dx_ + dy_*dy_ + dz_*dz_ > rSq) continue;
                                        var nvx = vx + dx_;
                                        if (nvx < 0 || nvx >= GRID) continue;
                                        var idx2 = vi(nvx, nvy, nvz);
                                        if (_voxels[idx2] < 0xFFFF) _voxels[idx2]++;
                                    }
                                }
                            }
                        }
                    }
                    voxelIdx = end;
                    if (voxelIdx < n) {
                        if (onProgress) onProgress(
                            45 + Math.round(voxelIdx / n * 20),
                            'ボクセル密度を集計中...'
                        );
                        setTimeout(voxelStep, 0);
                        return;
                    }

                    // Phase 3 完了 → Phase 4: 二値化 + 連結成分フィルタ
                    // スタンプ方式では「1 回でもスタンプされたら solid」で十分。
                    // ノイズ除去は連結成分フィルタ (CC) に任せる。
                    var solidThresh = 1;

                    // Uint16Array(counts) → Uint8Array(solid bool) に置き換え
                    var solid = new Uint8Array(GRID3);
                    solidCount = 0;
                    for (var i = 0; i < GRID3; i++) {
                        if (_voxels[i] >= solidThresh) {
                            solid[i] = 1;
                            solidCount++;
                        }
                    }
                    _voxels = solid;  // 以降は boolean grid

                    if (onProgress) onProgress(
                        68,
                        '連結成分フィルタ中... (solid voxels=' + solidCount + ', 閾値=' + solidThresh + ')'
                    );
                    setTimeout(ccStep, 0);
                }

                // --- Phase 4: 連結成分フィルタ（浮遊スプラット除去）---
                // BFS で 6-連結ラベリングし、大きなクラスタだけ残す
                function ccStep() {
                    var solid = _voxels;
                    var labels = new Int32Array(GRID3);   // 0 = empty, >0 = label
                    var sizes  = [0];                     // sizes[i] = label i のボクセル数
                    var queue  = new Int32Array(GRID3);   // BFS キュー
                    var nextLabel = 1;
                    var maxSize   = 0;

                    for (var start = 0; start < GRID3; start++) {
                        if (!solid[start] || labels[start]) continue;
                        var head = 0, tail = 0;
                        queue[tail++] = start;
                        labels[start] = nextLabel;
                        var size = 1;
                        while (head < tail) {
                            var idx = queue[head++];
                            var vx_ = idx % GRID;
                            var rem = (idx - vx_) / GRID;
                            var vy_ = rem % GRID;
                            var vz_ = (rem - vy_) / GRID;
                            // 6-neighbors
                            var nb;
                            if (vx_ > 0)        { nb = idx - 1;     if (solid[nb] && !labels[nb]) { labels[nb] = nextLabel; queue[tail++] = nb; size++; } }
                            if (vx_ < GRID - 1) { nb = idx + 1;     if (solid[nb] && !labels[nb]) { labels[nb] = nextLabel; queue[tail++] = nb; size++; } }
                            if (vy_ > 0)        { nb = idx - GRID;  if (solid[nb] && !labels[nb]) { labels[nb] = nextLabel; queue[tail++] = nb; size++; } }
                            if (vy_ < GRID - 1) { nb = idx + GRID;  if (solid[nb] && !labels[nb]) { labels[nb] = nextLabel; queue[tail++] = nb; size++; } }
                            if (vz_ > 0)        { nb = idx - GRID2; if (solid[nb] && !labels[nb]) { labels[nb] = nextLabel; queue[tail++] = nb; size++; } }
                            if (vz_ < GRID - 1) { nb = idx + GRID2; if (solid[nb] && !labels[nb]) { labels[nb] = nextLabel; queue[tail++] = nb; size++; } }
                        }
                        sizes.push(size);
                        if (size > maxSize) maxSize = size;
                        nextLabel++;
                    }

                    // Phase 3b: 各ラベルの bbox を計算（薄い平面シート＝ガラス/間仕切りを保護する）
                    var lbMinX = new Int16Array(nextLabel), lbMaxX = new Int16Array(nextLabel);
                    var lbMinY = new Int16Array(nextLabel), lbMaxY = new Int16Array(nextLabel);
                    var lbMinZ = new Int16Array(nextLabel), lbMaxZ = new Int16Array(nextLabel);
                    for (var L0 = 0; L0 < nextLabel; L0++) {
                        lbMinX[L0] = GRID; lbMinY[L0] = GRID; lbMinZ[L0] = GRID;
                        lbMaxX[L0] = -1;   lbMaxY[L0] = -1;   lbMaxZ[L0] = -1;
                    }
                    for (var p2 = 0; p2 < GRID3; p2++) {
                        var Lp = labels[p2];
                        if (!Lp) continue;
                        var px = p2 % GRID, pr = (p2 - px) / GRID, py = pr % GRID, pz = (pr - py) / GRID;
                        if (px < lbMinX[Lp]) lbMinX[Lp] = px; if (px > lbMaxX[Lp]) lbMaxX[Lp] = px;
                        if (py < lbMinY[Lp]) lbMinY[Lp] = py; if (py > lbMaxY[Lp]) lbMaxY[Lp] = py;
                        if (pz < lbMinZ[Lp]) lbMinZ[Lp] = pz; if (pz > lbMaxZ[Lp]) lbMaxZ[Lp] = pz;
                    }

                    // クラスタサイズしきい値: 最大の MIN_CLUSTER_RATIO 以下 or MIN_CLUSTER_VOXELS 未満は削除
                    // ただし最大クラスタは常に残す（極端に小さなシーンで全て消えるのを防ぐ）
                    var threshold = Math.max(MIN_CLUSTER_VOXELS, Math.round(maxSize * MIN_CLUSTER_RATIO));
                    if (threshold > maxSize) threshold = maxSize;
                    // 薄い平面シート（ガラス screen/薄壁）の判定: 最薄辺 ≤ THIN_MAX かつ 中辺 ≥ PLANAR_MIN
                    var THIN_MAX = 4, PLANAR_MIN = 14, PLANAR_MIN_VOXELS = 80;
                    var keptLabels = new Uint8Array(nextLabel);
                    var keptCount  = 0;
                    var keptVoxels = 0;
                    var planarKept = 0;
                    for (var L = 1; L < nextLabel; L++) {
                        var keep = sizes[L] >= threshold;
                        if (!keep && sizes[L] >= PLANAR_MIN_VOXELS) {
                            var d = [lbMaxX[L] - lbMinX[L] + 1, lbMaxY[L] - lbMinY[L] + 1, lbMaxZ[L] - lbMinZ[L] + 1]
                                .sort(function (a, b) { return a - b; });
                            if (d[0] <= THIN_MAX && d[1] >= PLANAR_MIN) { keep = true; planarKept++; }
                        }
                        if (keep) { keptLabels[L] = 1; keptCount++; keptVoxels += sizes[L]; }
                    }

                    // フィルタ適用: 残すクラスタの voxel だけ solid に残す
                    for (var i = 0; i < GRID3; i++) {
                        if (!keptLabels[labels[i]]) solid[i] = 0;
                    }

                    console.log(
                        '[Collider] CC filter — clusters:', nextLabel - 1,
                        '/ kept:', keptCount, '(planar sheets:', planarKept + ')',
                        '/ threshold:', threshold,
                        '/ kept voxels:', keptVoxels, '/', solidCount
                    );

                    _hmap    = new Float32Array(GRID2);
                    _ceilmap = new Float32Array(GRID2);
                    _hmap.fill(NaN);    // NaN = 未検出 → 床補正をかけない
                    _ceilmap.fill(NaN);

                    if (onProgress) onProgress(80, '床・天井マップを構築中...');
                    setTimeout(hmapStep, 0);
                }

                // --- Phase 5: 床・天井マップ（CC フィルタ済み solid から直接）---
                var hmapVZ = 0;

                function hmapStep() {
                    var end = Math.min(hmapVZ + HMAP_ROWS, GRID);
                    var b   = _bounds;
                    for (var vz = hmapVZ; vz < end; vz++) {
                        for (var vx = 0; vx < GRID; vx++) {
                            var botVY = -1, topVY = -1;
                            // CC フィルタ後はノイズが無いので最低/最高占有ボクセルがそのまま床/天井
                            for (var vy = 0; vy < GRID; vy++) {
                                if (_voxels[vi(vx, vy, vz)]) { botVY = vy; break; }
                            }
                            for (var vy2 = GRID - 1; vy2 >= 0; vy2--) {
                                if (_voxels[vi(vx, vy2, vz)]) { topVY = vy2; break; }
                            }
                            _hmap[vx + vz * GRID] = botVY >= 0
                                ? b.minY + (botVY / (GRID - 1)) * b.sy
                                : NaN;
                            _ceilmap[vx + vz * GRID] = topVY >= 0
                                ? b.minY + (topVY / (GRID - 1)) * b.sy
                                : NaN;
                        }
                    }
                    hmapVZ = end;
                    if (hmapVZ < GRID) {
                        if (onProgress) onProgress(
                            80 + Math.round(hmapVZ / GRID * 15),
                            '床・天井マップを構築中...'
                        );
                        setTimeout(hmapStep, 0);
                        return;
                    }

                    // Phase 5b: 床マップの小さな穴を近傍から補間して埋める。
                    // porous な床で NaN になった「内側」のセルを壁扱いすると、
                    // 狭い通路が塞がって通れなくなる。周囲が床のセルは床とみなす。
                    // 過半数(5/8以上)が床のセルだけ埋めるので、外側の広い NaN は残る。
                    for (var fpass = 0; fpass < 2; fpass++) {
                        var fsrc = new Float32Array(_hmap);
                        for (var hz = 0; hz < GRID; hz++) {
                            for (var hx = 0; hx < GRID; hx++) {
                                var hi0 = hx + hz * GRID;
                                if (!isNaN(fsrc[hi0])) continue;
                                var fsum = 0, fcnt = 0;
                                for (var oz = -1; oz <= 1; oz++) {
                                    for (var ox = -1; ox <= 1; ox++) {
                                        if (ox === 0 && oz === 0) continue;
                                        var nnx = hx + ox, nnz = hz + oz;
                                        if (nnx < 0 || nnz < 0 || nnx >= GRID || nnz >= GRID) continue;
                                        var nnv = fsrc[nnx + nnz * GRID];
                                        if (!isNaN(nnv)) { fsum += nnv; fcnt++; }
                                    }
                                }
                                if (fcnt >= 5) _hmap[hi0] = fsum / fcnt;
                            }
                        }
                    }

                    // Phase 6: XZ 壁マスクを構築（.hmap.json に保存する用）
                    // 床から +PERSON_LO 〜 +PERSON_HI の間に solid voxel があれば「壁」
                    // 床未検出 (NaN) は外側エリアと見なして壁扱い
                    var PERSON_LO = 0.3;   // 床から下端 (m)
                    var PERSON_HI = 1.6;   // 床から上端 (m)
                    var b2 = _bounds;
                    _wallmask = new Uint8Array(GRID2);
                    var voxelH = b2.sy / GRID;
                    var loDV = Math.max(1, Math.round(PERSON_LO / voxelH));
                    var hiDV = Math.max(loDV, Math.round(PERSON_HI / voxelH));
                    for (var vz3 = 0; vz3 < GRID; vz3++) {
                        for (var vx3 = 0; vx3 < GRID; vx3++) {
                            var fy = _hmap[vx3 + vz3 * GRID];
                            if (isNaN(fy)) {
                                _wallmask[vx3 + vz3 * GRID] = 1;
                                continue;
                            }
                            var floorVY = Math.floor((fy - b2.minY) / b2.sy * GRID);
                            var lo = Math.min(GRID - 1, floorVY + loDV);
                            var hi = Math.min(GRID - 1, floorVY + hiDV);
                            for (var vy3 = lo; vy3 <= hi; vy3++) {
                                if (_voxels[vi(vx3, vy3, vz3)]) {
                                    _wallmask[vx3 + vz3 * GRID] = 1;
                                    break;
                                }
                            }
                        }
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
            if (!_bounds || !_hmap) return null;
            var b  = _bounds;
            var vx = toVox(wx, b.minX, b.sx);
            var vz = toVox(wz, b.minZ, b.sz);
            var v  = _hmap[vx + vz * GRID];
            return isNaN(v) ? null : v;   // NaN は未検出
        },

        getCeilY: function (wx, wz) {
            if (!_ready) return null;
            if (_svo) return getCeilY_SVO(wx, wz);
            if (!_bounds || !_ceilmap) return null;
            var b  = _bounds;
            var vx = toVox(wx, b.minX, b.sx);
            var vz = toVox(wz, b.minZ, b.sz);
            var v  = _ceilmap[vx + vz * GRID];
            return isNaN(v) ? null : v;
        },

        /**
         * 前フレーム位置 → 新位置への移動をボクセル幅の半分ずつに分割し、
         * 各サブステップで resolvePosition を適用して壁を貫通しないように補正する。
         * 1フレームの移動量がボクセル幅を超えると薄い壁を踏み越えてしまい、
         * 反対側の床高さに引っ張られて「がくん」と落下するのを防ぐ。
         * @param {pc.Vec3} prevPos
         * @param {pc.Vec3} newPos
         * @param {number}  eyeHeight
         * @returns {pc.Vec3}
         */
        resolvePositionSwept: function (prevPos, newPos, eyeHeight) {
            if (!_enabled || (!_ready && !_manualBoxes.length)) {
                return new pc.Vec3(newPos.x, newPos.y, newPos.z);
            }

            // サブステップ単位（ボクセル XZ 幅の半分）を決める
            var stepSize;
            if (_svo) {
                stepSize = _svo.meta.voxelResolution * 0.5;
            } else if (_bounds) {
                stepSize = Math.min(_bounds.sx, _bounds.sz) / (GRID - 1) * 0.5;
            } else if (_manualBoxes.length) {
                stepSize = 0.05;   // ボクセル無し（手動箱のみ）でもスイープしてすり抜け防止
            } else {
                return this.resolvePosition(newPos, eyeHeight);
            }

            var dx = newPos.x - prevPos.x;
            var dz = newPos.z - prevPos.z;
            var dy = newPos.y - prevPos.y;
            var moveDistXZ = Math.sqrt(dx * dx + dz * dz);

            // 1ステップで収まる短距離移動は通常パスへ
            if (moveDistXZ <= stepSize) return this.resolvePosition(newPos, eyeHeight);

            var steps = Math.ceil(moveDistXZ / stepSize);
            // 高速移動でも薄壁を貫通しないよう分割上限を引き上げる（~0.6m/フレームまで完全スイープ）。
            // これを超える一括移動はテレポート相当とみなし端点解決（着地は次フレームで押し出し）。
            if (steps > 64) steps = 64;

            var cur = new pc.Vec3();
            var resolved = new pc.Vec3(prevPos.x, prevPos.y, prevPos.z);
            // 直前のサブステップで蓄積した押し戻し量を継承する
            // (壁の手前で止まったら、次のステップもその位置から再開する)
            for (var s = 1; s <= steps; s++) {
                var t  = s / steps;
                var tp = (s - 1) / steps;
                var offsetX = resolved.x - (prevPos.x + dx * tp);
                var offsetZ = resolved.z - (prevPos.z + dz * tp);
                cur.set(
                    prevPos.x + dx * t + offsetX,
                    prevPos.y + dy * t,
                    prevPos.z + dz * t + offsetZ
                );
                resolved = this.resolvePosition(cur, eyeHeight);
            }
            return resolved;
        },

        /**
         * カメラ位置に床・天井衝突を適用して補正後の pc.Vec3 を返す
         * @param {pc.Vec3} pos
         * @param {number}  eyeHeight  床から目線までの高さ (m)
         * @returns {pc.Vec3}
         */
        resolvePosition: function (pos, eyeHeight) {
            var out = new pc.Vec3(pos.x, pos.y, pos.z);
            if (!_enabled) return out;
            if (!_ready && !_manualBoxes.length) return out;   // 手動箱だけでも判定する

            var EYE         = eyeHeight || 1.0;
            var HEAD        = 0.05;   // 頭部クリアランス (m)
            // カメラ円柱半径 (m)。半径 R のカメラは幅 2R 未満の隙間を通れない。
            // 3DGS の壁は厚さ1ボクセルの穴あきシートで、特に角は2枚の壁が繋がりきらず
            // 対角に数ボクセルの隙間が残る。半径が小さすぎる（点に近い）と、この角の
            // 隙間にはまり込んで壁をすり抜けてしまう。すり抜けるより「少し引っかかる」
            // 挙動を優先し、~40cm までの角の隙間を塞ぐ（ドア幅 ~80cm は通れる）。
            var WALL_RADIUS = 0.20;
            var STEP_UP     = 0.30;   // 乗り越えられる段差 (m)。これ以下は「段」、超は「壁」

            // ---- 3D カプセル判定（_voxels / SVO / 手動箱 のいずれかがある場合）----
            if (_svo || (_voxels && _bounds) || _manualBoxes.length) {
                var feetY = out.y - EYE;

                // 1) 壁: 足元+段差 〜 頭 の縦帯で XZ 押し出し（段差以下は無視＝登れる）
                var bandLo = feetY + STEP_UP;
                var bandHi = out.y + HEAD;
                // 天井（頭上の水平面）は「壁」ではない。頭を天井へ突き上げるフレームでは
                // band 上端 (out.y+HEAD) が天井ボクセルに達し、それを真上の「壁」と誤認して
                // 真横へ押し出される。天井は部屋全面が solid なので押し出しが止まらず、
                // 壁の隙間から部屋の外へ滑り出るバグになる。band 上端を天井の直下へ抑え、
                // 天井ボクセルを壁判定に含めない（縦方向の当たりは後段の 3) でクランプ）。
                // 家具の天板など（立てない高さ）は本物の天井ではないので cap しない。
                var ceilCap = ceilBottomWorld(out.x, out.z, feetY + STEP_UP + 0.05);
                if (ceilCap !== null && (ceilCap - feetY) >= (EYE + HEAD)) {
                    bandHi = Math.min(bandHi, ceilCap - 0.001);
                }
                if (bandHi < bandLo) bandHi = bandLo;
                var xz = resolveWallBand(out.x, out.z, WALL_RADIUS, bandLo, bandHi);
                out.x = xz.x; out.z = xz.z;

                // 2) 床: 足元+段差 以下で最も高い面に乗る（段差・台・多層に対応）
                var support = supportTopWorld(out.x, out.z, feetY + STEP_UP);
                var floorRef;
                if (support !== null) {
                    floorRef = support;
                    var standY = support + EYE;
                    if (_walkMode) {
                        // ウォークモード: 目線を床に固定追従（上下とも standY に合わせる）。
                        // 段の上り下りは呼び出し側の Y レート制限でなめらかに補間される。
                        out.y = standY;
                    } else {
                        // 自由モード: 床は「下限」のみ（登り／段差の乗り上げは可、上へは自由に飛べる）。
                        // 段を降りるスナップは入れない（自由飛行の上下移動を固定してしまうため）。
                        if (out.y < standY) out.y = standY;
                    }
                } else {
                    floorRef = out.y - EYE;
                }

                // 3) 天井: 頭上の最も低い面。床から立てない高さ差は「家具の天板」とみなし無視
                var ceil = ceilBottomWorld(out.x, out.z, floorRef + STEP_UP + 0.05);
                if (ceil !== null && (ceil - floorRef) < (EYE + HEAD)) ceil = null;
                if (ceil !== null) {
                    var maxY = ceil - HEAD;
                    if (out.y > maxY) out.y = maxY;
                }
                return out;
            }

            // ---- 2D フォールバック（旧 .hmap.json: 3D ボクセル無し）----
            var xz2 = resolveWall(out.x, out.y, out.z, WALL_RADIUS);
            out.x = xz2.x;
            out.z = xz2.z;
            var floorY = this.getFloorY(out.x, out.z);
            var ceilY  = this.getCeilY(out.x, out.z);
            if (floorY !== null) {
                var mY = floorY + EYE;
                if (_walkMode) out.y = mY;          // ウォークモード: 床に固定追従
                else if (out.y < mY) out.y = mY;    // 自由モード: 下限のみ
            }
            if (ceilY !== null && floorY !== null && (ceilY - floorY) < (EYE + HEAD)) {
                ceilY = null;
            }
            if (ceilY !== null) {
                var xY = ceilY - HEAD;
                if (out.y > xY) out.y = xY;
            }
            return out;
        },

        // Phase 3c: 手動コリジョン箱（ガラス・鏡）。シーンごとに main.js から設定する。
        // boxes: [[minX,minY,minZ,maxX,maxY,maxZ], ...]（ワールド座標）
        setManualBoxes: function (boxes) {
            _manualBoxes = Array.isArray(boxes) ? boxes.slice() : [];
        },
        getManualBoxes: function () { return _manualBoxes.slice(); },

        reset: function () {
            _ready    = false;
            _voxels   = null;
            _hmap     = null;
            _ceilmap  = null;
            _wallmask = null;
            _bounds   = null;
            _svo      = null;
            // _manualBoxes はシーン .json 由来のため main.js が管理（ここでは消さない）
        },
    };
}());
