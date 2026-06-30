/**
 * pano-renderer.js — 360度 (Equirectangular) 画像表示モジュール
 *
 * 高分割の内向きスフィア + StandardMaterial (emissiveMap) で実装。
 * カスタムシェーダー方式は PlayCanvas v2.x の Material API と整合せずエラーが
 * 出るため、安定して動く標準マテリアル + 細かい UV メッシュで歪みを抑える。
 */
window.PanoRenderer = (function () {
    'use strict';

    var _app        = null;
    var _entity     = null;
    var _sharedMesh = null;   // 高分割スフィア (LAT 128 × LON 256)

    // 内向き高分割スフィアメッシュ。equirectangular の UV を頂点で持つ。
    // 鏡像対策のため U.x を反転 (1-u)、V は北極=0 / 南極=1 に合わせる。
    function _buildInvertedSphere(device) {
        var LAT = 128, LON = 256;
        var positions = [];
        var normals   = [];
        var uvs       = [];
        var indices   = [];

        for (var lat = 0; lat <= LAT; lat++) {
            var v   = lat / LAT;
            var phi = (v - 0.5) * Math.PI;
            var y   = Math.sin(phi);
            var cp  = Math.cos(phi);
            for (var lon = 0; lon <= LON; lon++) {
                var u     = lon / LON;
                var theta = u * Math.PI * 2;
                var x = cp * Math.cos(theta);
                var z = cp * Math.sin(theta);
                positions.push(x, y, z);
                normals.push(-x, -y, -z);
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
                var tex = loadedAsset.resource;
                if (tex) {
                    tex.addressU   = pc.ADDRESS_REPEAT;
                    tex.addressV   = pc.ADDRESS_CLAMP_TO_EDGE;
                    tex.minFilter  = pc.FILTER_LINEAR_MIPMAP_LINEAR;
                    tex.magFilter  = pc.FILTER_LINEAR;
                    tex.anisotropy = 16;
                }
                if (objectURL) URL.revokeObjectURL(objectURL);
                resolve(loadedAsset);
            });
            asset.on('error', function (err) {
                if (objectURL) URL.revokeObjectURL(objectURL);
                reject(new Error('360度画像の読み込みに失敗しました: '
                    + (err ? String(err) : 'Unknown error')));
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

        loadFromURL: function (app, url) {
            return _loadAsset(app, { url: url, name: url.split('/').pop() });
        },

        loadFromFile: function (app, file) {
            return _loadAsset(app, { file: file, name: file.name });
        },

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
            mat.diffuse        = new pc.Color(0, 0, 0);
            mat.emissive       = new pc.Color(1, 1, 1);
            mat.emissiveMap    = asset.resource;
            mat.useLighting    = false;
            mat.useGammaTonemap = false;
            mat.cull           = pc.CULLFACE_BACK;  // 自前 winding に合わせる
            mat.depthWrite     = false;
            mat.update();

            var mi = new pc.MeshInstance(_sharedMesh, mat, entity);
            entity.addComponent('render', { meshInstances: [mi] });

            entity.setLocalScale(50, 50, 50);
            entity.setLocalPosition(0, 1.6, 0);

            // 初期向き (yaw) は entity 自体を回転させて反映
            entity.setLocalEulerAngles(0, options.yaw || 0, 0);

            app.root.addChild(entity);
            _entity = entity;

            console.log('[PanoRenderer] 高分割スフィア (LAT 128 × LON 256) 起動');
            return entity;
        },

        setYaw: function (yaw) {
            if (!_entity) return;
            _entity.setLocalEulerAngles(0, yaw || 0, 0);
        },

        getCenter: function () {
            if (!_entity) return { x: 0, y: 1.6, z: 0 };
            var p = _entity.getLocalPosition();
            return { x: p.x, y: p.y, z: p.z };
        },

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
