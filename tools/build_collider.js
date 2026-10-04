#!/usr/bin/env node
/**
 * build_collider.js — .hmap.json をコマンドラインで生成する
 *
 * admin.html の「コリジョン生成」と同じ処理を、ブラウザを開かずに実行する。
 * src/collider.js をそのまま Node で走らせるので、出力はブラウザ生成と一致する
 * （collider.js の生成経路 buildAsync → exportJSON は DOM も PlayCanvas も使わず、
 *   必要なのは setTimeout / DataView / TextDecoder / btoa だけ）。
 *
 * 使い方:
 *   node tools/build_collider.js <point_cloud.ply | 物件フォルダ> [-o 出力.hmap.json] [-w] [-q]
 *     -o  出力先（既定は入力と同じ場所の <基準名>.hmap.json）
 *     -w  既存の .hmap.json を上書き
 *     -q  進捗を表示しない
 *
 * 前提: 入力は水平化済みの原本 PLY（level_gaussian_ply.py の出力）。
 *       圧縮 PLY（.compressed.ply）は読めないので拒否する。
 */
'use strict';

var fs   = require('fs');
var path = require('path');
var vm   = require('vm');

function usage(msg) {
    if (msg) console.error(msg);
    console.error('使い方: node tools/build_collider.js <point_cloud.ply | 物件フォルダ> [-o out.hmap.json] [-w] [-q]');
    process.exit(2);
}

function parseArgs(argv) {
    var a = { target: null, out: null, overwrite: false, quiet: false };
    for (var i = 0; i < argv.length; i++) {
        var v = argv[i];
        if (v === '-o' || v === '--out')            a.out = argv[++i];
        else if (v === '-w' || v === '--overwrite') a.overwrite = true;
        else if (v === '-q' || v === '--quiet')     a.quiet = true;
        else if (v === '-h' || v === '--help')      usage();
        else if (v[0] === '-')                      usage('不明なオプション: ' + v);
        else if (!a.target)                         a.target = v;
        else                                        usage('引数が多すぎます');
    }
    if (!a.target) usage();
    return a;
}

/** フォルダなら中の原本 .ply / .splat を 1 つ選ぶ（optimize_scene.py と同じ規則） */
function findInput(target) {
    if (fs.existsSync(target) && fs.statSync(target).isFile()) return target;
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        console.error('見つかりません: ' + target);
        process.exit(1);
    }
    var cands = fs.readdirSync(target).sort().filter(function (f) {
        var l = f.toLowerCase();
        return (l.endsWith('.ply') || l.endsWith('.splat')) && !l.endsWith('.compressed.ply');
    }).map(function (f) { return path.join(target, f); });
    if (cands.length === 0) { console.error('.ply / .splat が見つかりません: ' + target); process.exit(1); }
    if (cands.length > 1) {
        console.error('.ply が複数あります。ファイルを指定してください:\n  ' + cands.join('\n  '));
        process.exit(1);
    }
    return cands[0];
}

/**
 * PLY ヘッダーの事前チェック。collider.js は「vertex の全プロパティが 4 バイト float」を
 * 前提に自前パースするので、圧縮 PLY（uint 混在・chunk 要素）を渡すと黙って壊れた
 * 結果が出る。ここで先に弾く。
 */
function checkPlyHeader(buf) {
    var head = buf.subarray(0, Math.min(buf.length, 64 * 1024)).toString('latin1');
    var end  = head.indexOf('end_header');
    if (end < 0) return { ok: false, reason: 'PLY ヘッダーが見つかりません（64KB 以内に end_header が無い）' };
    var lines = head.slice(0, end).split('\n').map(function (l) { return l.trim(); });
    if (lines[0] !== 'ply') return { ok: false, reason: 'PLY ファイルではありません' };
    if (lines.indexOf('format binary_little_endian 1.0') < 0) {
        return { ok: false, reason: 'binary_little_endian 以外の PLY は未対応です' };
    }
    var inVertex = false, props = [], nonFloat = [], elements = [];
    lines.forEach(function (l) {
        if (l.startsWith('element ')) {
            var name = l.split(/\s+/)[1];
            elements.push(name);
            inVertex = (name === 'vertex');
        } else if (inVertex && l.startsWith('property ')) {
            var p = l.split(/\s+/);
            props.push(p[2]);
            if (p[1] !== 'float' && p[1] !== 'float32') nonFloat.push(p[2] + ':' + p[1]);
        }
    });
    if (elements.indexOf('chunk') >= 0 || nonFloat.length) {
        return { ok: false, reason: '圧縮 PLY（float 以外のプロパティ: ' + (nonFloat.slice(0, 3).join(', ') || 'chunk 要素') +
            '）は読めません。原本の PLY を指定してください' };
    }
    var missing = ['x', 'y', 'z'].filter(function (k) { return props.indexOf(k) < 0; });
    if (missing.length) return { ok: false, reason: 'PLY に ' + missing.join('/') + ' がありません' };
    var hasScale = ['scale_0', 'scale_1', 'scale_2'].every(function (k) { return props.indexOf(k) >= 0; });
    return { ok: true, hasScale: hasScale, hasOpacity: props.indexOf('opacity') >= 0 };
}

