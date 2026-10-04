#!/usr/bin/env node
/**
 * serve.js — 管理者ツール用ローカルサーバー（python -m http.server の置き換え）
 *
 *   node tools/serve.js [port]      既定 8099、127.0.0.1 にだけ bind
 *
 * 1) vr-naiken/ を静的配信する（index.html / admin.html / src / vendor ...）
 * 2) admin.html の「公開準備」パネルが叩く /api/pipeline/* を提供する
 *      POST /api/pipeline/pick      Windows のフォルダ選択ダイアログを開いてパスを返す
 *      POST /api/pipeline/inspect   { folder } → 原本 PLY の有無・水平化済みか・hmap/圧縮の有無
 *      POST /api/pipeline/run       { folder, rebuild } → 水平化→コリジョン→圧縮 を順に実行（jobId）
 *      POST /api/pipeline/upload    { folder, name } → gcloud storage cp でバケットへ（jobId）
 *      GET  /api/pipeline/events/:id  ジョブのログを SSE で流す（log / step / done）
 *      GET  /api/pipeline/status    python / node / splat-transform / gcloud が使えるか
 *      GET  /local/:token/<file>    inspect したフォルダをビューアから開くための一時マウント
 *
 * ブラウザ（静的ページ）からは Python も gcloud も起動できないので、
 * コマンドの実行はすべてこのプロセスが引き受ける。実行するコマンドは固定で、
 * ブラウザから渡せるのはフォルダのパスと物件名だけ。
 */
'use strict';

var http  = require('http');
var fs    = require('fs');
var path  = require('path');
var cp    = require('child_process');
var crypto = require('crypto');

var ROOT   = path.resolve(__dirname, '..');            // vr-naiken/
var TOOLS  = __dirname;
var PORT   = parseInt(process.argv[2], 10) || 8099;
var BUCKET = 'vr_naiken_properties';
var IS_WIN = process.platform === 'win32';

var MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',   '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ply': 'application/octet-stream',
    '.splat': 'application/octet-stream', '.bin': 'application/octet-stream',
    '.lcc': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
};

// ---------------------------------------------------------------- utils
function sendJSON(res, code, obj) {
    var body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
}
function readBody(req) {
    return new Promise(function (resolve, reject) {
        var chunks = [];
        req.on('data', function (c) { chunks.push(c); if (Buffer.concat(chunks).length > 1e6) reject(new Error('body too large')); });
        req.on('end', function () {
            try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
            catch (e) { reject(new Error('JSON が不正です')); }
        });
        req.on('error', reject);
    });
}
function which(cmd) {
    var exts = IS_WIN ? ['.cmd', '.exe', '.bat', ''] : [''];
    var dirs = (process.env.PATH || '').split(path.delimiter);
    for (var i = 0; i < dirs.length; i++) {
        for (var j = 0; j < exts.length; j++) {
            var p = path.join(dirs[i], cmd + exts[j]);
            try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* not here */ }
        }
    }
    return null;
}
function fmtMB(n) { return (n / 1048576).toFixed(1) + 'MB'; }

// ---------------------------------------------------------------- PLY inspection
/** ヘッダーだけ読んで「原本 PLY か」「水平化済みか」「点数」を返す */
function inspectPly(file) {
    var fd = fs.openSync(file, 'r');
    var buf = Buffer.alloc(65536);
    var n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    var head = buf.subarray(0, n).toString('latin1');
    var end  = head.indexOf('end_header');
    if (end < 0) return { valid: false, reason: 'PLY ヘッダーが見つかりません' };
    var lines = head.slice(0, end).split('\n').map(function (l) { return l.trim(); });
    var inVertex = false, nonFloat = 0, vertices = 0, leveled = false, chunk = false;
    lines.forEach(function (l) {
        if (l.startsWith('element ')) {
            var parts = l.split(/\s+/);
            inVertex = parts[1] === 'vertex';
            if (parts[1] === 'vertex') vertices = parseInt(parts[2], 10) || 0;
            if (parts[1] === 'chunk') chunk = true;
        } else if (inVertex && l.startsWith('property ')) {
            var t = l.split(/\s+/)[1];
            if (t !== 'float' && t !== 'float32') nonFloat++;
        } else if (l.startsWith('comment leveled vr-naiken')) {
            leveled = true;
        }
    });
    return { valid: true, compressed: chunk || nonFloat > 0, vertices: vertices, leveled: leveled };
}

