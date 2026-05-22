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

    function createDisc(pos) {
        var entity = new pc.Entity('teleport-disc');
        entity.addComponent('render', { type: 'plane' });

        var mat = new pc.StandardMaterial();
        mat.emissive          = new pc.Color(0, 0.83, 0.67);
        mat.emissiveIntensity = 2;
        mat.blendType         = pc.BLEND_ADDITIVE;
        mat.depthWrite        = false;
        mat.update();
        entity.render.meshInstances[0].material = mat;
        entity.setLocalScale(1.2, 1, 1.2);
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

            // パルスアニメーション
            var pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.003);
            _discs.forEach(function (d, i) {
                d.mat.emissiveIntensity = 1.5 + pulse * 2;
                d.mat.update();
                var s = 1.1 + pulse * 0.1;
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
