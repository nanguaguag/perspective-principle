/* =========================================================
 * ui.js — 工具栏/选项面板事件绑定与状态同步
 * ========================================================= */
PP.UI = {
  elems: {},
  panelOpen: true,    // 桌面端默认展开；移动端抽屉默认收起（由 CSS + body.panel-open 控制）
  currentPreset: 'one',
};

PP.UI.isMobile = function () {
  return window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
};

PP.UI.bind = function () {
  this.elems.toolBtns = document.querySelectorAll('.tool-btn[data-tool]');
  this.elems.btnAdd = document.getElementById('btn-add');
  this.elems.btnReset = document.getElementById('btn-reset');
  this.elems.btnEyeView = document.getElementById('btn-eyeview');
  this.elems.btnTogglePanel = document.getElementById('btn-toggle-panel');
  this.elems.panel = document.getElementById('panel');

  this.elems.optShowSightLine = document.getElementById('opt-showSightLine');
  this.elems.optShowFrustum = document.getElementById('opt-showFrustum');
  this.elems.frustumAngle = document.getElementById('frustumAngle');
  this.elems.frustumVal = document.getElementById('frustumVal');
  this.elems.zoomSens = document.getElementById('zoomSens');
  this.elems.zoomSensVal = document.getElementById('zoomSensVal');
  this.elems.curveSmooth = document.getElementById('curveSmooth');
  this.elems.curveSmoothVal = document.getElementById('curveSmoothVal');
  this.elems.optShowProjectionLines = document.getElementById('opt-showProjectionLines');
  this.elems.optShowPerspective = document.getElementById('opt-showPerspective');
  this.elems.optShowLabels = document.getElementById('opt-showLabels');
  this.elems.optShowParallelLines = document.getElementById('opt-showParallelLines');
  this.elems.optShowVanishingPoints = document.getElementById('opt-showVanishingPoints');
  this.elems.optShowCanvasVanishingPoints = document.getElementById('opt-showCanvasVanishingPoints');
  this.elems.optLockCanvas = document.getElementById('opt-lockCanvas');
  this.elems.canvasSize = document.getElementById('canvasSize');
  this.elems.canvasSizeVal = document.getElementById('canvasSizeVal');
  this.elems.canvasShapeBtns = document.querySelectorAll('#canvasShape .shape-btn');
  this.elems.resetMenu = document.getElementById('reset-menu');
  this.elems.resetItems = document.querySelectorAll('#reset-menu .md3-menu-item[data-reset]');

  this.elems.selPanel = document.getElementById('sel-panel');
  this.elems.selName = document.getElementById('sel-name');
  this.elems.selSize = document.getElementById('sel-size');
  this.elems.btnDelete = document.getElementById('btn-delete');

  this.elems.status = document.getElementById('status');
  this.elems.info = document.getElementById('info');

  // 绑定事件
  for (const btn of this.elems.toolBtns) {
    btn.addEventListener('click', () => {
      this.selectTool(btn.dataset.tool);
    });
  }
  this.elems.btnAdd.addEventListener('click', () => this.addCube());
  this.elems.btnDelete.addEventListener('click', () => this.deleteSelected());
  this.elems.btnEyeView.addEventListener('click', () => this.toggleEyeView());
  this.elems.btnTogglePanel.addEventListener('click', () => this.togglePanel());
  this.elems.btnReset.addEventListener('click', (e) => this.toggleResetMenu(e));
  const backd = document.getElementById('panel-backdrop');
  if (backd) backd.addEventListener('click', () => this.closePanel());

  this.elems.optShowSightLine.addEventListener('change', () => this.syncOptions());
  this.elems.optShowFrustum.addEventListener('change', () => this.syncOptions());
  this.elems.frustumAngle.addEventListener('input', () => this.syncOptions());
  this.elems.zoomSens.addEventListener('input', () => {
    PP.App.options.zoomSensitivity = Number(this.elems.zoomSens.value) / 100;
    this.elems.zoomSensVal.textContent = Math.round(this.elems.zoomSens.value) + '%';
  });
  this.elems.curveSmooth.addEventListener('input', () => {
    PP.App.options.curveSmoothness = Number(this.elems.curveSmooth.value);
    this.elems.curveSmoothVal.textContent = this.elems.curveSmooth.value;
  });
  this.elems.optShowProjectionLines.addEventListener('change', () => this.syncOptions());
  this.elems.optShowPerspective.addEventListener('change', () => this.syncOptions());
  this.elems.optShowLabels.addEventListener('change', () => this.syncOptions());
  this.elems.optShowParallelLines.addEventListener('change', () => this.syncOptions());
  this.elems.optShowVanishingPoints.addEventListener('change', () => this.syncOptions());
  this.elems.optShowCanvasVanishingPoints.addEventListener('change', () => this.syncOptions());
  this.elems.optLockCanvas.addEventListener('change', () => {
    PP.App.canvas.lockToEye = this.elems.optLockCanvas.checked;
  });
  this.elems.canvasSize.addEventListener('input', () => {
    PP.App.canvas.size = Number(this.elems.canvasSize.value);
    this.elems.canvasSizeVal.textContent = Math.round(PP.App.canvas.size * 100) + '%';
  });

  for (const btn of this.elems.canvasShapeBtns) {
    btn.addEventListener('click', () => this.setCanvasShape(btn.dataset.shape));
  }

  for (const btn of this.elems.resetItems) {
    btn.addEventListener('click', () => this.applyPreset(btn.dataset.reset));
  }
  // 点击菜单外部任意处 → 关闭重置菜单
  window.addEventListener('pointerdown', (e) => {
    if (!this.elems.resetMenu.hidden) {
      const m = this.elems.resetMenu;
      const t = e.target;
      if (!m.contains(t) && t !== this.elems.btnReset) this.hideResetMenu();
    }
  });

  this.selectTool(PP.App.tool);
  this.syncOptionsToUI();
  this.syncCanvasShape();
  this.updateSelectionPanel();
  this.updateStatus();

  // 初始面板状态：桌面默认展开、移动端默认收起（抽屉统一由 body.panel-open 控制）
  if (this.isMobile()) this.panelOpen = false;
  document.body.classList.toggle('panel-open', this.panelOpen);
  this.elems.btnTogglePanel.classList.toggle('active', this.panelOpen);
  this.elems.btnTogglePanel.title = this.panelOpen ? '隐藏侧边栏' : '展开侧边栏';
  this.renderResetMenu();
};

