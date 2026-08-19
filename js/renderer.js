/* =========================================================
 * renderer.js — 3D→2D 渲染管线 + 各元素绘制
 * 使用 Canvas 2D，画家算法（由远及近排序）
 * ========================================================= */
PP.Renderer = {
  ctx: null,
  W: 0, H: 0,
  basis: null, // 视口相机基
  fov: 45,     // 有效 FOV（人眼视图下 = 视锥角）
  closes: [],  // 排序后的绘制深度
  _lastT: 0,
};

// 初始化
PP.Renderer.init = function (canvas) {
  this.ctx = canvas.getContext('2d');
  this.resize(canvas);
  this._lastT = performance.now();
};

PP.Renderer.resize = function (canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  this.W = rect.width;
  this.H = rect.height;
  canvas.width = Math.round(this.W * dpr);
  canvas.height = Math.round(this.H * dpr);
  this.ctx = canvas.getContext('2d');
  this.ctx.scale(dpr, dpr);
};

// 世界点 → 屏幕像素 (x,y) + 深度 z（相机空间）
// 人眼视图 + 非平面画布 → 鱼眼投影（球/圆柱），用于展示曲面上的灭点形成
PP.Renderer.worldToScreen = function (wp) {
  const cam = PP.App.camera;
  const cs = M3.toCamSpace(wp, cam.pos, this.basis);
  if (cs.z < 0.1) return null; // 在相机后方
  const shape = PP.App.canvas.shape || 'flat';
  if (PP.App.eyeView && shape !== 'flat') {
    const sp = this._fisheyeScreen(cs);
    if (!sp) return null;
    return { x: sp.x, y: sp.y, z: cs.z };
  }
  const p = M3.projectCam(cs, this.fov, this.W / this.H);
  return {
    x: (p.sx + 1) * 0.5 * this.W,
    y: (-p.sy + 1) * 0.5 * this.H,
    z: cs.z,
  };
};

// 鱼眼：把相机空间方向(cs, forward=+z)映射到屏幕像素
PP.Renderer._fisheyeScreen = function (cs) {
  const W = this.W, H = this.H;
  const fovHalf = (this.fov * Math.PI / 180) / 2;
  const shape = PP.App.canvas.shape;
  const aspect = W / H;
  if (shape === 'sphere' || shape === 'hemisphere') {
    // 等距球面投影：半径按离轴角线性映射，方向角决定屏幕角度
    const z = cs.z;
    if (z <= 1e-4) return null;
    const r = Math.hypot(cs.x, cs.y);
    const alpha = Math.atan2(r, z);          // 离轴角 0..90°
    const rad = (alpha / fovHalf) * (H / 2); // 视锥边缘 → 屏幕垂直半高
    const beta = Math.atan2(-cs.y, cs.x);    // 相机 y 向上、屏幕 y 向下 → 取反，避免上下颠倒
    return { x: W / 2 + rad * Math.cos(beta), y: H / 2 + rad * Math.sin(beta) };
  }
  if (shape === 'cylinder') {
    // 柱面展开：绕圆柱轴（=画布 v 方向）的方位角 → x，相对 (u,n) 平面的俯仰角 → y
    const cb = M3.canvasBasis(PP.App.canvas);
    const b = this.basis;
    // 相机空间方向 → 世界方向
    const w = M3.add(
      M3.add(M3.scale(b.right, cs.x), M3.scale(b.up, cs.y)),
      M3.scale(b.forward, cs.z)
    );
    const du = M3.dot(w, cb.u), dv = M3.dot(w, cb.v), dn = M3.dot(w, cb.n);
    const lh = Math.hypot(du, dn);
    if (lh < 1e-6) return null; // 沿柱轴方向，方位角不确定
    const theta = Math.atan2(du, dn);   // 方位角（n=0，u 方向为 +）
    const phi = Math.atan2(dv, lh);     // 俯仰角（沿轴方向 ±90°）
    const fovHalfH = Math.atan(Math.tan(fovHalf) * aspect); // 匹配视锥水平视场
    const fovHalfV = fovHalf;
    return {
      x: W / 2 + (theta / fovHalfH) * (W / 2),
      y: H / 2 + (phi / fovHalfV) * (H / 2),
    };
  }
  return null;
};

// 屏幕 → 世界射线
PP.Renderer.screenToWorld = function (mx, my) {
  const app = PP.App;
  // 鱼眼（球/圆柱）视图下屏幕位置由 _fisheyeScreen 生成，
  // 必须用其逆映射构造射线，拾取位置才能与渲染位置一致
  if (app.eyeView && (app.canvas.shape || 'flat') !== 'flat') {
    return this._fisheyeRay(mx, my);
  }
  return M3.screenRay(mx, my, app.camera, this.fov, this.W, this.H, this.basis);
};

// 鱼眼（球/圆柱）视图：屏幕像素 → 世界射线（_fisheyeScreen 的逆映射）
PP.Renderer._fisheyeRay = function (mx, my) {
  const W = this.W, H = this.H;
  const fovHalf = (this.fov * Math.PI / 180) / 2;
  const shape = PP.App.canvas.shape;
  const cam = PP.App.camera;
  const origin = M3.v3(cam.pos.x, cam.pos.y, cam.pos.z);
  if (shape === 'sphere' || shape === 'hemisphere') {
    const dx = mx - W / 2, dy = my - H / 2;
    const rad = Math.hypot(dx, dy);
    const beta = Math.atan2(dy, dx);          // 屏幕 y 向下
    const alpha = Math.min((rad / (H / 2)) * fovHalf, Math.PI / 2 - 1e-3);
    const s = Math.sin(alpha), c = Math.cos(alpha);
    // 相机空间：x=右、y=上、z=前；与 _fisheyeScreen 的 y 取反对应
    const dirCam = { x: s * Math.cos(beta), y: -s * Math.sin(beta), z: c };
    const dir = M3.norm(M3.add(
      M3.add(M3.scale(this.basis.right, dirCam.x), M3.scale(this.basis.up, dirCam.y)),
      M3.scale(this.basis.forward, dirCam.z)
    ));
    return { origin, dir };
  }
  // 圆柱：与 _fisheyeScreen 的柱面展开对应（画布局部坐标 → 世界方向）
  const aspect = W / H;
  const fovHalfH = Math.atan(Math.tan(fovHalf) * aspect);
  const theta = ((mx - W / 2) / (W / 2)) * fovHalfH;
  const phi = ((my - H / 2) / (H / 2)) * fovHalf;
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const cb = M3.canvasBasis(PP.App.canvas);
  const dir = M3.norm(M3.add(
    M3.add(M3.scale(cb.u, cp * Math.sin(theta)), M3.scale(cb.v, sp)),
    M3.scale(cb.n, cp * Math.cos(theta))
  ));
  return { origin, dir };
};

