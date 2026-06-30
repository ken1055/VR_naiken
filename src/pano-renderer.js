/**
 * pano-renderer.js — 360度 (Equirectangular) 画像表示モジュール
 *
 * PlayCanvas v2.x のプリミティブ sphere + StandardMaterial で実装。
 * カスタムメッシュ / カスタムシェーダー方式はエンジンの内部 API と整合せず
 * 'impl' / 'failed' プロパティの undefined エラーになるため、標準コンポーネント
 * に統一する。
 *
 * プリミティブ sphere の分割は粗いため equirectangular の極付近で歪みが出る。
 * 完全なピクセル単位投影は将来 ShaderMaterial 等での再実装を検討。
 */
window.PanoRenderer = (function () {
    'use strict';

    var _app    = null;
    var _entity = null;

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

            var entity = new pc.Entity('panorama-sphere');
            entity.tags.add('pano-renderer');

            // PlayCanvas プリミティブ sphere を使う
            entity.addComponent('render', { type: 'sphere' });

            var mat = new pc.StandardMaterial();
            mat.diffuse         = new pc.Color(0, 0, 0);
            mat.emissive        = new pc.Color(1, 1, 1);
            mat.emissiveMap     = asset.resource;
            mat.useLighting     = false;
            mat.useGammaTonemap = false;
            mat.cull            = pc.CULLFACE_FRONT;   // 内面のみ描画
            mat.depthWrite      = false;
            mat.update();

            if (entity.render && entity.render.meshInstances) {
                entity.render.meshInstances.forEach(function (mi) {
                    mi.material = mat;
                });
            }

            // 半径 50 (プリミティブ sphere は直径1なので scale=100 で直径100=半径50)
            entity.setLocalScale(100, 100, 100);
            entity.setLocalPosition(0, 1.6, 0);

            // 初期向き (yaw)
            entity.setLocalEulerAngles(0, options.yaw || 0, 0);

            app.root.addChild(entity);
            _entity = entity;

            console.log('[PanoRenderer] プリミティブ sphere 起動');
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
