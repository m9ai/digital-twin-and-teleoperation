import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Circle,
  Download,
  Film,
  GitMerge,
  Pause,
  Play,
  Repeat,
  Send,
  ShieldAlert,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { useRecordingStore, type PlaybackSpeed } from '@/store/recordingStore';
import { useRobotStore } from '@/store/robotStore';
import { useConnectionStore } from '@/store/connectionStore';
import { useURDFStore } from '@/store/urdfStore';
import { applyTrajectorySample } from '@/lib/trajectoryPlayer';
import {
  downloadJsonFile,
  formatDuration,
  parseTrajectoryFile,
  serializeTrajectory,
} from '@/lib/trajectory';
import { decimateTrajectory, scaleTrajectoryTime, trimTrajectory } from '@/lib/trajectoryEditing';
import {
  ROS_TRAJECTORY_TOPIC,
  publishJointTrajectory,
  toFollowJointTrajectoryGoal,
  toRosJointTrajectory,
} from '@/lib/rosTrajectory';
import { rosClientRef } from '@/lib/rosRef';

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2];

function safeFileName(name: string, extension: string): string {
  return `${name.replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}${extension}`;
}

/**
 * Motion record & replay.
 *
 * Recording captures whatever drives the digital twin (jogging in simulation,
 * or the live /joint_states stream). Replaying walks the trajectory back out
 * through the same path: joint targets in simulation, /joint_command on real
 * hardware — gated by an explicit arm switch and interruptible by E-Stop.
 */
