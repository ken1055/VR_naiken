/**
 * vr-mode.js
 * PlayCanvas WebXR VR モード管理モジュール
 *
 * 依存: PlayCanvas (window.pc), window.UI (ui.js)
 * 初期化: VRMode.init(app, cameraEntity) を main.js から呼ぶこと
 */

window.VRMode = (function () {
  // -------------------------------------------------------------------
  // プライベート状態
  // -------------------------------------------------------------------
  let _app = null;
  let _cameraEntity = null;
  let _inVR = false;

  // VR コントローラー移動設定
  const MOVE_SPEED = 2.0;   // m/s
  const TURN_SPEED = 60.0;  // deg/s

  // -------------------------------------------------------------------
  // 内部ヘルパー
  // -------------------------------------------------------------------

  /**
   * XR イベントリスナーを登録する
   */
  function _bindXREvents() {
    if (!_app || !_app.xr) return;

    // VR セッション開始
    _app.xr.on('start', function () {
      _inVR = true;
      if (window.UI) {
        window.UI.setVRButtonState('exit');
      }
      console.log('[VRMode] VR セッション開始');
    });

    // VR セッション終了
    _app.xr.on('end', function () {
      _inVR = false;
      if (window.UI) {
        window.UI.setVRButtonState('enter');
      }
      console.log('[VRMode] VR セッション終了');
    });

    // エラーハンドリング
    _app.xr.on('error', function (err) {
      console.error('[VRMode] XR エラー:', err);
      _inVR = false;
      if (window.UI) {
        window.UI.setVRButtonState('enter');
        window.UI.showTooltip('VR の開始に失敗しました: ' + (err.message || err));
      }
    });
  }

  /**
   * VR コントローラーのサムスティック入力を毎フレーム処理する
   * app.on('update', ...) から呼ばれる
   */
  function _onUpdate(dt) {
    if (!_inVR || !_app || !_app.xr || !_app.xr.active) return;

    const input = _app.xr.input;
    if (!input) return;

    const controllers = input.controllers;
    if (!controllers || controllers.length === 0) return;

    // 左コントローラー: 移動 (スティック X/Y)
    // 右コントローラー: 回転 (スティック X)
    for (let i = 0; i < controllers.length; i++) {
      const ctrl = controllers[i];
      if (!ctrl || !ctrl.gamepad) continue;

      const axes = ctrl.gamepad.axes;
      if (!axes || axes.length < 2) continue;

      const axisX = axes[0] || 0;
      const axisY = axes[1] || 0;

      if (ctrl.hand === 'left' || ctrl.hand === null) {
        // 左スティック: 前後左右移動
        if (Math.abs(axisX) > 0.1 || Math.abs(axisY) > 0.1) {
          const cam = _cameraEntity;
          if (!cam) continue;

          // カメラの向いている方向に沿って移動
          const forward = cam.forward.clone().scale(-axisY * MOVE_SPEED * dt);
          const right   = cam.right.clone().scale(axisX * MOVE_SPEED * dt);
          cam.translateLocal(forward.x + right.x, 0, forward.z + right.z);
        }
      } else if (ctrl.hand === 'right') {
        // 右スティック X: 水平回転 (スナップターン)
        if (Math.abs(axisX) > 0.5) {
          _cameraEntity.rotateLocal(0, -Math.sign(axisX) * TURN_SPEED * dt, 0);
        }
      }
    }
  }

  // -------------------------------------------------------------------
  // 公開 API
  // -------------------------------------------------------------------
  return {
    /**
     * モジュールを初期化する
     * @param {pc.Application} app           - PlayCanvas Application インスタンス
     * @param {pc.Entity}       cameraEntity - カメラを持つエンティティ
     */
    init: function (app, cameraEntity) {
      _app          = app;
      _cameraEntity = cameraEntity;

      if (!app.xr) {
        // WebXR 非対応ランタイム (古いブラウザ等)
        console.warn('[VRMode] app.xr が存在しません。WebXR 非対応環境です。');
        if (window.UI) {
          window.UI.setVRButtonState('unsupported');
        }
        return;
      }

      const supported = app.xr.isAvailable(pc.XRTYPE_VR);

      if (window.UI) {
        window.UI.setVRButtonState(supported ? 'enter' : 'unsupported');
      }

      if (!supported) {
        console.warn('[VRMode] WebXR VR は利用不可です。');
        return;
      }

      _bindXREvents();

      // 毎フレームのコントローラー入力処理
      app.on('update', _onUpdate);

      console.log('[VRMode] 初期化完了。WebXR VR 対応環境です。');
    },

    /**
     * VR モードが利用可能かどうかを返す
     * @returns {boolean}
     */
    isSupported: function () {
      if (!_app || !_app.xr) return false;
      return _app.xr.isAvailable(pc.XRTYPE_VR);
    },

    /**
     * VR セッションを開始する
     * すでに VR 中、またはカメラが未設定の場合は何もしない
     */
    enter: function () {
      if (!_app || !_cameraEntity) {
        console.warn('[VRMode] enter() が呼ばれましたが、init() が完了していません。');
        return;
      }
      if (!this.isSupported()) {
        console.warn('[VRMode] WebXR VR は利用不可です。enter() をスキップします。');
        return;
      }
      if (_app.xr.active) {
        console.warn('[VRMode] すでに XR セッション中です。');
        return;
      }

      // LocalFloor: 床面基準の座標系 (ルームスケール VR 向け)
      _app.xr.start(
        _cameraEntity.camera,
        pc.XRTYPE_VR,
        pc.XRSPACE_LOCALFLOOR,
        {
          optionalFeatures: ['local-floor', 'bounded-floor'],
          callback: function (err) {
            if (err) {
              console.error('[VRMode] xr.start エラー:', err);
              if (window.UI) {
                window.UI.showTooltip('VR 起動に失敗しました: ' + (err.message || err));
              }
            }
          }
        }
      );
    },

    /**
     * VR セッションを終了する
     */
    exit: function () {
      if (!_app || !_app.xr) return;
      if (!_app.xr.active) {
        console.warn('[VRMode] exit() が呼ばれましたが XR セッションはアクティブではありません。');
        return;
      }
      _app.xr.end();
    },

    /**
     * 現在 VR セッション中かどうかを返す
     * @returns {boolean}
     */
    isActive: function () {
      return _inVR;
    },

    /**
     * モジュールの後片付けをする (アプリ終了時など)
     */
    destroy: function () {
      if (_app) {
        _app.off('update', _onUpdate);
        if (_app.xr) {
          _app.xr.off('start');
          _app.xr.off('end');
          _app.xr.off('error');
        }
      }
      _app          = null;
      _cameraEntity = null;
      _inVR         = false;
    }
  };
})();
