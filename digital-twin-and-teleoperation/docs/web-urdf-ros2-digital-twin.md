# 浏览器里的 URDF 数字孪生：从 STL 渲染到 ROS 2 高频数据同步的工程落地

> 关键词：ROS 2 / rosbridge / URDF / Three.js / WebRTC / 环形缓冲 / Draco / Service Worker
>
> 本文记录我们把一个「能跑」的 Web 机器人上位机，打磨成「敢在现场演示」的具身智能上位机的完整过程。所有结论都来自真实代码，可直接对照 `src/` 阅读。

---

## 0. 问题起点

第一版做完之后，功能清单是齐的：URDF 能渲染、`/joint_states` 能动、能 jog、能录轨迹、能看视频。但一上真机就暴露了四个硬伤：

| 现象 | 根因 |
| --- | --- |
| 拖一个 6 轴机械臂，画面一卡一卡 | 100 Hz 的 `/joint_states` 直接灌进 React state，每帧触发全量 re-render |
| 打开模型要等 8~10 秒 | URDF 引用的是裸 `.stl`，几十 MB 无索引网格，主线程重建 buffer |
| 想让末端走到某个点，只能一格一格点 jog | 没有笛卡尔空间的直接操作入口 |
| 演示时对方说"你这得连机器人吧" | 没有开箱即用的 Demo 模式，销售演示链路断在第一屏 |

下面按「交互 → 性能 → 商业化」三条线，讲我们怎么做。

---

## 1. 交互：把「能看」变成「能操作」

### 1.1 3D Gizmo：直接拖拽 TCP 下发 IK 目标

思路很直接：用 `TransformControls` 绑定一个代理 `Object3D`，让它每帧跟随末端执行器的世界变换。

关键在于**参考系**。操作者在世界坐标系里拖，而 IK 解算器要的是**机器人基座坐标系**下的位姿。所以发布前必须把世界位姿左乘基座世界矩阵的逆：

```ts
// src/lib/scene/tcpGizmo.ts —— 位置与姿态分别处理
const position = worldPosition.clone().applyMatrix4(inverse);
const orientation = referenceQuaternion.clone().invert().multiply(worldQuaternion);
```

姿态这里有个坑：不能直接对四元数做矩阵变换。正确做法是取基座的世界四元数取逆后左乘——这样旋转部分才对（如果基座含缩放，矩阵变换会把缩放混进四元数）。

三个工程细节：

1. **点击召唤**：在末端挂一个 `depthTest: false` 的小球，用 `pointerdown/pointerup` 位移 < 4px 判定为「点击」而非「旋转视角」，再 raycast 命中即开关 Gizmo。
2. **拖拽时接管相机**：监听 `dragging-changed`，把 `OrbitControls.enabled` 置反，否则拖轴会把视角甩飞。
3. **限流发布**：`objectChange` 在拖拽中每帧都触发，按 50 ms 节流下发 `/ik_target`（`geometry_msgs/PoseStamped`），松手再补一帧 `end`。

还有个容易被忽略的点：**数字孪生是关节驱动的**。你在屏幕上把 TCP 拖走了，但机器人还没走到，代理轴必须立刻弹回真实 TCP，否则下一次拖拽的起点就是错的。所以 `dragging-changed` 结束时强制 `syncProxyToTCP()`。

### 1.2 相机预设：四种视角 + 无依赖缓动

四种视角分别是 `Perspective / Head-Cam / Top-Down / TCP-Follow`。

这里没有引入 `tween.js`。视角过渡本来就必须跑在 `requestAnimationFrame` 里，再挂一个独立的 tween 引擎等于两套时间轴，反而容易和渲染循环打架。我们直接在渲染循环里推进一个 `easeInOutCubic` 插值：

```ts
// src/lib/scene/cameraDirector.ts
tweenElapsed += deltaMs;
const k = easeInOutCubic(Math.min(1, tweenElapsed / TWEEN_DURATION_MS));
camera.position.lerpVectors(fromPosition, toPosition, k);
controls.target.lerpVectors(fromTarget, toTarget, k);
```

两个设计决定：

- **预设不写死坐标**，而是从模型包围球推导（`getBounds()`）。换一台机器人，取景自动缩放。
- **TCP-Follow 是连续模式而非一次性快照**。每帧把相机 `lerp` 到 `TCP + offset`，`offset` 在切入时按当前取景捕获，所以操作者先调好距离再开跟随，手感可控。任何手动 orbit/zoom（`controls` 的 `start` 事件）立即退出跟随——**人的操作永远优先**。

