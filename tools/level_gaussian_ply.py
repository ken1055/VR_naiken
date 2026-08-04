# -*- coding: utf-8 -*-
"""3D Gaussian Splatting PLY の傾き自動補正ツール

PortalCam などが出力する 3DGS 形式 PLY（x,y,z + rot_0..3 クォータニオン + scale_0..2）を、
部屋の壁・床がワールド軸に揃うように全体回転させる。
位置(x,y,z)とスプラットの向き(rot_0..3)の両方を回転させるので表示が壊れない。
（f_dc_0..2 は DC 成分のみで回転不変。f_rest_* がある高次SH入りPLYには未対応）

手順:
  1. 各スプラットの最短スケール軸（=面法線）をクォータニオンから計算
  2. 法線クラスタ（壁2方向+床/天井）を反復推定して初期回転を得る
  3. 軸方向1cmヒストグラムの集中度を最大化する微調整（座標降下グリッドサーチ）
  4. 位置・クォータニオンに適用し、ヘッダーの bbox コメントを更新して書き出し

使い方:
  python tools/level_gaussian_ply.py input.ply            # → input_leveled.ply
  python tools/level_gaussian_ply.py input.ply -o out.ply
"""
import argparse
import os
import sys
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")


def read_ply(path):
    with open(path, "rb") as f:
        header = b""
        while not header.endswith(b"end_header\n"):
            line = f.readline()
            if not line:
                raise ValueError("PLYヘッダーが読めません")
            header += line
        hlines = header.decode().splitlines()
        if not any(l.startswith("format binary_little_endian") for l in hlines):
            raise ValueError("binary_little_endian 形式のみ対応")
        n_vertex = int([l for l in hlines if l.startswith("element vertex")][0].split()[-1])
        props = [l.split()[-1] for l in hlines if l.startswith("property")]
        types = {l.split()[-1]: l.split()[1] for l in hlines if l.startswith("property")}
        if any(t != "float" for t in types.values()):
            raise ValueError("float 以外のプロパティには未対応")
        data = np.fromfile(f, dtype=np.float32, count=n_vertex * len(props)).reshape(n_vertex, len(props))
    return hlines, props, data


def quat_to_R(q):
    w, x, y, z = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    R = np.empty((len(q), 3, 3))
    R[:, 0, 0] = 1 - 2*(y*y + z*z); R[:, 0, 1] = 2*(x*y - w*z);     R[:, 0, 2] = 2*(x*z + w*y)
    R[:, 1, 0] = 2*(x*y + w*z);     R[:, 1, 1] = 1 - 2*(x*x + z*z); R[:, 1, 2] = 2*(y*z - w*x)
    R[:, 2, 0] = 2*(x*z - w*y);     R[:, 2, 1] = 2*(y*z + w*x);     R[:, 2, 2] = 1 - 2*(x*x + y*y)
    return R


def R_to_quat(R):
    w = np.sqrt(max(0.0, 1 + R[0, 0] + R[1, 1] + R[2, 2])) / 2
    return np.array([w,
                     (R[2, 1] - R[1, 2]) / (4*w),
                     (R[0, 2] - R[2, 0]) / (4*w),
                     (R[1, 0] - R[0, 1]) / (4*w)])


def rot(axis, deg):
    t = np.radians(deg); c, s = np.cos(t), np.sin(t)
    if axis == 0: return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == 1: return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def estimate_initial(sn):
    """法線クラスタの反復推定 → 部屋の軸をワールド軸に揃える回転"""
    M = np.eye(3)
    for _ in range(8):
        cols = []
        for a in range(3):
            ax = M[:, a]
            grp = sn[np.abs(sn @ ax) > 0.9]
            if len(grp) < 50:
                cols.append(ax)
                continue
            g = grp * np.sign(grp @ ax)[:, None]
            m = g.mean(axis=0)
            cols.append(m / np.linalg.norm(m))
        U, _, Vt = np.linalg.svd(np.column_stack(cols))
        Mn = U @ Vt
        if np.linalg.det(Mn) < 0:
            U[:, -1] *= -1
            Mn = U @ Vt
        M = Mn
    return M.T


def sharpness(pts, R, c0):
    p = (pts - c0) @ R.T
    tot = 0.0
    for a in range(3):
        v = p[:, a]
        lo, hi = np.percentile(v, [0.5, 99.5])
        h, _ = np.histogram(v[(v >= lo) & (v <= hi)], bins=int((hi - lo) / 0.01) + 1)
        hn = h / h.sum()
        tot += (hn ** 2).sum()
    return tot