export function TrajectoryPanel() {
  const {
    isRecording,
    recordedMs,
    recordedFrames,
    library,
    selectedId,
    isPlaying,
    playheadMs,
    speed,
    loop,
    liveArmed,
    startRecording,
    stopRecording,
    discardRecording,
    selectTrajectory,
    removeTrajectory,
    setPlayhead,
    setSpeed,
    toggleLoop,
    setLiveArmed,
    play,
    pause,
    stopPlayback,
    addTrajectory,
    updateTrajectory,
    appendTrajectory,
  } = useRecordingStore();

  const { joints } = useURDFStore();
  const { eStop, addLog } = useRobotStore();
  const { useSimulation, status } = useConnectionStore();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [scaleFactor, setScaleFactor] = useState(2);
  const [minGapMs, setMinGapMs] = useState(50);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [rosStepMs, setRosStepMs] = useState(50);
  const [includeVelocities, setIncludeVelocities] = useState(true);
  const [rosFormat, setRosFormat] = useState<'msg' | 'goal'>('goal');

  const selected = useMemo(
    () => library.find((item) => item.id === selectedId) ?? null,
    [library, selectedId]
  );

  const durationMs = selected?.durationMs ?? 0;

  /** Keep the trim range in sync whenever a different trajectory is selected. */
  useEffect(() => {
    setTrimStart(0);
    setTrimEnd(Math.round(durationMs));
  }, [selectedId, durationMs]);

  const matchedJoints = useMemo(() => {
    if (!selected) return 0;
    const names = new Set(joints.map((j) => j.name));
    return selected.jointNames.filter((name) => names.has(name)).length;
  }, [selected, joints]);

  const handleToggleRecord = useCallback(() => {
    if (isRecording) {
      stopRecording();
      return;
    }
    startRecording(
      joints.map((j) => j.name),
      useSimulation ? 'simulation' : 'live'
    );
  }, [isRecording, stopRecording, startRecording, joints, useSimulation]);

  const handleSeek = useCallback(
    (value: number) => {
      setPlayhead(value);
      if (!selected) return;
      // Scrubbing only moves the twin in simulation; scrubbing a real robot
      // would teleport it, so live scrubbing is limited to playhead position.
      if (useSimulation) {
        useRobotStore.getState().setJogActive(true);
        applyTrajectorySample(selected, value, true);
      }
    },
    [setPlayhead, selected, useSimulation]
  );

  const handleExport = useCallback(() => {
    if (!selected) return;
    downloadJsonFile(safeFileName(selected.name, '.json'), serializeTrajectory(selected));
    addLog(`导出轨迹：${selected.name}`);
  }, [selected, addLog]);

  const handleExportRos = useCallback(() => {
    if (!selected) return;
    const options = { stepMs: rosStepMs, includeVelocities };
    const payload =
      rosFormat === 'msg'
        ? toRosJointTrajectory(selected, options)
        : toFollowJointTrajectoryGoal(selected, options);
    const extension = rosFormat === 'msg' ? '.joint_trajectory.json' : '.follow_joint_trajectory.json';
    downloadJsonFile(safeFileName(selected.name, extension), JSON.stringify(payload, null, 2));
    addLog(
      `导出 ROS 2 ${rosFormat === 'msg' ? 'JointTrajectory' : 'FollowJointTrajectory goal'}：${selected.name}`
    );
  }, [selected, rosFormat, rosStepMs, includeVelocities, addLog]);

  const handlePublishRos = useCallback(() => {
    if (!selected) return;
    try {
      const message = toRosJointTrajectory(selected, { stepMs: rosStepMs, includeVelocities });
      publishJointTrajectory(rosClientRef.current, message);
      addLog(`已下发 JointTrajectory 到 ${ROS_TRAJECTORY_TOPIC}（${message.points.length} 个轨迹点）`);
    } catch (err) {
      addLog(`下发失败：${err instanceof Error ? err.message : 'ROS 未连接'}`);
    }
  }, [selected, rosStepMs, includeVelocities, addLog]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        addTrajectory(parseTrajectoryFile(text));
      } catch (err) {
        addLog(`轨迹导入失败：${err instanceof Error ? err.message : '未知错误'}`);
      }
    },
    [addTrajectory, addLog]
  );

  const handleScale = useCallback(() => {
    if (!selected || !Number.isFinite(scaleFactor) || scaleFactor <= 0) return;
    updateTrajectory(selected.id, (t) => scaleTrajectoryTime(t, scaleFactor), `时间缩放 ${scaleFactor}x`);
  }, [selected, scaleFactor, updateTrajectory]);

  const handleDecimate = useCallback(() => {
    if (!selected) return;
    updateTrajectory(selected.id, (t) => decimateTrajectory(t, minGapMs), `抽稀（最小间隔 ${minGapMs}ms）`);
  }, [selected, minGapMs, updateTrajectory]);

  const handleTrim = useCallback(() => {
    if (!selected) return;
    updateTrajectory(selected.id, (t) => trimTrajectory(t, trimStart, trimEnd), `裁剪 ${trimStart}–${trimEnd}ms`);
  }, [selected, trimStart, trimEnd, updateTrajectory]);

  const canPlay = Boolean(selected) && !eStop && !isRecording && (useSimulation || liveArmed);

  return (
    <div className="panel flex min-h-[240px] flex-col overflow-y-auto">
      <div className="panel-title justify-between">
        <div className="flex items-center gap-2">
          <Film className="h-4 w-4" />
          <span>Motion Recorder</span>
        </div>
        {isRecording && (
          <span className="flex items-center gap-1.5 text-xs font-normal normal-case text-red-400">
            <Circle className="h-2.5 w-2.5 animate-pulse fill-red-500 text-red-500" />
            REC {formatDuration(recordedMs)}
          </span>
        )}
      </div>

      {eStop && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 ring-1 ring-red-500/30">
          <ShieldAlert className="h-3.5 w-3.5" />
          <span>E-Stop 已触发，录制与回放被锁定</span>
        </div>
      )}

      {!useSimulation && (
        <div
          className={`mb-2 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs ring-1 ${
            liveArmed
              ? 'bg-amber-500/10 text-amber-300 ring-amber-500/30'
              : 'bg-slate-800/60 text-slate-400 ring-slate-700'
          }`}
        >
          <span className="flex items-center gap-2">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>真机回放（限速下发 /joint_command）</span>
          </span>
          <button
            onClick={() => setLiveArmed(!liveArmed)}
            className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
              liveArmed ? 'bg-amber-500 text-slate-900 hover:bg-amber-400' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {liveArmed ? '已解锁' : '已锁定'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={handleToggleRecord}
          disabled={eStop || joints.length === 0}
          className={`btn px-2 py-1.5 text-xs ${
            isRecording ? 'btn-danger' : 'btn-secondary'
          }`}
        >
          {isRecording ? <Square className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5 fill-current" />}
          {isRecording ? '停止' : '录制'}
        </button>
        <button
          onClick={isPlaying ? pause : play}
          disabled={!canPlay}
          className="btn btn-primary px-2 py-1.5 text-xs"
          title={
            !useSimulation && !liveArmed ? 'Live 模式请先解锁真机回放' : '回放选中的轨迹'
          }
        >
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {isPlaying ? '暂停' : '回放'}
        </button>
        <button
          onClick={() => stopPlayback()}
          disabled={!isPlaying && playheadMs === 0}
          className="btn btn-secondary px-2 py-1.5 text-xs"
        >
          <Square className="h-3.5 w-3.5" />
          停止
        </button>
      </div>

      {isRecording && (
        <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-800/40 px-3 py-2 text-xs text-slate-400">
          <span>
            已采集 <span className="font-mono text-cyan-400">{recordedFrames}</span> 帧
          </span>
          <button onClick={discardRecording} className="text-red-400 hover:text-red-300">
            放弃
          </button>
        </div>
      )}

      {selected && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="truncate font-medium text-slate-300">{selected.name}</span>
            <span className="shrink-0 font-mono">
              {formatDuration(playheadMs)} / {formatDuration(selected.durationMs)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(selected.durationMs, 1)}
            step={1}
            value={Math.min(playheadMs, selected.durationMs)}
            disabled={isRecording}
            onChange={(e) => handleSeek(Number.parseFloat(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-700 accent-cyan-400 disabled:opacity-40"
          />
          <div className="flex items-center justify-between text-[10px] text-slate-500">
            <span>
              {selected.frames.length} 帧 · {selected.jointNames.length} 关节 ·{' '}
              {selected.source === 'live' ? 'Live' : 'Sim'}
            </span>
            {matchedJoints === 0 && (
              <span className="text-amber-400">关节与当前 URDF 不匹配</span>
            )}
            {matchedJoints > 0 && matchedJoints < selected.jointNames.length && (
              <span className="text-amber-400">
                {matchedJoints}/{selected.jointNames.length} 关节匹配
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-slate-700">
              {SPEEDS.map((option) => (
                <button
                  key={option}
                  onClick={() => setSpeed(option)}
                  className={`px-2 py-1 text-[10px] font-medium transition-colors ${
                    speed === option
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {option}x
                </button>
              ))}
            </div>
            <button
              onClick={toggleLoop}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition-colors ${
                loop
                  ? 'border-cyan-500 bg-cyan-600/20 text-cyan-300'
                  : 'border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              <Repeat className="h-3 w-3" />
              循环
            </button>
          </div>
        </div>
      )}

      {selected && (
        <div className="mt-3 rounded-lg border border-slate-700/60 bg-slate-800/30 p-2">
          <button
            onClick={() => setEditorOpen((value) => !value)}
            className="flex w-full items-center justify-between text-[10px] uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-300"
          >
            <span>编辑</span>
            <span>{editorOpen ? '收起' : '展开'}</span>
          </button>

          {editorOpen && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-14 shrink-0 text-slate-500">时间缩放</span>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={scaleFactor}
                  onChange={(e) => setScaleFactor(Number.parseFloat(e.target.value))}
                  className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                />
                <span className="text-slate-500">×</span>
                <button onClick={handleScale} className="btn btn-secondary px-2 py-1 text-[10px]">
                  应用
                </button>
              </div>

              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-14 shrink-0 text-slate-500">抽稀间隔</span>
                <input
                  type="number"
                  min={10}
                  step={10}
                  value={minGapMs}
                  onChange={(e) => setMinGapMs(Number.parseFloat(e.target.value))}
                  className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                />
                <span className="text-slate-500">ms</span>
                <button onClick={handleDecimate} className="btn btn-secondary px-2 py-1 text-[10px]">
                  抽稀
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="w-14 shrink-0 text-slate-500">裁剪区间</span>
                <input
                  type="number"
                  value={trimStart}
                  onChange={(e) => setTrimStart(Number.parseFloat(e.target.value))}
                  className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                />
                <span className="text-slate-500">→</span>
                <input
                  type="number"
                  value={trimEnd}
                  onChange={(e) => setTrimEnd(Number.parseFloat(e.target.value))}
                  className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                />
                <span className="text-slate-500">ms</span>
                <button
                  onClick={() => setTrimStart(Math.round(playheadMs))}
                  className="rounded bg-slate-800 px-1.5 py-1 text-[10px] text-slate-400 hover:bg-slate-700"
                  title="用播放头作为起点"
                >
                  起
                </button>
                <button
                  onClick={() => setTrimEnd(Math.round(playheadMs))}
                  className="rounded bg-slate-800 px-1.5 py-1 text-[10px] text-slate-400 hover:bg-slate-700"
                  title="用播放头作为终点"
                >
                  终
                </button>
                <button onClick={handleTrim} className="btn btn-secondary px-2 py-1 text-[10px]">
                  裁剪
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
        <span>轨迹库 ({library.length})</span>
      </div>
      {library.length === 0 ? (
        <div className="mt-1 flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-800/40 p-3 text-center text-xs text-slate-500">
          点击「录制」采集一段关节动作，或导入已有的轨迹 JSON。
        </div>
      ) : (
        <div className="mt-1 space-y-1 pr-1">
          {library.map((item) => {
            const active = item.id === selectedId;
            return (
              <div
                key={item.id}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors ${
                  active ? 'bg-cyan-600/20 ring-1 ring-cyan-500/40' : 'bg-slate-800/40 hover:bg-slate-800'
                }`}
              >
                <button
                  onClick={() => selectTrajectory(item.id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                >
                  <span className={`truncate ${active ? 'text-cyan-300' : 'text-slate-300'}`}>
                    {item.name}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-500">
                    {formatDuration(item.durationMs)} · {item.frames.length}f
                  </span>
                </button>
                <button
                  onClick={() => selectedId && appendTrajectory(selectedId, item.id)}
                  disabled={!selectedId || item.id === selectedId}
                  className="shrink-0 text-slate-500 hover:text-cyan-400 disabled:opacity-30"
                  title="拼接到当前选中轨迹之后"
                >
                  <GitMerge className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => removeTrajectory(item.id)}
                  className="shrink-0 text-slate-500 hover:text-red-400"
                  title="删除轨迹"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={handleImportClick}
          className="btn btn-secondary px-2 py-1.5 text-xs"
        >
          <Upload className="h-3.5 w-3.5" />
          导入
        </button>
        <button
          onClick={handleExport}
          disabled={!selected}
          className="btn btn-secondary px-2 py-1.5 text-xs"
        >
          <Download className="h-3.5 w-3.5" />
          导出
        </button>
      </div>

      {selected && (
        <div className="mt-2 space-y-2 rounded-lg border border-slate-700/60 bg-slate-800/30 p-2">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="w-14 shrink-0 text-slate-500">控制步长</span>
            <input
              type="number"
              min={0}
              step={10}
              value={rosStepMs}
              onChange={(e) => setRosStepMs(Number.parseFloat(e.target.value))}
              className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
            />
            <span className="text-slate-500">ms（0 = 原始帧）</span>
            <label className="ml-auto flex items-center gap-1 text-slate-400">
              <input
                type="checkbox"
                checked={includeVelocities}
                onChange={(e) => setIncludeVelocities(e.target.checked)}
                className="accent-cyan-500"
              />
              速度
            </label>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={rosFormat}
              onChange={(e) => setRosFormat(e.target.value as 'msg' | 'goal')}
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="goal">FollowJointTrajectory goal</option>
              <option value="msg">trajectory_msgs/JointTrajectory</option>
            </select>
            <button onClick={handleExportRos} className="btn btn-secondary px-2 py-1 text-[10px]">
              <Download className="h-3 w-3" />
              导出
            </button>
            <button
              onClick={handlePublishRos}
              disabled={useSimulation || !status.connected}
              title={
                useSimulation
                  ? '切换到 Live 模式后可下发'
                  : status.connected
                    ? `发布到 ${ROS_TRAJECTORY_TOPIC}`
                    : 'ROS 未连接'
              }
              className="btn btn-secondary px-2 py-1 text-[10px] disabled:opacity-40"
            >
              <Send className="h-3 w-3" />
              下发
            </button>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
