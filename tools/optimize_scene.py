# -*- coding: utf-8 -*-
"""シーンの転送量を削減する（PLY 圧縮 + アップロード手順の生成）

3DGS の PLY は 1 スプラットあたり 68 バイト（x,y,z + nx,ny,nz + f_dc*3 + opacity
+ scale*3 + rot*4）の生の float 列で、実測で 87万スプラット = 59MB になる。
splat-transform の圧縮 PLY 形式に変換すると 16 バイト/スプラットになり、
実測で 59.2MB → 13.5MB（-77%）まで落ちる。見た目の差はほぼ無い
（同一視点の描画を比較して 64 ブロック平均の絶対差 0.4/255・最大 2/255）。

拡張子が .ply のままなのでビューア側は無改修で読める。コンパニオン
（.json / .hmap.json / .voxel.*）は原本と同じ基準名のまま置けばよい
（main.js の _companionBase が .compressed を落として探す）。

前提となる処理順序:
    1. 水平化   python tools/level_gaussian_ply.py point_cloud.ply -o point_cloud.ply
    2. hmap生成 node tools/build_collider.js point_cloud.ply → point_cloud.hmap.json
                （このスクリプトが .hmap.json 不在なら自動で実行する。admin.html でも可）
    3. 圧縮     python tools/optimize_scene.py point_cloud.ply   ← このスクリプト
    4. アップロード（出力されたコマンドを実行）

3 を先にやると 1・2 が壊れる。level_gaussian_ply.py と build_collider.js
（admin のコリジョン生成と同じ collider.js）はどちらも「全プロパティが float の
PLY」を前提に自前パースしているため、圧縮 PLY を入力にできない。

使い方:
    python tools/optimize_scene.py <point_cloud.ply>
    python tools/optimize_scene.py <物件フォルダ>        # 中の .ply を自動で探す
    python tools/optimize_scene.py <...> --bucket gs://vr_naiken_properties/物件名
    python tools/optimize_scene.py <...> --rebuild-collider   # .hmap.json を作り直す
"""
import argparse
import gzip
import os
import shutil
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")

COMPANION_SUFFIXES = (".json", ".hmap.json", ".voxel.json")


def mb(n):
    if n < 1048576:
        return "%.1fKB" % (n / 1024.0)
    return "%.2fMB" % (n / 1048576.0)


def find_ply(target):
    """引数がフォルダなら中の .ply を1つ選ぶ。圧縮済みは除外する。"""
    if os.path.isfile(target):
        return target
    if not os.path.isdir(target):
        sys.exit("見つかりません: %s" % target)
    cands = [
        os.path.join(target, f)
        for f in sorted(os.listdir(target))
        if f.lower().endswith(".ply") and not f.lower().endswith(".compressed.ply")
    ]
    if not cands:
        sys.exit(".ply が見つかりません: %s" % target)
    if len(cands) > 1:
        sys.exit(
            ".ply が複数あります。ファイルを指定してください:\n  "
            + "\n  ".join(cands)
        )
    return cands[0]


def gzip_ratio(path):
    """gzip 後のサイズを実測する（アップロードは gsutil -Z に任せるので測るだけ）"""
    size = 0
    with open(path, "rb") as f:
        comp = gzip.compress(f.read(), 6)
        size = len(comp)
    return size


def ensure_hmap(ply, base, rebuild, skip):
    """圧縮の前に .hmap.json を用意する（原本 PLY からしか作れないため）。

    無ければ node tools/build_collider.js で生成する。node が無い環境では
    admin.html での生成を案内して止める（--skip-collider で続行可）。
    """
    hmap = base + ".hmap.json"
    if skip:
        return
    if os.path.exists(hmap) and not rebuild:
        print("コリジョン: %s（既存を使用。作り直すなら --rebuild-collider）"
              % os.path.basename(hmap))
        return
    node = shutil.which("node")
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "build_collider.js")
    if not node or not os.path.exists(script):
        sys.exit(
            ".hmap.json がありません: %s\n"
            "  node が見つからないため自動生成できません。admin.html の「コリジョン生成」で\n"
            "  作るか、node を入れて再実行してください（--skip-collider で圧縮だけ続行）。" % hmap
        )
    print("コリジョン: %s を生成中（build_collider.js）..." % os.path.basename(hmap))
    r = subprocess.run([node, script, ply, "-w", "-q"])
    if r.returncode != 0 or not os.path.exists(hmap):
        sys.exit("コリジョン生成に失敗しました（終了コード %d）" % r.returncode)