帧率无关的平滑也值得抄一下。直接 `lerp(a, b, 0.14)` 在 144 Hz 屏上会明显比 60 Hz 快，正确写法是：

```ts
const alpha = 1 - Math.pow(1 - FOLLOW_SMOOTHING, deltaMs / 16.67);
```

### 1.3 安全：急停、限界、碰撞

**急停**做了三层冗余：

1. Header 常驻按钮（任何视图都可达）；
2. 全局 `Space` 快捷键，**capture 阶段**监听，保证不管焦点在哪个面板都能触发；
3. 触发时同时发 `/emergency_stop`（`std_msgs/Bool` **latch**）和零速 `/cmd_vel`——不是所有底盘都认急停 latch。

`Space` 的处理有两个必须做的保护：

```ts
if (isTextEntry(event.target)) return;   // 输入框 / Monaco 里输入空格不能被吞
event.preventDefault();                  // 阻止滚动 & 阻止再次激活 focus 的按钮
```

另外**松开急停必须显式点击**，快捷键只负责「拍下去」，避免误触恢复造成危险。

发布用了**发布者缓存**。原来每次 `publish` 都 new 一个 `ROSLIB.Topic`，等于每次都在 bridge 上重新 advertise 一遍并泄漏句柄：

```ts
let topic = this.publishers.get(`${topicName}|${messageType}`);
if (!topic) { topic = new ROSLIB.Topic({...}); this.publishers.set(key, topic); }
```

**限界与碰撞预警**则落在 `src/lib/safetyMonitor.ts`：

- 限界：取 URDF `<limit>` 的上下界，算归一化余量 `margin`，> 90% 行程发 `warn`，越界发 `violation`。`continuous` 关节（`lower/upper` 为 ±π）直接跳过，否则会永远报警。
- 碰撞：用**包围球近距**做廉价自碰撞近似。每 120 ms 算一次所有连杆的世界包围球，排除运动学相邻对（父子关节），间距 < 20 mm 报警、< 2 mm 判越限。全网格碰撞检测在这个频率下不现实，包围球足够给操作者「要撞了」的提示。

高亮部分（`src/lib/scene/safetyHighlight.ts`）有个必须注意的点：**材质可能是共享的**。我们先遍历收集每个 link 的材质，再改动 `emissive`，并且每次更新前先还原上一轮记录的原值——否则高亮会「粘」在模型上退不掉。`violation` 级别额外加了呼吸脉冲（`update(deltaMs)` 驱动），在现场大屏上很难忽视。

---

## 2. 性能：把「能跑」变成「流畅」

### 2.1 高频数据流与渲染解耦

这是收益最大的一处改造。原来的链路是：

```
WebSocket 100Hz → setJointState(msg) → React re-render → Three.js 更新
```

问题有两层：100 Hz 的 React re-render 本身浪费；更糟的是 WebSocket 到达是**突发的**（一帧里可能来 3 条，下一帧来 0 条），直接赋值会让模型肉眼可见地抖动。

改造后的链路：

```
WebSocket 100Hz → jointBus（旁路发布订阅）→ RingBuffer（Float64Array）
                                                    ↓
         requestAnimationFrame 60Hz → sampleInto(now - delay) → 线性插值 → applyJointPositions
```

三个要点：

**① 旁路总线**。`/joint_states` 写进 `jointBus`，完全不经过 React。UI 面板（遥测、jog 反馈）另外走 10 Hz 节流的 zustand 更新——它们本来也不需要 100 Hz。这样 React 的 re-render 频率从 100 Hz 降到 10 Hz，3D 视图降到 0 Hz（由渲染循环自己拉数据）。

**② 环形缓冲**。`JointStateStream` 用两个 `Float64Array`（时间戳 + `capacity × dof` 的位置）预分配，写入零 GC。`sampleInto(t)` 用二分查找定位夹住目标时刻的两个样本：

```ts
// timeAt() 随 k 递减：找到 lo（较新，>= target）和 hi（较旧，<= target）
while (hi - lo > 1) {
  const mid = (lo + hi) >> 1;
  if (this.timeAt(mid) >= target) lo = mid; else hi = mid;
}
const alpha = (target - t0) / (t1 - t0);
out[i] = a + delta * alpha;
```

**播放延迟（默认 80 ms）是关键**：它保证渲染时刻几乎总能找到两个夹住它的样本，从而永远有得插值。代价是 80 ms 的确定性延迟——对遥操作来说，80 ms 的确定性延迟远比「时快时慢的抖动」可接受。

连续关节（`continuous`）插值要走最短弧，否则从 +179° 到 -179° 会转一整圈：