// 切换画布形状（平面 / 球形 / 圆柱）
PP.UI.setCanvasShape = function (shape) {
  PP.App.canvas.shape = shape;
  this.syncCanvasShape();
  if (this.isMobile()) this.closePanel(); // 切换画布后让出屏幕看效果
};

PP.UI.syncCanvasShape = function () {
  const shape = PP.App.canvas.shape || 'flat';
  for (const btn of this.elems.canvasShapeBtns) {
    btn.classList.toggle('active', btn.dataset.shape === shape);
  }
  // 曲线光滑度仅在鱼眼（球/圆柱）画布下有效
  if (this.elems.curveSmooth) {
    this.elems.curveSmooth.disabled = (shape === 'flat');
    this.elems.curveSmoothVal.classList.toggle('dim', shape === 'flat');
  }
};

// 显示 / 隐藏右侧抽屉（桌面端也滑入，与移动端一致）。
// 纯悬浮覆盖，画布尺寸不变，故无需重新 resize。
PP.UI.togglePanel = function () {
  this.panelOpen = !this.panelOpen;
  document.body.classList.toggle('panel-open', this.panelOpen);
  this.elems.btnTogglePanel.classList.toggle('active', this.panelOpen);
  this.elems.btnTogglePanel.title = this.panelOpen ? '收起侧边栏' : '展开侧边栏';
};

// 强制收起抽屉（场景一键切换后让出视图空间）
PP.UI.closePanel = function () {
  if (!this.panelOpen) return;
  this.panelOpen = false;
  document.body.classList.remove('panel-open');
  this.elems.btnTogglePanel.classList.toggle('active', false);
  this.elems.btnTogglePanel.title = '展开侧边栏';
};

/* ==================== 重置 / 透视预设菜单 ==================== */
// 点“重置”弹出 6 个透视预设供选择（默认一点透视）
PP.UI.toggleResetMenu = function (e) {
  if (this.elems.resetMenu.hidden) {
    e.preventDefault(); // 避免触发下方全局 pointerdown 立即关闭
    this.showResetMenu();
    this.elems.btnReset.classList.add('caret-flip');
  } else {
    this.hideResetMenu();
  }
};

PP.UI.showResetMenu = function () {
  const menu = this.elems.resetMenu;
  menu.hidden = false;
  // 以锚点按钮右下角定位（悬浮 fixed，需测量宽度后对齐右缘）
  const r = this.elems.btnReset.getBoundingClientRect();
  menu.style.top = (r.bottom + 6) + 'px';
  menu.style.right = (window.innerWidth - r.right) + 'px';
  menu.style.left = 'auto';
};

PP.UI.hideResetMenu = function () {
  if (this.elems.resetMenu.hidden) return;
  this.elems.resetMenu.hidden = true;
  this.elems.btnReset.classList.remove('caret-flip');
};

// 刷新菜单选中态 + 重置按钮标题，标记当前预设
PP.UI.renderResetMenu = function () {
  const name = this.currentPreset;
  for (const btn of this.elems.resetItems) {
    btn.classList.toggle('active', btn.dataset.reset === name);
  }
  const labels = {
    one: '一点透视', two: '两点透视', three: '三点透视',
    four: '四点透视', five: '五点透视', six: '六点透视',
  };
  this.elems.btnReset.title = '重置为透视预设 · 当前：' + (labels[name] || name);
};