/* ==================== 主渲染循环 ==================== */
PP.Renderer.render = function () {
  try {
    this._renderCore();
  } catch (e) {
    try { this._drawErr('render: ' + (e && e.message)); } catch (_) { /* ignore */ }
    if (window.console) console.error('render error:', e);
  }
};

// 临时：把渲染错误绘制到画布，便于截图诊断
PP.Renderer._drawErr = function (msg) {
  if (!this.ctx) return;
  this.ctx.save();
  this.ctx.clearRect(0, 0, this.W, this.H);
  this.ctx.fillStyle = '#10151d';
  this.ctx.fillRect(0, 0, this.W, this.H);
  this.ctx.fillStyle = '#ff5252';
  this.ctx.font = '13px Menlo, monospace';
  this.ctx.fillText('ERR: ' + msg, 10, 20);
  this.ctx.restore();
};

PP.Renderer._renderCore = function () {
  const ctx = this.ctx;
  const W = this.W, H = this.H;
  const app = PP.App;

  const now = performance.now();
  const dt = (now - this._lastT) / 1000;
  this._lastT = now;

  // 更新视口相机（含人眼视图锁定与过渡动画）
  this.updateCamera(dt);
  // 更新画布锁定
  PP.updateCanvasNormal();

  // 清空
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#10151d';
  ctx.fillRect(0, 0, W, H);

  app.warnings = [];

  // 收集所有绘制元素 → 按深度排序
  const drawList = [];
  const addDraw = (depth, fn) => { drawList.push({ depth, fn }); };

  // ---- 1. 画布平面 ----
  this.drawCanvasPlane(addDraw);

  // ---- 2. 立方体面 ----
  for (const cube of app.cubes) {
    this.drawCubeFaces(cube, addDraw);
  }

  // ---- 3. 投影连线与交点 ----
  if (app.options.showProjectionLines) {
    for (const cube of app.cubes) {
      this.drawProjectionLines(cube, addDraw);
    }
  }

  // ---- 4. 画布上的透视图形 ----
  if (app.options.showPerspective) {
    for (const cube of app.cubes) {
      this.drawPerspectiveShape(cube, addDraw);
    }
  }

  // ---- 5. 立方体线框 ----
  for (const cube of app.cubes) {
    this.drawCubeWireframe(cube, addDraw);
  }

  // ---- 6. 视线 ----
  if (app.options.showSightLine) {
    this.drawSightLine(addDraw);
  }

  // ---- 7. 视锥 ----
  if (app.options.showFrustum) {
    this.drawFrustum(addDraw);
  }

  // ---- 8. 平行线与灭点 ----
  const sel = PP.getSelectedCube();
  if (sel && app.options.showParallelLines) {
    this.drawParallelLines(sel, addDraw);
  }
  if (sel && app.options.showVanishingPoints) {
    this.drawVanishingPoints(sel, addDraw);
  }
  if (sel && app.options.showCanvasVanishingPoints) {
    this.drawCanvasVanishingPoints(sel, addDraw);
  }

  // ---- 9. 人眼 ----
  this.drawEye(addDraw);

  // ---- 10. 标签 ----
  if (app.options.showLabels) {
    for (const cube of app.cubes) {
      this.drawLabel(cube, addDraw);
    }
    this.drawEyeLabel(addDraw);
    this.drawCanvasLabel(addDraw);
    if (sel && app.options.showVanishingPoints) {
      this.drawVPLabels(sel, addDraw);
    }
    if (sel && app.options.showCanvasVanishingPoints) {
      this.drawCVPLabels(sel, addDraw);
    }
  }

  // 排序：按深度降序（远的先画）
  drawList.sort((a, b) => b.depth - a.depth);
  ctx.save();
  for (const d of drawList) d.fn(ctx);
  ctx.restore();
};

/* ==================== 视口相机覆盖（人眼视图 / 过渡动画） ==================== */
// 人眼视图下，把相机 FOV 对齐到视锥：让视锥底面（画布上的正圆）正好充满视野
// 视锥半角 frustumAngle → 圆外接矩形同时容纳垂直与水平两个方向
PP.Renderer.computeEyeFov = function () {
  const angle = PP.App.options.frustumAngle * (Math.PI / 180);
  const aspect = this.W / Math.max(1, this.H);
  // 要"正好容纳"，取受裁剪更紧的那个方向为基准：
  // 水平半视场 = atan(tan(V/2) * aspect)；令窄的那一维=angle 即可两者都容纳
  const halfV = aspect >= 1
    ? angle                                   // 宽屏：垂直是限制维
    : Math.atan(Math.tan(angle) / aspect);     // 竖屏：水平是限制维，反向放大垂直
  return halfV * (180 / Math.PI) * 2;
};

PP.Renderer.updateCamera = function (dt) {
  const app = PP.App;
  const anim = app.eyeViewAnim;
  if (anim) {
    anim.t += dt;
    const k = this._ease(Math.min(1, anim.t / anim.dur));
    if (anim.t >= anim.dur) {
      app.eyeViewAnim = null;
      if (anim.phase === 'in') {
        app.eyeView = true;
        this.basis = this._eyeViewBasis();
        this.fov = this.computeEyeFov();
      } else {
        app.eyeView = false;
        this.basis = M3.camSetup(app.camera);
        this.fov = app.camera.fov;
      }
      if (PP.UI.syncEyeViewButton) PP.UI.syncEyeViewButton();
      return;
    }
    const pos = M3.lerp(anim.fromPos, anim.toPos, k);
    const look = M3.lerp(anim.fromLook, anim.toLook, k);
    app.camera.pos = pos;
    this.basis = M3.basisFrom(pos, look, M3.UP);
    this.fov = anim.fromFov + (anim.toFov - anim.fromFov) * k;
    return;
  }
  if (app.eyeView) {
    this.basis = this._eyeViewBasis();
    this.fov = this.computeEyeFov();
    return;
  }
  this.basis = M3.camSetup(app.camera);
  this.fov = app.camera.fov;
};