```ts
if (Math.abs(delta) > Math.PI) delta -= Math.sign(delta) * Math.PI * 2;
```

**③ 关节名变更自动 reset**。换模型时 dof 或名字变化，缓冲必须整体失效，否则会拿旧模型的名字去索引新模型。

UI 上我们把实测输入频率显示出来（`{inputRateHz} Hz`）——这既是性能指示，也是现场排查 rosbridge 是否掉速的第一眼信息。

### 2.2 模型资产：STL → GLB + Draco

**为什么必须离线转换**：二进制 STL 每个三角面独立存 3 个顶点 + 1 个法线（50 字节/面），无索引、无层级、无材质。浏览器拿到后要在主线程重建索引缓冲，这才是"打开要等 10 秒"的真正瓶颈（不是下载）。转成 Draco 压缩的 GLB 通常小 8~15 倍，而且在 worker 里解码。

`scripts/stl_to_glb.py` 支持两个引擎：

```bash
# trimesh（纯 Python，CI 友好）
python scripts/stl_to_glb.py meshes/ --out meshes_glb --draco

# Blender CLI（对病态导出更稳）
python scripts/stl_to_glb.py meshes/ --out meshes_glb --engine blender \
  --blender /Applications/Blender.app/Contents/MacOS/Blender

# 顺带把 URDF 里的 mesh 引用改写成 .glb
python scripts/stl_to_glb.py meshes/ --out meshes_glb --draco \
  --urdf robot.urdf --urdf-out robot_glb.urdf
```

转换前会做 `remove_degenerate_faces / merge_vertices / fix_normals`——CAD 导出的 STL 经常缺法线或有退化面，不修的话 PBR 打光出来是块状的花脸。

**Draco 解码器必须同源托管**，否则离线打不开。我们加了一个构建脚本把 three.js 自带的解码器拷进 `public/draco/`：

```jsonc
"prepare:assets": "node scripts/copy-draco.mjs",   // dev/build 前自动执行
```

### 2.3 缓存：Service Worker + IndexedDB 双保险

**Service Worker 覆盖网络资源**。在 `vite.config.ts` 的 workbox `runtimeCaching` 里加了两条规则：

```ts
// .stl/.glb/.gltf/.bin/.dae/.obj —— CacheFirst + rangeRequests
{ urlPattern: /\.(stl|glb|gltf|bin|dae|obj)(\?.*)?$/i, handler: 'CacheFirst', ... }
// .urdf/.xacro/.xml —— StaleWhileRevalidate（URDF 会被编辑，不能永久缓存）
{ urlPattern: /\.(urdf|xacro|xml)(\?.*)?$/i, handler: 'StaleWhileRevalidate', ... }
```

**但 SW 有个覆盖不到的盲区**：本应用上传的 URDF 包，会把 mesh 解析成 `blob:` URL 再交给 loader。`blob:` 请求 SW 拦截不了。所以补了一层 IndexedDB 字节缓存（`src/lib/meshCache.ts`）：

```ts
const cacheKey = getMeshCacheKeyForUrl(path) ?? path;
const cached = await readMeshCache(cacheKey);      // 命中直接返回 ArrayBuffer
```

缓存 key 不能用 blob URL（每次会话都变），而是用 **文件名 + size + mtime** 作为文件身份。LRU 上限 120 条，超限按 `savedAt` 淘汰。全部 best-effort：IndexedDB 不可用（隐私模式/配额满）时静默退化为内存 Map + 普通 fetch。

另外 `GLTFLoader` 统一挂上了 `DRACOLoader`，否则上一步产出的压缩 GLB 根本解不开；ASCII STL 也要识别（`solid` 头），因为 `STLLoader.parse()` 只认二进制。

### 2.4 视频：WebRTC 与真实延迟

视频走 WebRTC P2P（`webrtc_ros` 自定义 WebSocket 信令，或标准 WHEP）。这一轮补了两件事：

**真实延迟**。原来 `latencyMs` 是写死的 null。现在每秒采样 `pc.getStats()`：

```
latency ≈ currentRoundTripTime / 2 + jitterBufferDelay / jitterBufferEmittedCount
```

「单程网络 + 接收端抖动缓冲」正是操作者判断"能不能 safely 遥操作"的那个数。UI 上 ≤100 ms 显示绿色，超出转黄。

**多摄像头画中画**（`VideoWall`）。多路 tile 网格监控，任意一路可用 Picture-in-Picture 弹出——注意浏览器**同时只允许一个 PiP 元素**，所以按钮是「切换当前弹出项」而不是叠加窗口。相机配置持久化在 localStorage，现场插拔相机后刷新不丢配置。

