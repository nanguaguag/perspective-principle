# -*- coding: utf-8 -*-
"""独立验证：新平行线算法（平面透视）

不变量（透视投影下直线仍为直线）：
  A) 每组 4 条平行线投影后，其屏幕图像都通过同一点 VP（方向 dir 的投影）。
  B) 新算法输出的每条线段都落在该组图像直线（过 VP 与近平面交点）上。
  C) 当 VP 落在视口内时，线段远端点应精确收敛到 VP（在无穷远交于同一点）。

基准实现独立于 renderer.js：直接对真实 3D 直线在可见半支上几何采样。
"""
import math, random

def add(a,b): return (a[0]+b[0], a[1]+b[1], a[2]+b[2])
def sub(a,b): return (a[0]-b[0], a[1]-b[1], a[2]-b[2])
def scale(a,s): return (a[0]*s, a[1]*s, a[2]*s)
def dot(a,b): return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
def lenv(a): return math.hypot(a[0],a[1],a[2])
def norm(a):
    l=lenv(a)
    return (a[0]/l,a[1]/l,a[2]/l) if l>1e-9 else (0,0,0)

def cameraBasis(camPos, target, up=(0,1,0)):
    fwd=norm(sub(target,camPos))
    cx = fwd[1]*up[2]-fwd[2]*up[1]
    cy = fwd[2]*up[0]-fwd[0]*up[2]
    cz = fwd[0]*up[1]-fwd[1]*up[0]
    rl=math.hypot(cx,cy,cz)
    right=(cx/rl,cy/rl,cz/rl) if rl>1e-9 else (1,0,0)
    ux=right[1]*fwd[2]-right[2]*fwd[1]
    uy=right[2]*fwd[0]-right[0]*fwd[2]
    uz=right[0]*fwd[1]-right[1]*fwd[0]
    up2=norm((ux,uy,uz))
    return {'right':right,'up':up2,'fwd':fwd}

def toCam(p, camPos, basis):
    d=sub(p,camPos)
    return (dot(d,basis['right']), dot(d,basis['up']), dot(d,basis['fwd']))

def dirCam(dirv, camPos, basis):
    """世界方向 dirv 的相机空间坐标（toCam 会减去 camPos，故加回）"""
    return toCam(add(camPos, dirv), camPos, basis)

W,H=1200.0,800.0
fov=45.0; aspect=W/H
F=1/math.tan(math.radians(fov)/2)

def projectCam(c):
    return (c[0]/c[2]*F/aspect, c[1]/c[2]*F)   # (sx,sy) NDC

def screenOf(ndc):
    return ((ndc[0]+1)*0.5*W, (-ndc[1]+1)*0.5*H)

def worldToScreen(p,camPos,basis):
    c=toCam(p,camPos,basis)
    if c[2]<0.1: return None
    return screenOf(projectCam(c))

def refVP(dirv,camPos,basis):
    """方向 dirv 的灭点（独立基准，直接投影方向，任意朝向）"""
    c=dirCam(dirv,camPos,basis)   # 相机空间方向
    if abs(c[2])<1e-9: return None
    return screenOf(projectCam(c))

# ---------- 新算法（移植自 renderer.js） ----------
def rayRect(P,d):
    t0=0.0; t1=float('inf')
    for lo,hi,c in ((0,W,0),(0,H,1)):
        pc=P[c]; dc=d[c]
        if abs(dc)<1e-9:
            if pc<lo or pc>hi: return None
        else:
            ta=(lo-pc)/dc; tb=(hi-pc)/dc
            if ta>tb: ta,tb=tb,ta
            t0=max(t0,ta); t1=min(t1,tb)
            if t0>t1: return None
    return (t0,t1)

def rayToVP(P,d,vp):
    r=rayRect(P,d)
    if r is None: return None
    t0=max(0.0,r[0]); t1=r[1]
    if vp is not None and -0.5<=vp[0]<=W+0.5 and -0.5<=vp[1]<=H+0.5:
        tvp=(vp[0]-P[0])*d[0]+(vp[1]-P[1])*d[1]
        if tvp>=t0: t1=min(t1,tvp)
    if t1-t0<1e-6: return None
    return ( (P[0]+d[0]*t0, P[1]+d[1]*t0), (P[0]+d[0]*t1, P[1]+d[1]*t1) )

