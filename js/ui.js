/* =========================================================
 * ui.js — 工具栏/选项面板事件绑定与状态同步
 * ========================================================= */
PP.UI = {
  elems: {},
};

PP.UI.bind = function () {
  this.elems.toolBtns = document.querySelectorAll('.tool-btn[data-tool]');
  this.elems.btnAdd = document.getElementById('btn-add');
  this.elems.btnReset = document.getElementById('btn-reset');
  this.elems.btnEyeView = document.getElementById('btn-eyeview');

  this.elems.optShowSightLine = document.getElementById('opt-showSightLine');
  this.elems.optShowFrustum = document.getElementById('opt-showFrustum');
  this.elems.frustumAngle = document.getElementById('frustumAngle');
  this.elems.frustumVal = document.getElementById('frustumVal');
  this.elems.zoomSens = document.getElementById('zoomSens');
  this.elems.zoomSensVal = document.getElementById('zoomSensVal');
  this.elems.optShowProjectionLines = document.getElementById('opt-showProjectionLines');
  this.elems.optShowPerspective = document.getElementById('opt-showPerspective');
  this.elems.optShowLabels = document.getElementById('opt-showLabels');
  this.elems.optShowParallelLines = document.getElementById('opt-showParallelLines');
  this.elems.optShowVanishingPoints = document.getElementById('opt-showVanishingPoints');
  this.elems.optLockCanvas = document.getElementById('opt-lockCanvas');
  this.elems.canvasSize = document.getElementById('canvasSize');
  this.elems.canvasSizeVal = document.getElementById('canvasSizeVal');

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
  this.elems.btnReset.addEventListener('click', () => this.reset());
  this.elems.btnDelete.addEventListener('click', () => this.deleteSelected());
  this.elems.btnEyeView.addEventListener('click', () => this.toggleEyeView());

  this.elems.optShowSightLine.addEventListener('change', () => this.syncOptions());
  this.elems.optShowFrustum.addEventListener('change', () => this.syncOptions());
  this.elems.frustumAngle.addEventListener('input', () => this.syncOptions());
  this.elems.zoomSens.addEventListener('input', () => {
    PP.App.options.zoomSensitivity = Number(this.elems.zoomSens.value) / 100;
    this.elems.zoomSensVal.textContent = Math.round(this.elems.zoomSens.value) + '%';
  });
  this.elems.optShowProjectionLines.addEventListener('change', () => this.syncOptions());
  this.elems.optShowPerspective.addEventListener('change', () => this.syncOptions());
  this.elems.optShowLabels.addEventListener('change', () => this.syncOptions());
  this.elems.optShowParallelLines.addEventListener('change', () => this.syncOptions());
  this.elems.optShowVanishingPoints.addEventListener('change', () => this.syncOptions());
  this.elems.optLockCanvas.addEventListener('change', () => {
    PP.App.canvas.lockToEye = this.elems.optLockCanvas.checked;
  });
  this.elems.canvasSize.addEventListener('input', () => {
    PP.App.canvas.size = Number(this.elems.canvasSize.value);
    this.elems.canvasSizeVal.textContent = Math.round(PP.App.canvas.size * 100) + '%';
  });

  this.selectTool(PP.App.tool);
  this.syncOptionsToUI();
  this.updateSelectionPanel();
  this.updateStatus();
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
  this.elems.optShowProjectionLines.checked = o.showProjectionLines;
  this.elems.optShowPerspective.checked = o.showPerspective;
  this.elems.optShowLabels.checked = o.showLabels;
  this.elems.optShowParallelLines.checked = o.showParallelLines;
  this.elems.optShowVanishingPoints.checked = o.showVanishingPoints;
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
  const sel = PP.getSelectedCube();
  if (!sel) {
    this.elems.selPanel.hidden = true;
    this.elems.optShowParallelLines.disabled = true;
    this.elems.optShowVanishingPoints.disabled = true;
    return;
  }
  this.elems.selPanel.hidden = false;
  this.elems.optShowParallelLines.disabled = false;
  this.elems.optShowVanishingPoints.disabled = false;
  this.elems.selName.textContent = sel.name;
  this.elems.selSize.textContent = '边长: ' + sel.size.toFixed(2);
};

PP.UI.addCube = function () {
  // 放在画布前方，稍微随机偏移
  const center = M3.v3((Math.random() - 0.5) * 2, 1.5 + (Math.random() - 0.5) * 1, -1 + (Math.random() - 0.5) * 2);
  PP.addCube(center);
  this.updateSelectionPanel();
};

PP.UI.deleteSelected = function () {
  if (PP.App.selectedId) {
    PP.removeCube(PP.App.selectedId);
    this.updateSelectionPanel();
  }
};

PP.UI.reset = function () {
  PP.resetScene();
  this.selectTool(PP.App.tool);
  this.syncOptionsToUI();
  this.updateSelectionPanel();
  this.updateStatus();
  this.syncEyeViewButton();
};

PP.UI.updateStatus = function () {
  const toolHint = {
    select: '选择/查看：点击物体选中或再点取消，点击空白取消选中；拖动旋转视图，Shift+拖动平移，Ctrl/⌘+滚轮缩放',
    move: '移动：拖拽人眼/立方体/画布；空白处拖动旋转视图，滚轮缩放',
    rotate: '旋转：按住对象改变方向（人眼=控制视线方向）；空白处拖动旋转视图',
    scale: '缩放：按住立方体水平拖动改变大小；空白处拖动旋转视图',
  };
  this.elems.status.textContent = toolHint[PP.App.tool];
  const w = PP.App.warnings;
  this.elems.info.textContent = w.length ? w.join('；') : '';
};