PP.UI.selectTool = function (tool) {
  PP.App.tool = tool;
  for (const btn of this.elems.toolBtns) {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  }
  this.updateStatus();
};

PP.UI.syncOptions = function () {
  PP.App.options.showSightLine = this.elems.optShowSightLine.checked;
  PP.App.options.showFrustum = this.elems.optShowFrustum.checked;
  PP.App.options.frustumAngle = Number(this.elems.frustumAngle.value);
  this.elems.frustumVal.textContent = PP.App.options.frustumAngle + '°';
  PP.App.options.showProjectionLines = this.elems.optShowProjectionLines.checked;
  PP.App.options.showPerspective = this.elems.optShowPerspective.checked;
  PP.App.options.showLabels = this.elems.optShowLabels.checked;
  PP.App.options.showParallelLines = this.elems.optShowParallelLines.checked;
  PP.App.options.showVanishingPoints = this.elems.optShowVanishingPoints.checked;
  PP.App.options.showCanvasVanishingPoints = this.elems.optShowCanvasVanishingPoints.checked;
};

PP.UI.syncOptionsToUI = function () {
  const o = PP.App.options;
  this.elems.optShowSightLine.checked = o.showSightLine;
  this.elems.optShowFrustum.checked = o.showFrustum;
  this.elems.frustumAngle.value = o.frustumAngle;
  this.elems.frustumVal.textContent = o.frustumAngle + '°';
  const zs = Math.round(o.zoomSensitivity * 100);
  this.elems.zoomSens.value = zs;
  this.elems.zoomSensVal.textContent = zs + '%';
  this.elems.curveSmooth.value = o.curveSmoothness;
  this.elems.curveSmoothVal.textContent = o.curveSmoothness;
  this.elems.optShowProjectionLines.checked = o.showProjectionLines;
  this.elems.optShowPerspective.checked = o.showPerspective;
  this.elems.optShowLabels.checked = o.showLabels;
  this.elems.optShowParallelLines.checked = o.showParallelLines;
  this.elems.optShowVanishingPoints.checked = o.showVanishingPoints;
  this.elems.optShowCanvasVanishingPoints.checked = o.showCanvasVanishingPoints;
  this.elems.optLockCanvas.checked = PP.App.canvas.lockToEye;
  this.elems.canvasSize.value = PP.App.canvas.size;
  this.elems.canvasSizeVal.textContent = Math.round(PP.App.canvas.size * 100) + '%';
};

/* ==================== 人眼视图 ==================== */
PP.UI.toggleEyeView = function () {
  const app = PP.App;
  if (app.eyeView || app.eyeViewAnim) this.exitEyeView();
  else this.enterEyeView();
};

PP.UI.enterEyeView = function () {
  const app = PP.App;
  // 若已在过渡中，取消旧过渡直接进入
  if (app.eyeViewAnim) {
    app.eyeViewAnim = null;
    app.eyeView = false;
  }
  // 保存当前轨道相机参数，用于退出时恢复
  app.camOrbit = {
    target: M3.v3(app.camera.target.x, app.camera.target.y, app.camera.target.z),
    yaw: app.camera.yaw,
    pitch: app.camera.pitch,
    dist: app.camera.dist,
    fov: app.camera.fov,
  };
  const eye = app.eye;
  app.eyeViewAnim = {
    phase: 'in', t: 0, dur: 1.1,
    fromPos: M3.v3(app.camera.pos.x, app.camera.pos.y, app.camera.pos.z),
    fromLook: M3.v3(app.camera.target.x, app.camera.target.y, app.camera.target.z),
    toPos: M3.v3(eye.pos.x, eye.pos.y, eye.pos.z),
    toLook: M3.add(eye.pos, M3.scale(eye.dir, 100)),
    fromFov: app.camera.fov,
    toFov: PP.Renderer.computeEyeFov(),
  };
  this.syncEyeViewButton();
};

