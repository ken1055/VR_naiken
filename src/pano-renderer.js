/**
 * pano-renderer.js — 360度 (Equirectangular) 画像表示モジュール
 *
 * 球メッシュ + フラグメントシェーダーで equirectangular 画像を歪み無しで表示する。
 * 頂点 UV による線形補間方式だと球の分割数を上げても多角形感が残るため、
 * シェーダー内で view_position からのワールド方向ベクトルを直接 (atan, asin) で
 * UV 化することで perspective-correct な極座標マッピングを得る。
 */
window.PanoRenderer = (function () {
    'use strict';

    var _app           = null;
    var _entity        = null;
    var _sharedMesh    = null;   // 球メッシュ (UV 不使用なので粗くて良い)
    var _sharedShader  = null;   // equirect サンプリングシェーダー

    // 内向き球メッシュ (UV はシェーダーで計算するので持たない)
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
                // 内向き winding (CULLFACE_BACK で内側だけ描画)
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

    // equirectangular サンプリング用のカスタムシェーダー
    //
    // 方向ベクトルとして「球のローカル座標 (= 球中心からの単位方向)」を直接使う。
    // view_position からの差分方式だと、カメラ位置が球の中心から微妙にずれている
    // (entity 階層の親変換ずれ等) と方向ベクトルが歪んで、結果壁が波打って見える。
    // ローカル座標を方向にすれば、カメラ位置に関わらず常に正確な極座標マッピングが得られる。
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
            'precision mediump float;',
            'uniform sampler2D uPano;',
            'uniform float uYawOffset;',     // 初期向き調整 (rad)
            'varying vec3 vLocal;',
            'const float PI    = 3.14159265359;',
            'const float TWO_PI = 6.28318530718;',
            'void main(void) {',
            '    vec3 d = normalize(vLocal);',
            // U: equirectangular の中央 (U=0.5) をカメラ正面 (-Z) に合わせる。
            // atan(d.x, -d.z) で
            //   d=(0,0,-1)[カメラ正面]→0, d=(+1,0,0)[画面右]→+π/2, d=(-1,0,0)[画面左]→-π/2
            // これを TWO_PI で正規化し +0.5 して画像中央にシフト。
            '    float u = (atan(d.x, -d.z) + uYawOffset) / TWO_PI + 0.5;',
            '    u = fract(u);',
            // V: 北極 (d.y=+1) を V=0、南極 (d.y=-1) を V=1 にマップ
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
                    tex.anisotropy = 8;
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

        /**
         * パノラマ表示用 entity を生成しシーンに追加する
         * @param {pc.Application} app
         * @param {pc.Asset}       asset      texture asset
         * @param {Object}         [options]  { yaw: Number(deg) }
         * @returns {pc.Entity}
         */
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
            // 度 → ラジアン (yaw を画像中央のオフセットとして使う)
            mat.setParameter('uYawOffset', (options.yaw || 0) * Math.PI / 180);
            mat.cull       = pc.CULLFACE_BACK;
            mat.depthWrite = false;
            mat.update();

            var mi = new pc.MeshInstance(_sharedMesh, mat, entity);
            entity.addComponent('render', { meshInstances: [mi] });

            // 半径 50 (カメラの farClip 1000 以内)
            entity.setLocalScale(50, 50, 50);
            entity.setLocalPosition(0, 1.6, 0);

            app.root.addChild(entity);
            _entity = entity;

            console.log('[PanoRenderer] 球生成完了 (シェーダー方式)');
            return entity;
        },

        /**
         * 表示中のパノラマの yaw (初期向き) を変更する
         * @param {number} yaw 度
         */
        setYaw: function (yaw) {
            if (!_entity || !_entity.render) return;
            var mi = _entity.render.meshInstances[0];
            if (mi && mi.material) {
                mi.material.setParameter('uYawOffset',
                    (yaw || 0) * Math.PI / 180);
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
