import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Move, RotateCcw, Send, ShieldAlert } from 'lucide-react';
import { useURDFStore } from '@/store/urdfStore';
import { useRobotStore } from '@/store/robotStore';
import { useConnectionStore } from '@/store/connectionStore';
import { rosClientRef } from '@/lib/rosRef';
import { clampToJointLimits, type URDFJointDefinition } from '@/lib/urdfJoints';

const PUBLISH_INTERVAL_MS = 60;
const LOG_THROTTLE_MS = 500;

/**
 * Manual joint jogging.
 *
 * - Simulation mode: targets are merged into the synthetic /joint_states so
 *   the digital twin follows the sliders directly.
 * - Live ROS mode: targets are published as sensor_msgs/JointState on
 *   /joint_command for the robot controller to execute.
 */
export function JointJogPanel() {
  const { joints } = useURDFStore();
  const {
    jointState,
    jointTargets,
    jogActive,
    eStop,
    setJointTarget,
    setJointTargets,
    setJogActive,
    clearJointTargets,
    addLog,
  } = useRobotStore();
  const { useSimulation } = useConnectionStore();

  const publishTimer = useRef<number | null>(null);
  const lastLogAt = useRef(0);

  const feedbackFor = useCallback(
    (name: string): number | undefined => {
      const index = jointState.name.indexOf(name);
      return index >= 0 ? jointState.position[index] : undefined;
    },
    [jointState]
  );

  const activateJog = useCallback(() => {
    const seed: Record<string, number> = {};
    for (const joint of joints) {
      seed[joint.name] = feedbackFor(joint.name) ?? 0;
    }
    setJointTargets(seed);
    setJogActive(true);
    addLog(`Joint jog enabled for ${joints.length} joints`);
  }, [joints, feedbackFor, setJointTargets, setJogActive, addLog]);

  const deactivateJog = useCallback(() => {
    setJogActive(false);
    clearJointTargets();
    addLog('Joint jog released');
  }, [setJogActive, clearJointTargets, addLog]);

  const schedulePublish = useCallback(() => {
    if (publishTimer.current !== null) return;
    publishTimer.current = window.setTimeout(() => {
      publishTimer.current = null;
      const targets = useRobotStore.getState().jointTargets;
      const names = useURDFStore.getState().joints.map((j) => j.name);
      if (names.length === 0) return;

      const positions = names.map((name) => targets[name] ?? 0);
      try {
        rosClientRef.current?.publishJointCommand(names, positions);
        const now = Date.now();
        if (now - lastLogAt.current > LOG_THROTTLE_MS) {
          lastLogAt.current = now;
          addLog(`Published /joint_command (${names.length} joints)`);
        }
      } catch (err) {
        addLog(`Joint command failed: ${err instanceof Error ? err.message : 'ROS not connected'}`);
      }
    }, PUBLISH_INTERVAL_MS);
  }, [addLog]);

  useEffect(
    () => () => {
      if (publishTimer.current !== null) {
        window.clearTimeout(publishTimer.current);
      }
    },
    []
  );

  const handleChange = useCallback(
    (joint: URDFJointDefinition, rawValue: number) => {
      if (eStop) return;
      if (!jogActive) activateJog();
      const value = clampToJointLimits(joint, rawValue);
      setJointTarget(joint.name, value);
      if (!useSimulation) schedulePublish();
    },
    [eStop, jogActive, activateJog, setJointTarget, useSimulation, schedulePublish]
  );

  const handleZeroAll = useCallback(() => {
    if (eStop) return;
    const zeroed: Record<string, number> = {};
    for (const joint of joints) {
      zeroed[joint.name] = clampToJointLimits(joint, 0);
    }
    setJointTargets(zeroed);
    if (!jogActive) setJogActive(true);
    if (!useSimulation) schedulePublish();
    addLog('All joint targets zeroed');
  }, [eStop, joints, setJointTargets, jogActive, setJogActive, useSimulation, schedulePublish, addLog]);

  const handlePublishOnce = useCallback(() => {
    const names = joints.map((j) => j.name);
    if (names.length === 0) return;
    const positions = names.map((name) => useRobotStore.getState().jointTargets[name] ?? 0);
    try {
      rosClientRef.current?.publishJointCommand(names, positions);
      addLog(`Published /joint_command (${names.length} joints)`);
    } catch (err) {
      addLog(`Joint command failed: ${err instanceof Error ? err.message : 'ROS not connected'}`);
    }
  }, [joints, addLog]);

  const rows = useMemo(
    () =>
      joints.map((joint) => {
        const min = Math.min(joint.lower, joint.upper);
        const max = Math.max(joint.lower, joint.upper);
        return { joint, min, max, step: (max - min) / 200 || 0.001 };
      }),
    [joints]
  );

  return (
    <div className="panel flex min-h-[240px] flex-col">
      <div className="panel-title justify-between">
        <div className="flex items-center gap-2">
          <Move className="h-4 w-4" />
          <span>Joint Jog</span>
        </div>
        <button
          onClick={jogActive ? deactivateJog : activateJog}
          disabled={joints.length === 0 || eStop}
          className={`rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-40 ${
            jogActive
              ? 'bg-cyan-600 text-white hover:bg-cyan-500'
              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          }`}
        >
          {jogActive ? 'Jog 已接管' : '接管关节'}
        </button>
      </div>

      {eStop && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 ring-1 ring-red-500/30">
          <ShieldAlert className="h-3.5 w-3.5" />
          <span>E-Stop 已触发，关节指令被锁定</span>
        </div>
      )}

      {joints.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-800/40 p-4 text-center text-xs text-slate-500">
          当前 URDF 未解析到可动关节（revolute / continuous / prismatic）。
        </div>
      ) : (
        <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
          {rows.map(({ joint, min, max, step }) => {
            const feedback = feedbackFor(joint.name);
            const target = jointTargets[joint.name];
            const value = jogActive && target !== undefined ? target : (feedback ?? 0);
            const unit = joint.type === 'prismatic' ? 'm' : 'rad';

            return (
              <div key={joint.name} className="rounded-lg bg-slate-800/40 px-3 py-2">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="truncate font-mono text-slate-300">{joint.name}</span>
                  <span className="shrink-0 font-mono text-cyan-400">
                    {value.toFixed(3)} {unit}
                  </span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={value}
                  disabled={eStop}
                  onChange={(e) => handleChange(joint, Number.parseFloat(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-700 accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                />
                <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                  <span>
                    {min.toFixed(2)} {unit}
                  </span>
                  <span className="uppercase">{joint.type}</span>
                  <span>
                    {max.toFixed(2)} {unit}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {joints.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={handleZeroAll}
            disabled={eStop}
            className="btn btn-secondary px-2 py-1.5 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            全部归零
          </button>
          <button
            onClick={handlePublishOnce}
            disabled={eStop || useSimulation}
            className="btn btn-primary px-2 py-1.5 text-xs"
            title={useSimulation ? '仿真模式下关节目标已直接驱动数字孪生' : '下发 /joint_command'}
          >
            <Send className="h-3.5 w-3.5" />
            下发指令
          </button>
        </div>
      )}
    </div>
  );
}
