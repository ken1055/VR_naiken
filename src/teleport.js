/**
 * teleport.js — シーン間テレポートシステム
 * テレポートポイントを3D空間に配置し、近づいたときにUIを表示する
 */
window.Teleporter = (function () {
    'use strict';

    var _app         = null;
    var _points      = [];   // { label, position:{x,y,z}, radius, destinationUrl, destinationCamera }
    var _discs       = [];   // { entity, mat }
    var _activePoint = null;
    var _onActivate  = null;

    // 透過リング模様のテクスチャを 1度だけ生成して使い回す
    var _ringTexture = null;
    function getRingTexture() {
        if (_ringTexture) return _ringTexture;
        var size = 256;
        var canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        var ctx = canvas.getContext('2d');
        var cx = size / 2, cy = size / 2;
        var ringOuter = size * 0.48;   // リング外半径
        var ringInner = size * 0.34;   // リング内半径
        var img  = ctx.createImageData(size, size);
        var data = img.data;
        for (var y = 0; y < size; y++) {
            for (var x = 0; x < size; x++) {
                var dx = x - cx, dy = y - cy;
                var r  = Math.sqrt(dx * dx + dy * dy);
                var a  = 0;
                if (r < ringOuter && r > ringInner) {
                    // リング本体: 端で滑らかに alpha 0 へフォール
                    var mid  = (ringOuter + ringInner) * 0.5;
                    var half = (ringOuter - ringInner) * 0.5;
                    a = 1 - Math.abs(r - mid) / half;
                    a = Math.pow(a, 0.6);
                }
                var idx = (y * size + x) * 4;
                data[idx]     = 255;
                data[idx + 1] = 255;
                data[idx + 2] = 255;
                data[idx + 3] = Math.round(a * 255);
            }
        }
        ctx.putImageData(img, 0, 0);

        _ringTexture = new pc.Texture(_app.graphicsDevice, {
            width:  size, height: size,
            format: pc.PIXELFORMAT_R8_G8_B8_A8,
            mipmaps: true,
        });
        _ringTexture.setSource(canvas);
        _ringTexture.minFilter = pc.FILTER_LINEAR_MIPMAP_LINEAR;
        _ringTexture.magFilter = pc.FILTER_LINEAR;
        _ringTexture.addressU  = pc.ADDRESS_CLAMP_TO_EDGE;
        _ringTexture.addressV  = pc.ADDRESS_CLAMP_TO_EDGE;
        return _ringTexture;
    }

    function createDisc(pos) {
        var entity = new pc.Entity('teleport-disc');
        entity.addComponent('render', { type: 'plane' });

        var mat = new pc.StandardMaterial();
        var color = new pc.Color(0.1, 0.95, 0.78);
        mat.emissive          = color;
        mat.emissiveIntensity = 1.0;
        mat.emissiveMap       = getRingTexture();   // 中央透明・周囲リング
        mat.opacityMap        = getRingTexture();   // 同じテクスチャの alpha を使う
        mat.opacity           = 0.85;
        mat.blendType         = pc.BLEND_NORMAL;    // additive 廃止（白飛び防止）
        mat.depthWrite        = false;
        mat.cull              = pc.CULLFACE_NONE;   // 表裏どちらからも見える
        mat.update();
        entity.render.meshInstances[0].material = mat;
        entity.setLocalScale(0.7, 1, 0.7);          // 直径 0.7m
        entity.setLocalPosition(
            pos.x,
            (pos.y !== undefined ? pos.y : 0) + 0.03,
            pos.z
        );
        _app.root.addChild(entity);
        return { entity: entity, mat: mat };
    }

    return {
        init: function (app) {
            _app = app;
        },

        load: function (teleports, onActivate) {
            this.reset();
            if (!teleports || !teleports.length) return;
            _onActivate = onActivate;
            _points     = teleports;
            _points.forEach(function (pt) {
                _discs.push(createDisc(pt.position));
            });
        },

        update: function (camPos) {
            if (!_points.length) return;

            // パルスアニメーション（控えめに）
            var pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.003);
            _discs.forEach(function (d, i) {
                d.mat.emissiveIntensity = 0.7 + pulse * 0.6;   // 0.7 〜 1.3
                d.mat.update();
                var s = 0.7 + pulse * 0.08;                    // 0.7 〜 0.78m
                _discs[i].entity.setLocalScale(s, 1, s);
            });

            // 最近接ポイントを探す
            var nearest = null, nearestDist = Infinity;
            _points.forEach(function (pt) {
                var dx   = camPos.x - pt.position.x;
                var dz   = camPos.z - pt.position.z;
                var dist = Math.sqrt(dx * dx + dz * dz);
                var r    = pt.radius !== undefined ? pt.radius : 1.2;
                if (dist < r && dist < nearestDist) {
                    nearest     = pt;
                    nearestDist = dist;
                }
            });

            if (nearest !== _activePoint) {
                _activePoint = nearest;
                if (window.UI) {
                    UI.setTeleportPrompt(nearest, function () {
                        if (_onActivate && _activePoint) _onActivate(_activePoint);
                    });
                }
            }
        },

        reset: function () {
            _discs.forEach(function (d) {
                if (d.entity && d.entity.destroy) d.entity.destroy();
            });
            _discs       = [];
            _points      = [];
            _activePoint = null;
            if (window.UI) UI.setTeleportPrompt(null, null);
        },

        setOnActivate: function (fn) { _onActivate = fn; },

        getPoints: function () { return _points.slice(); },

        addPoint: function (point) {
            _points.push(point);
            if (_app) _discs.push(createDisc(point.position));
        },

        removePoint: function (index) {
            if (_discs[index]) _discs[index].entity.destroy();
            _discs.splice(index, 1);
            _points.splice(index, 1);
        }
    };
}());
