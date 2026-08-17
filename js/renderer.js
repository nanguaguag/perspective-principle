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
PP.Renderer.worldToScreen = function (wp) {
  const cam = PP.App.camera;
  const cs = M3.toCamSpace(wp, cam.pos, this.basis);
  if (cs.z < 0.1) return null; // 在相机后方
  const p = M3.projectCam(cs, this.fov, this.W / this.H);
  return {
    x: (p.sx + 1) * 0.5 * this.W,
    y: (-p.sy + 1) * 0.5 * this.H,
    z: cs.z,
  };
};

// 屏幕 → 世界射线
PP.Renderer.screenToWorld = function (mx, my) {
  return M3.screenRay(mx, my, PP.App.camera, this.fov, this.W, this.H, this.basis);
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

/* ==================== 绘制辅助 ==================== */
PP.Renderer._sc = function (wp) {
  if (!wp) return null;
  return this.worldToScreen(wp);
};
PP.Renderer._scVec = function (list) {
  return list.map((p) => this._sc(p)).filter((s) => s !== null);
};

/* ==================== 1. 画布平面 ==================== */
PP.Renderer.drawCanvasPlane = function (addDraw) {
  const c = PP.App.canvas;
  if (c.size <= 0) return; // size=0 → 隐藏画布
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

/* ==================== 2. 立方体面 ==================== */
PP.Renderer.drawCubeFaces = function (cube, addDraw) {
  const verts = PP.cubeVertices(cube);
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

/* ==================== 3. 立方体线框 ==================== */
PP.Renderer.drawCubeWireframe = function (cube, addDraw) {
  const verts = PP.cubeVertices(cube);
  const sc = verts.map((v) => this._sc(v));
  if (sc.some((s) => !s)) return;
  const isSelected = PP.App.selectedId === cube.id;
  for (const edge of PP.CUBE_EDGES) {
    const p0 = sc[edge[0]], p1 = sc[edge[1]];
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
    const res = M3.projectToCanvas(v, eyePos, plane.center, plane.normal);
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
      const loc = M3.pointOnCanvas(res.point, plane, M3.canvasBasis(plane));
      const r = loc.on ? 4 : 2.5;
      ctx.beginPath();
      ctx.arc(pSc.x, pSc.y, r, 0, Math.PI * 2);
      ctx.fillStyle = loc.on ? '#16a085' : 'rgba(22,160,133,0.45)';
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

  // 投影到画布的 8 个点
  const proj = verts.map((v) => {
    const res = M3.projectToCanvas(v, eyePos, plane.center, plane.normal);
    return res && res.t >= 0 ? res.point : null;
  });
  if (proj.some((p) => p === null)) return;

  // 按 12 条棱连接
  for (const edge of PP.CUBE_EDGES) {
    const p0 = this._sc(proj[edge[0]]);
    const p1 = this._sc(proj[edge[1]]);
    if (!p0 || !p1) continue;
    const avgZ = (p0.z + p1.z) / 2;
    addDraw(avgZ, (ctx) => {
      // 深色描边 + 亮色内芯，保证在深色背景上醒目
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.strokeStyle = 'rgba(10, 15, 25, 0.95)';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = '#f1c40f';
      ctx.lineWidth = 2.5;
      ctx.stroke();
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
  const eye = PP.App.eye;
  const plane = PP.App.canvas;
  const angle = PP.App.options.frustumAngle * (Math.PI / 180);
  const eSc = this._sc(eye.pos);
  if (!eSc) return;

  // 轴向射线与画布交点 = 锥底圆心
  const res = M3.rayPlane(eye.pos, eye.dir, plane.center, plane.normal);
  if (!res) return;
  const distToCanvas = M3.dist(eye.pos, res.point);
  const radius = Math.tan(angle) * distToCanvas;

  // 画出锥底圆周上的点
  const basis = M3.canvasBasis(plane);
  const nSamples = 32;
  const pts = [];
  for (let i = 0; i < nSamples; i++) {
    const theta = (i / nSamples) * Math.PI * 2;
    const offset = M3.add(M3.scale(basis.u, Math.cos(theta) * radius), M3.scale(basis.v, Math.sin(theta) * radius));
    const wp = M3.add(res.point, offset);
    const sp = this._sc(wp);
    if (sp) pts.push(sp);
  }
  if (pts.length < 3) return;
  const avgZ = (eSc.z + pts.reduce((a, p) => a + p.z, 0) / pts.length) / 2;

  addDraw(avgZ, (ctx) => {
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = 'rgba(231, 76, 60, 0.5)';
    ctx.lineWidth = 1;
    // 锥底圆
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
  const verts = PP.cubeVertices(cube);
  const axes = PP.cubeAxes(cube);
  const colors = ['#e67e22', '#27ae60', '#8e44ad'];
  // "无限延伸"：生长到越过视锥/覆盖画面，达到"朝向灭点延伸"的观感
  const ext = M3.dist(PP.App.camera.pos, cube.position) * 3 + 20;

  for (let g = 0; g < 3; g++) {
    const dir = M3.norm(axes[g]);
    const edgePairs = PP.CUBE_EDGE_GROUPS[g];

    for (const [i0, i1] of edgePairs) {
      const p0 = verts[i0], p1 = verts[i1];
      // 每条棱沿 dir 向两侧延伸出两条"射线"；对近平面做裁剪，
      // 保证朝向相机的线也能正确延伸到画面边缘（不因端点越界而整条消失）
      this._drawExtLine(addDraw, p0, p0, dir, ext, colors[g]);
      this._drawExtLine(addDraw, p1, p1, dir, ext, colors[g]);
    }
  }
};

// 沿 dir 过 origin 的"无限"延伸线：两端点投影并近平面裁剪后画线
PP.Renderer._drawExtLine = function (addDraw, oA, oB, dir, ext, color) {
  const wA = M3.sub(oA, M3.scale(dir, ext));
  const wB = M3.add(oB, M3.scale(dir, ext));
  const res = this._clipSegmentWorld(wA, wB);
  if (!res) return;
  const avgZ = (res.a.z + res.b.z) / 2;
  addDraw(avgZ, (ctx) => {
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(res.a.x, res.a.y); ctx.lineTo(res.b.x, res.b.y); ctx.stroke();
    ctx.setLineDash([]);
  });
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
  const axes = PP.cubeAxes(cube);
  const colors = ['#e67e22', '#27ae60', '#8e44ad'];
  const plane = app.canvas;
  const eye = app.eye;
  const basis = M3.canvasBasis(plane);
  const eSc = this._sc(eye.pos); // 人眼视图下眼睛==相机，可能为 null（仅影响辅助线）

  for (let g = 0; g < 3; g++) {
    const dir = axes[g];
    const denom = M3.dot(plane.normal, dir);
    if (Math.abs(denom) < M3.EPS) {
      app.warnings.push('组' + (g + 1) + '方向平行于画面，灭点在无穷远');
      continue;
    }
    const s = M3.dot(plane.normal, M3.sub(plane.center, eye.pos)) / denom;
    const vp = M3.add(eye.pos, M3.scale(dir, s));
    const vpSc = this._sc(vp);
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
  const app = PP.App;
  const axes = PP.cubeAxes(cube);
  const colors = ['#e67e22', '#27ae60', '#8e44ad'];
  const dirs = ['X', 'Y', 'Z'];
  for (let g = 0; g < 3; g++) {
    const dir = axes[g];
    const denom = M3.dot(app.canvas.normal, dir);
    if (Math.abs(denom) < M3.EPS) continue;
    const s = M3.dot(app.canvas.normal, M3.sub(app.canvas.center, app.eye.pos)) / denom;
    const vp = M3.add(app.eye.pos, M3.scale(dir, s));
    const vpSc = this._sc(vp);
    if (!vpSc) continue;
    addDraw(vpSc.z, (ctx) => {
      this._drawLabel(ctx, '灭点 ' + dirs[g], vpSc.x, vpSc.y - 18, colors[g]);
    });
  }
};