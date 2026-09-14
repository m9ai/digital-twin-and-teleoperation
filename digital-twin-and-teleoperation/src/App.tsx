import { Layout } from './components/Layout';
import { RobotViewer } from './components/RobotViewer';
import { TelemetryPanel } from './components/TelemetryPanel';
import { ControlDesk } from './components/ControlDesk';
import { VideoStream } from './components/VideoStream';
import { PointCloud } from './components/PointCloud';
import { ConnectionBar } from './components/ConnectionBar';
import { URDFUploadPanel } from './components/URDFUploadPanel';
import { useROS } from './hooks/useROS';
import { useHeartbeat } from './hooks/useHeartbeat';

function App() {
  useROS();
  useHeartbeat();

  return (
    <Layout>
      <div className="flex flex-col h-full gap-4 p-4">
        <ConnectionBar />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
          <div className="lg:col-span-2 flex flex-col gap-4 min-h-0">
            <RobotViewer />
            <PointCloud />
          </div>
          <div className="flex flex-col gap-4 min-h-0">
            <URDFUploadPanel />
            <VideoStream />
            <TelemetryPanel />
            <ControlDesk />
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default App;
