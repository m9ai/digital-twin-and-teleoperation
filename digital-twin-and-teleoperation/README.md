# ROS 2 Digital Twin & Teleoperation

Web 端 ROS 2 机器人数字孪生与遥测系统，解决具身智能研发中依赖本地桌面环境、多源异构数据高延迟、多团队协同调试成本高三大痛点。

## 系统架构

```
+----------------+     WebSocket / WebRTC      +---------------------+     ROS 2 Topics
|  React Frontend |  <-------------------------> |  rosbridge_server   | <------------->  Edge Robot
| Three.js / RTC  |                              |  + WebRTC Gateway   |
+----------------+                               +---------------------+
```

- **Frontend**: React + TypeScript + Tailwind CSS + Three.js + ECharts + Zustand
- **Bridge**: `rosbridge_suite` WebSocket + `webrtc_ros` media gateway
- **Edge**: ROS 2 nodes publishing `/joint_states`, `/robot_telemetry`, `/points`, etc.

## 快速开始

```bash
cd digital-twin-and-teleoperation
npm install
npm run dev
```

打开浏览器访问 `http://localhost:5173`。

## 模式

- **Simulation**（默认）：无需 ROS 后端，前端自动生成模拟关节状态与遥测数据，用于 UI 验证。
- **Live ROS**：切换到 Live 模式并输入 `rosbridge_server` 地址（默认 `ws://localhost:9090`），连接真实 ROS 2 环境。

## ROS 2 边缘端启动示例

```bash
# 启动 rosbridge_server
ros2 launch rosbridge_server rosbridge_websocket_launch.xml

# 启动 webrtc_ros 视频网关
ros2 launch webrtc_ros webrtc_ros_launch.xml

# 发布测试 JointState
ros2 topic pub /joint_states sensor_msgs/JointState "{name: ['base_link_to_link1','link1_to_link2','link2_to_link3'], position: [0.2,0.3,0.05]}"
```

## 生产环境 URDF / Mesh 优化建议

为在浏览器中长期稳定运行复杂人形机器人（30+ 关节、数十个 mesh），建议做以下工程化优化：

1. **离线格式转换（STL → GLB）**
   - STL 是原始且冗余的格式，不含材质与层级。
   - 在 CI/CD 中用 Python + Open3D / Blender CLI 批量将 `.stl` 转为 `.glb`（GLTF 二进制）。
   - GLB 体积通常减少 60%~80%，天然支持 DRACO 几何压缩与 PBR 材质。
   - 本前端已支持直接上传 `.glb` / `.gltf` 作为 URDF mesh 资源。

2. **DRACO 压缩**
   - 对 GLB 启用 Draco 压缩可进一步降低传输与显存占用。
   - 如需支持 Draco GLB，可在 `src/lib/urdfScene.ts` 中为 `GLTFLoader` 注入 `DRACOLoader`。

3. **LOD（细节层次）**
   - 对远离相机的 link 使用降采样 mesh，减少三角面片数量。
   - 可在离线转换阶段生成多档 LOD 模型，运行时按距离切换。

4. **渲染性能**
   - 已默认对机器人节点关闭 `matrixAutoUpdate`，仅在 `/joint_states` 更新关节角度后重新计算世界矩阵。
   - 避免在动画循环中每帧遍历整棵树。

## 目录结构

```
src/
  components/     # UI 组件（RobotViewer、JointJogPanel、URDFEditor…）
  hooks/          # useROS、useGamepad、useHeartbeat、useWebRTC、useTrajectoryRecorder、useTrajectoryPlayback
  lib/            # ROS 客户端、URDF 场景、URDF 关节解析、全局引用
  store/          # Zustand 状态（机器人、连接、URDF）
  types/          # TypeScript 类型
public/
  assets/         # URDF / Mesh 资源
  icons/          # 矢量应用图标（any / maskable）
  screenshots/    # manifest 截图与 og:image
  favicon.svg     # 矢量 favicon
  robots.txt
  sitemap.xml
```

## 关节 Jog 说明

- 点击「接管关节」后，滑块目标值会覆盖仿真生成的位置，数字孪生立即跟随。
- Live ROS 模式下拖动滑块会以 `sensor_msgs/JointState` 发布到 `/joint_command`：

