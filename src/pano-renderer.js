/**
 * pano-renderer.js — 360度 (Equirectangular) 画像表示モジュール
 *
 * 球メッシュ + フラグメントシェーダーで equirectangular 画像を歪み無しで表示する。
 * 球のローカル座標を方向ベクトルとして直接 (atan, asin) で UV 化することで
 * カメラ位置の微小ずれに依存しない perspective-correct な極座標マッピングを得る。
 * Insta360 や Photo Sphere Viewer と同じ原理。
 */
window.PanoRenderer = (function () {
    'use strict';

    var _app          = null;
    var _entity       = null;
    var _sharedMesh   = null;
    var _sharedShader = null;

    // 内向き球メッシュ (UV はシェーダーで計算)
    function _buildSphereMesh(device) {
        var LAT = 32, LON = 64;
        var positions = [];
        var indices   = [];

        for (var lat = 0; lat <= LAT; lat++) {
            var phi = (lat / LAT - 0.5) * Math.PI;
            var y   = Math.sin(phi);
            var cp  = Math.cos(phi);
            for (var lon = 0; lon <= LON; lon++) {
                var theta = (lon / LON) * Math.PI * 2;
                positions.push(cp * Math.cos(theta), y, cp * Math.sin(theta));
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
        mesh.setIndices(indices);
        mesh.update(pc.PRIMITIVE_TRIANGLES);
        return mesh;
    }

    function _buildShader(device) {
        var vshader = [
            'attribute vec3 vertex_position;',
            'uniform mat4 matrix_model;',
            'uniform mat4 matrix_viewProjection;',
            'varying vec3 vLocal;',
            'void main(void) {',
            '    vLocal = vertex_position;',
            '    gl_Position = matrix_viewProjection * matrix_model * vec4(vertex_position, 1.0);',
            '}'
        ].join('\n');

        var fshader = [
            'precision highp float;',
            'uniform sampler2D uPano;',
            'uniform float uYawOffset;',
            'varying vec3 vLocal;',
            'const float PI    = 3.14159265359;',
            'const float TWO_PI = 6.28318530718;',
            'void main(void) {',
            '    vec3 d = normalize(vLocal);',
            '    float u = (atan(d.x, -d.z) + uYawOffset) / TWO_PI + 0.5;',
            '    u = fract(u);',
            '    float v = 0.5 - asin(clamp(d.y, -1.0, 1.0)) / PI;',
            '    gl_FragColor = texture2D(uPano, vec2(u, v));',
            '}'
        ].join('\n');

        var attributes = { vertex_position: pc.SEMANTIC_POSITION };
        return pc.createShaderFromCode(device, vshader, fshader,
            'pano-equirect', attributes);
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
            if (!_sharedMesh)   _sharedMesh   = _buildSphereMesh(device);
            if (!_sharedShader) _sharedShader = _buildShader(device);

            var entity = new pc.Entity('panorama-sphere');
            entity.tags.add('pano-renderer');

            var mat = new pc.Material();
            mat.shader = _sharedShader;
            mat.setParameter('uPano', asset.resource);
            mat.setParameter('uYawOffset', (options.yaw || 0) * Math.PI / 180);
            mat.cull       = pc.CULLFACE_BACK;
            mat.depthWrite = false;
            mat.update();

            var mi = new pc.MeshInstance(_sharedMesh, mat, entity);
            entity.addComponent('render', { meshInstances: [mi] });

            entity.setLocalScale(50, 50, 50);
            entity.setLocalPosition(0, 1.6, 0);

            app.root.addChild(entity);
            _entity = entity;

            console.log('[PanoRenderer] 球面投影シェーダー方式 起動');
            return entity;
        },

        setYaw: function (yaw) {
            if (!_entity || !_entity.render) return;
            var mi = _entity.render.meshInstances[0];
            if (mi && mi.material) {
                mi.material.setParameter('uYawOffset', (yaw || 0) * Math.PI / 180);
            }
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
