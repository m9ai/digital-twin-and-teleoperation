import { Layout } from './components/Layout';
import { RobotViewer } from './components/RobotViewer';
import { TelemetryPanel } from './components/TelemetryPanel';
import { ControlDesk } from './components/ControlDesk';
import { VideoWall } from './components/VideoWall';
import { PointCloud } from './components/PointCloud';
import { JointJogPanel } from './components/JointJogPanel';
import { TrajectoryPanel } from './components/TrajectoryPanel';
import { ConnectionBar } from './components/ConnectionBar';
import { PWABadge } from './components/PWABadge';
import { URDFUploadPanel } from './components/URDFUploadPanel';
import { useROS } from './hooks/useROS';
import { useHeartbeat } from './hooks/useHeartbeat';
import { useTrajectoryRecorder } from './hooks/useTrajectoryRecorder';
import { useTrajectoryPlayback } from './hooks/useTrajectoryPlayback';
import { useEStopHotkey } from './hooks/useEStopHotkey';
import { useURDFStore } from './store/urdfStore';
import { useEffect } from 'react';

function App() {
  useROS();
  useHeartbeat();
  useTrajectoryRecorder();
  useTrajectoryPlayback();
  // Space latches the emergency stop from anywhere in the workspace.
  useEStopHotkey();

  // Load the bundled demo URDF into the store so that its joints can be
  // jogged and edited without an upload.
  const loadDefault = useURDFStore((s) => s.loadDefault);
  useEffect(() => {
    void loadDefault();
  }, [loadDefault]);

  return (
    <Layout>
      <PWABadge />
      <div className="flex flex-col h-full gap-4 p-4">
        <ConnectionBar />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
          <div className="lg:col-span-2 flex flex-col gap-4 min-h-0">
            <RobotViewer />
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 min-h-0">
              <PointCloud />
              <JointJogPanel />
              <TrajectoryPanel />
            </div>
          </div>
          <div className="flex flex-col gap-4 min-h-0 overflow-y-auto">
            <URDFUploadPanel />
            <VideoWall />
            <TelemetryPanel />
            <ControlDesk />
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default App;