```bash
ros2 topic echo /joint_command
```

## 动作录制与回放

在「Motion Recorder」面板中完成示教 → 复现闭环：

1. **录制**：点击「录制」，系统会按关节状态到达时序采样（最小采样间隔 10ms，上限 20000 帧），再次点击「停止」生成一条轨迹并加入轨迹库。
2. **回放**：选中轨迹后点击「回放」。仿真模式下写入关节目标直接驱动数字孪生；Live 模式下以约 16Hz 下发 `/joint_command`。
3. **拖拽进度**：仿真模式下拖动进度条可让数字孪生停在该时刻姿态；Live 模式下拖拽只移动播放头，不会让真机瞬移。
4. **导入 / 导出**：轨迹以 JSON 文件导出，可直接分享给其他同事导入复现同一段动作。

轨迹文件格式：

```json
{
  "format": "embodied-ai.joint-trajectory",
  "version": 1,
  "trajectory": {
    "id": "traj-...",
    "name": "轨迹 1",
    "jointNames": ["joint1", "..."],
    "durationMs": 4200,
    "source": "simulation",
    "frames": [{ "t": 0, "position": [0.1, 0.2] }]
  }
}
```

安全约束：

- 回放按录制时间戳**线性插值**后下发，不直接下发原始关键帧，避免真机出现阶跃。
- Live 模式回放默认**锁定**，需显式点击「已锁定 → 已解锁」才会下发真机指令。
- 回放过程中一旦触发 E-Stop，回放立即中断并释放关节接管。

### 末端轨迹可视化

选中轨迹后，Digital Twin 视口会用青色折线画出末端执行器的运动路径：绿点为起点、橙点为终点、白点跟随播放头，左上角显示采样点数与路径长度（mm）。路径由 URDF 正向运动学实时求解（临时改写关节值后立刻还原，不影响实时姿态），切换 URDF 会自动重算。视口标题栏右侧的「轨迹」按钮可开关显示。

### 轨迹编辑

在 Motion Recorder 面板展开「编辑」：

- **时间缩放**：按倍率拉伸 / 压缩时间（2x 表示动作放慢一倍），关节位置不变。
- **抽稀间隔**：删除间隔小于设定值的帧并保留首末帧，用于压缩长时间录制。
- **裁剪区间**：只保留 [起点, 终点] 并把时间轴归一化为 0 起点，可用播放头快速取点。
- **拼接**：点击轨迹库中某条轨迹的拼接图标，把它追加到当前选中轨迹之后（关节必须一致），生成新轨迹。

### 导出 ROS 2 JointTrajectory

面板底部可导出 `trajectory_msgs/JointTrajectory`，直接喂给 `joint_trajectory_controller`：

- **控制步长**：按固定周期（如 50ms）重采样，填 0 保留原始帧。
- **速度**：由位置中心差分估计（rad/s），可关闭（置 0）。
- **格式**：`FollowJointTrajectory goal`（rosbridge `send_action_goal` 可直接使用）或纯 `JointTrajectory` 消息。
- **下发**：Live 模式且 ROS 已连接时，可直接发布到 `/joint_trajectory_controller/joint_trajectory`。

时间字段使用 ROS 2 的 `sec` / `nanosec` 命名。

## 核心功能

- URDF/XACRO 机器人模型加载与关节联动
- `/joint_states` 实时同步 Three.js 数字孪生
- URDF 在线编辑（Monaco）：XML 语法校验（含出错行号）、显式「应用到数字孪生」、还原与导出
- 关节 Jog 点动控制：滑块范围直接取自 URDF `<limit>`，仿真模式直驱数字孪生，Live 模式下发 `/joint_command`
- 动作录制与回放：录制关节轨迹（带时间戳），按录制时序插值回放，支持 0.5x/1x/2x 倍速、循环、进度拖拽与轨迹 JSON 导入导出；可编辑（时间缩放 / 抽稀 / 裁剪 / 拼接）、在视口中可视化末端路径，并导出为 ROS 2 `trajectory_msgs/JointTrajectory`
- ECharts 遥测时序图（电池、速度、温度）
- WebRTC 低延迟视频流（< 100ms 目标）：自建 WebSocket 信令（`ws://` / `wss://`）与标准 WHEP 端点（`http(s)://`）双通道接入
- Three.js `BufferGeometry` 实时点云渲染
- WebHID / HTML5 Gamepad API 遥控输入
- `/cmd_vel` Twist 指令下发
- 100ms 心跳 + 急停（E-Stop）安全保护
- PWA：可安装为桌面应用，应用外壳离线可用，新版本提示后手动更新
- SEO：完整 meta / Open Graph / JSON-LD、`robots.txt`、`sitemap.xml`，纯矢量图标