def clipSeg2D(a,b):
    t0=0.0;t1=1.0
    dx=b[0]-a[0]; dy=b[1]-a[1]
    p=[-dx,dx,-dy,dy]; q=[a[0],W-a[0],a[1],H-a[1]]
    for i in range(4):
        if abs(p[i])<1e-12:
            if q[i]<0: return None
        else:
            r=q[i]/p[i]
            if p[i]<0:
                if r>t1: return None
                if r>t0: t0=r
            else:
                if r<t0: return None
                if r<t1: t1=r
    if t1-t0<1e-6: return None
    return ((a[0]+t0*dx,a[1]+t0*dy),(a[0]+t1*dx,a[1]+t1*dy))

def vpScreen(dirv,camPos,basis):
    c=dirCam(dirv,camPos,basis)
    if abs(c[2])<1e-9: return None
    return screenOf(projectCam(c))

def newDrawParallelGroup(verts, edgePairs, dirv, camPos, basis):
    vpSc=vpScreen(dirv,camPos,basis)
    dc=dirCam(dirv,camPos,basis)
    dl=math.hypot(dc[0],dc[1])
    dScreen=(dc[0]/dl, dc[1]/dl) if dl>1e-9 else None
    fwd=basis['fwd']; near=0.1
    zdir=dc[2]
    segs=[]   # (edge_index, segment)
    for ei,pair in enumerate(edgePairs):
        A=verts[pair[0]]
        zA=dot(sub(A,camPos),fwd)
        if zA<near and zdir<=1e-9: continue
        if abs(zdir)<1e-9:
            aSc=worldToScreen(A,camPos,basis)
            if aSc is None: continue
            P=aSc; mode='line'
        else:
            t0=(near+0.05-zA)/zdir
            cSc=worldToScreen(add(A,scale(dirv,t0)),camPos,basis)
            if cSc is None: continue
            P=cSc; mode='ray'
        if mode=='ray' and vpSc is not None:
            vx=vpSc[0]-P[0]; vy=vpSc[1]-P[1]
            vl=math.hypot(vx,vy)
            if vl<1e-6: continue
            d=(vx/vl,vy/vl)
        else:
            if dScreen is None: continue
            d=dScreen
        if mode=='ray':
            res=rayToVP(P,d,vpSc)
        else:
            BIG=1e5
            res=clipSeg2D((P[0]-d[0]*BIG,P[1]-d[1]*BIG),(P[0]+d[0]*BIG,P[1]+d[1]*BIG))
        if res is not None:
            segs.append((ei,res))
    return segs, vpSc

# ---------- 基准：在可见半支上采样真实 3D 直线的投影 ----------
def sampleVisibleLine(A, dirv, camPos, basis, n=48):
    """返回可见半支上的屏幕采样点（几何采样，独立于新算法）"""
    fwd=basis['fwd']; near=0.1
    zA=dot(sub(A,camPos),fwd)
    zdir=dot(dirv,fwd)
    pts=[]
    if abs(zdir)<1e-9:
        if zA<near: return []
        # 整条可见：向正反两侧采样
        d0=2.0; Tmax=1e6; p=math.pow(Tmax/d0,1/(n-1))
        t=d0
        for k in range(n):
            for sgn in (1,-1):
                q=add(A,scale(dirv,sgn*t))
                sc=worldToScreen(q,camPos,basis)
                if sc: pts.append(sc)
            t*=p
        return pts
    t0=(near-zA)/zdir   # 近平面交点（zdir≠0）
    d0=0.2; Tmax=1e6; p=math.pow(Tmax/d0,1/(n-1))
    t=d0
    for k in range(n):
        if zdir>0:
            q=add(A,scale(dirv,t0+t))   # 可见半支：t>t0（向远增长）
        else:
            q=add(A,scale(dirv,t0-t))   # 可见半支：t<t0
        sc=worldToScreen(q,camPos,basis)
        if sc: pts.append(sc)
        t*=p
    return pts

def segLine(a,b):
    A=b[1]-a[1]; B=a[0]-b[0]; C=-(A*a[0]+B*a[1])
    return (A,B,C)

def distToLine(P,L):
    A,B,C=L
    return abs(A*P[0]+B*P[1]+C)/max(1e-9,math.hypot(A,B))

def cubeVerts(pos, quat, size=2.0):
    h=size/2; c=math.cos(quat); s=math.sin(quat)
    out=[]
    for i in range(8):
        x=(1 if i&1 else -1)*h
        y=(1 if i&2 else -1)*h
        z=(1 if i&4 else -1)*h
        rx=x*c+z*s; rz=-x*s+z*c
        out.append(add(pos,(rx,y,rz)))
    return out

def cubeAxes(quat):
    c=math.cos(quat); s=math.sin(quat)
    return [(c,0,s), (0,1,0), (-s,0,c)]

