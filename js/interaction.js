/* =========================================================
 * interaction.js — 鼠标交互：拾取、拖拽、工具模式
 * 命中：手柄 > 人眼 > 立方体 > 画布 > 空
 * ========================================================= */
PP.Interaction = {
  dragging: null, // { type: 'move' | 'rotate' | 'scale' | 'orbit' | 'eyedir' } + 状态
  lastX: 0, lastY: 0,
  _pinch: null,   // { startDist, startCameraDist } 双指捏合缩放状态
  _touching: false,
};

// 命中检测：按优先级取命中（人眼 > 立方体 > 画布），同优先级取更近者
PP.Interaction.pick = function (ray) {
  const app = PP.App;
  const eye = app.eye;
  let best = null; // { prio, distance, type, id }
  const consider = (prio, distance, type, id) => {
    if (!best || prio > best.prio || (prio === best.prio && distance < best.distance)) {
      best = { prio, distance, type, id };
    }
  };
  const hitEye = M3.raySphere(ray.origin, ray.dir, eye.pos, 0.6);
  if (hitEye !== null) consider(3, hitEye, 'eye', null);
  for (const cube of app.cubes) {
    // OBB 精确命中：旋转后的立方体也能点中“真实形状”，避免点到 AABB 空角
    const t = M3.rayOBB(ray.origin, ray.dir, cube.position, cube.quat, cube.size / 2);
    if (t !== null) consider(2, t, 'cube', cube.id);
  }
  const planeHit = M3.rayPlane(ray.origin, ray.dir, app.canvas.center, app.canvas.normal);
  if (planeHit && planeHit.t >= 0) {
    const wp = M3.add(ray.origin, M3.scale(ray.dir, planeHit.t));
    const loc = M3.pointOnCanvas(wp, app.canvas, M3.canvasBasis(app.canvas));
    if (loc.on) consider(1, planeHit.t, 'canvas', null);
  }
  return best;
};

// 沿平行于屏幕平面拖动目标点
PP.Interaction.dragAlongScreen = function (origin, offset, basis) {
  // 拖动 = 在 right-up 平面上投影
  const r = basis.right, u = basis.up;
  const worldOffset = M3.add(M3.scale(r, offset.x), M3.scale(u, offset.y));
  return M3.add(origin, worldOffset);
};

/* ==================== 事件绑定入口 ==================== */
PP.Interaction.bindEvents = function (canvas) {
  canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
  window.addEventListener('mousemove', (e) => this.onMouseMove(e));
  window.addEventListener('mouseup', () => this.onMouseUp());
  window.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  window.addEventListener('keydown', (e) => this.onKeydown(e));

  // 触控：单指 = 等价于鼠标操作（移动/旋转/缩放/选中），双指 = 捏合缩放
  canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
  canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
  canvas.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false });
  canvas.addEventListener('touchcancel', () => { this.dragging = null; this._pinch = null; this._touching = false; });
};

/* ==================== 触控事件（映射到鼠标逻辑） ==================== */
PP.Interaction.onTouchStart = function (e) {
  e.preventDefault();
  this._touching = true;
  if (e.touches.length === 1) {
    const t = e.touches[0];
    this._simulateMouse('down', t.clientX, t.clientY);
  } else if (e.touches.length >= 2) {
    // 第二根手指落下：取消正在进行的对象拖拽，切换为捏合缩放
    this.dragging = null;
    const a = e.touches[0], b = e.touches[1];
    this._pinch = {
      startDist: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
      startDistCam: PP.App.camera.dist,
    };
  } else {
    this._touching = e.touches.length > 0;
  }
};

PP.Interaction.onTouchMove = function (e) {
  e.preventDefault();
  if (!this._touching) return;
  // 双指：捏合缩放（距离变大为放大，即 dist 减小）
  if (this._pinch && e.touches.length >= 2) {
    const a = e.touches[0], b = e.touches[1];
    const d = Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));
    PP.App.camera.dist = M3.clamp(this._pinch.startDistCam * (this._pinch.startDist / d), 10, 60);
    return;
  }
  if (this._pinch) {
    // 由双指回到单指：重置起点，避免画面瞬移
    this.dragging = null; this._pinch = null;
    const t = e.touches[0];
    const rect = PP.Renderer.ctx.canvas.getBoundingClientRect();
    this.lastX = t.clientX - rect.left; this.lastY = t.clientY - rect.top;
    return;
  }
  if (e.touches.length === 1) {
    const t = e.touches[0];
    this._simulateMouse('move', t.clientX, t.clientY);
  }
};

