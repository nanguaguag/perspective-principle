/* =========================================================
 * scene.js — 场景状态与操作
 * 双相机分层：视口相机 App.camera（怎么看）vs 概念人眼 App.eye（透视学怎么算）
 * ========================================================= */
const PP = {};
window.PP = PP; // 调试时便于在控制台检视全局状态

PP.App = {
  eye: {
    pos: M3.v3(0, 3.5, 10),
    // 视线方向用 yaw（水平，绕世界 Y，可 360°）+ pitch（俯仰）控制
    yaw: Math.PI,            // 默认 dir=(0,-0.45,-1) → yaw=π, pitch≈-0.4228
    pitch: -0.4228,
    dir: M3.norm(M3.v3(0, -0.45, -1)),
  },
  canvas: {
    center: M3.v3(0, 1.6, 3),
    normal: M3.v3(0, 0, 1),
    w: 12,
    h: 9,
    size: 1,          // 画布显示大小（0~2，0 = 隐藏画布）
    lockToEye: true,
    shape: 'flat',    // 'flat' 平面 | 'sphere' 球形 | 'cylinder' 圆柱（模拟鱼眼透视）
  },
  cubes: [],
  camera: {
    target: M3.v3(0, 1.5, 0.5),
    yaw: 0.62,
    pitch: 0.38,
    dist: 22,
    fov: 45,
    pos: M3.v3(),
  },
  tool: 'select',
  selectedId: null,
  cubeCounter: 0,
  // 人眼视图（透视学视角）：eyeView = 是否锁定，eyeViewAnim = 过渡动画
  eyeView: false,
  eyeViewAnim: null, // { phase:'in'|'out', t, fromPos, fromLook, toPos, toLook }
  camOrbit: null,    // 进入人眼视图前保存的轨道相机参数
  options: {
    showSightLine: true,
    showFrustum: true,
    frustumAngle: 45,
    showProjectionLines: true,
    showPerspective: true,
    showLabels: true,
    showParallelLines: true,
    showVanishingPoints: true,
    zoomSensitivity: 0.5, // 滚动缩放灵敏度（0.05~2）
  },
  warnings: [], // 每帧退化提示
};

// 由 yaw/pitch 计算视线方向 dir
PP.setEyeDir = function () {
  const e = PP.App.eye;
  const cp = Math.cos(e.pitch), sp = Math.sin(e.pitch);
  const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
  e.dir = M3.norm(M3.v3(cp * sy, sp, cp * cy));
};

// 立方体默认配色（多个立方体取不同色调）
const CUBE_COLORS = ['#3498db', '#e67e22', '#27ae60', '#8e44ad', '#d35400', '#16a085'];

PP.addCube = function (pos) {
  PP.App.cubeCounter += 1;
  const cube = {
    id: 'cube-' + PP.App.cubeCounter,
    name: '立方体' + PP.App.cubeCounter,
    position: pos || M3.v3(0, 1.5, -1),
    quat: M3.qIdentity(),
    size: 2,
    color: CUBE_COLORS[(PP.App.cubeCounter - 1) % CUBE_COLORS.length],
  };
  PP.App.cubes.push(cube);
  PP.App.selectedId = cube.id;
  return cube;
};

PP.removeCube = function (id) {
  PP.App.cubes = PP.App.cubes.filter((c) => c.id !== id);
  if (PP.App.selectedId === id) PP.App.selectedId = null;
};

PP.getSelectedCube = function () {
  return PP.App.cubes.find((c) => c.id === PP.App.selectedId) || null;
};

PP.findCube = function (id) {
  return PP.App.cubes.find((c) => c.id === id) || null;
};

// 立方体 8 个顶点（世界坐标）
PP.cubeVertices = function (cube) {
  const h = cube.size / 2;
  const local = [];
  for (let i = 0; i < 8; i++) {
    const x = (i & 1 ? 1 : -1) * h;
    const y = (i & 2 ? 1 : -1) * h;
    const z = (i & 4 ? 1 : -1) * h;
    local.push(M3.v3(x, y, z));
  }
  return local.map((v) => M3.add(cube.position, M3.qRotate(cube.quat, v)));
};

// 12 条棱（顶点索引对）：x/y/z 方向各 4 条
PP.CUBE_EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7], // x 方向
  [0, 2], [1, 3], [4, 6], [5, 7], // y 方向
  [0, 4], [1, 5], [2, 6], [3, 7], // z 方向
];

// 6 个面（顶点索引）
PP.CUBE_FACES = [
  [0, 1, 3, 2], [4, 6, 7, 5],
  [0, 4, 5, 1], [2, 3, 7, 6],
  [0, 2, 6, 4], [1, 5, 7, 3],
];

// 3 组平行线的世界方向（由四元数旋转局部三轴）
PP.cubeAxes = function (cube) {
  return [
    M3.qRotate(cube.quat, M3.v3(1, 0, 0)),
    M3.qRotate(cube.quat, M3.v3(0, 1, 0)),
    M3.qRotate(cube.quat, M3.v3(0, 0, 1)),
  ];
};

// 每帧调用：锁定画布时让画布垂直于视线（法线沿人眼方向 eye.dir）
PP.updateCanvasNormal = function () {
  const c = PP.App.canvas;
  if (c.lockToEye) {
    const d = M3.norm(PP.App.eye.dir);
    if (M3.len(d) > M3.EPS) c.normal = d;
  }
};

// 重置场景到默认布局
PP.resetScene = function () {
  PP.App.cubes.length = 0;
  PP.App.cubeCounter = 0;
  PP.App.selectedId = null;
  Object.assign(PP.App.eye, { pos: M3.v3(0, 3.5, 10), yaw: Math.PI, pitch: -0.4228 });
  PP.setEyeDir();
  Object.assign(PP.App.canvas, { center: M3.v3(0, 1.6, 3), normal: M3.v3(0, 0, 1), w: 12, h: 9, size: 1, lockToEye: true, shape: 'flat' });
  Object.assign(PP.App.camera, { target: M3.v3(0, 1.5, 0.5), yaw: 0.62, pitch: 0.38, dist: 22, fov: 45 });
  PP.App.tool = 'select';
  PP.App.eyeView = false;
  PP.App.eyeViewAnim = null;
  PP.App.camOrbit = null;
  PP.addCube(M3.v3(0, 1.5, -1));
};