EDGE_GROUPS=[[[0,1],[2,3],[4,5],[6,7]],
             [[0,2],[1,3],[4,6],[5,7]],
             [[0,4],[1,5],[2,6],[3,7]]]

def run_scenario(tag, camPos, target, cubePos, quat):
    basis=cameraBasis(camPos,target)
    verts=cubeVerts(cubePos,quat)
    axes=cubeAxes(quat)
    ok=True
    for g in range(3):
        dirv=axes[g]
        new_segs,new_vp=newDrawParallelGroup(verts,EDGE_GROUPS[g],dirv,camPos,basis)
        tvp=refVP(dirv,camPos,basis)
        # A) 新算法输出的灭点 == 基准灭点
        if tvp is not None:
            if new_vp is None:
                print(f"[{tag}] g={g} 新算法灭点丢失（基准有灭点 {tvp[0]:.0f},{tvp[1]:.0f}）"); ok=False
            else:
                d=math.hypot(new_vp[0]-tvp[0],new_vp[1]-tvp[1])
                if d>1e-3:
                    print(f"[{tag}] g={g} 灭点偏差 {d:.3f}px"); ok=False
        else:
            if new_vp is not None:
                print(f"[{tag}] g={g} 基准无灭点但新算法有灭点"); ok=False
        # B) 逐边采样可见半支，验证该边新线段与之共线（各平行线图像不同，不可混比）
        edge_samples=[sampleVisibleLine(verts[pair[0]],dirv,camPos,basis) for pair in EDGE_GROUPS[g]]
        if tvp is not None:
            for ei,seg in new_segs:
                L=segLine(seg[0],seg[1])
                pts=edge_samples[ei]
                if not pts: continue
                # 该边基准采样点都应在该线上
                worst=max((distToLine(pt,L) for pt in pts), default=0.0)
                if worst>1.0:
                    print(f"[{tag}] g={g} 边{ei} 基准采样到新线段距离 {worst:.2f}px"); ok=False
                # 新线段延长线也应过灭点（基准图像直线）
                dseg=distToLine(tvp,L)
                if dseg>1.0:
                    print(f"[{tag}] g={g} 边{ei} 新线段到灭点距离 {dseg:.2f}px"); ok=False
        # C) VP 在视口内时，线段远端点（seg[1] 为朝向灭点端）收敛到灭点
        if tvp is not None and -0.5<=tvp[0]<=W+0.5 and -0.5<=tvp[1]<=H+0.5:
            for ei,seg in new_segs:
                b=seg[1]
                dA=math.hypot(b[0]-tvp[0],b[1]-tvp[1])
                if dA>3.0:
                    print(f"[{tag}] g={g} 线段端点未收敛到灭点 d={dA:.1f}px 端点=({b[0]:.0f},{b[1]:.0f}) 灭点=({tvp[0]:.0f},{tvp[1]:.0f})"); ok=False
        # D) 灭点在视口外时，线段方向应指向灭点（延长线应通过灭点）
        if tvp is not None and not(-0.5<=tvp[0]<=W+0.5 and -0.5<=tvp[1]<=H+0.5):
            for ei,seg in new_segs:
                L=segLine(seg[0],seg[1])
                dseg=distToLine(tvp,L)
                if dseg>1.0:
                    print(f"[{tag}] g={g} 灭点在视口外但线段延长线偏离 {dseg:.1f}px"); ok=False
    return ok

random.seed(7)
allok=True
allok &= run_scenario("默认", (10.4,8.6,14.2), (0,1.5,0.5), (0,1.5,-1), 0.0)
allok &= run_scenario("绕Y45", (10.4,8.6,14.2), (0,1.5,0.5), (0,1.5,-1), math.radians(45))
allok &= run_scenario("贴近", (0.2,1.5,6.0), (0,1.5,-1), (0,1.5,-1), 0.0)
allok &= run_scenario("俯视", (0.1,25.0,1.0), (0,1.5,0), (0,1.5,-1), 0.3)
# 轴向正对相机：zdir<0 的边界场景
allok &= run_scenario("轴向指向相机", (0,1.5,14.0), (0,1.5,-1), (0,1.5,-1), 0.0)
allok &= run_scenario("轴向指向相机_旋转", (0,1.5,14.0), (0,1.5,-1), (0,1.5,-1), math.radians(30))
for i in range(30):
    camPos=(random.uniform(-12,12), random.uniform(0.5,22), random.uniform(2,18))
    quat=random.uniform(-1.6,1.6)
    allok &= run_scenario(f"随机{i}", camPos, (0,1.5,0.5), (0,1.5,-1), quat)
print("ALL OK" if allok else "FAIL")