/** src/collider.js を Node で読み込む。window.Collider への代入を globalThis で受ける */
function loadCollider() {
    var file = path.join(__dirname, '..', 'src', 'collider.js');
    var src  = fs.readFileSync(file, 'utf8');
    globalThis.window = globalThis;
    vm.runInThisContext(src, { filename: file });
    if (!globalThis.Collider || typeof globalThis.Collider.buildAsync !== 'function') {
        console.error('src/collider.js の読み込みに失敗しました（Collider.buildAsync が無い）');
        process.exit(1);
    }
    return globalThis.Collider;
}

function main() {
    var args  = parseArgs(process.argv.slice(2));
    var input = findInput(args.target);
    var lower = input.toLowerCase();
    if (lower.endsWith('.compressed.ply')) {
        console.error('圧縮済みの PLY です。原本を指定してください: ' + input);
        process.exit(1);
    }
    var base = input.replace(/\.(ply|splat)$/i, '');
    var out  = args.out || (base + '.hmap.json');
    if (fs.existsSync(out) && !args.overwrite) {
        console.error('既に存在します（-w で上書き）: ' + out);
        process.exit(1);
    }

    var buf = fs.readFileSync(input);
    if (lower.endsWith('.ply')) {
        var chk = checkPlyHeader(buf);
        if (!chk.ok) { console.error(chk.reason + ': ' + input); process.exit(1); }
        if (!chk.hasScale) {
            console.error('注意: scale_0/1/2 が無い PLY です。ガウシアンの大きさで壁を埋められないので、薄い壁が抜ける可能性があります。');
        }
    }
    // Buffer → 独立した ArrayBuffer（Buffer はプールを共有するので slice で切り出す）
    var ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

    var Collider = loadCollider();
    var t0 = Date.now();
    console.log('入力: ' + input + ' (' + (buf.length / 1048576).toFixed(1) + 'MB)');

    // 進捗: 端末なら同じ行を書き換え、パイプ/ログなら段階が変わった時だけ 1 行出す
    var isTTY = !!process.stderr.isTTY;
    var lastMsg = null;
    function onProgress(pct, msg) {
        if (args.quiet) return;
        if (isTTY) {
            process.stderr.write('\r[' + String(pct).padStart(3) + '%] ' + (msg || '') + '          ');
            return;
        }
        var stage = (msg || '').replace(/\s*\d+%$/, '');
        if (stage !== lastMsg) { process.stderr.write('[' + String(pct).padStart(3) + '%] ' + stage + '\n'); lastMsg = stage; }
    }

    Collider.reset();
    Collider.buildAsync(
        ab,
        path.basename(input),
        onProgress,
        function onDone(err) {
            if (!args.quiet && isTTY) process.stderr.write('\n');
            if (err) {
                console.error('生成失敗: ' + (err && err.message ? err.message : err));
                process.exit(1);
            }
            var data = Collider.exportJSON();
            if (!data) { console.error('生成失敗: exportJSON が空です'); process.exit(1); }

            // 要約（ビューアでの見え方に直結する数字だけ）
            var g = data.grid, cells = g * g;
            // hmap の未検出セルは exportJSON 時点では NaN（JSON では null になる）
            var floorCells = 0, wallCells = 0;
            for (var i = 0; i < cells; i++) {
                var fv = data.hmap[i];
                if (fv != null && !Number.isNaN(fv)) floorCells++;
                if (data.wallmask && data.wallmask[i]) wallCells++;
            }
            // 床が無い結果はファイルに残さない（残すと次回「既存あり」として使われてしまう）
            if (floorCells === 0) {
                console.error('生成失敗: 床が 1 セルも検出されていません。水平化前の PLY か、座標系が想定と違う可能性があります（ファイルは書き出しません）。');
                process.exit(3);
            }
            // 書き込み途中で落ちても壊れたファイルが残らないよう、一時名に書いてから置き換える
            var json = JSON.stringify(data);
            var tmp = out + '.tmp';
            fs.writeFileSync(tmp, json);
            fs.renameSync(tmp, out);

            var b = data.bounds;
            var maxDim = Math.max(b.sx, b.sy, b.sz);
            console.log('出力: ' + out + ' (' + (json.length / 1048576).toFixed(2) + 'MB, ' + data.format + ')');
            console.log('  grid ' + g + ' (約' + (maxDim / g * 100).toFixed(1) + 'cm/voxel)  範囲 ' +
                b.sx.toFixed(2) + ' x ' + b.sy.toFixed(2) + ' x ' + b.sz.toFixed(2) + ' m');
            console.log('  床を検出したセル ' + floorCells + '/' + cells +
                ' (' + (floorCells / cells * 100).toFixed(1) + '%)  壁セル ' + wallCells);
            console.log('  所要 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒');
        }
    );
}

main();