def main():
    ap = argparse.ArgumentParser(description="シーンの転送量削減")
    ap.add_argument("target", help="point_cloud.ply または物件フォルダ")
    ap.add_argument("--bucket", default=None,
                    help="アップロード先 (例 gs://vr_naiken_properties/物件名)")
    ap.add_argument("-w", "--overwrite", action="store_true",
                    help="既存の .compressed.ply を上書きする")
    ap.add_argument("--rebuild-collider", action="store_true",
                    help="既存の .hmap.json があっても作り直す")
    ap.add_argument("--skip-collider", action="store_true",
                    help=".hmap.json の自動生成をしない")
    args = ap.parse_args()

    ply = find_ply(args.target)
    base = ply[:-4]                      # 拡張子 .ply を落とす
    out = base + ".compressed.ply"
    folder = os.path.dirname(os.path.abspath(ply)) or "."

    if ply.lower().endswith(".compressed.ply"):
        sys.exit("圧縮済みの PLY です。原本を指定してください: %s" % ply)
    if os.path.exists(out) and not args.overwrite:
        sys.exit("既に存在します（-w で上書き）: %s" % out)

    if not shutil.which("splat-transform") and not shutil.which("splat-transform.cmd"):
        sys.exit(
            "splat-transform が見つかりません。\n"
            "  npm install -g @playcanvas/splat-transform"
        )

    # 圧縮 PLY からはコリジョンを作れないので、圧縮の前に必ず済ませる
    ensure_hmap(ply, base, args.rebuild_collider, args.skip_collider)

    before = os.path.getsize(ply)
    print("入力: %s (%s)" % (os.path.basename(ply), mb(before)))
    print("圧縮中...")
    # 途中で失敗しても壊れた .compressed.ply を残さないよう、一時名に書いてから置き換える。
    # splat-transform は出力名が「.compressed.ply」で終わるときだけ圧縮形式で書くので、
    # 一時名もその末尾を保つ（.tmp.ply にすると無圧縮のまま出てしまう）。
    tmp_out = base + ".tmp.compressed.ply"
    if os.path.exists(tmp_out):
        os.remove(tmp_out)
    cmd = ["splat-transform", "--no-tty", "-w", ply, tmp_out]
    if os.name == "nt":
        # splat-transform は .cmd なので cmd.exe を経由する。引数は自分で "…" で囲む
        # （subprocess は空白のある引数しか引用しないので、& を含むパスで壊れる）。
        # " と % は引用符の中でも cmd に解釈されるので拒否する。
        for a in (ply, tmp_out):
            if '"' in a or "%" in a:
                sys.exit('パスに " や %% を含められません: %s' % a)
        cmd = " ".join('"%s"' % a for a in cmd)
        r = subprocess.run(cmd, shell=True)
    else:
        r = subprocess.run(cmd)
    if r.returncode != 0 or not os.path.exists(tmp_out):
        if os.path.exists(tmp_out):
            os.remove(tmp_out)
        sys.exit("splat-transform が失敗しました")
    os.replace(tmp_out, out)

    after = os.path.getsize(out)
    print("出力: %s (%s)  →  %.0f%% 削減"
          % (os.path.basename(out), mb(after), (1 - after / before) * 100))

    # コンパニオンの gzip 効果を測る（JSON は数値配列なので非常によく効く）
    print("\nコンパニオン（gsutil -Z で gzip 転送される）:")
    total_raw = after
    total_gz = after
    for suf in COMPANION_SUFFIXES:
        p = base + suf
        if not os.path.exists(p):
            continue
        raw = os.path.getsize(p)
        gz = gzip_ratio(p)
        total_raw += raw
        total_gz += gz
        print("  %-24s %10s → %10s (%.1f倍)"
              % (os.path.basename(p), mb(raw), mb(gz), raw / gz))

    print("\n転送量合計: %s（圧縮前の原本構成: %s）"
          % (mb(total_gz), mb(before + sum(
              os.path.getsize(base + s) for s in COMPANION_SUFFIXES
              if os.path.exists(base + s)))))

    # ---- アップロードコマンド ----
    dest = args.bucket or "gs://vr_naiken_properties/<物件名>"
    print("\n--- アップロード ---")
    print("# 1) 圧縮 PLY 本体。内容が変わったらファイル名を変える前提で長期キャッシュ")
    print("gsutil -h 'Cache-Control:public,max-age=31536000,immutable' \\")
    print("       cp '%s' '%s/'" % (out, dest))
    print()
    print("# 2) コンパニオン JSON。-Z で gzip 転送、内容が変わりうるので短期キャッシュ")
    print("gsutil -m -h 'Cache-Control:public,max-age=300' \\")
    print("       cp -Z '%s'*.json '%s/'" % (base, dest))
    print()
    print("# 3) voxel バイナリがあれば（gzip 済みバイナリなので -Z は付けない）")
    print("gsutil -h 'Cache-Control:public,max-age=300' \\")
    print("       cp '%s.voxel.bin' '%s/'   # 無ければスキップ" % (base, dest))
    print()
    print("※ 原本 %s はアップロードしない（配信は圧縮版のみ）。" % os.path.basename(ply))
    print("   ただし再水平化・コリジョン再生成には原本が要るのでローカルには残すこと。")


if __name__ == "__main__":
    main()
