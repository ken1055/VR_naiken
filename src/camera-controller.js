/**
 * camera-controller.js
 * Unity Scene View 風の自由視点カメラコントローラー
 * PlayCanvas 用 - window.CameraController としてグローバル定義
 */
window.CameraController = (function () {
  // ---- 内部状態 ----
  var _app = null;
  var _cameraEntity = null;

  // 目標姿勢（入力で即時更新）
  var _targetYaw   = 0;
  var _targetPitch = 0;
  var _targetPos   = new pc.Vec3(0, 2, 5);

  // 表示姿勢（毎フレーム lerp で目標に追従）
  var _yaw   = 0;
  var _pitch = 0;
  var _pos   = new pc.Vec3(0, 2, 5);

  // オービット用注視点
  var _orbitTarget = new pc.Vec3(0, 0, 0);

  // スムージング係数（フレームレート非依存 exponential decay）
  var SMOOTH_POS = 12;
  var SMOOTH_ROT = 16;

  // 移動速度
  var _moveSpeed = 2;          // m/s
  var _moveSpeedMin = 0.2;
  var _moveSpeedMax = 20;

  // マウス状態
  var _mouseRight = false;     // 右ドラッグ中（FPS 回転）
  var _mouseLeft  = false;     // 左ドラッグ中（オービット回転）
  var _lastMouseX = 0;
  var _lastMouseY = 0;
  var _isPointerLocked = false;

  // キー状態
  var _keys = {};

  // モバイル上下移動ボタン (-1 / 0 / 1)
  var _mobileVertical = 0;

  // パノラマモード: 位置を完全に固定し、回転入力のみ受け付ける
  var _lockPosition = false;
  var _lockedPos    = new pc.Vec3(0, 1.6, 0);

  // バーチャルジョイスティック入力 (-1〜1)
  var _joystickX = 0;  // 右(+) / 左(-)
  var _joystickY = 0;  // 下(+) / 上(-) ← 画面座標なので前進は -Y

  // タッチ状態
  var _touches = [];
  var _lastPinchDist = null;

  // 感度
  var LOOK_SENSITIVITY       = 0.08;  // deg / px (PC)
  var TOUCH_LOOK_SENSITIVITY = 0.15;  // deg / px (スマホ)
  var ORBIT_SENSITIVITY  = 0.15;  // deg / px
  var WHEEL_SPEED_FACTOR = 1.15;
  var TOUCH_PAN_FACTOR   = 0.004; // m/px per (m/s) of moveSpeed

  // ---- ユーティリティ ----
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function degToRad(d) { return d * Math.PI / 180; }

  /** カメラを現在の _yaw / _pitch / _pos に合わせる */
  function applyTransform() {
    _cameraEntity.setLocalEulerAngles(_pitch, _yaw, 0);
    _cameraEntity.setLocalPosition(_pos);
  }

  /** カメラのローカル前方ベクトルを取得 */
  function getForward() {
    var mat = _cameraEntity.getWorldTransform();
    return new pc.Vec3(-mat.data[8], -mat.data[9], -mat.data[10]).normalize();
  }

  /** カメラのローカル右ベクトルを取得 */
  function getRight() {
    var mat = _cameraEntity.getWorldTransform();
    return new pc.Vec3(mat.data[0], mat.data[1], mat.data[2]).normalize();
  }

  // ---- Pointer Lock ----
  function requestPointerLock(canvas) {
    canvas.requestPointerLock =
      canvas.requestPointerLock ||
      canvas.mozRequestPointerLock ||
      canvas.webkitRequestPointerLock;
    if (canvas.requestPointerLock) canvas.requestPointerLock();
  }

  function exitPointerLock() {
    document.exitPointerLock =
      document.exitPointerLock ||
      document.mozExitPointerLock ||
      document.webkitExitPointerLock;
    if (document.exitPointerLock) document.exitPointerLock();
  }

  function onPointerLockChange() {
    var canvas = _app.graphicsDevice.canvas;
    _isPointerLocked = (
      document.pointerLockElement === canvas ||
      document.mozPointerLockElement === canvas ||
      document.webkitPointerLockElement === canvas
    );
    // 没入感のためポインターロック中はヘッダーを隠す
    var header = document.getElementById('vr-header');
    if (header) {
      header.style.transition = 'opacity 0.3s';
      header.style.opacity        = _isPointerLocked ? '0' : '';
      header.style.pointerEvents  = _isPointerLocked ? 'none' : '';
    }
  }

  // ---- マウスイベント ----
  function onMouseDown(e) {
    if (e.button === 2) {
      _mouseRight = true;
      _lastMouseX = e.clientX;
      _lastMouseY = e.clientY;
      requestPointerLock(_app.graphicsDevice.canvas);
      e.preventDefault();
    } else if (e.button === 0) {
      _mouseLeft = true;
      _lastMouseX = e.clientX;
      _lastMouseY = e.clientY;
      e.preventDefault();
    }
  }

  function onMouseUp(e) {
    if (e.button === 2) {
      _mouseRight = false;
      if (_isPointerLocked) exitPointerLock();
    } else if (e.button === 0) {
      _mouseLeft = false;
    }
  }

  function onMouseMove(e) {
    var dx, dy;
    if (_isPointerLocked) {
      dx = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
      dy = e.movementY || e.mozMovementY || e.webkitMovementY || 0;
    } else {
      dx = e.clientX - _lastMouseX;
      dy = e.clientY - _lastMouseY;
      _lastMouseX = e.clientX;
      _lastMouseY = e.clientY;
    }

    if (_mouseRight) {
      // FPS 視点回転 → ターゲット更新
      _targetYaw   += dx * LOOK_SENSITIVITY;
      _targetPitch += dy * LOOK_SENSITIVITY;
      _targetPitch  = clamp(_targetPitch, -89, 89);
    } else if (_mouseLeft) {
      // 左ドラッグも FPS 視点回転（右ドラッグと同じ）
      _targetYaw   += dx * LOOK_SENSITIVITY;
      _targetPitch += dy * LOOK_SENSITIVITY;
      _targetPitch  = clamp(_targetPitch, -89, 89);
    }
  }

  function onWheel(e) {
    // ホイールで移動速度変更
    if (e.deltaY < 0) {
      _moveSpeed = clamp(_moveSpeed * WHEEL_SPEED_FACTOR, _moveSpeedMin, _moveSpeedMax);
    } else {
      _moveSpeed = clamp(_moveSpeed / WHEEL_SPEED_FACTOR, _moveSpeedMin, _moveSpeedMax);
    }
    e.preventDefault();
  }

  function onContextMenu(e) { e.preventDefault(); }

  // ---- キーボードイベント ----
  var GAME_CODES = {
    KeyW:1, KeyA:1, KeyS:1, KeyD:1, KeyE:1, KeyQ:1,
    ArrowUp:1, ArrowDown:1, ArrowLeft:1, ArrowRight:1
  };

  function isInputFocused() {
    var t = document.activeElement && document.activeElement.tagName;
    return t === 'INPUT' || t === 'TEXTAREA';
  }

  function onKeyDown(e) {
    // Ctrl+W / Cmd+W はテキスト入力中でも常にタブを閉じさせない
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyW') {
      e.preventDefault();
    }

    // テキスト入力中はカメラ操作を無視
    if (isInputFocused()) return;

    _keys[e.code] = true;

    // ゲームキーのブラウザデフォルト動作を抑制
    if (GAME_CODES[e.code]) e.preventDefault();
  }

  function onKeyUp(e) {
    _keys[e.code] = false;
  }

  // ---- タッチイベント ----
  function getTouchDist(touches) {
    var dx = touches[0].clientX - touches[1].clientX;
    var dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function onTouchStart(e) {
    _touches = Array.from(e.touches);
    if (_touches.length === 2) {
      _lastPinchDist = getTouchDist(_touches);
    }
    e.preventDefault();
  }

  function onTouchMove(e) {
    var curTouches = Array.from(e.touches);

    if (curTouches.length === 1 && _touches.length === 1) {
      // 1本指ドラッグ: FPS 回転 → ターゲット更新
      var dx = curTouches[0].clientX - _touches[0].clientX;
      var dy = curTouches[0].clientY - _touches[0].clientY;
      _targetYaw   += dx * TOUCH_LOOK_SENSITIVITY;
      _targetPitch += dy * TOUCH_LOOK_SENSITIVITY;
      _targetPitch  = clamp(_targetPitch, -89, 89);
    } else if (curTouches.length === 2 && _touches.length === 2) {
      // 2本指ピンチ: 移動速度変更
      var dist = getTouchDist(curTouches);
      if (_lastPinchDist !== null) {
        var ratio = dist / _lastPinchDist;
        _moveSpeed = clamp(_moveSpeed * ratio, _moveSpeedMin, _moveSpeedMax);
      }
      _lastPinchDist = dist;

      // 2本指パン: 前後左右移動（中点の変位をワールド移動に変換）
      var midX     = (curTouches[0].clientX + curTouches[1].clientX) * 0.5;
      var midY     = (curTouches[0].clientY + curTouches[1].clientY) * 0.5;
      var prevMidX = (_touches[0].clientX  + _touches[1].clientX)  * 0.5;
      var prevMidY = (_touches[0].clientY  + _touches[1].clientY)  * 0.5;
      var panDx  = midX - prevMidX;
      var panDy  = midY - prevMidY;
      var panFwd   = getForward();
      var panRight = getRight();
      var panSpd = _moveSpeed * TOUCH_PAN_FACTOR;
      _targetPos.add(panFwd.clone().scale(-panDy * panSpd));
      _targetPos.add(panRight.clone().scale(panDx * panSpd));
    }

    _touches = curTouches;
    e.preventDefault();
  }

  function onTouchEnd(e) {
    _touches = Array.from(e.touches);
    if (_touches.length < 2) _lastPinchDist = null;
    e.preventDefault();
  }

  // ---- 公開 API ----
  return {
    /**
     * 初期化
     * @param {pc.Application} app - PlayCanvas Application
     * @param {pc.Entity} cameraEntity - カメラエンティティ
     */
    init: function (app, cameraEntity) {
      _app          = app;
      _cameraEntity = cameraEntity;

      // 初期姿勢（target / smoothed 両方を同じ値に）
      _targetPos.set(0, 2, 5);  _pos.set(0, 2, 5);
      _targetYaw   = 0;         _yaw   = 0;
      _targetPitch = 0;         _pitch = 0;
      applyTransform();

      var canvas = app.graphicsDevice.canvas;

      // マウスイベント
      canvas.addEventListener('mousedown',     onMouseDown,   false);
      canvas.addEventListener('mousemove',     onMouseMove,   false);
      canvas.addEventListener('mouseup',       onMouseUp,     false);
      canvas.addEventListener('wheel',         onWheel,       { passive: false });
      canvas.addEventListener('contextmenu',   onContextMenu, false);

      // Pointer Lock
      document.addEventListener('pointerlockchange',       onPointerLockChange, false);
      document.addEventListener('mozpointerlockchange',    onPointerLockChange, false);
      document.addEventListener('webkitpointerlockchange', onPointerLockChange, false);

      // キーボードイベント（window に付与）
      window.addEventListener('keydown', onKeyDown, false);
      window.addEventListener('keyup',   onKeyUp,   false);
      // フォーカス喪失時にキー状態をリセット（keyup が届かず stuck になるのを防ぐ）
      window.addEventListener('blur', function () { _keys = {}; }, false);

      // タッチイベント
      canvas.addEventListener('touchstart', onTouchStart, { passive: false });
      canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
      canvas.addEventListener('touchend',   onTouchEnd,   { passive: false });

      // PlayCanvas フレーム更新
      app.on('update', function (dt) {
        window.CameraController.update(dt);
      });
    },

    /**
     * 毎フレーム呼び出し（app.on('update') から自動呼び出し）
     * @param {number} dt - デルタタイム（秒）
     */
    update: function (dt) {
      if (!_cameraEntity) return;

      // タブが非アクティブから復帰したときの巨大な dt を制限
      dt = Math.min(dt, 0.1);

      var fwd   = getForward();
      var right = getRight();
      var spd   = _moveSpeed * dt;

      // パノラマモード: 位置を固定したまま回転だけ反映する
      if (_lockPosition) {
        _targetPos.copy(_lockedPos);
        _pos.copy(_lockedPos);
        var tRotLk = 1 - Math.exp(-SMOOTH_ROT * dt);
        _yaw   += (_targetYaw   - _yaw)   * tRotLk;
        _pitch += (_targetPitch - _pitch) * tRotLk;
        applyTransform();
        return;
      }

      // キー入力 → ターゲット位置を更新
      if (_keys['KeyW'] || _keys['ArrowUp'])    { _targetPos.add(fwd.clone().scale(spd)); }
      if (_keys['KeyS'] || _keys['ArrowDown'])   { _targetPos.add(fwd.clone().scale(-spd)); }
      if (_keys['KeyD'] || _keys['ArrowRight'])  { _targetPos.add(right.clone().scale(spd)); }
      if (_keys['KeyA'] || _keys['ArrowLeft'])   { _targetPos.add(right.clone().scale(-spd)); }
      if (_keys['KeyQ'])       { _targetPos.add(new pc.Vec3(0,  spd, 0)); }
      if (_keys['KeyE'])       { _targetPos.add(new pc.Vec3(0, -spd, 0)); }
      if (_mobileVertical !== 0) { _targetPos.add(new pc.Vec3(0, _mobileVertical * spd, 0)); }
      if (_joystickX !== 0 || _joystickY !== 0) {
        _targetPos.add(fwd.clone().scale(-_joystickY * spd));
        _targetPos.add(right.clone().scale(_joystickX * spd));
      }

      // 床・天井・壁コライダーを適用
      if (window.Collider && Collider.isReady() && Collider.isEnabled()) {
        var resolved = Collider.resolvePosition(_targetPos, 1.0);
        // XZ: 壁補正は即時適用
        _targetPos.x = resolved.x;
        _targetPos.z = resolved.z;
        // Y: 壁付近で床高さマップが誤った大きな値を返す場合に急上昇するのを防ぐ
        // 上方向は最大 3m/s、下方向は 6m/s でクランプ（家具の上端などで瞬間的に頭が
        // 押し下げられた際の「がくん」を防ぎつつ、階段降りはほぼ即時に追従させる）
        var maxUpPerFrame   = 3.0 * dt;
        var maxDownPerFrame = 6.0 * dt;
        if (resolved.y > _targetPos.y) {
          _targetPos.y = Math.min(resolved.y, _targetPos.y + maxUpPerFrame);
        } else if (resolved.y < _targetPos.y) {
          _targetPos.y = Math.max(resolved.y, _targetPos.y - maxDownPerFrame);
        } else {
          _targetPos.y = resolved.y;
        }
      }

      // Exponential lerp（フレームレート非依存）
      var tPos = 1 - Math.exp(-SMOOTH_POS * dt);
      var tRot = 1 - Math.exp(-SMOOTH_ROT * dt);
      _pos.set(
        _pos.x + (_targetPos.x - _pos.x) * tPos,
        _pos.y + (_targetPos.y - _pos.y) * tPos,
        _pos.z + (_targetPos.z - _pos.z) * tPos
      );
      _yaw   += (_targetYaw   - _yaw)   * tRot;
      _pitch += (_targetPitch - _pitch) * tRot;

      applyTransform();
    },

    /** 現在の移動速度を取得 */
    getMoveSpeed: function () { return _moveSpeed; },

    /** 移動速度を設定 */
    setMoveSpeed: function (v) {
      _moveSpeed = clamp(v, _moveSpeedMin, _moveSpeedMax);
    },

    /** カメラ位置を設定（即時テレポート） */
    setPosition: function (x, y, z) {
      _targetPos.set(x, y, z);
      _pos.set(x, y, z);
    },

    /** オービット注視点を設定 */
    setOrbitTarget: function (x, y, z) {
      _orbitTarget.set(x, y, z);
    },

    /** 現在の位置・向きを取得（コンパニオン JSON 生成用） */
    getState: function () {
      return {
        x:     Math.round(_targetPos.x * 1000) / 1000,
        y:     Math.round(_targetPos.y * 1000) / 1000,
        z:     Math.round(_targetPos.z * 1000) / 1000,
        yaw:   Math.round(_targetYaw   * 10)   / 10,
        pitch: Math.round(_targetPitch * 10)   / 10
      };
    },

    /** モバイル上下ボタンから呼ぶ (-1=下降 / 0=停止 / 1=上昇) */
    setVertical: function (v) {
      _mobileVertical = v;
    },

    /** バーチャルジョイスティックから呼ぶ (x: 左右, y: 前後・画面座標) */
    setJoystick: function (x, y) {
      _joystickX = x;
      _joystickY = y;
    },

    /** 位置・向きを即時セット（コンパニオン JSON 適用用） */
    teleport: function (x, y, z, yaw, pitch) {
      _targetPos.set(x, y, z);  _pos.set(x, y, z);
      _targetYaw   = yaw   || 0; _yaw   = yaw   || 0;
      _targetPitch = pitch || 0; _pitch = pitch || 0;
      applyTransform();
    },

    /**
     * パノラマモード: 位置を center に固定し、回転入力だけ受け付ける
     * lock=false で通常モードに戻す
     * @param {boolean} lock
     * @param {{x:number,y:number,z:number}} [center]
     */
    setLockPosition: function (lock, center) {
      _lockPosition = !!lock;
      if (lock) {
        var c = center || { x: 0, y: 1.6, z: 0 };
        _lockedPos.set(c.x, c.y, c.z);
        _targetPos.copy(_lockedPos);
        _pos.copy(_lockedPos);
      }
    }
  };
}());