/**
 * フォルダの状態を調べる。原本 PLY は point_cloud.ply を最優先し、無ければ
 * .compressed.ply / environment.ply 以外の唯一の .ply を使う。
 */
function inspectFolder(folder) {
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
        return { ok: false, error: 'フォルダが見つかりません: ' + folder };
    }
    var files = fs.readdirSync(folder);
    var plys = files.filter(function (f) {
        var l = f.toLowerCase();
        return l.endsWith('.ply') && !l.endsWith('.compressed.ply') && l !== 'environment.ply';
    });
    var ply = null;
    if (plys.indexOf('point_cloud.ply') >= 0) ply = 'point_cloud.ply';
    else if (plys.length === 1) ply = plys[0];
    else if (plys.length === 0) return { ok: false, error: '原本の .ply がありません（environment.ply と .compressed.ply は対象外）', files: files };
    else return { ok: false, error: '.ply が複数あります。point_cloud.ply にリネームしてください: ' + plys.join(', '), files: files };

    var full = path.join(folder, ply);
    var info = inspectPly(full);
    if (!info.valid) return { ok: false, error: info.reason + ': ' + ply };
    if (info.compressed) return { ok: false, error: ply + ' は圧縮済み PLY です。原本（全プロパティが float）が必要です' };
    var base = ply.replace(/\.ply$/i, '');
    var st = fs.statSync(full);
    // 生成物は「存在する」だけでなく「原本より新しい」ときだけ有効とみなす。
    // 水平化で原本が書き換わった後や、途中で失敗した後の古い生成物を掴まないため。
    function fresh(f) {
        try { return fs.statSync(f).mtimeMs >= st.mtimeMs - 1000; } catch (e) { return false; }
    }
    var hmapPath = path.join(folder, base + '.hmap.json');
    var compPath = path.join(folder, base + '.compressed.ply');
    return {
        ok: true, folder: folder, ply: ply, base: base,
        sizeMB: st.size / 1048576, vertices: info.vertices,
        leveled: info.leveled,
        hasHmap: fs.existsSync(hmapPath),           hmapStale: fs.existsSync(hmapPath) && !fresh(hmapPath),
        hasCompressed: fs.existsSync(compPath),     compressedStale: fs.existsSync(compPath) && !fresh(compPath),
        hasSceneJson: fs.existsSync(path.join(folder, base + '.json')),
        suggestedName: suggestName(folder),
        busy: !!busy[folder],
    };
}

var busy = {};   // folder → jobId（同じフォルダで run/upload を同時に走らせない）

