/**
 * pano-renderer.js — 360度 (Equirectangular) 画像表示モジュール
 *
 * 内面反転スフィアにテクスチャを貼り、カメラから見回せる形で表示する。
 * 3DGS とは排他で表示することを想定 (loadAndRender 側で先に disposeAll する)。
 */
window.PanoRenderer = (function () {
    'use strict';

    var _app    = null;
    var _entity = null;

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

            var entity = new pc.Entity('panorama-sphere');
            entity.tags.add('pano-renderer');

            entity.addComponent('model', { type: 'sphere' });

            var mat = new pc.StandardMaterial();
            mat.diffuse  = new pc.Color(0, 0, 0);
            mat.emissive = new pc.Color(1, 1, 1);
            mat.emissiveMap = asset.resource;
            mat.useLighting = false;
            mat.useGammaTonemap = false;
            mat.cull = pc.CULLFACE_FRONT;   // 内面のみ描画
            mat.depthWrite = false;          // 背景として扱う
            mat.update();

            entity.model.meshInstances.forEach(function (mi) {
                mi.material = mat;
            });

            // 半径 50 (球プリミティブの直径1にスケール100をかけたもの)
            // カメラの farClip 1000 以内に収まるサイズ
            entity.setLocalScale(100, 100, 100);
            entity.setLocalPosition(0, 1.6, 0);

            // 初期向き (yaw)。equirectangular の中心が向きたい方向に来るように回す
            var yaw = options.yaw || 0;
            // X 軸反転で内側から見たときの左右反転を防ぐ
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
                if (_entity.model) _entity.removeComponent('model');
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