// 人眼视图基：相机位置 = 人眼位置，看向视线方向（FOV 与视锥对齐）
PP.Renderer._eyeViewBasis = function () {
  const eye = PP.App.eye;
  PP.App.camera.pos = M3.v3(eye.pos.x, eye.pos.y, eye.pos.z);
  const look = M3.add(eye.pos, M3.scale(eye.dir, 100));
  return M3.basisFrom(eye.pos, look, M3.UP);
};

PP.Renderer._ease = function (t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
};

// 曲线细分段数：由用户“曲线光滑度”推导（scale 用于不同元素按比例取密度）
PP.Renderer._curveSeg = function (scale) {
  const s = PP.App.options.curveSmoothness || 20;
  return Math.max(3, Math.round(s * scale));
};

/* ==================== 绘制辅助 ==================== */
PP.Renderer._sc = function (wp) {
  if (!wp) return null;
  return this.worldToScreen(wp);
};
PP.Renderer._scVec = function (list) {
  return list.map((p) => this._sc(p)).filter((s) => s !== null);
};

/* ==================== 1. 画布（平面/球/圆柱） ==================== */
PP.Renderer.drawCanvasPlane = function (addDraw) {
  const c = PP.App.canvas;
  if (c.size <= 0) return; // size=0 → 隐藏画布
  const shape = c.shape || 'flat';
  if (shape === 'sphere') { this._drawSphereCanvas(addDraw); return; }
  if (shape === 'hemisphere') { this._drawHemisphereCanvas(addDraw); return; }
  if (shape === 'cylinder') { this._drawCylinderCanvas(addDraw); return; }
  this._drawFlatCanvas(addDraw);
};

// 平面画布：矩形 + 网格
PP.Renderer._drawFlatCanvas = function (addDraw) {
  const c = PP.App.canvas;
  const basis = M3.canvasBasis(c);
  const hw = (c.w * c.size) / 2, hh = (c.h * c.size) / 2;
  // 4 角
  const corners = [
    M3.add(c.center, M3.add(M3.scale(basis.u, -hw), M3.scale(basis.v, -hh))),
    M3.add(c.center, M3.add(M3.scale(basis.u, hw), M3.scale(basis.v, -hh))),
    M3.add(c.center, M3.add(M3.scale(basis.u, hw), M3.scale(basis.v, hh))),
    M3.add(c.center, M3.add(M3.scale(basis.u, -hw), M3.scale(basis.v, hh))),
  ];
  const sc = corners.map((p) => this._sc(p));
  if (sc.some((s) => !s)) return;
  const avgZ = sc.reduce((a, s) => a + s.z, 0) / sc.length;

  addDraw(avgZ, (ctx) => {
    ctx.beginPath();
    ctx.moveTo(sc[0].x, sc[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(sc[i].x, sc[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(100,150,255,0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(100,150,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 网格线
    ctx.strokeStyle = 'rgba(100,150,255,0.08)';
    ctx.lineWidth = 0.5;
    const gridN = 8;
    for (let i = 1; i < gridN; i++) {
      const t = -hw + ((c.w * c.size) / gridN) * i;
      const p1 = M3.add(c.center, M3.add(M3.scale(basis.u, t), M3.scale(basis.v, -hh)));
      const p2 = M3.add(c.center, M3.add(M3.scale(basis.u, t), M3.scale(basis.v, hh)));
      const s1 = this._sc(p1), s2 = this._sc(p2);
      if (s1 && s2) { ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke(); }
    }
    for (let i = 1; i < gridN; i++) {
      const t = -hh + ((c.h * c.size) / gridN) * i;
      const p1 = M3.add(c.center, M3.add(M3.scale(basis.u, -hw), M3.scale(basis.v, t)));
      const p2 = M3.add(c.center, M3.add(M3.scale(basis.u, hw), M3.scale(basis.v, t)));
      const s1 = this._sc(p1), s2 = this._sc(p2);
      if (s1 && s2) { ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke(); }
    }
  });
};

// 球形画布（球心=人眼）：三条正交大圆线框
PP.Renderer._drawSphereCanvas = function (addDraw) {
  const eye = PP.App.eye;
  const R = M3.dist(eye.pos, PP.App.canvas.center) * PP.App.canvas.size;
  const basis = M3.canvasBasis(PP.App.canvas);
  const N = 48;
  const rings = [
    // 在 eye 处相互正交的三个平面圈
    { a: basis.u, b: basis.v }, // 正对观察者的外缘
    { a: basis.n, b: basis.u },
    { a: basis.n, b: basis.v },
  ];
  for (const ring of rings) {
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      const d = M3.add(M3.scale(ring.a, Math.cos(th)), M3.scale(ring.b, Math.sin(th)));
      pts.push(M3.add(eye.pos, M3.scale(d, R)));
    }
    this._drawRing(addDraw, pts, 'rgba(100,150,255,0.28)');
  }
};

// 半球画布（球心=人眼，开口朝画布法线方向）：赤道圆 + 正面经线弧
PP.Renderer._drawHemisphereCanvas = function (addDraw) {
  const eye = PP.App.eye;
  const basis = M3.canvasBasis(PP.App.canvas);
  const n = basis.n;
  const R = M3.dist(eye.pos, PP.App.canvas.center) * PP.App.canvas.size;
  const N = 40;
  // 赤道（开口边缘）圆：⊥ n 平面内，过球心
  const eq = [];
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI * 2;
    const d = M3.add(M3.scale(basis.u, Math.cos(th)), M3.scale(basis.v, Math.sin(th)));
    eq.push(M3.add(eye.pos, M3.scale(d, R)));
  }
  this._drawRing(addDraw, eq, 'rgba(100,150,255,0.35)');
  // 正面四条经线弧：从顶端(+n)到赤道，各取 90° 半圆
  for (const w of [basis.u, M3.scale(basis.u, -1), basis.v, M3.scale(basis.v, -1)]) {
    const arc = [];
    for (let i = 0; i <= N / 2; i++) {
      const phi = (i / (N / 2)) * (Math.PI / 2); // 0..90°
      const d = M3.add(M3.scale(n, Math.cos(phi)), M3.scale(w, Math.sin(phi)));
      arc.push(M3.add(eye.pos, M3.scale(d, R)));
    }
    this._drawRing(addDraw, arc, 'rgba(100,150,255,0.24)');
  }
};

// 圆柱画布（轴=画布竖直方向 v，过 人眼；锁定画布时 v ⊥ 视线，母线 ⊥ 视线）
PP.Renderer._drawCylinderCanvas = function (addDraw) {
  const eye = PP.App.eye;
  const c = PP.App.canvas;
  const R = M3.dist(eye.pos, c.center) * c.size;
  const halfH = (c.h * c.size) / 2;
  const N = 40;
  const basis = M3.canvasBasis(c);
  const axis = basis.v;   // 圆柱轴 = 画布竖直方向
  // 底部 / 中部 / 顶部 的圆环（在 ⊥ 轴的平面内，轴过 人眼）
  for (const sy of [-1, 0, 1]) {
    const center = M3.add(eye.pos, M3.scale(axis, sy * halfH));
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      const p = M3.add(center, M3.add(M3.scale(basis.u, Math.cos(th) * R), M3.scale(basis.n, Math.sin(th) * R)));
      pts.push(p);
    }
    this._drawRing(addDraw, pts, 'rgba(100,150,255,0.22)');
  }
  // 母线（沿轴方向），围绕一圈
  for (let k = 0; k < 12; k++) {
    const th = (k / 12) * Math.PI * 2;
    const hor = M3.add(M3.scale(basis.u, Math.cos(th) * R), M3.scale(basis.n, Math.sin(th) * R));
    const pB = M3.add(M3.add(eye.pos, M3.scale(axis, -halfH)), hor);
    const pT = M3.add(M3.add(eye.pos, M3.scale(axis, halfH)), hor);
    const res = this._clipSegmentWorld(pB, pT);
    if (!res) continue;
    const avgZ = (res.a.z + res.b.z) / 2;
    addDraw(avgZ, (ctx) => {
      ctx.strokeStyle = 'rgba(100,150,255,0.20)';
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(res.a.x, res.a.y); ctx.lineTo(res.b.x, res.b.y); ctx.stroke();
    });
  }
};

PP.Renderer._drawRing = function (addDraw, pts, color) {
  const chain = [];
  for (const p of pts) {
    const s = this._sc(p);
    if (s) chain.push({ x: s.x, y: s.y, z: s.z });
  }
  if (chain.length < 2) return;
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i], b = chain[i + 1];
    const avgZ = (a.z + b.z) / 2;
    addDraw(avgZ, (ctx) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    });
  }
};