def main():
    ap = argparse.ArgumentParser(description="3DGS PLY の傾き自動補正")
    ap.add_argument("input")
    ap.add_argument("-o", "--output", default=None)
    args = ap.parse_args()
    out_path = args.output or os.path.splitext(args.input)[0] + "_leveled.ply"

    hlines, props, data = read_ply(args.input)
    i = {p: k for k, p in enumerate(props)}
    for need in ("x", "y", "z", "opacity", "scale_0", "rot_0"):
        if need not in i:
            raise ValueError(f"プロパティ {need} がありません（3DGS形式のPLYではない？）")
    if any(p.startswith("f_rest") for p in props):
        print("警告: f_rest_*（高次SH）は回転されません。見た目が僅かに変わる可能性あり")

    print(f"読み込み: {args.input} ({len(data)}点)")
    opacity = 1 / (1 + np.exp(-data[:, i["opacity"]]))
    q = data[:, [i["rot_0"], i["rot_1"], i["rot_2"], i["rot_3"]]].astype(np.float64)
    q /= np.linalg.norm(q, axis=1, keepdims=True)

    # スプラット面法線 = 最短スケール軸の方向
    Rall = quat_to_R(q)
    scales = data[:, [i["scale_0"], i["scale_1"], i["scale_2"]]].astype(np.float64)
    min_axis = scales.argmin(axis=1)
    normals = Rall[np.arange(len(q)), :, min_axis]
    srt = np.sort(scales, axis=1)
    sel = (opacity > 0.5) & ((srt[:, 1] - srt[:, 0]) > 1.0)
    if sel.sum() < 1000:
        raise ValueError("解析に使える不透明・扁平スプラットが少なすぎます")

    R0 = estimate_initial(normals[sel])

    xyz = data[:, 0:3].astype(np.float64)
    pts_all = xyz[opacity > 0.5]
    rng = np.random.default_rng(0)
    sub = pts_all[rng.choice(len(pts_all), min(120000, len(pts_all)), replace=False)]
    c0 = np.median(pts_all, axis=0)

    best, best_s = R0, sharpness(sub, R0, c0)
    for _ in range(3):
        for axis in range(3):
            for deg in np.arange(-3, 3.01, 0.25):
                if abs(deg) < 1e-9:
                    continue
                Rc = rot(axis, deg) @ best
                s = sharpness(sub, Rc, c0)
                if s > best_s:
                    best_s, best = s, Rc
    for axis in range(3):
        for deg in np.arange(-0.3, 0.31, 0.05):
            if abs(deg) < 1e-9:
                continue
            Rc = rot(axis, deg) @ best
            s = sharpness(sub, Rc, c0)
            if s > best_s:
                best_s, best = s, Rc
    Rf = best

    total = np.degrees(np.arccos(np.clip((np.trace(Rf) - 1) / 2, -1, 1)))
    tilt = np.degrees(np.arccos(np.clip((Rf @ [0, 0, 1.0])[2], -1, 1)))
    yaw = np.degrees(np.arctan2(Rf[1, 0], Rf[0, 0]))
    print(f"補正回転: 全体 {total:.2f}°（うち上下軸の傾き {tilt:.2f}°, ヨー {yaw:.2f}°）")

    out = data.copy()
    xyz_new = (xyz - c0) @ Rf.T + c0
    out[:, 0:3] = xyz_new.astype(np.float32)

    w1, x1, y1, z1 = R_to_quat(Rf)
    w2, x2, y2, z2 = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    qn = np.column_stack([
        w1*w2 - x1*x2 - y1*y2 - z1*z2,
        w1*x2 + x1*w2 + y1*z2 - z1*y2,
        w1*y2 - x1*z2 + y1*w2 + z1*x2,
        w1*z2 + x1*y2 - y1*x2 + z1*w2,
    ])
    qn /= np.linalg.norm(qn, axis=1, keepdims=True)
    out[:, [i["rot_0"], i["rot_1"], i["rot_2"], i["rot_3"]]] = qn.astype(np.float32)

    if all(k in i for k in ("nx", "ny", "nz")):
        nrm = data[:, [i["nx"], i["ny"], i["nz"]]].astype(np.float64)
        if np.abs(nrm).max() > 0:
            out[:, [i["nx"], i["ny"], i["nz"]]] = (nrm @ Rf.T).astype(np.float32)

    mn, mx = xyz_new.min(axis=0), xyz_new.max(axis=0)
    upd = {"minx": mn[0], "miny": mn[1], "minz": mn[2], "maxx": mx[0], "maxy": mx[1], "maxz": mx[2]}
    new_hlines = []
    for l in hlines:
        parts = l.split()
        if len(parts) == 3 and parts[0] == "comment" and parts[1] in upd:
            l = f"comment {parts[1]} {upd[parts[1]]:.7f}"
        new_hlines.append(l)
    with open(out_path, "wb") as f:
        f.write(("\n".join(new_hlines) + "\n").encode("ascii"))
        out.astype("<f4").tofile(f)
    print(f"書き出し: {out_path}")


if __name__ == "__main__":
    main()