/** アップロード先のフォルダ名候補: PortalCam の point_cloud/iteration_100 を飛ばして意味のある親を使う */
function suggestName(folder) {
    var parts = path.resolve(folder).split(/[\\/]/).filter(Boolean);
    var skip = /^(point_cloud|iteration_\d+|scene|output|export)$/i;
    for (var i = parts.length - 1; i >= 0; i--) {
        if (!skip.test(parts[i]) && !/^[A-Za-z]:$/.test(parts[i])) {
            // 「6月30日エクスポート/リビング」のように親を 1 段付けると物件を区別しやすい
            var parent = i > 0 && !skip.test(parts[i - 1]) && !/^[A-Za-z]:$/.test(parts[i - 1]) && !/^(users|downloads|desktop|documents)$/i.test(parts[i - 1])
                ? parts[i - 1].replace(/エクスポート$/, '') + '_' : '';
            return sanitizeName(parent + parts[i]);
        }
    }
    return '';
}
function sanitizeName(s) {
    return String(s || '').replace(/[\\/:*?"<>|#\[\]\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
}
// アップロード先フォルダ名の許可リスト（文字・数字・_ . - のみ。先頭に - . は不可）。
// gcloud に渡す値なので、置換ではなく合わなければ拒否する。
var NAME_RE = /^[\p{L}\p{N}_][\p{L}\p{N}_.\-]{0,79}$/u;

/**
 * フォルダ指定の安全チェック（ブラウザから渡される唯一のパス）。
 * ローカルドライブの絶対パスだけを受け付け、UNC（\\host\share）は拒否する
 * （外部 SMB への接続を誘発できるため）。cmd.exe を経由する gcloud に渡すので
 * " と % を含むパスも断る。
 */
function safeFolder(raw) {
    var f = String(raw || '').trim();
    if (!f) return { error: 'フォルダを指定してください' };
    if (/["%]/.test(f)) return { error: 'フォルダ名に " や % は使えません' };
    if (IS_WIN) {
        if (/^\\\\|^\/\//.test(f)) return { error: 'ネットワークパス（\\\\...）は指定できません。ローカルにコピーしてください' };
        if (!/^[A-Za-z]:[\\/]/.test(f)) return { error: 'ドライブからの絶対パスで指定してください（例 C:\\Users\\...）' };
    } else if (f[0] !== '/') {
        return { error: '絶対パスで指定してください' };
    }
    return { folder: path.resolve(f) };
}

// ---------------------------------------------------------------- jobs (SSE)
var jobs = {};   // id → { log: [], listeners: [], status: 'running'|'done'|'error', summary }

function newJob() {
    var id = crypto.randomBytes(6).toString('hex');
    jobs[id] = { id: id, log: [], listeners: [], status: 'running', summary: null, started: Date.now() };
    return jobs[id];
}
function emit(job, type, data) {
    var ev = { type: type, data: data, t: Date.now() - job.started };
    job.log.push(ev);
    job.listeners.forEach(function (res) { res.write('data: ' + JSON.stringify(ev) + '\n\n'); });
}
function finish(job, err, summary) {
    job.status = err ? 'error' : 'done';
    job.summary = summary || null;
    emit(job, 'done', { ok: !err, error: err ? String(err.message || err) : null, summary: job.summary });
    job.listeners.forEach(function (res) { res.end(); });
    job.listeners = [];
    setTimeout(function () { delete jobs[job.id]; }, 30 * 60 * 1000);
}

/**
 * 子プロセスを 1 本走らせ、stdout/stderr を行単位でジョブログに流す。
 * Windows の .cmd/.bat（gcloud.cmd 等）は cmd.exe 経由でしか動かないが、Node の
 * shell:true は引数を引用符なしで連結するので「Cloud SDK」のような空白入りパスや
 * & を含むフォルダ名で壊れる。ここでは全引数を自分で "…" で囲み、cmd.exe /d /s /c に
 * 1 本の文字列として渡す（windowsVerbatimArguments）。" と % を含む引数は拒否する
 * （% は引用符の中でも環境変数展開されるため）。
 */
function runStep(job, label, cmd, args) {
    return new Promise(function (resolve, reject) {
        emit(job, 'step', { label: label, cmd: [cmd].concat(args).join(' ') });
        var exe = cmd, argv = args, verbatim = false;
        if (IS_WIN && /\.(cmd|bat)$/i.test(cmd)) {
            var bad = [cmd].concat(args).filter(function (a) { return /["%]/.test(a); });
            if (bad.length) return reject(new Error(label + ': 引数に " や % を含められません: ' + bad[0]));
            var line = [cmd].concat(args).map(function (a) { return '"' + a + '"'; }).join(' ');
            exe = process.env.ComSpec || 'cmd.exe';
            argv = ['/d', '/s', '/c', '"' + line + '"'];
            verbatim = true;
        }
        var child = cp.spawn(exe, argv, {
            cwd: ROOT,
            env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' }),
            shell: false,
            windowsVerbatimArguments: verbatim,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        var tail = [];
        function pipe(stream) {
            var buf = '';
            stream.setEncoding('utf8');
            stream.on('data', function (chunk) {
                buf += chunk;
                var lines = buf.split(/\r?\n|\r/);
                buf = lines.pop();
                lines.forEach(function (line) {
                    var l = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trimEnd();
                    if (!l) return;
                    tail.push(l); if (tail.length > 20) tail.shift();
                    emit(job, 'log', l);
                });
            });
            stream.on('end', function () { if (buf.trim()) emit(job, 'log', buf.trim()); });
        }
        pipe(child.stdout); pipe(child.stderr);
        child.on('error', function (e) { reject(new Error(label + ' を起動できません: ' + e.message)); });
        child.on('close', function (code) {
            if (code === 0) resolve();
            else reject(new Error(label + ' が失敗しました（終了コード ' + code + '）: ' + tail.slice(-3).join(' / ')));
        });
    });
}

// ---------------------------------------------------------------- pipeline
// python は Windows の「アプリ実行エイリアス」（WindowsApps/python.exe）だと
// fs.stat で見つからないことがあるので、実際に起動して確かめる
function findPython() {
    var cands = [['python', []], ['python3', []], ['py', ['-3']]];
    for (var i = 0; i < cands.length; i++) {
        try {
            var r = cp.spawnSync(cands[i][0], cands[i][1].concat(['-c', 'import numpy; print(1)']), { windowsHide: true, timeout: 20000, encoding: 'utf8' });
            if (r.status === 0 && String(r.stdout).trim() === '1') return { cmd: cands[i][0], args: cands[i][1] };
        } catch (e) { /* 次の候補 */ }
    }
    return null;
}
var PY = findPython();
var PYTHON = PY ? PY.cmd : null;
function pyArgs(script, rest) { return (PY ? PY.args : []).concat([script], rest); }

function runPipeline(job, folder, rebuild) {
    var info = inspectFolder(folder);
    if (!info.ok) return finish(job, new Error(info.error));
    if (!PYTHON) return finish(job, new Error('python（numpy 入り）が見つかりません'));
    var ply = path.join(folder, info.ply);
    var base = path.join(folder, info.base);
    var t0 = Date.now();
    busy[folder] = job.id;
    job.folder = folder;

    emit(job, 'log', '対象: ' + ply + ' (' + fmtMB(fs.statSync(ply).size) + ', ' + info.vertices.toLocaleString() + ' スプラット)');
    // これから水平化で座標が変わるなら、旧座標で作られたコリジョンは使い回せない
    if (!info.leveled) {
        if (info.hasHmap) { emit(job, 'log', '水平化で座標が変わるため、既存の .hmap.json は作り直します'); }
        rebuild = true;
        if (info.hasSceneJson) emit(job, 'log', '注意: ' + info.base + '.json の視点・テレポートは水平化前の座標です。ビューアで開いて「位置を保存」で取り直してください');
    } else if (info.hmapStale) {
        emit(job, 'log', '.hmap.json が原本より古いので作り直します');
        rebuild = true;
    }

    var p = Promise.resolve();
    // 1) 水平化（印があればスクリプト側でスキップ）
    p = p.then(function () {
        return runStep(job, '① 水平化', PYTHON,
            pyArgs(path.join(TOOLS, 'level_gaussian_ply.py'), [ply, '-o', ply, '--skip-if-leveled']));
    });
    // 2) コリジョン + 3) 圧縮（optimize_scene.py が .hmap.json 不在なら build_collider.js を呼ぶ）
    p = p.then(function () {
        var rest = [ply, '-w', '--bucket', 'gs://' + BUCKET + '/' + (info.suggestedName || '<物件名>')];
        if (rebuild) rest.push('--rebuild-collider');
        return runStep(job, '② コリジョン生成 → ③ 圧縮', PYTHON, pyArgs(path.join(TOOLS, 'optimize_scene.py'), rest));
    });
    p.then(function () {
        var after = inspectFolder(folder);
        var summary = {
            folder: folder, ply: info.ply, base: info.base,
            leveled: after.ok && after.leveled, hasHmap: after.ok && after.hasHmap, hasCompressed: after.ok && after.hasCompressed,
            compressedMB: fs.existsSync(base + '.compressed.ply') ? fs.statSync(base + '.compressed.ply').size / 1048576 : null,
            hmapMB: fs.existsSync(base + '.hmap.json') ? fs.statSync(base + '.hmap.json').size / 1048576 : null,
            seconds: (Date.now() - t0) / 1000,
            suggestedName: info.suggestedName,
            mount: mountFolder(folder),
        };
        delete busy[folder];
        finish(job, null, summary);
    }).catch(function (e) { delete busy[folder]; finish(job, e); });
}

var GCLOUD = which('gcloud');

function runUpload(job, folder, name) {
    var info = inspectFolder(folder);
    if (!info.ok) return finish(job, new Error(info.error));
    if (!GCLOUD) return finish(job, new Error('gcloud が見つかりません（Google Cloud SDK を入れて gcloud auth login）'));
    name = String(name || '').trim();
    if (!name) return finish(job, new Error('物件名（バケット内のフォルダ名）を入力してください'));
    if (!NAME_RE.test(name)) return finish(job, new Error('物件名に使えるのは文字・数字・_ . - だけです（先頭は文字か数字）: ' + name));
    var base = path.join(folder, info.base);
    var compressed = base + '.compressed.ply';
    if (!info.hasCompressed) return finish(job, new Error('圧縮 PLY がありません。先に「実行」を押してください'));
    if (info.compressedStale) return finish(job, new Error('圧縮 PLY が原本より古いです（途中で失敗した可能性）。もう一度「実行」を押してください'));
    if (!info.hasHmap) emit(job, 'log', '注意: .hmap.json が無いのでコリジョン無しで公開されます');
    else if (info.hmapStale) return finish(job, new Error('.hmap.json が原本より古いです。「実行」で作り直してください'));
    busy[folder] = job.id;
    job.folder = folder;

    var dest = 'gs://' + BUCKET + '/' + name + '/';
    // フォルダ URL で開けるように manifest.json を作る（ビューアは manifest.ply を読む）
    var manifest = path.join(folder, 'manifest.json');
    fs.writeFileSync(manifest, JSON.stringify({ ply: info.base + '.compressed.ply' }));
    var jsons = ['manifest.json', info.base + '.json', info.base + '.hmap.json', info.base + '.voxel.json']
        .map(function (f) { return path.join(folder, f); })
        .filter(function (f) { return fs.existsSync(f); });

    var p = runStep(job, '④ アップロード（圧縮 PLY・長期キャッシュ）', GCLOUD,
        ['storage', 'cp', '--cache-control=public,max-age=31536000,immutable', compressed, dest]);
    p = p.then(function () {
        return runStep(job, '④ アップロード（JSON・gzip 転送・短期キャッシュ）', GCLOUD,
            ['storage', 'cp', '--gzip-local=json', '--cache-control=public,max-age=300'].concat(jsons, [dest]));
    });
    var voxelBin = base + '.voxel.bin';
    if (fs.existsSync(voxelBin)) {
        p = p.then(function () {
            return runStep(job, '④ アップロード（voxel.bin）', GCLOUD,
                ['storage', 'cp', '--cache-control=public,max-age=300', voxelBin, dest]);
        });
    }
    p = p.then(function () { return runStep(job, '⑤ 確認', GCLOUD, ['storage', 'ls', '-l', dest]); });
    p.then(function () {
        var pub = 'https://storage.googleapis.com/' + BUCKET + '/' + encodeURIComponent(name) + '/';
        delete busy[folder];
        finish(job, null, {
            name: name, dest: dest,
            sceneUrl: pub,                                      // 物件登録の scene_url（フォルダ URL）
            plyUrl: pub + encodeURIComponent(info.base + '.compressed.ply'),
        });
    }).catch(function (e) { delete busy[folder]; finish(job, e); });
}

// ---------------------------------------------------------------- folder dialog (Windows)
function pickFolder() {
    return new Promise(function (resolve, reject) {
        if (!IS_WIN) return reject(new Error('フォルダ選択ダイアログは Windows のみ対応です。パスを直接入力してください'));
        // このサーバーは前面のアプリではないので、普通にダイアログを出すとブラウザの
        // 後ろに隠れて「開いています…」のまま止まったように見える。画面外に置いた
        // 透明の TopMost ウィンドウを先に表示し、その子としてダイアログを出すことで
        // 最前面に来させる。終わったら所有ウィンドウは閉じる。
        var ps = [
            '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;',
            'Add-Type -AssemblyName System.Windows.Forms;',
            'Add-Type -AssemblyName System.Drawing;',
            '$w = New-Object System.Windows.Forms.Form;',
            '$w.TopMost = $true; $w.ShowInTaskbar = $false; $w.Opacity = 0;',
            '$w.StartPosition = "Manual"; $w.Location = New-Object System.Drawing.Point(-20000, -20000); $w.Size = New-Object System.Drawing.Size(1, 1);',
            '$w.Show(); $w.Activate();',
            '$d = New-Object System.Windows.Forms.FolderBrowserDialog;',
            '$d.Description = "PortalCam の出力フォルダ（point_cloud.ply があるフォルダ）を選んでください";',
            '$d.ShowNewFolderButton = $false;',
            '$r = $d.ShowDialog($w); $w.Close();',
            'if ($r -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath } else { Write-Output "" }',
        ].join(' ');
        cp.execFile('powershell', ['-NoProfile', '-STA', '-Command', ps], { timeout: 5 * 60 * 1000 },
            function (err, stdout) {
                if (err) return reject(new Error('ダイアログを開けませんでした: ' + err.message));
                var p = String(stdout || '').trim();
                resolve(p ? { folder: p } : { cancelled: true });
            });
    });
}

// ---------------------------------------------------------------- local mount (open the folder in the viewer)
var mounts = {};   // token → folder
function mountFolder(folder) {
    for (var t in mounts) if (mounts[t] === folder) return '/local/' + t + '/';
    var token = crypto.randomBytes(6).toString('hex');
    mounts[token] = folder;
    return '/local/' + token + '/';
}
function serveMount(req, res, token, rel) {
    var folder = mounts[token];
    if (!folder) { res.writeHead(404); return res.end('mount not found'); }
    var name;
    try { name = decodeURIComponent(rel).replace(/^\/+/, ''); } catch (e) { res.writeHead(400); return res.end('bad path'); }
    if (!name || name.indexOf('/') >= 0 || name.indexOf('\\') >= 0) { res.writeHead(404); return res.end(); }   // 直下のファイルだけ
    // manifest.json が無ければその場で作る（圧縮 PLY があればそれを優先）
    if (name === 'manifest.json' && !fs.existsSync(path.join(folder, name))) {
        var info = inspectFolder(folder);
        if (!info.ok) { res.writeHead(404); return res.end(); }
        return sendJSON(res, 200, { ply: info.hasCompressed ? info.base + '.compressed.ply' : info.ply });
    }
    var file = path.join(folder, name);
    if (path.relative(folder, file).startsWith('..')) { res.writeHead(403); return res.end(); }
    serveFile(res, file, req);
}

// ---------------------------------------------------------------- static
function serveFile(res, file, req) {
    fs.stat(file, function (err, st) {
        if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404 ' + path.basename(file)); }
        var ext = path.extname(file).toLowerCase();
        var headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
        var range = req && req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (range) {
            var start = range[1] ? parseInt(range[1], 10) : 0;
            var end   = range[2] ? parseInt(range[2], 10) : st.size - 1;
            if (start > end || end >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
            headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + st.size;
            headers['Content-Length'] = end - start + 1;
            res.writeHead(206, headers);
            return fs.createReadStream(file, { start: start, end: end }).pipe(res);
        }
        headers['Content-Length'] = st.size;
        res.writeHead(200, headers);
        fs.createReadStream(file).pipe(res);
    });
}

// ---------------------------------------------------------------- router
// 127.0.0.1 にしか bind しないが、ブラウザは別サイトからでも localhost に届く
// （CSRF / DNS rebinding）。Host が自分自身でなければ全部断り、変更系 POST は
// 同一オリジンかつカスタムヘッダー付き（＝他サイトの fetch では preflight で落ちる）だけ通す。
var OK_HOSTS = ['127.0.0.1:' + PORT, 'localhost:' + PORT, '[::1]:' + PORT];
function sameOrigin(req) {
    var o = req.headers.origin;
    if (!o) return true;   // 同一オリジンの GET / SSE はブラウザが Origin を付けない
    return OK_HOSTS.some(function (h) { return o === 'http://' + h; });
}

var server = http.createServer(function (req, res) {
    try { route(req, res); }
    catch (e) { try { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('error'); } catch (e2) { /* 送信済み */ } console.error('[serve] ' + (e && e.stack || e)); }
});

function route(req, res) {
    var p;
    try { p = new URL(req.url, 'http://localhost').pathname; }
    catch (e) { res.writeHead(400); return res.end('bad url'); }
    if (OK_HOSTS.indexOf(String(req.headers.host || '').toLowerCase()) < 0) { res.writeHead(403); return res.end('forbidden host'); }

    // ---- API ----
    if (p.startsWith('/api/pipeline/')) {
        var sub = p.slice('/api/pipeline/'.length);
        if (req.method === 'POST') {
            if (!sameOrigin(req) || req.headers['x-pipeline'] !== '1' ||
                !/^application\/json/i.test(String(req.headers['content-type'] || ''))) {
                return sendJSON(res, 403, { error: 'forbidden' });
            }
        }
        try {
            if (sub === 'status' && req.method === 'GET') {
                return sendJSON(res, 200, {
                    ok: true, root: ROOT, port: PORT,
                    tools: {
                        python: !!PYTHON, node: true,
                        splatTransform: !!(which('splat-transform')),
                        gcloud: !!GCLOUD,
                        dialog: IS_WIN,
                    },
                    bucket: BUCKET,
                });
            }
            if (sub === 'pick' && req.method === 'POST') {
                return pickFolder().then(function (r) { sendJSON(res, 200, r); })
                    .catch(function (e) { sendJSON(res, 500, { error: e.message }); });
            }
            if (sub === 'inspect' && req.method === 'POST') {
                return readBody(req).then(function (b) {
                    var sf = safeFolder(b.folder);
                    if (sf.error) return sendJSON(res, 200, { ok: false, error: sf.error });
                    var info = inspectFolder(sf.folder);
                    if (info.ok) info.mount = mountFolder(info.folder);
                    sendJSON(res, 200, info);
                }).catch(function (e) { sendJSON(res, 400, { ok: false, error: e.message }); });
            }
            if ((sub === 'run' || sub === 'upload') && req.method === 'POST') {
                return readBody(req).then(function (b) {
                    var sf = safeFolder(b.folder);
                    if (sf.error) return sendJSON(res, 400, { error: sf.error });
                    if (busy[sf.folder]) return sendJSON(res, 409, { error: 'このフォルダは処理中です（ジョブ ' + busy[sf.folder] + '）。終わるまで待ってください' });
                    var job = newJob();
                    setImmediate(function () {
                        try {
                            if (sub === 'run') runPipeline(job, sf.folder, !!b.rebuild);
                            else runUpload(job, sf.folder, String(b.name || ''));
                        } catch (e) { delete busy[sf.folder]; finish(job, e); }
                    });
                    sendJSON(res, 200, { jobId: job.id });
                }).catch(function (e) { sendJSON(res, 400, { error: e.message }); });
            }
            var m = /^events\/([a-f0-9]+)$/.exec(sub);
            if (m && req.method === 'GET') {
                var job = jobs[m[1]];
                if (!job) return sendJSON(res, 404, { error: 'job not found' });
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive' });
                job.log.forEach(function (ev) { res.write('data: ' + JSON.stringify(ev) + '\n\n'); });
                if (job.status !== 'running') return res.end();
                job.listeners.push(res);
                req.on('close', function () { job.listeners = job.listeners.filter(function (r) { return r !== res; }); });
                return;
            }
            return sendJSON(res, 404, { error: 'unknown api: ' + sub });
        } catch (e) {
            return sendJSON(res, 500, { error: e.message });
        }
    }

    // ---- ローカルフォルダのマウント ----
    var lm = /^\/local\/([a-f0-9]+)(\/.*)?$/.exec(p);
    if (lm) return serveMount(req, res, lm[1], lm[2] || '');

    // ---- 静的ファイル（ビューアに必要なものだけ。ドット始まり・worker/ は出さない）----
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    var rel;
    try { rel = decodeURIComponent(p); } catch (e) { res.writeHead(400); return res.end('bad path'); }
    if (rel.endsWith('/')) rel += 'index.html';
    if (rel.split('/').some(function (s) { return s[0] === '.'; }) || /^\/(worker|node_modules)(\/|$)/.test(rel)) {
        res.writeHead(404); return res.end();
    }
    var file = path.join(ROOT, rel);
    if (path.relative(ROOT, file).startsWith('..')) { res.writeHead(403); return res.end(); }
    serveFile(res, file, req);
}

if (require.main === module) {
    server.listen(PORT, '127.0.0.1', function () {
        console.log('vr-naiken 管理サーバー: http://localhost:' + PORT + '/admin.html');
        console.log('  静的配信: ' + ROOT);
        console.log('  python: ' + (PYTHON || '無し') + ' / gcloud: ' + (GCLOUD || '無し') + ' / splat-transform: ' + (which('splat-transform') || '無し'));
    });
} else {
    // テスト用（require されたときは listen しない）
    module.exports = { runStep: runStep, newJob: newJob, inspectFolder: inspectFolder, safeFolder: safeFolder, NAME_RE: NAME_RE, GCLOUD: GCLOUD, which: which };
}