/* ==================== 2. 立方体面 ==================== */
PP.Renderer.drawCubeFaces = function (cube, addDraw) {
  const verts = PP.cubeVertices(cube);
  const fisheye = PP.App.eyeView && (PP.App.canvas.shape || 'flat') !== 'flat';
  if (fisheye) {
    // 鱼眼下表面轮廓也变形：采样 4 条边围成闭合路径再填充
    for (const face of PP.CUBE_FACES) {
      const world = [];
      const per = this._curveSeg(0.3);
      for (let e = 0; e < 4; e++) {
        const a = verts[face[e]], b = verts[face[(e + 1) % 4]];
        for (let k = 0; k < per; k++) world.push(M3.lerp(a, b, k / per));
      }
      const pts = this._projectPath(world);
      if (!pts) continue;
      const avgZ = pts.reduce((s, p) => s + p.z, 0) / pts.length;
      addDraw(avgZ, (ctx) => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.fillStyle = cube.color + '33'; // 20% 不透明度
        ctx.fill();
        ctx.strokeStyle = cube.color + '55';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      });
    }
    return;
  }
  const sc = verts.map((v) => this._sc(v));
  if (sc.some((s) => !s)) return;
  for (const face of PP.CUBE_FACES) {
    const pts = face.map((i) => sc[i]);
    const avgZ = pts.reduce((a, p) => a + p.z, 0) / pts.length;
    addDraw(avgZ, (ctx) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = cube.color + '33'; // 20% 不透明度
      ctx.fill();
      ctx.strokeStyle = cube.color + '55';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    });
  }
};

// 世界坐标点链 → 屏幕点链；任一点不可见（相机后方）返回 null
PP.Renderer._projectPath = function (worldPts) {
  const out = [];
  for (const p of worldPts) {
    const s = this._sc(p);
    if (!s) return null;
    out.push(s);
  }
  return out;
};