---

## 3. 商业化：把「需要环境」变成「打开即用」

### 3.1 Demo / Mock 模式

销售演示的第一要求：**不能要求对方先装 ROS 2**。

`src/lib/mockRobot.ts` 从 URDF 里解析出的关节限界出发，给每个关节分配不同的频率和相位偏移：

```ts
omega: BASE_OMEGA * (1 + index * 0.17),   // 逐个失谐，避免整臂像刚体一样同步摆动
phase: index * 0.9,
amplitude: min(halfSpan * 0.42, 1.1),     // 严格在限界内，永不触发越限告警
```

正弦是 C∞ 连续的，不会出现速度突变；失谐让动作看起来有"生命感"；振幅由限界推导，所以**任何 URDF 都不会演示到越界**。

关键是 Mock 也要跑 **100 Hz**——不是 10 Hz。否则根本验证不了上面那套插值链路，也骗不过内行的眼睛。数据源切换做在侧边栏：`Demo / Mock` ↔ `真实 ROS 2 节点`，默认前者。

### 3.2 组件化沉淀

核心逻辑抽成了 `<RobotTwin />`，一个自洽的 React 组件：

```tsx
<RobotTwin
  urdfUrl={blobUrl}          // null 时自动降级到程序化机械臂
  joints={joints}            // URDF 关节定义：驱动安全校验与插值
  trajectoryPath={points}    // 末端轨迹折线
  playhead={point}           // 播放头
  onPoseChange={publishIK}   // Gizmo 拖拽回调
  onSafety={showWarnings}    // 安全评估报告（~8 Hz）
  showToolbar                // 内置视角 + Gizmo 工具条
/>
```

内部封住了全部脏活：Three.js 生命周期、ResizeObserver、环形缓冲订阅、渲染帧插值、Gizmo、相机预设、安全高亮。对外只剩 props + 回调，`RobotViewer` 变成 100 行的胶水层。

一个容易踩的坑写在注释里了：**回调要用 ref 存**，否则父组件每次 inline 箭头函数都会让渲染循环 effect 重新挂载，画面会周期性卡一帧。

```ts
const poseHandlerRef = useRef(onPoseChange);
poseHandlerRef.current = onPoseChange;   // 不进 deps
```

---

## 4. 成果与踩坑清单

改造后的关键指标：

| 项 | 改造前 | 改造后 |
| --- | --- | --- |
| React re-render（joint_states） | 100 Hz | 10 Hz（3D 视图 0 Hz） |
| 渲染数据源 | 突发直写 | 80 ms 播放延迟 + 线性插值 |
| 模型首次/二次加载 | 8~10 s | Draco GLB 后二次加载走本地缓存 |
| 遥操作入口 | 仅 jog 点动 | Gizmo 直接下发 `/ik_target` |
| 演示前置条件 | 需要 ROS 2 现场 | 打开即用（默认 Demo 模式） |

踩过的坑，按痛感排序：

1. **四元数不能用矩阵做参考系变换**（要用四元数取逆左乘）。
2. **材质共享**会让高亮"传染"到无关 link，必须按 link 收集材质并逐轮还原。
3. **`blob:` URL 无法被 Service Worker 拦截**——必须有 In-DB 兜底。
4. **ASCII STL 与二进制 STL 的魔数不同**，`parse()` 只认后者。
5. **`lerp` 系数要按 deltaTime 归一化**，否则高刷屏行为不一致。
6. **每次 publish 都 new Topic** 会在 rosbridge 上泄漏 advertise。
7. **回调进 effect deps** 会导致渲染循环被反复重建。

---

## 5. 下一步

- **IK 闭环**：目前只下发目标位姿，浏览器侧没有解算。下一步把 `KDL`/`ikfast` 的 WASM 版本接进来，拖 Gizmo 直接驱动关节角，形成完整闭环。
- **真实碰撞检测**：包围球换成 BVH + GJK（three-mesh-bvh），把预警从"提示"升级为"拦截"。
- **`webrtc_ros` 深度对接**：目前是通用 WHEP/自定义信令，下一步直接对接 DataChannel 传力控与触觉反馈。
- **多机协同**：`RobotTwin` 已经支持多实例，加一个场景级时间同步即可做多臂协同监控。

---

> 项目地址：`digital-twin-and-teleoperation`
> 核心代码：`src/lib/scene/`（场景运行时）、`src/lib/jointStream.ts`（环形缓冲）、`src/components/RobotTwin.tsx`（通用组件）
