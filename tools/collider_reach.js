#!/usr/bin/env node
/**
 * collider_reach.js — .hmap.json で「実際に歩いて行ける範囲」を測る（コライダー変更の回帰確認用）
 *
 * src/collider.js の resolvePositionSwept（ウォークモード）をそのまま使い、開始位置から
 * 8 方向へ 10cm ずつ進む幅優先探索で到達できるセルを数える。壁の厚み・通路の幅・
 * ノイズの孤立障害物が「通れるかどうか」に与える影響を、ビューアを開かずに数字で比べられる。
 *
 * 使い方:
 *   node tools/collider_reach.js <point_cloud.hmap.json> [point_cloud.json] [--map] [--eye=1.6] [--step=0.10]
 *     point_cloud.json  初期カメラ（initialCamera）を開始位置にする。省略/無ければ最も開けた場所から始める
 *     --map             到達範囲を文字で描く（1 文字 = step）
 *     --eye=            目線高さを固定する（既定は初期カメラの床からの高さを 1.0〜1.8 に丸めた値、無ければ 1.6）
 *
 * 出力（1 行目）: {"reachArea": 到達面積 m², "reachCells": セル数, "blockedMoves": 塞がれた移動, ...}
 *
 * 例（コライダー生成の変更前後で比べる）:
 *   node tools/build_collider.js 物件/point_cloud.ply -o /tmp/new.hmap.json
 *   node tools/collider_reach.js 物件/point_cloud.hmap.json 物件/point_cloud.json
 *   node tools/collider_reach.js /tmp/new.hmap.json 物件/point_cloud.json
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var args = process.argv.slice(2);
if (!args[0]) {
    console.error('使い方: node tools/collider_reach.js <hmap.json> [scene.json] [--map] [--eye=1.6] [--step=0.10]');
    process.exit(2);
}
var hmapPath = args[0];
var scenePath = args[1] && args[1][0] !== '-' ? args[1] : null;
var SHOW_MAP = args.indexOf('--map') >= 0;
var eyeArg = null, STEP = 0.10;
args.forEach(function (a) {
    var m;
    if ((m = /^--eye=([\d.]+)$/.exec(a))) eyeArg = parseFloat(m[1]);
    if ((m = /^--step=([\d.]+)$/.exec(a))) STEP = parseFloat(m[1]);
});

// ---- src/collider.js を Node で読む（build_collider.js と同じ要領。pc.Vec3 だけ最小実装で補う）----
globalThis.window = globalThis;
globalThis.atob = globalThis.atob || function (s) { return Buffer.from(s, 'base64').toString('binary'); };
globalThis.btoa = globalThis.btoa || function (s) { return Buffer.from(s, 'binary').toString('base64'); };
function Vec3(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
Vec3.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
Vec3.prototype.copy = function (v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; };
Vec3.prototype.clone = function () { return new Vec3(this.x, this.y, this.z); };
globalThis.pc = { Vec3: Vec3 };
var colliderFile = path.join(__dirname, '..', 'src', 'collider.js');
var origLog = console.log;
console.log = function () {};   // collider.js の読込ログは出さない（1 行目を JSON にする）
vm.runInThisContext(fs.readFileSync(colliderFile, 'utf8'), { filename: colliderFile });
var Collider = globalThis.Collider;

var data = JSON.parse(fs.readFileSync(hmapPath, 'utf8'));
var G = data.grid, G2 = G * G, b = data.bounds, vw = b.sx / G, vh = b.sy / G, vd = b.sz / G;

// 開始位置: scene.json の初期カメラ。無ければ「帯が空いていて周囲も広く空いているセル」
function pickStart() {
    if (scenePath && fs.existsSync(scenePath)) {
        var sc = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
        if (sc.initialCamera) return { x: sc.initialCamera.x, y: sc.initialCamera.y, z: sc.initialCamera.z, from: 'scene.json' };
    }
    if (!data.vox) return null;
    var bin = Buffer.from(data.vox, 'base64');
    function occ(vx, vy, vz) { var j = vx + vy * G + vz * G2; return (bin[j >> 3] >> (j & 7)) & 1; }
    var free = new Uint8Array(G2);
    for (var z = 0; z < G; z++) for (var x = 0; x < G; x++) {
        var i = x + z * G; if (data.hmap[i] == null) continue;
        var y = Math.max(0, Math.floor((data.hmap[i] - b.minY) / vh)), top = y;
        while (y < G - 1 && (occ(x, y + 1, z) || occ(x, y + 2, z))) { y++; if (occ(x, y, z)) top = y; }
        var sup = b.minY + (top + 1) * vh;
        var lo = Math.floor((sup + 0.30 - b.minY) / vh), hi = Math.min(G - 1, Math.floor((sup + 1.65 - b.minY) / vh));
        var blocked = false; for (var yy = lo; yy <= hi; yy++) if (occ(x, yy, z)) { blocked = true; break; }
        if (!blocked) free[i] = 1;
    }
    var best = null, bestR = -1;
    for (var z2 = 2; z2 < G - 2; z2 += 2) for (var x2 = 2; x2 < G - 2; x2 += 2) {
        if (!free[x2 + z2 * G]) continue;
        var R = 0, ok = true;
        while (ok && R < 20) {
            R++;
            for (var dz = -R; dz <= R && ok; dz++) for (var dx = -R; dx <= R; dx++) {
                var nx = x2 + dx, nz = z2 + dz;
                if (nx < 0 || nz < 0 || nx >= G || nz >= G || !free[nx + nz * G]) { ok = false; break; }
            }
        }
        if (R > bestR) { bestR = R; best = { x: b.minX + (x2 + 0.5) * vw, z: b.minZ + (z2 + 0.5) * vd, floor: data.hmap[x2 + z2 * G] }; }
    }
    if (!best) return null;
    return { x: best.x, y: best.floor + 1.6, z: best.z, from: 'auto(R=' + bestR + ')' };
}

Collider.reset();
Collider.loadHmapJSON(data, function (err) {
    if (err) { console.error('hmap 読込失敗: ' + err.message); process.exit(1); }
    Collider.setWalkMode(true);
    var st = pickStart();
    if (!st) { console.error('開始位置が決められません（vox が無い hmap か、空いているセルが無い）'); process.exit(1); }
    // 目線高さ: camera-controller.js の settle 時の校正と同じ規則
    var eye = 1.6;
    var fy = Collider.getSupportY(st.x, st.z, st.y);
    if (fy !== null) { var eh = st.y - fy; if (eh >= 0.8 && eh <= 2.4) eye = Math.min(1.8, Math.max(1.0, eh)); }
    if (eyeArg) eye = eyeArg;

    var p0 = new Vec3(st.x, st.y, st.z);
    p0 = Collider.resolvePositionSwept(p0, p0, eye);
    var NX = Math.ceil(b.sx / STEP) + 2, NZ = Math.ceil(b.sz / STEP) + 2;
    function cellOf(p) { return { cx: Math.floor((p.x - b.minX) / STEP) + 1, cz: Math.floor((p.z - b.minZ) / STEP) + 1 }; }
    var visited = new Array(NX * NZ).fill(null);
    var c0 = cellOf(p0); visited[c0.cx + c0.cz * NX] = p0;
    var queue = [c0.cx + c0.cz * NX], head = 0, dirs = [];
    for (var a = 0; a < 8; a++) dirs.push([Math.cos(a * Math.PI / 4), Math.sin(a * Math.PI / 4)]);
    var blockedMoves = 0, moves = 0;
    while (head < queue.length) {
        var ci = queue[head++], p = visited[ci];
        for (var d = 0; d < 8; d++) {
            // 1 セル分を 2 フレームに分けて進む（速めの歩行 ≒ 3m/s 相当）
            var cur = p, tx = p.x + dirs[d][0] * STEP, tz = p.z + dirs[d][1] * STEP;
            for (var sub = 1; sub <= 2; sub++) {
                var tgt = new Vec3(p.x + (tx - p.x) * sub / 2, cur.y, p.z + (tz - p.z) * sub / 2);
                cur = Collider.resolvePositionSwept(cur, tgt, eye);
            }
            moves++;
            var dist = Math.sqrt((cur.x - tx) * (cur.x - tx) + (cur.z - tz) * (cur.z - tz));
            var cc = cellOf(cur);
            if (cc.cx < 0 || cc.cz < 0 || cc.cx >= NX || cc.cz >= NZ) continue;
            var k = cc.cx + cc.cz * NX;
            if (visited[k]) { if (dist > STEP * 0.5) blockedMoves++; continue; }
            if (dist > STEP * 0.75) { blockedMoves++; continue; }   // ほとんど進めなかった
            visited[k] = cur; queue.push(k);
        }
    }
    var reached = queue.length;
    origLog(JSON.stringify({
        hmap: path.basename(hmapPath), start: st.from, eye: +eye.toFixed(2), grid: G,
        vox: (vw * 100).toFixed(1) + 'x' + (vh * 100).toFixed(1) + 'x' + (vd * 100).toFixed(1),
        reachArea: +(reached * STEP * STEP).toFixed(2), reachCells: reached, blockedMoves: blockedMoves, moves: moves
    }));
    if (SHOW_MAP) {
        var rows = [];
        for (var z = 0; z < NZ; z++) {
            var r = '';
            for (var x = 0; x < NX; x++) r += visited[x + z * NX] ? (x === c0.cx && z === c0.cz ? 'S' : '.') : ' ';
            rows.push(String((b.minZ + (z - 1) * STEP).toFixed(1)).padStart(5) + ' ' + r);
        }
        origLog('到達範囲（1 文字 = ' + (STEP * 100) + 'cm, S=開始, 行頭=world z, 左端 world x=' + b.minX.toFixed(2) + '）');
        origLog(rows.join('\n'));
    }
});
