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
  components/     # UI 组件
  hooks/          # useROS、useGamepad、useHeartbeat、useWebRTC
  lib/            # ROS 客户端、URDF 场景、全局引用
  store/          # Zustand 状态（机器人、连接）
  types/          # TypeScript 类型
public/assets/    # URDF / Mesh 资源
```

## 核心功能

- URDF/XACRO 机器人模型加载与关节联动
- `/joint_states` 实时同步 Three.js 数字孪生
- ECharts 遥测时序图（电池、速度、温度）
- WebRTC 低延迟视频流（< 100ms 目标）
- Three.js `BufferGeometry` 实时点云渲染
- WebHID / HTML5 Gamepad API 遥控输入
- `/cmd_vel` Twist 指令下发
- 100ms 心跳 + 急停（E-Stop）安全保护