## 部署（Vercel）

使用 Vercel Git 集成，无需 GitHub Actions：推送 `main` 自动生产部署，PR 自动生成预览环境。

1. Vercel 导入仓库；若项目位于子目录，Root Directory 设为 `digital-twin-and-teleoperation`。
2. `.env` 已随仓库提交（仅含公开域名，无密钥），构建无需额外环境变量；绑定自定义域名后，可在 Vercel 项目里设 `VITE_SITE_URL` 覆盖，不用改代码。

> 不要同时启用 GitHub Actions 部署：会与 Git 集成重复触发两次构建。

`sw.js` 设为 `max-age=0, must-revalidate`，确保新版本能被立即发现；`assets/` 带 hash 故可长缓存。

## PWA（可安装 / 离线）

由 `vite-plugin-pwa`（Workbox `generateSW`）提供，构建时产出 `dist/manifest.webmanifest` 与 `dist/sw.js`。

| 策略 | 选择 | 原因 |
|---|---|---|
| 更新方式 | `registerType: 'prompt'` | **遥操作会话中绝不能自动 reload**。新构建只通过右下角提示条告知，由操作者确认后更新 |
| 预缓存 | 仅应用外壳（`js/css/html/svg/woff2`，约 2MB） | Three.js / ECharts 版本稳定，值得缓存；URDF 与 mesh 由用户提供且体积大，刻意排除 |
| 导航请求 | 不进入运行时缓存 | 避免旧 `index.html` 遮挡刚部署的新版本 |
| Monaco CDN | `CacheFirst`，30 天 | 默认从 jsdelivr 加载，缓存后 URDF 编辑器离线可用 |
| 跨源 URDF / mesh | 不缓存 | 用户远程模型可能随时变化，不做过期猜测 |

- **图标**：`public/favicon.svg`、`public/icons/icon.svg`（purpose `any`）、`public/icons/icon-maskable.svg`（purpose `maskable`，图形收缩到 80% 安全区）——全部为矢量，无位图。
- **界面 logo**：`src/components/BrandLogo.tsx` 复用同一套几何（`currentColor` + 橙色关节），已用于顶栏。
- **状态提示**：`src/components/PWABadge.tsx` 负责「新版本可用」「安装为桌面应用」「离线已就绪」。
- **本地验证**：`npm run build && npm run preview`，浏览器地址栏出现安装按钮即生效。Service Worker 只在 `https://` 或 `localhost` 下工作，局域网 IP 访问时不会注册。
- 已知限制：iOS Safari 的 `apple-touch-icon` 只接受位图，当前指向 SVG，添加到主屏时 iOS 会回退为页面截图；如需完美效果，可额外导出 PNG 并改回 `index.html` 中的该标签。

## SEO

- `index.html`：`title` / `description` / `keywords` / `canonical` / `robots`、Open Graph、Twitter Card、`WebApplication` JSON-LD（含 `featureList`）、`noscript` 兜底，以及 `theme-color`、`apple-mobile-web-app-*` 等安装元数据。
- `public/robots.txt`、`public/sitemap.xml`：单页应用只有 `/` 一个 URL。
- 站点域名通过 `.env` 的 `VITE_SITE_URL` 注入（构建时替换 `%VITE_SITE_URL%`）。

绑定自定义域名时替换三处（`VITE_SITE_URL`、`<loc>`、Sitemap 行），保持一致：

```bash
sed -i '' 's#embodied-ai-platform.vercel.app#your-domain.com#g' \
  .env public/sitemap.xml public/robots.txt
```

`og:image` / `manifest.screenshots` 复用 `public/screenshots/` 下的界面截图（1280×720，由 `editor-mode.png`、`editor-test.png` 复制而来）；社交平台不支持 SVG 预览图，故此处保留 PNG。