PP.Interaction.onTouchEnd = function (e) {
  e.preventDefault();
  this._pinch = null;
  if (e.touches.length === 0) {
    this._touching = false;
    this._simulateMouse('up', 0, 0);
  } else if (e.touches.length === 1) {
    const t = e.touches[0];
    const rect = PP.Renderer.ctx.canvas.getBoundingClientRect();
    this.lastX = t.clientX - rect.left; this.lastY = t.clientY - rect.top;
  }
};

// 把触控坐标包装成鼠标事件对象，复用现有交互逻辑
PP.Interaction._simulateMouse = function (type, x, y) {
  const canvas = PP.Renderer.ctx.canvas;
  const ev = {
    clientX: x, clientY: y, button: 0,
    preventDefault() {},
    target: canvas,
  };
  if (type === 'down') this.onMouseDown(ev);
  else if (type === 'move') this.onMouseMove(ev);
  else this.onMouseUp(ev);
};

PP.Interaction.onMouseDown = function (e) {
  this._pending = null; // 重置 Shift 点击/拖动延迟判定
  const rect = PP.Renderer.ctx.canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  this.lastX = mx; this.lastY = my;

  const btn = e.button;
  // 右键/中键：人眼视图下旋转视线，否则临时环绕视图
  if (btn === 1 || btn === 2) {
    this.startBlankDrag();
    e.preventDefault();
    return;
  }
  if (btn !== 0) return;

  const ray = PP.Renderer.screenToWorld(mx, my);
  const pick = this.pick(ray);
  const tool = PP.App.tool;

  // 人眼视图：select 工具点击选中/取消；move/rotate/scale 可操作立方体；
  // 其余（画布/空白）拖动旋转视线
  if (PP.App.eyeView) {
    if (tool === 'select') {
      if (pick && pick.type === 'cube') {
        if (e.shiftKey) this.toggleMultiSelect(pick.id);
        else PP.setSelected([pick.id]); // 普通点击=单选；再次点击已选物体保持选中
      } else {
        PP.setSelected([]); // 点击画布/空白都取消选中
      }
      PP.UI.updateSelectionPanel();
      this.startBlankDrag(); // eyeView → type='eyedir'，旋转视线
      e.preventDefault();
      return;
    }
    // 移动/旋转/缩放：命中立方体 → 对象级操作
    if (pick && pick.type === 'cube') {
      PP.setSelected([pick.id]);
      PP.UI.updateSelectionPanel();
      if (tool === 'move') {
        this.dragging = { type: 'move', target: 'cube', id: pick.id };
        e.preventDefault();
        return;
      }
      if (tool === 'rotate') {
        this.dragging = {
          type: 'rotate', target: 'cube', id: pick.id,
          startYaw: PP.App.eye.yaw, startPitch: PP.App.eye.pitch,
        };
        e.preventDefault();
        return;
      }
      if (tool === 'scale') {
        this.dragging = {
          type: 'scale', target: 'cube', id: pick.id,
          startSize: PP.findCube(pick.id).size,
          startX: mx,
        };
        e.preventDefault();
        return;
      }
    }
    // 画布/空白：取消选中 + 旋转视线（与 select 工具保持一致，避免选中残留）
    PP.setSelected([]);
    PP.UI.updateSelectionPanel();
    this.startBlankDrag();
    e.preventDefault();
    return;
  }

  // 选择工具：Shift+点击=多选切换，Shift+拖动=平移；左键拖动=旋转视图；点击=选中
  if (tool === 'select') {
    if (e.shiftKey) {
      // 点击/平移二义：先记录 pending，等 mouseup（未移动=点击）或 mousemove（移动=平移）判定
      this._pending = {
        shift: true,
        pick,
        x: mx, y: my,
        startTarget: M3.v3(PP.App.camera.target.x, PP.App.camera.target.y, PP.App.camera.target.z),
      };
      e.preventDefault();
      return;
    }
    if (pick && pick.type === 'cube') {
      // 普通点击 → 单选该物体
      PP.setSelected([pick.id]);
    } else if (!pick) {
      // 点击空白 → 取消选中
      PP.setSelected([]);
    }
    PP.UI.updateSelectionPanel();
    this.startBlankDrag(); // 拖动旋转视图 / 人眼视图下转视线
    e.preventDefault();
    return;
  }

  // 点击立方体 → 选中（任何工具下都生效）
  if (pick && pick.type === 'cube') {
    PP.setSelected([pick.id]);
    PP.UI.updateSelectionPanel();
  }

  // 命中对象 → 对象级操作
  if (pick) {
    if (tool === 'move') {
      this.dragging = { type: 'move', target: pick.type, id: (pick.type === 'cube' ? pick.id : null) };
      e.preventDefault();
      return;
    }
    if (tool === 'rotate') {
      this.dragging = {
        type: 'rotate', target: pick.type, id: (pick.type === 'cube' ? pick.id : null),
        startYaw: PP.App.eye.yaw, startPitch: PP.App.eye.pitch,
      };
      e.preventDefault();
      return;
    }
    if (tool === 'scale' && pick.type === 'cube') {
      this.dragging = {
        type: 'scale', target: pick.type, id: pick.id,
        startSize: PP.findCube(pick.id).size,
        startX: mx, // 记录拖拽起点，缩放按累积位移计算
      };
      e.preventDefault();
      return;
    }
    // 缩放工具命中人眼/画布 → 落到空白逻辑（旋转视图）
  }

  // 空白处：取消选中 + 旋转视图（人眼视图下旋转视线方向）
  if (!pick) {
    PP.setSelected([]);
    PP.UI.updateSelectionPanel();
  }
  this.startBlankDrag();
  e.preventDefault();
};

