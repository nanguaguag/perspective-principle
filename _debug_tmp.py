# -*- coding: utf-8 -*-
"""调试：单个场景打印 基准采样点 / 灭点 / 新线段 的具体屏幕坐标"""
import math, random
import sys
sys.path.insert(0, '/Users/huzongyao/WeChatProjects/perspective-principle')

# 复用验证脚本中的函数（手动复制关键部分，避免导入副作用）
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
    return toCam(add(camPos, dirv), camPos, basis)
W,H=1200.0,800.0
fov=45.0; aspect=W/H
F=1/math.tan(math.radians(fov)/2)
def projectCam(c): return (c[0]/c[2]*F/aspect, c[1]/c[2]*F)
def screenOf(ndc): return ((ndc[0]+1)*0.5*W, (-ndc[1]+1)*0.5*H)
def worldToScreen(p,camPos,basis):
    c=toCam(p,camPos,basis)
    if c[2]<0.1: return None
    return screenOf(projectCam(c))
def refVP(dirv,camPos,basis):
    c=dirCam(dirv,camPos,basis)
    if abs(c[2])<1e-9: return None
    return screenOf(projectCam(c))

def sampleVisibleLine(A, dirv, camPos, basis, n=48):
    fwd=basis['fwd']; near=0.1
    zA=dot(sub(A,camPos),fwd)
    zdir=dot(dirv,fwd)
    pts=[]
    if abs(zdir)<1e-9:
        if zA<near: return []
        d0=2.0; Tmax=1e6; p=math.pow(Tmax/d0,1/(n-1))
        t=d0
        for k in range(n):
            for sgn in (1,-1):
                q=add(A,scale(dirv,sgn*t))
                sc=worldToScreen(q,camPos,basis)
                if sc: pts.append(sc)
            t*=p
        return pts
    t0=(near-zA)/zdir
    d0=0.2; Tmax=1e6; p=math.pow(Tmax/d0,1/(n-1))
    t=d0
    for k in range(n):
        if zdir>0:
            q=add(A,scale(dirv,t0+t))
        else:
            q=add(A,scale(dirv,t0-t))
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

random.seed(7)
camPos=(random.uniform(-12,12), random.uniform(0.5,22), random.uniform(2,18))
target=(0,1.5,0.5); cubePos=(0,1.5,-1); quat=random.uniform(-1.6,1.6)
basis=cameraBasis(camPos,target)
verts=cubeVerts(cubePos,quat)
axes=cubeAxes(quat)
print("camPos=", tuple(round(x,2) for x in camPos), " quat=", round(quat,3))
for g in range(3):
    dirv=axes[g]
    A=verts[EDGE_GROUPS[g][0][0]]
    tvp=refVP(dirv,camPos,basis)
    pts=sampleVisibleLine(A,dirv,camPos,basis)
    print(f"\n== g={g} dir=({round(dirv[0],3)},{round(dirv[1],3)},{round(dirv[2],3)}) zdir={round(dot(dirv,basis['fwd']),4)} ==")
    print("  VP(基准)=", None if tvp is None else (round(tvp[0],1),round(tvp[1],1)))
    print("  基准采样点:")
    for p in pts:
        print(f"    ({p[0]:9.1f},{p[1]:9.1f})")
    # 这些点两两共线吗？取首尾两点连线，看中间点距离
    if len(pts)>=3:
        L=segLine(pts[0],pts[-1])
        worst=max(distToLine(p,L) for p in pts)
        print(f"  基准点自共线性 worst={worst:.3f}px")
        if tvp is not None:
            print(f"  基准点延长线到VP距离={distToLine(tvp,L):.3f}px")
