/* =========================================================
 * math.js — 轻量 3D 数学库（透视原理教程专用）
 * 向量用 {x,y,z}，四元数用 {x,y,z,w}，矩阵按需内联计算
 * ========================================================= */
const M3 = (function () {
  const EPS = 1e-6;
  const UP = { x: 0, y: 1, z: 0 };

  /* ---------------- Vec3 ---------------- */
  const v3 = (x, y, z) => ({ x, y, z });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  const len = (a) => Math.hypot(a.x, a.y, a.z);
  const dist = (a, b) => len(sub(a, b));
  const norm = (a) => {
    const l = len(a);
    return l > EPS ? { x: a.x / l, y: a.y / l, z: a.z / l } : v3(0, 0, 0);
  };
  const lerp = (a, b, t) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  });
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ---------------- Quaternion ---------------- */
  const qIdentity = () => ({ x: 0, y: 0, z: 0, w: 1 });
  const qAxisAngle = (axis, angle) => {
    const h = angle / 2, s = Math.sin(h), a = norm(axis);
    return { x: a.x * s, y: a.y * s, z: a.z * s, w: Math.cos(h) };
  };
  const qMul = (q1, q2) => ({
    x: q1.w * q2.x + q1.x * q2.w + q1.y * q2.z - q1.z * q2.y,
    y: q1.w * q2.y - q1.x * q2.z + q1.y * q2.w + q1.z * q2.x,
    z: q1.w * q2.z + q1.x * q2.y - q1.y * q2.x + q1.z * q2.w,
    w: q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z,
  });
  const qRotate = (q, v) => {
    // v' = v + 2w(u×v) + 2(u×(u×v))（要求单位四元数，避免长度/形状畸变）
    const u = { x: q.x, y: q.y, z: q.z }, s = q.w;
    const uv = cross(u, v), uuv = cross(u, uv);
    return add(add(v, scale(uv, 2 * s)), scale(uuv, 2));
  };
  const qNorm = (q) => {
    const l = Math.hypot(q.x, q.y, q.z, q.w);
    return l > EPS ? { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l } : qIdentity();
  };

  /* ---------------- 视口相机（环绕） ---------------- */
  // 由 target/yaw/pitch/dist 计算相机位置并返回正交基
  function camSetup(cam) {
    const cy = Math.cos(cam.pitch), sy = Math.sin(cam.pitch);
    const cx = Math.cos(cam.yaw), sx = Math.sin(cam.yaw);
    cam.pos = v3(
      cam.target.x + cam.dist * cy * sx,
      cam.target.y + cam.dist * sy,
      cam.target.z + cam.dist * cy * cx
    );
    return cameraBasis(cam);
  }
  function cameraBasis(cam) {
    const forward = norm(sub(cam.target, cam.pos));
    let right = cross(forward, UP);
    if (len(right) < EPS) right = v3(1, 0, 0);
    right = norm(right);
    const up = norm(cross(right, forward));
    return { right, up, forward };
  }
  // 由任意位置与注视点构造正交基（用于人眼视图等相机覆盖场景）
  function basisFrom(pos, look, up) {
    let forward = norm(sub(look, pos));
    if (len(forward) < EPS) forward = v3(0, 0, -1);
    let right = cross(forward, up);
    if (len(right) < EPS) right = v3(1, 0, 0);
    right = norm(right);
    const u = norm(cross(right, forward));
    return { right, up: u, forward };
  }
  function toCamSpace(p, camPos, basis) {
    const d = sub(p, camPos);
    return { x: dot(d, basis.right), y: dot(d, basis.up), z: dot(d, basis.forward) };
  }
  // 相机空间 → 屏幕（aspect = W/H），z 必须 > 近裁剪面
  function projectCam(c, fov, aspect) {
    const f = 1 / Math.tan((fov / 2) * (Math.PI / 180));
    const sx = (c.x / c.z) * f / aspect;
    const sy = (c.y / c.z) * f;
    return { sx, sy, z: c.z };
  }
  // 屏幕像素 → 世界射线（fov 为有效视场角，人眼视图下与视锥对齐）
  function screenRay(mx, my, cam, fov, W, H, basis) {
    const f = 1 / Math.tan((fov / 2) * (Math.PI / 180));
    const aspect = W / H;
    const ndcX = (mx / W) * 2 - 1;
    const ndcY = 1 - (my / H) * 2;
    const dirCam = { x: ndcX * aspect / f, y: ndcY / f, z: 1 };
    const dir = norm(add(add(scale(basis.right, dirCam.x), scale(basis.up, dirCam.y)), scale(basis.forward, dirCam.z)));
    return { origin: cam.pos, dir };
  }

  /* ---------------- 求交 ---------------- */
  function rayPlane(origin, dir, planeCenter, planeNormal) {
    const denom = dot(planeNormal, dir);
    if (Math.abs(denom) < EPS) return null;
    const t = dot(planeNormal, sub(planeCenter, origin)) / denom;
    return { t, point: add(origin, scale(dir, t)) };
  }
  function raySphere(origin, dir, center, radius) {
    const oc = sub(origin, center);
    const b = dot(oc, dir);
    const c = dot(oc, oc) - radius * radius;
    let h = b * b - c;
    if (h < 0) return null;
    h = Math.sqrt(h);
    const t = -b - h;
    return t >= 0 ? t : null;
  }
  function rayAABB(origin, dir, min, max) {
    let tmin = -Infinity, tmax = Infinity;
    const axes = ['x', 'y', 'z'];
    for (const a of axes) {
      const o = origin[a], d = dir[a];
      if (Math.abs(d) < EPS) {
        if (o < min[a] || o > max[a]) return null;
      } else {
        let t1 = (min[a] - o) / d, t2 = (max[a] - o) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmax >= 0 ? Math.max(tmin, 0) : null;
  }

  /* ---------------- 透视投影：点 → 画布 ---------------- */
  // 人眼 E 看向点 P，连线与画布平面 (C,N) 相交
  // 返回 { t, point }；若连线平行于画布返回 null
  function projectToCanvas(P, E, planeCenter, planeNormal) {
    const dir = sub(P, E);
    const denom = dot(planeNormal, dir);
    if (Math.abs(denom) < EPS) return null;
    const t = dot(planeNormal, sub(planeCenter, E)) / denom;
    return { t, point: add(E, scale(dir, t)) };
  }

  /* ---------------- 画布局部坐标 ---------------- */
  function canvasBasis(canvas) {
    const n = norm(canvas.normal);
    let u = cross(n, UP);
    if (len(u) < EPS) u = v3(1, 0, 0);
    u = norm(u);
    const v = norm(cross(n, u));
    return { n, u, v };
  }
  // 世界点 → 画布局部 (u,v)，判断是否在矩形内
  function pointOnCanvas(P, canvas, basis) {
    const d = sub(P, canvas.center);
    const pu = dot(d, basis.u);
    const pv = dot(d, basis.v);
    const s = canvas.size === undefined ? 1 : canvas.size;
    const hw = (canvas.w * s) / 2, hh = (canvas.h * s) / 2;
    return {
      u: pu,
      v: pv,
      on: Math.abs(pu) <= hw && Math.abs(pv) <= hh,
    };
  }

  return {
    EPS, UP, v3, add, sub, scale, dot, cross, len, dist, norm, lerp, clamp,
    qIdentity, qAxisAngle, qMul, qRotate, qNorm,
    camSetup, cameraBasis, basisFrom, toCamSpace, projectCam, screenRay,
    rayPlane, raySphere, rayAABB, projectToCanvas,
    canvasBasis, pointOnCanvas,
  };
})();
