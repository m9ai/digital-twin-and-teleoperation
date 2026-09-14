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