// Shift+点击：切换该物体的多选状态（已在集合中→移除，否则加入）
PP.Interaction.toggleMultiSelect = function (id) {
  const ids = PP.App.selectedIds || [];
  if (ids.includes(id)) {
    PP.setSelected(ids.filter((i) => i !== id));
  } else {
    PP.setSelected(ids.concat([id]));
  }
};

// 空白处拖动的通用入口：人眼视图下旋转视线，否则环绕视图
PP.Interaction.startBlankDrag = function () {
  if (PP.App.eyeView) {
    this.dragging = { type: 'eyedir', startYaw: PP.App.eye.yaw, startPitch: PP.App.eye.pitch };
  } else {
    this.dragging = { type: 'orbit', startYaw: PP.App.camera.yaw, startPitch: PP.App.camera.pitch };
  }
};

PP.Interaction.onMouseMove = function (e) {
  const rect = PP.Renderer.ctx.canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  // Shift 待定（点击/平移二义）：一旦移动超过阈值即升级为平移，否则保持点击候选
  if (this._pending && this._pending.shift && Math.hypot(mx - this._pending.x, my - this._pending.y) > 4) {
    const p = this._pending;
    this._pending = null;
    this.dragging = { type: 'pan', startTarget: p.startTarget };
  }
  if (!this.dragging) return;
  const dx = mx - this.lastX, dy = my - this.lastY;
  const basis = PP.Renderer.basis;

  if (this.dragging.type === 'pan') {
    // Shift+拖动 → 平移视点：沿屏幕 left/up 方向移动 target（反向以贴合"拖画布=画布跟着走"）
    const cam = PP.App.camera;
    const fov = PP.Renderer.fov * Math.PI / 180;
    const k = (2 * cam.dist * Math.tan(fov / 2)) / PP.Renderer.H;
    cam.target = this.dragAlongScreen(this.dragging.startTarget, { x: -dx * k, y: dy * k }, basis);
    return;
  }

  if (this.dragging.type === 'orbit') {
    const speed = 0.005;
    // 右拖 = yaw 减小 → 立方体向左转（符合直觉：向右拖 = 相机向左绕行）
    PP.App.camera.yaw = this.dragging.startYaw - dx * speed;
    PP.App.camera.pitch = M3.clamp(this.dragging.startPitch + dy * speed, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    return;
  }

  if (this.dragging.type === 'eyedir') {
    // 人眼视图下：拖动控制视线方向（yaw 水平 360°，pitch 俯仰）。
    // 符号与视口环绕一致：右拖=画面右移、下拖=画面下移（"拖画布=画布跟着走"）
    const speed = 0.005;
    PP.App.eye.yaw = this.dragging.startYaw + dx * speed;
    PP.App.eye.pitch = M3.clamp(this.dragging.startPitch + dy * speed, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    PP.setEyeDir();
    return;
  }

  if (this.dragging.type === 'move') {
    const o = (this.dragging.target === 'eye') ? PP.App.eye.pos
      : (this.dragging.target === 'canvas') ? PP.App.canvas.center
      : PP.findCube(this.dragging.id).position;
    // 屏幕像素 → 世界比例：视口用相机距离；人眼视图相机距离失效，改用 人眼→目标 距离
    const D = PP.App.eyeView ? Math.max(0.1, M3.dist(PP.App.eye.pos, o)) : PP.App.camera.dist;
    const k = this._worldPerPixel(D);
    const newPos = this.dragAlongScreen(o, { x: dx * k, y: -dy * k }, basis);
    if (this.dragging.target === 'eye') PP.App.eye.pos = newPos;
    else if (this.dragging.target === 'canvas') PP.App.canvas.center = newPos;
    else PP.findCube(this.dragging.id).position = newPos;
  } else if (this.dragging.type === 'rotate') {
    const speed = 0.006;
    if (this.dragging.target === 'eye') {
      // 拖动控制视线方向：右拖转向右，上拖抬头；yaw 可水平 360°
      PP.App.eye.yaw = this.dragging.startYaw - dx * speed;
      PP.App.eye.pitch = M3.clamp(this.dragging.startPitch - dy * speed, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      PP.setEyeDir();
    } else if (this.dragging.target === 'cube') {
      const cube = PP.findCube(this.dragging.id);
      let qy = M3.qAxisAngle(M3.UP, -dx * speed);
      let qx = M3.qAxisAngle(basis.right, dy * speed);
      let q = M3.qMul(qy, qx);
      // 累积后归一化，防止浮点漂移导致变形
      cube.quat = M3.qNorm(M3.qMul(q, cube.quat));
    } else if (this.dragging.target === 'canvas') {
      if (!PP.App.canvas.lockToEye) {
        // 类似人眼旋转，但法线在 world 空间
        let qy = M3.qAxisAngle(M3.UP, -dx * speed);
        let qx = M3.qAxisAngle(basis.right, dy * speed);
        let q = M3.qMul(qy, qx);
        PP.App.canvas.normal = M3.norm(M3.qRotate(q, PP.App.canvas.normal));
      }
    }
  } else if (this.dragging.type === 'scale') {
    // 对数缩放：水平拖动改变 size（按从拖拽起点累积的位移计算，而非单帧增量），下限 0.2
    const cube = PP.findCube(this.dragging.id);
    const totalDx = mx - this.dragging.startX;
    const s = this.dragging.startSize * Math.pow(1.006, totalDx);
    cube.size = Math.max(0.2, s);
    if (PP.UI.updateSelectionPanel) PP.UI.updateSelectionPanel();
  }

  this.lastX = mx; this.lastY = my;
};

PP.Interaction.onMouseUp = function () {
  // Shift+点击（未移动成拖动）→ 多选切换
  if (this._pending && this._pending.shift) {
    const p = this._pending;
    this._pending = null;
    if (p.pick && p.pick.type === 'cube') {
      this.toggleMultiSelect(p.pick.id);
    } else {
      PP.setSelected([]); // Shift+点击空白 → 清空
    }
    PP.UI.updateSelectionPanel();
  }
  this.dragging = null;
};

PP.Interaction.onWheel = function (e) {
  // 侧边栏等 UI 区域交给浏览器原生滚动（不拦截、不 preventDefault）
  // e.target 可能不是 Node（如 window/document），先做类型判断避免 contains 抛错
  const panel = document.getElementById('panel');
  const t = e.target;
  if (panel && t && typeof t.nodeType === 'number' && panel.contains(t)) return;
  e.preventDefault();
  const app = PP.App;
  const sens = app.options.zoomSensitivity;

  // 触控板捏合缩放：macOS 以 ctrlKey + wheel 事件发送（所有工具统一）
  if (e.ctrlKey || e.metaKey) {
    const raw = M3.clamp(e.deltaY, -240, 240);
    const k = Math.exp(raw * sens * 0.0012);
    app.camera.dist = M3.clamp(app.camera.dist * k, 10, 60);
    return;
  }

  // 触控板双指手势（所有工具统一）：
  // 双指滚动 = 旋转视角，Shift+双指滚动 = 平移（与鼠标拖动方向一致）。
  // 触控板双指滚动单帧位移很小；物理滚轮一档很大（~100px+）→ 走下方缩放分支
  const px = this._wheelPixels(e);
  const isTrackpad = Math.abs(px.dx) + Math.abs(px.dy) < 80;
  if (isTrackpad) {
    if (e.shiftKey) this._trackpadPan(px.dx, px.dy);
    else this._trackpadOrbit(px.dx, px.dy);
    return;
  }

  // 物理滚轮缩放（所有工具统一）
  const raw = M3.clamp(e.deltaY, -240, 240);
  const k = Math.exp(raw * sens * 0.0012);
  app.camera.dist = M3.clamp(app.camera.dist * k, 10, 60);
};

// 把 wheel 增量归一化为像素（deltaMode: 0=像素, 1=行, 2=页）
PP.Interaction._wheelPixels = function (e) {
  let dx = e.deltaX || 0, dy = e.deltaY || 0;
  if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
  else if (e.deltaMode === 2) { dx *= PP.Renderer.W; dy *= PP.Renderer.H; }
  return { dx, dy };
};

// 触控板双指滚动 → 旋转视角（与鼠标拖动同向；人眼视图下转视线方向）
// 触控板自然滚动的 deltaX/deltaY 与鼠标位移符号相反（手指向右→deltaX<0 等），
// 因此这里与鼠标拖拽公式符号相反，才能得到相同的手感
PP.Interaction._trackpadOrbit = function (dx, dy) {
  const app = PP.App;
  const speed = 0.005;
  if (app.eyeView) {
    app.eye.yaw = app.eye.yaw - dx * speed;
    app.eye.pitch = M3.clamp(app.eye.pitch - dy * speed, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    PP.setEyeDir();
    return;
  }
  app.camera.yaw = app.camera.yaw + dx * speed;
  app.camera.pitch = M3.clamp(app.camera.pitch - dy * speed, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
};

// 触控板 Shift+双指滚动 → 平移视点（与鼠标 Shift+拖动同向：画面跟随手指）
PP.Interaction._trackpadPan = function (dx, dy) {
  const app = PP.App;
  const basis = PP.Renderer.basis;
  if (app.eyeView) {
    // 人眼视图下平移人眼本身（沿屏幕方向），比例取 人眼→画布 的距离
    const D = M3.dist(app.eye.pos, app.canvas.center);
    const k = this._worldPerPixel(D);
    const move = M3.add(M3.scale(basis.right, dx * k), M3.scale(basis.up, -dy * k));
    app.eye.pos = M3.add(app.eye.pos, move);
    return;
  }
  const cam = app.camera;
  const k = this._worldPerPixel(cam.dist);
  const move = M3.add(M3.scale(basis.right, dx * k), M3.scale(basis.up, -dy * k));
  cam.target = M3.add(cam.target, move);
};

// 屏幕像素 → 世界距离 的比例。
// fov 过大会使 tan 发散（尤其人眼视图 fov=2×视锥角，接近 90° 时 tan→∞），
// 导致拖动物体因换算比例过大而"飞走"。限幅换算用的半视场角以保持可控。
PP.Interaction._worldPerPixel = function (D) {
  const fov = PP.Renderer.fov * Math.PI / 180;
  const half = M3.clamp(fov / 2, 0.05, 55 * Math.PI / 180);
  return (2 * D * Math.tan(half)) / PP.Renderer.H;
};

PP.Interaction.onKeydown = function (e) {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    // 删除全部选中物体（支持多选）
    const ids = PP.App.selectedIds || [];
    for (const id of ids) {
      if (PP.findCube(id)) PP.removeCube(id);
    }
    PP.setSelected([]);
    PP.UI.updateSelectionPanel();
  }
  if (e.key === 'Escape') {
    PP.setSelected([]);
    PP.UI.updateSelectionPanel();
  }
};
