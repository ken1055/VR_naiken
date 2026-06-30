/**
 * pano-renderer.js — 360度 (Equirectangular) 画像表示モジュール
 *
 * 内面反転スフィアにテクスチャを貼り、カメラから見回せる形で表示する。
 * 3DGS とは排他で表示することを想定 (loadAndRender 側で先に disposeAll する)。
 */
window.PanoRenderer = (function () {
    'use strict';

    var _app        = null;
    var _entity     = null;
    var _sharedMesh = null;   // 全パノラマで使い回す高分割スフィア

    // 内向き高分割スフィアメッシュを生成する。
    // - 緯度 64 / 経度 128 分割。プリミティブの sphere (約 16x32) では equirectangular
    //   テクスチャの極付近や線が明らかに多角形に見える歪みが出るため自前で作る。
    // - UV.U を反転して内側から見たときの左右鏡像を解消する。
    // - 三角形 winding を CW（外側から見て）にし、CULLFACE_BACK で内側だけ描画する。
    function _buildInvertedSphere(device) {
        var LAT = 64, LON = 128;
        var positions = [];
        var normals   = [];
        var uvs       = [];
        var indices   = [];

        for (var lat = 0; lat <= LAT; lat++) {
            var v   = lat / LAT;                  // 0 (南極) → 1 (北極)
            var phi = (v - 0.5) * Math.PI;        // -π/2 → π/2
            var y   = Math.sin(phi);
            var cp  = Math.cos(phi);
            for (var lon = 0; lon <= LON; lon++) {
                var u     = lon / LON;
                var theta = u * Math.PI * 2;
                var x = cp * Math.cos(theta);
                var z = cp * Math.sin(theta);
                positions.push(x, y, z);
                // 内向き法線
                normals.push(-x, -y, -z);
                // U を反転: 内側から見た時の左右鏡像を相殺
                // V は equirectangular の上端=北極 (V=0)、下端=南極 (V=1) に合わせる
                uvs.push(1 - u, 1 - v);
            }
        }

        var stride = LON + 1;
        for (var la = 0; la < LAT; la++) {
            for (var lo = 0; lo < LON; lo++) {
                var a = la * stride + lo;
                var b = a + 1;
                var c = a + stride;
                var d = c + 1;
                // 内側だけ描画するための winding
                indices.push(a, c, b);
                indices.push(b, c, d);
            }
        }

        var mesh = new pc.Mesh(device);
        mesh.setPositions(positions);
        mesh.setNormals(normals);
        mesh.setUvs(0, uvs);
        mesh.setIndices(indices);
        mesh.update(pc.PRIMITIVE_TRIANGLES);
        return mesh;
    }

    // パノラマ画像を pc.Asset (type: 'texture') としてロードする。
    // file を渡せば File / Blob から、url なら URL から読む。
    function _loadAsset(app, opts) {
        return new Promise(function (resolve, reject) {
            var name = opts.name || 'panorama';
            var src  = opts.url;
            var objectURL = null;
            if (opts.file) {
                objectURL = URL.createObjectURL(opts.file);
                src = objectURL;
            }
            if (!src) { reject(new Error('画像のソースが指定されていません')); return; }

            var asset = new pc.Asset(name, 'texture', { url: src, filename: name });

            asset.ready(function (loadedAsset) {
                // Equirectangular 用にラップ設定
                var tex = loadedAsset.resource;
                if (tex) {
                    tex.addressU = pc.ADDRESS_REPEAT;
                    tex.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
                    tex.minFilter = pc.FILTER_LINEAR_MIPMAP_LINEAR;
                    tex.magFilter = pc.FILTER_LINEAR;
                    tex.anisotropy = 4;
                }
                if (objectURL) URL.revokeObjectURL(objectURL);
                resolve(loadedAsset);
            });
            asset.on('error', function (err) {
                if (objectURL) URL.revokeObjectURL(objectURL);
                reject(new Error('360度画像の読み込みに失敗しました: ' + (err ? String(err) : 'Unknown error')));
            });
            app.assets.add(asset);
            app.assets.load(asset);
        });
    }

    function _isPanoEntity(entity) {
        return entity && entity.tags && entity.tags.has('pano-renderer');
    }

    return {

        init: function (app) {
            _app = app;
        },

        /**
         * URL から 360度画像をロードする
         * @param {pc.Application} app
         * @param {string}         url
         * @returns {Promise<pc.Asset>}
         */
        loadFromURL: function (app, url) {
            return _loadAsset(app, { url: url, name: url.split('/').pop() });
        },

        /**
         * File オブジェクトから 360度画像をロードする
         */
        loadFromFile: function (app, file) {
            return _loadAsset(app, { file: file, name: file.name });
        },

        /**
         * スフィアを生成しシーンに追加する
         * @param {pc.Application} app
         * @param {pc.Asset}       asset      texture アセット
         * @param {Object}         [options]  { yaw: Number }
         * @returns {pc.Entity}
         */
        create: function (app, asset, options) {
            if (!app || !asset) {
                throw new Error('[PanoRenderer] app / asset が不正です');
            }
            options = options || {};

            this.dispose();

            var device = app.graphicsDevice;
            if (!_sharedMesh) _sharedMesh = _buildInvertedSphere(device);

            var entity = new pc.Entity('panorama-sphere');
            entity.tags.add('pano-renderer');

            var mat = new pc.StandardMaterial();
            mat.diffuse  = new pc.Color(0, 0, 0);
            mat.emissive = new pc.Color(1, 1, 1);
            mat.emissiveMap = asset.resource;
            mat.useLighting = false;
            mat.useGammaTonemap = false;
            mat.cull       = pc.CULLFACE_BACK;  // 自前 winding に合わせる
            mat.depthWrite = false;             // 背景として扱う
            mat.update();

            // 自前の高分割スフィアを meshInstance として entity に貼る
            var meshInstance = new pc.MeshInstance(_sharedMesh, mat, entity);
            entity.addComponent('render', { meshInstances: [meshInstance] });

            // 半径 50。カメラの farClip 1000 以内に収まるサイズ
            entity.setLocalScale(50, 50, 50);
            entity.setLocalPosition(0, 1.6, 0);

            // 初期向き (yaw)。equirectangular の中心が向きたい方向に来るように回す
            var yaw = options.yaw || 0;
            entity.setLocalEulerAngles(0, yaw, 0);

            app.root.addChild(entity);
            _entity = entity;

            console.log('[PanoRenderer] 球生成完了', entity.name);
            return entity;
        },

        /**
         * 既存スフィアの yaw を変更する (admin 用)
         */
        setYaw: function (yaw) {
            if (!_entity) return;
            _entity.setLocalEulerAngles(0, yaw || 0, 0);
        },

        /**
         * パノラマ表示位置 (球の中心) を返す。カメラを置く位置として使う。
         */
        getCenter: function () {
            if (!_entity) return { x: 0, y: 1.6, z: 0 };
            var p = _entity.getLocalPosition();
            return { x: p.x, y: p.y, z: p.z };
        },

        /**
         * 現在表示中のパノラマ Entity を破棄する
         */
        dispose: function () {
            if (!_entity) return;
            try {
                if (_entity.render) _entity.removeComponent('render');
                _entity.destroy();
            } catch (e) {
                console.warn('[PanoRenderer] dispose 中にエラー:', e);
            }
            _entity = null;
        },

        isActive: function () {
            return _isPanoEntity(_entity);
        }
    };
}());