PP.UI.exitEyeView = function () {
  const app = PP.App;
  if (!app.eyeView && !app.eyeViewAnim) return;
  const orbit = app.camOrbit || {
    target: M3.v3(0, 1.5, 0.5), yaw: 0.62, pitch: 0.38, dist: 22, fov: 45,
  };
  // 若正在进入动画，直接切回轨道相机
  if (app.eyeViewAnim) {
    app.eyeViewAnim = null;
    app.eyeView = false;
    Object.assign(app.camera, orbit);
    this.syncEyeViewButton();
    return;
  }
  const eye = app.eye;
  Object.assign(app.camera, orbit); // 目标轨道参数（过渡期间 basis 由插值驱动）
  M3.camSetup(orbit); // 计算退出时的轨道相机位置（写入 orbit.pos）
  app.eyeViewAnim = {
    phase: 'out', t: 0, dur: 1.1,
    fromPos: M3.v3(app.camera.pos.x, app.camera.pos.y, app.camera.pos.z),
    fromLook: M3.add(eye.pos, M3.scale(eye.dir, 100)),
    toPos: M3.v3(orbit.pos.x, orbit.pos.y, orbit.pos.z),
    toLook: M3.v3(orbit.target.x, orbit.target.y, orbit.target.z),
    fromFov: PP.Renderer.computeEyeFov(),
    toFov: orbit.fov,
  };
  app.eyeView = false;
  this.syncEyeViewButton();
};

PP.UI.syncEyeViewButton = function () {
  const active = PP.App.eyeView || !!PP.App.eyeViewAnim;
  this.elems.btnEyeView.classList.toggle('active', active);
};

PP.UI.updateSelectionPanel = function () {
  const sels = PP.getSelectedCubes();
  if (!sels.length) {
    this.elems.selPanel.hidden = true;
    this.elems.optShowParallelLines.disabled = true;
    this.elems.optShowVanishingPoints.disabled = true;
    this.elems.optShowCanvasVanishingPoints.disabled = true;
    return;
  }
  this.elems.selPanel.hidden = false;
  this.elems.optShowParallelLines.disabled = false;
  this.elems.optShowVanishingPoints.disabled = false;
  this.elems.optShowCanvasVanishingPoints.disabled = false;
  if (sels.length === 1) {
    this.elems.selName.textContent = sels[0].name;
    this.elems.selSize.textContent = '边长: ' + sels[0].size.toFixed(2);
  } else {
    this.elems.selName.textContent = '已选 ' + sels.length + ' 个物体';
    this.elems.selSize.textContent = '平行线已按各自颜色显示';
  }
};

PP.UI.addCube = function () {
  // 放在画布前方，稍微随机偏移
  const center = M3.v3((Math.random() - 0.5) * 2, 1.5 + (Math.random() - 0.5) * 1, -1 + (Math.random() - 0.5) * 2);
  PP.addCube(center);
  this.updateSelectionPanel();
};

PP.UI.deleteSelected = function () {
  // 删除全部选中物体（支持多选）
  const ids = PP.App.selectedIds || [];
  for (const id of ids) {
    if (PP.findCube(id)) PP.removeCube(id);
  }
  PP.setSelected([]);
  this.updateSelectionPanel();
};

PP.UI.reset = function () {
  PP.resetScene();
  this.selectTool(PP.App.tool);
  this.syncOptionsToUI();
  this.syncCanvasShape();
  this.updateSelectionPanel();
  this.updateStatus();
  this.syncEyeViewButton();
};

// 一键创建透视场景（重置为所选预设）
PP.UI.applyPreset = function (name) {
  PP.applyPreset(name);
  this.currentPreset = name;
  this.renderResetMenu();
  this.syncOptionsToUI();
  this.syncCanvasShape();
  this.updateSelectionPanel();
  this.updateStatus();
  this.syncEyeViewButton();
  if (this.isMobile()) this.closePanel(); // 切完场景收起抽屉，聚焦画布
};

PP.UI.updateStatus = function () {
  let hint;
  if (PP.UI.isMobile()) {
    hint = {
      select: '点击物体选中/取消，拖动旋转视图；双指捏合缩放',
      move: '拖动人眼/立方体/画布；空白处拖动旋转视图；双指捏合缩放',
      rotate: '拖动对象改变方向；空白处拖动旋转视图；双指捏合缩放',
      scale: '拖动立方体水平改变大小；空白处拖动旋转视图；双指捏合缩放',
    }[PP.App.tool];
  } else {
    hint = {
      select: '选择：点击物体单选，Shift+点击多选/取消；点击空白取消选中；拖动旋转视图，Shift+拖动平移；触控板：双指滚动旋转，Shift+双指滚动平移，捏合/滚轮缩放',
      move: '移动：拖拽人眼/立方体/画布；空白处拖动旋转视图；触控板：双指滚动旋转，Shift+双指滚动平移，捏合/滚轮缩放',
      rotate: '旋转：按住对象改变方向（人眼=控制视线方向）；空白处拖动旋转视图；触控板：双指滚动旋转，Shift+双指滚动平移，捏合/滚轮缩放',
      scale: '缩放：按住立方体水平拖动改变大小；空白处拖动旋转视图；触控板：双指滚动旋转，Shift+双指滚动平移，捏合/滚轮缩放',
    }[PP.App.tool];
  }
  this.elems.status.textContent = hint;
  const w = PP.App.warnings;
  this.elems.info.textContent = w.length ? w.join('；') : '';
};