/* ==================== 3. 立方体线框 ==================== */
PP.Renderer.drawCubeWireframe = function (cube, addDraw) {
  const verts = PP.cubeVertices(cube);
  const fisheye = PP.App.eyeView && (PP.App.canvas.shape || 'flat') !== 'flat';
  const isSelected = PP.App.selectedId === cube.id;
  for (const edge of PP.CUBE_EDGES) {
    if (fisheye) {
      // 鱼眼下直线投影为曲线：采样 3D 棱 → 逐段裁剪绘制，与画布上的黄色透视图形对齐
      const vA = verts[edge[0]], vB = verts[edge[1]];
      const pts = [];
      const SEG = this._curveSeg(0.6);
      for (let k = 0; k <= SEG; k++) pts.push(M3.lerp(vA, vB, k / SEG));
      this._drawChain(addDraw, pts, (ctx) => {
        ctx.strokeStyle = isSelected ? '#fff' : cube.color;
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
      });
    } else {
      const p0 = this._sc(verts[edge[0]]), p1 = this._sc(verts[edge[1]]);
      if (!p0 || !p1) continue;
      const avgZ = (p0.z + p1.z) / 2;
      addDraw(avgZ, (ctx) => {
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.strokeStyle = isSelected ? '#fff' : cube.color;
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.stroke();
      });
    }
  }
  if (isSelected) {
    // 选中高亮光环
    const centerSc = this._sc(cube.position);
    if (centerSc) {
      addDraw(centerSc.z, (ctx) => {
        ctx.beginPath();
        ctx.arc(centerSc.x, centerSc.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      });
    }
  }
};

/* ==================== 4. 投影连线与交点 ==================== */
PP.Renderer.drawProjectionLines = function (cube, addDraw) {
  const app = PP.App;
  const verts = PP.cubeVertices(cube);
  const eyePos = app.eye.pos;
  const plane = app.canvas;

  for (const v of verts) {
    const res = M3.projectToCanvas(v, eyePos, plane);
    if (!res || res.t < 0) continue;
    // 交点
    const pSc = this._sc(res.point);
    const vSc = this._sc(v);
    const eSc = this._sc(eyePos);
    if (!pSc || !vSc || !eSc) continue;
    const avgZ = (pSc.z + vSc.z + eSc.z) / 3;

    addDraw(avgZ, (ctx) => {
      // 连线：人眼 → 物体顶点
      ctx.beginPath();
      ctx.moveTo(eSc.x, eSc.y);
      ctx.lineTo(vSc.x, vSc.y);
      ctx.strokeStyle = 'rgba(22, 160, 133, 0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // 连线：人眼 → 画布交点
      ctx.beginPath();
      ctx.moveTo(eSc.x, eSc.y);
      ctx.lineTo(pSc.x, pSc.y);
      ctx.strokeStyle = 'rgba(22, 160, 133, 0.5)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // 画布交点小圆点
      ctx.beginPath();
      ctx.arc(pSc.x, pSc.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#16a085';
      ctx.fill();
    });
  }
};

/* ==================== 5. 平行透视图形 ==================== */
PP.Renderer.drawPerspectiveShape = function (cube, addDraw) {
  const app = PP.App;
  const verts = PP.cubeVertices(cube);
  const eyePos = app.eye.pos;
  const plane = app.canvas;

  // 每条棱采样实际 3D 线段 → 投影到画布表面 → 连成（可能是曲线的）透视图形
  for (const edge of PP.CUBE_EDGES) {
    const vA = verts[edge[0]], vB = verts[edge[1]];
    const SURF = [];
    const SEG = this._curveSeg(1.2);
    let ok = true;
    for (let k = 0; k <= SEG; k++) {
      const s = M3.lerp(vA, vB, k / SEG); // 3D 边上的采样点
      const pr = M3.projectToCanvas(s, eyePos, plane);
      if (!pr || pr.t < 0) { ok = false; break; }
      SURF.push(pr.point);
    }
    if (!ok) continue;
    this._drawChain(addDraw, SURF, (ctx) => {
      ctx.strokeStyle = 'rgba(10, 15, 25, 0.95)';
      ctx.lineWidth = 5;
    });
    this._drawChain(addDraw, SURF, (ctx) => {
      ctx.strokeStyle = '#f1c40f';
      ctx.lineWidth = 2.5;
    });
  }
};

/* ==================== 6. 视线 ==================== */
PP.Renderer.drawSightLine = function (addDraw) {
  const eye = PP.App.eye;
  const plane = PP.App.canvas;
  const eSc = this._sc(eye.pos);
  if (!eSc) return;

  // 射线直到画布并略超出
  const res = M3.rayPlane(eye.pos, eye.dir, plane.center, plane.normal);
  if (!res) return;
  const end = M3.add(res.point, M3.scale(eye.dir, 2));
  const endSc = this._sc(end);
  if (!endSc) return;

  const avgZ = (eSc.z + endSc.z) / 2;
  addDraw(avgZ, (ctx) => {
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(eSc.x, eSc.y);
    ctx.lineTo(endSc.x, endSc.y);
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  });
};

/* ==================== 7. 视锥 ==================== */
PP.Renderer.drawFrustum = function (addDraw) {
  const app = PP.App;
  const eye = app.eye;
  const plane = app.canvas;
  const angle = app.options.frustumAngle * (Math.PI / 180);
  const eSc = this._sc(eye.pos);
  if (!eSc) return;

  // 锥母线方向在画布表面上的落点 → 环绕成锥底曲线（扁平面/球/圆柱各不相同）
  const basis = M3.canvasBasis(plane);
  const nSamples = 48;
  const raw = [];
  for (let i = 0; i < nSamples; i++) {
    const th = (i / nSamples) * Math.PI * 2;
    const d = M3.norm(M3.add(
      M3.scale(basis.n, Math.cos(angle)),
      M3.add(M3.scale(basis.u, Math.sin(angle) * Math.cos(th)), M3.scale(basis.v, Math.sin(angle) * Math.sin(th)))
    ));
    const far = M3.add(eye.pos, M3.scale(d, 1000));
    const hit = M3.projectToCanvas(far, eye.pos, plane);
    if (!hit || hit.t < 0) { raw.push(null); continue; }
    const s = this._sc(hit.point);
    raw.push(s);
  }
  const pts = raw.filter((s) => s !== null);
  if (pts.length < 3) return;
  const avgZ = (eSc.z + pts.reduce((a, p) => a + p.z, 0) / pts.length) / 2;

  addDraw(avgZ, (ctx) => {
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = 'rgba(231, 76, 60, 0.5)';
    ctx.lineWidth = 1;
    // 锥底（曲面）曲线
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();
    // 母线
    for (const p of pts) {
      ctx.beginPath();
      ctx.moveTo(eSc.x, eSc.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  });
};

/* ==================== 8. 平行线（3 组 3 色虚线） ==================== */
// 立方体 12 条棱按方向分组：x / y / z 各 4 条
PP.CUBE_EDGE_GROUPS = [
  [[0, 1], [2, 3], [4, 5], [6, 7]], // x
  [[0, 2], [1, 3], [4, 6], [5, 7]], // y
  [[0, 4], [1, 5], [2, 6], [3, 7]], // z
];

PP.Renderer.drawParallelLines = function (cube, addDraw) {
  const axes = PP.cubeAxes(cube);
  const colors = ['#e67e22', '#27ae60', '#8e44ad'];
  const verts = PP.cubeVertices(cube);
  // 鱼眼（球/圆柱）投影下直线不再是直线，只能采样绘制（屏幕坐标有界，无超长路径问题）
  const fisheye = PP.App.eyeView && (PP.App.canvas.shape || 'flat') !== 'flat';
  for (let g = 0; g < 3; g++) {
    if (fisheye) {
      for (const pair of PP.CUBE_EDGE_GROUPS[g]) {
        this._drawInfiniteLineSampled(addDraw, verts[pair[0]], axes[g], colors[g]);
      }
    } else {
      this._drawParallelGroupFlat(addDraw, verts, PP.CUBE_EDGE_GROUPS[g], axes[g], colors[g]);
    }
  }
};

// 灭点：方向 dir 在屏幕上的投影。正反两个无穷远点投影到同一灭点，
// 因此直接投影方向即可（对任意朝向都成立）。
// 不要采样 cam.pos + dir*1e7 这样的"远点"——当轴向指向相机时该点落在相机后方，
// worldToScreen 返回 null，会导致灭点丢失、整组平行线被跳过。
PP.Renderer._vpScreen = function (dir) {
  const cam = PP.App.camera;
  const dc = M3.toCamSpace(M3.add(cam.pos, dir), cam.pos, this.basis);
  const fisheye = PP.App.eyeView && (PP.App.canvas.shape || 'flat') !== 'flat';
  if (fisheye) {
    // 鱼眼（球/圆柱）下取指向屏幕前方（z>0）的方向投影为可见灭点：
    // 该方向的无穷远点沿视线前方可见，另一侧（后方）不可见
    const d2 = dc.z > 0 ? dc : M3.scale(dc, -1);
    const sp = this._fisheyeScreen(d2);
    if (!sp) return null;
    return { x: sp.x, y: sp.y, z: 0 };
  }
  if (Math.abs(dc.z) < 1e-9) return null; // 方向平行于近平面 → 灭点在无穷远
  const p = M3.projectCam(dc, this.fov, this.W / this.H);
  return { x: (p.sx + 1) * 0.5 * this.W, y: (-p.sy + 1) * 0.5 * this.H, z: 0 };
};

// 平面透视优化：直线投影仍是直线。
// 旧实现每线采样 50+ 点并逐段近平面裁剪，远点投影后屏幕坐标达百万像素级，
// 产生超长路径，Canvas 描边/虚线计算逐帧遍历 → 卡顿。
// 新实现：每组只算一次共享灭点（4 条平行线真正在无穷远交于同一点），
// 每条线只需一次近平面裁剪得到"可见半射线"，再裁剪到视口后绘制。
PP.Renderer._drawParallelGroupFlat = function (addDraw, verts, edgePairs, dir, color) {
  const W = this.W, H = this.H;
  const cam = PP.App.camera;
  const basis = this.basis;
  const fwd = basis.forward;
  const near = 0.1;

  // 共享灭点（与 drawVanishingPoints 完全一致）
  const vpSc = this._vpScreen(dir);

  // 屏幕方向：灭点不可见（dir 平行于近平面）时退化为 dir 的正交投影方向
  const dirC = M3.toCamSpace(M3.add(cam.pos, dir), cam.pos, basis);
  const dl = Math.hypot(dirC.x, dirC.y);
  const dScreen = dl > 1e-9 ? { x: dirC.x / dl, y: dirC.y / dl } : null;

  const zdir = dirC.z;

  for (const pair of edgePairs) {
    const A = verts[pair[0]];
    const zA = M3.dot(M3.sub(A, cam.pos), fwd);

    // 整条直线在相机后方 → 不可见
    if (zA < near && zdir <= 1e-9) continue;

    let P, mode;
    if (Math.abs(zdir) < 1e-9) {
      // 直线平行于近平面（整条可见）→ 画穿过锚点的整条屏幕线
      const aSc = this._sc(A);
      if (!aSc) continue;
      P = aSc; mode = 'line';
    } else {
      // 近平面裁剪：可见部分 = 近平面交点 C → 灭点的半射线（过锚点 A）
      const t0 = (near + 0.05 - zA) / zdir;
      const cSc = this._sc(M3.add(A, M3.scale(dir, t0)));
      if (!cSc) continue;
      P = cSc; mode = 'ray';
    }

    // 从 P 指向灭点的屏幕方向（ray 模式下灭点必存在；line 模式用正交投影方向）
    let d;
    if (mode === 'ray' && vpSc) {
      const vx = vpSc.x - P.x, vy = vpSc.y - P.y;
      const vl = Math.hypot(vx, vy);
      if (vl < 1e-6) continue;
      d = { x: vx / vl, y: vy / vl };
    } else {
      if (!dScreen) continue;
      d = dScreen;
    }

    const res = mode === 'ray'
      ? this._rayToVP(P, d, vpSc, W, H)
      : this._clipLineRect(P, d, W, H);
    if (!res) continue;

    addDraw(P.z, (ctx) => {
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(res.a.x, res.a.y);
      ctx.lineTo(res.b.x, res.b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }
};

// 从 P 沿 d 的半射线 → 裁剪到视口；灭点在视口内则恰好终止于灭点
PP.Renderer._rayToVP = function (P, d, vp, W, H) {
  const r = this._rayRect(P, d, W, H);
  if (!r) return null;
  let t0 = Math.max(0, r.tEnter);
  let t1 = r.tExit;
  if (vp && vp.x >= -0.5 && vp.x <= W + 0.5 && vp.y >= -0.5 && vp.y <= H + 0.5) {
    const tvp = (vp.x - P.x) * d.x + (vp.y - P.y) * d.y;
    if (tvp >= t0) t1 = Math.min(t1, tvp);
  }
  if (t1 - t0 < 1e-6) return null;
  return {
    a: { x: P.x + d.x * t0, y: P.y + d.y * t0 },
    b: { x: P.x + d.x * t1, y: P.y + d.y * t1 },
  };
};

// 过 P、方向 d 的整条屏幕线 → 裁剪到视口（直线平行于近平面、整条可见时用）
PP.Renderer._clipLineRect = function (P, d, W, H) {
  const BIG = 1e5;
  const a = { x: P.x - d.x * BIG, y: P.y - d.y * BIG };
  const b = { x: P.x + d.x * BIG, y: P.y + d.y * BIG };
  return this._clipSeg2D(a, b, W, H);
};

// 射线与矩形 [0,W]×[0,H] 求交（slab 法），返回 tEnter/tExit
PP.Renderer._rayRect = function (P, d, W, H) {
  let t0 = 0, t1 = Infinity;
  const slabs = [
    { lo: 0, hi: W, c: 'x' },
    { lo: 0, hi: H, c: 'y' },
  ];
  for (const s of slabs) {
    const pc = P[s.c], dc = d[s.c];
    if (Math.abs(dc) < 1e-9) {
      if (pc < s.lo || pc > s.hi) return null;
    } else {
      let ta = (s.lo - pc) / dc;
      let tb = (s.hi - pc) / dc;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return null;
    }
  }
  return { tEnter: t0, tExit: t1 };
};

// Liang-Barsky 线段裁剪到视口
PP.Renderer._clipSeg2D = function (a, b, W, H) {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x, W - a.x, a.y, H - a.y];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  if (t1 - t0 < 1e-6) return null;
  return {
    a: { x: a.x + t0 * dx, y: a.y + t0 * dy },
    b: { x: a.x + t1 * dx, y: a.y + t1 * dy },
  };
};

// 鱼眼（球/圆柱）备用路径：过 anchor、方向为 dir 的"无限"直线 → 采样曲线链 + 逐段近平面裁剪。
// 仅在非平面画布 + 人眼视图下使用。
// 旧实现把 +dir / -dir 两侧的点交错塞进同一条链（anchor±d0, anchor±d0·p, …），
// 屏幕上的曲线在两个分支之间来回反弹，形成"乱麻"且路径超长导致卡顿。
// 新实现：正负两个分支各自独立成链，采样距离按几何级数从近到远
// （近处密集保证曲线平滑，远处指数扩张使线条在屏幕上收敛到灭点），
// 每条分支投影后都是平滑单调的曲线。
PP.Renderer._drawInfiniteLineSampled = function (addDraw, anchor, dir, color) {
  this._drawLineRay(addDraw, anchor, dir, color);
  this._drawLineRay(addDraw, anchor, M3.scale(dir, -1), color);
};

// 从 anchor 出发、沿 +dir 方向延伸的一条分支：采样点距离按几何级数扩展
PP.Renderer._drawLineRay = function (addDraw, anchor, dir, color) {
  const N = this._curveSeg(1), t0 = 1.5, tmax = 1e5;
  const p = Math.pow(tmax / t0, 1 / (N - 1));
  const pts = [anchor];
  let t = t0;
  for (let k = 1; k < N; k++) {
    pts.push(M3.add(anchor, M3.scale(dir, t)));
    t *= p;
  }
  this._drawChain(addDraw, pts, (ctx) => {
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
  });
};

// 对一条世界坐标点链逐段做近平面裁剪，并把相邻可见段合并为少数几条折线后绘制。
// 相比逐段独立描边，大幅减少 Canvas 调用次数，解决平行线渲染卡顿。
PP.Renderer._drawChain = function (addDraw, worldPts, styleFn) {
  let run = null;        // 当前连续可见折线的屏幕点
  let runZ = Infinity;   // 折线中最近的深度（用于画家排序，保证平行线在画布前可见）
  const flush = () => {
    if (run && run.length >= 2) {
      const pts = run, d = runZ;
      addDraw(d, (ctx) => {
        styleFn(ctx);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }
    run = null; runZ = Infinity;
  };
  const addPt = (p) => {
    run.push(p);
    if (p.z < runZ) runZ = p.z;
  };
  for (let i = 0; i < worldPts.length - 1; i++) {
    const res = this._clipSegmentWorld(worldPts[i], worldPts[i + 1]);
    if (!res) { flush(); continue; }
    if (run) {
      // 上一段末点即本段起点，仅追加本段末点
      addPt(res.b);
    } else {
      run = [];
      addPt(res.a); addPt(res.b);
    }
  }
  flush();
};

// 世界坐标线段 → 两个屏幕点；任一端在相机后方时按近平面插值裁剪，返回 null 表示整段不可见
PP.Renderer._clipSegmentWorld = function (wA, wB) {
  const cam = PP.App.camera;
  const near = 0.1;
  const cA = M3.toCamSpace(wA, cam.pos, this.basis);
  if (cA.z < near) {
    const cB = M3.toCamSpace(wB, cam.pos, this.basis);
    if (cB.z < near) return null;
    const t = (near - cA.z) / (cB.z - cA.z);
    wA = M3.lerp(wA, wB, t);
  } else {
    const cB = M3.toCamSpace(wB, cam.pos, this.basis);
    if (cB.z < near) {
      const t = (near - cA.z) / (cB.z - cA.z);
      wB = M3.lerp(wA, wB, t);
    }
  }
  const a = this._sc(wA), b = this._sc(wB);
  if (!a || !b) return null;
  return { a, b };
};

/* ==================== 9. 灭点 ==================== */
PP.Renderer.drawVanishingPoints = function (cube, addDraw) {
  const app = PP.App;
  // 人眼视图下视图灭点与画布灭点重合，只保留画布灭点（含标签）避免重叠
  if (app.eyeView) return;
  const axes = PP.cubeAxes(cube);
  const colors = ['#e67e22', '#27ae60', '#8e44ad'];
  const eye = app.eye;
  const eSc = this._sc(eye.pos); // 人眼视图下眼睛==相机，可能为 null（仅影响辅助线）

  // 灭点 = 该方向直线在无穷远处的投影（与平行线的收敛点完全一致）
  for (let g = 0; g < 3; g++) {
    const dir = axes[g];
    const vpSc = this._vpScreen(dir);
    if (!vpSc) continue;

    addDraw(vpSc.z, (ctx) => {
      // 灭点圆
      ctx.beginPath();
      ctx.arc(vpSc.x, vpSc.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = colors[g];
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 人眼→灭点辅助线（人眼视图下相机=眼睛时无意义，跳过）
      if (eSc) {
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(eSc.x, eSc.y);
        ctx.lineTo(vpSc.x, vpSc.y);
        ctx.strokeStyle = colors[g] + '66';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  }
};

/* ==================== 9. 画布灭点 ==================== */
// 画布灭点：与平行线平行且穿过人眼的直线 与 画布表面的交点。
// 它位于画布上，与“视图灭点”（无穷远点在屏幕上的投影）物理含义不同。
// 平面画布 1 个；球/圆柱（中心轴过人眼）2 个（对向各一）；平行于画布时无交点。
// 返回每组方向的可见画布灭点 {x,y,z} 列表（可能为空）
PP.Renderer._canvasVPsScreen = function (cube) {
  const app = PP.App;
  const axes = PP.cubeAxes(cube);
  const eye = app.eye;
  const out = [];
  for (let g = 0; g < 3; g++) {
    const hits = M3.lineToCanvas(eye.pos, axes[g], app.canvas);
    const list = [];
    if (hits) {
      for (const h of hits) {
        const s = this._sc(h.point); // 交点本就在画布上，直接投影到屏幕
        if (s) list.push({ x: s.x, y: s.y, z: s.z });
      }
    }
    out.push(list);
  }
  return out;
};

PP.Renderer.drawCanvasVanishingPoints = function (cube, addDraw) {
  const app = PP.App;
  const colors = ['#e67e22', '#27ae60', '#8e44ad'];
  const eye = app.eye;
  const eSc = this._sc(eye.pos); // 人眼视图下相机=眼睛，可能为 null（仅略去辅助线）
  const vps = this._canvasVPsScreen(cube);

  for (let g = 0; g < 3; g++) {
    const list = vps[g];
    for (const cvp of list) {
      addDraw(cvp.z, (ctx) => {
        // 人眼→画布灭点 构造辅助线（虚线）——可直观看到“穿过人眼、方向平行”的这条线
        if (eSc) {
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(eSc.x, eSc.y);
          ctx.lineTo(cvp.x, cvp.y);
          ctx.strokeStyle = colors[g] + '3a';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);
        }
        // 画布灭点：空心方块（区别于实心圆 = 视图灭点）
        const s = 7;
        ctx.strokeStyle = colors[g];
        ctx.lineWidth = 2;
        ctx.strokeRect(cvp.x - s / 2, cvp.y - s / 2, s, s);
        ctx.fillStyle = colors[g];
        ctx.beginPath();
        ctx.arc(cvp.x, cvp.y, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }
};

/* ==================== 10. 人眼 ==================== */
PP.Renderer.drawEye = function (addDraw) {
  const eye = PP.App.eye;
  const sc = this._sc(eye.pos);
  if (!sc) return;
  // 方向箭头的端点
  const dirEnd = M3.add(eye.pos, M3.scale(eye.dir, 1.8));
  const dirSc = this._sc(dirEnd);
  if (!dirSc) return;

  addDraw(sc.z, (ctx) => {
    // 光环
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, 12, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(231, 76, 60, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 中心点
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#e74c3c';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 方向箭头
    ctx.beginPath();
    ctx.moveTo(sc.x, sc.y);
    ctx.lineTo(dirSc.x, dirSc.y);
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 箭头头
    const aDir = M3.norm(M3.sub(dirSc, sc));
    const perp = { x: -aDir.y, y: aDir.x };
    const headLen = 6;
    ctx.beginPath();
    ctx.moveTo(dirSc.x, dirSc.y);
    ctx.lineTo(dirSc.x - aDir.x * headLen + perp.x * headLen * 0.5, dirSc.y - aDir.y * headLen + perp.y * headLen * 0.5);
    ctx.moveTo(dirSc.x, dirSc.y);
    ctx.lineTo(dirSc.x - aDir.x * headLen - perp.x * headLen * 0.5, dirSc.y - aDir.y * headLen - perp.y * headLen * 0.5);
    ctx.stroke();
  });
};

/* ==================== 标签 ==================== */
PP.Renderer._drawLabel = function (ctx, text, x, y, color) {
  ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
  const m = ctx.measureText(text);
  const pad = 4;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x - m.width / 2 - pad, y - 10 - pad, m.width + pad * 2, 18 + pad);
  ctx.fillStyle = color || '#dfe6ef';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y - 1);
};

PP.Renderer.drawLabel = function (cube, addDraw) {
  const sc = this._sc(cube.position);
  if (!sc) return;
  addDraw(sc.z + 0.1, (ctx) => {
    this._drawLabel(ctx, cube.name, sc.x, sc.y - 15, '#fff');
  });
};

PP.Renderer.drawEyeLabel = function (addDraw) {
  const eye = PP.App.eye;
  const sc = this._sc(eye.pos);
  if (!sc) return;
  addDraw(sc.z, (ctx) => {
    this._drawLabel(ctx, '人眼', sc.x, sc.y - 20, '#e74c3c');
  });
};

PP.Renderer.drawCanvasLabel = function (addDraw) {
  const c = PP.App.canvas;
  if (c.size <= 0) return;
  const basis = M3.canvasBasis(c);
  const labelPos = M3.add(c.center, M3.scale(basis.v, -(c.h * c.size) / 2 - 1.2));
  const sc = this._sc(labelPos);
  if (!sc) return;
  addDraw(sc.z, (ctx) => {
    this._drawLabel(ctx, '画布', sc.x, sc.y, '#8fb8ff');
  });
};

PP.Renderer.drawVPLabels = function (cube, addDraw) {
  // 人眼视图下视图灭点已隐藏（与画布灭点重合），标签也随之隐藏
  if (PP.App.eyeView) return;
  const axes = PP.cubeAxes(cube);
  const colors = ['#e67e22', '#27ae60', '#8e44ad'];
  const dirs = ['X', 'Y', 'Z'];
  for (let g = 0; g < 3; g++) {
    const dir = axes[g];
    const vpSc = this._vpScreen(dir);
    if (!vpSc) continue;
    addDraw(vpSc.z, (ctx) => {
      this._drawLabel(ctx, '灭点 ' + dirs[g], vpSc.x, vpSc.y - 18, colors[g]);
    });
  }
};

PP.Renderer.drawCVPLabels = function (cube, addDraw) {
  const colors = ['#e67e22', '#27ae60', '#8e44ad'];
  const dirs = ['X', 'Y', 'Z'];
  const vps = this._canvasVPsScreen(cube);
  for (let g = 0; g < 3; g++) {
    for (const cvp of vps[g]) {
      addDraw(cvp.z, (ctx) => {
        this._drawLabel(ctx, '画布灭点 ' + dirs[g], cvp.x, cvp.y - 18, colors[g]);
      });
    }
  }
};