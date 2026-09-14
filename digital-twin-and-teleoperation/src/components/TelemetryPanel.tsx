import { useEffect, useRef, useMemo } from 'react';
import * as echarts from 'echarts';
import { Battery, Gauge, Thermometer, Activity } from 'lucide-react';
import { useRobotStore } from '@/store/robotStore';

const MAX_POINTS = 120;

function useChart(containerRef: React.RefObject<HTMLDivElement>, option: echarts.EChartsOption) {
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = echarts.init(containerRef.current, 'dark');
    chartRef.current = chart;
    chart.setOption(option);

    const resize = () => chart.resize();
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      chart.dispose();
      chartRef.current = null;
    };
  }, [containerRef, option]);

  return chartRef;
}

export function TelemetryPanel() {
  const { telemetry, jointState } = useRobotStore();
  const batteryRef = useRef<HTMLDivElement>(null);
  const velocityRef = useRef<HTMLDivElement>(null);
  const tempRef = useRef<HTMLDivElement>(null);

  const batteryData = useRef<number[]>([telemetry.batteryPercent]);
  const linearData = useRef<number[]>([telemetry.linearVelocity]);
  const angularData = useRef<number[]>([telemetry.angularVelocity]);
  const tempData = useRef<number[]>([telemetry.cpuTemp]);

  const batteryOption = useMemo<echarts.EChartsOption>(
    () => ({
      backgroundColor: 'transparent',
      grid: { top: 8, right: 8, bottom: 20, left: 40 },
      xAxis: { type: 'category', show: false },
      yAxis: { type: 'value', min: 0, max: 100, splitLine: { lineStyle: { color: '#334155' } } },
      series: [
        {
          type: 'line',
          smooth: true,
          data: batteryData.current,
          areaStyle: { color: 'rgba(34, 211, 238, 0.2)' },
          lineStyle: { color: '#22d3ee' },
          symbol: 'none',
        },
      ],
    }),
    []
  );

  const velocityOption = useMemo<echarts.EChartsOption>(
    () => ({
      backgroundColor: 'transparent',
      grid: { top: 8, right: 8, bottom: 20, left: 40 },
      xAxis: { type: 'category', show: false },
      yAxis: { type: 'value', min: -2, max: 2, splitLine: { lineStyle: { color: '#334155' } } },
      series: [
        {
          type: 'line',
          name: 'Linear',
          smooth: true,
          data: linearData.current,
          lineStyle: { color: '#34d399' },
          symbol: 'none',
        },
        {
          type: 'line',
          name: 'Angular',
          smooth: true,
          data: angularData.current,
          lineStyle: { color: '#f472b6' },
          symbol: 'none',
        },
      ],
    }),
    []
  );

  const tempOption = useMemo<echarts.EChartsOption>(
    () => ({
      backgroundColor: 'transparent',
      grid: { top: 8, right: 8, bottom: 20, left: 40 },
      xAxis: { type: 'category', show: false },
      yAxis: { type: 'value', min: 20, max: 80, splitLine: { lineStyle: { color: '#334155' } } },
      series: [
        {
          type: 'line',
          smooth: true,
          data: tempData.current,
          areaStyle: { color: 'rgba(251, 146, 60, 0.2)' },
          lineStyle: { color: '#fb923c' },
          symbol: 'none',
        },
      ],
    }),
    []
  );

  const batteryChart = useChart(batteryRef, batteryOption);
  const velocityChart = useChart(velocityRef, velocityOption);
  const tempChart = useChart(tempRef, tempOption);

  useEffect(() => {
    batteryData.current = [...batteryData.current, telemetry.batteryPercent].slice(-MAX_POINTS);
    linearData.current = [...linearData.current, telemetry.linearVelocity].slice(-MAX_POINTS);
    angularData.current = [...angularData.current, telemetry.angularVelocity].slice(-MAX_POINTS);
    tempData.current = [...tempData.current, telemetry.cpuTemp].slice(-MAX_POINTS);

    batteryChart.current?.setOption({ series: [{ data: batteryData.current }] });
    velocityChart.current?.setOption({
      series: [{ data: linearData.current }, { data: angularData.current }],
    });
    tempChart.current?.setOption({ series: [{ data: tempData.current }] });
  }, [telemetry, batteryChart, velocityChart, tempChart]);

  return (
    <div className="panel flex flex-col gap-4">
      <div className="panel-title">
        <Activity className="h-4 w-4" />
        <span>Telemetry</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={<Battery className="h-4 w-4 text-cyan-400" />}
          label="Battery"
          value={`${telemetry.batteryPercent.toFixed(1)}%`}
          sub={`${telemetry.batteryVoltage.toFixed(1)} V`}
        />
        <StatCard
          icon={<Gauge className="h-4 w-4 text-emerald-400" />}
          label="Velocity"
          value={`${telemetry.linearVelocity.toFixed(2)} m/s`}
          sub={`${telemetry.angularVelocity.toFixed(2)} rad/s`}
        />
        <StatCard
          icon={<Thermometer className="h-4 w-4 text-orange-400" />}
          label="CPU Temp"
          value={`${telemetry.cpuTemp.toFixed(1)}°C`}
        />
        <StatCard
          icon={<Activity className="h-4 w-4 text-purple-400" />}
          label="Joints"
          value={`${jointState.name.length}`}
          sub={jointState.name.slice(0, 3).join(', ')}
        />
      </div>

      <div className="grid grid-cols-1 gap-3">
        <ChartBox title="Battery Level" chartRef={batteryRef} />
        <ChartBox title="Velocity" chartRef={velocityRef} />
        <ChartBox title="CPU Temperature" chartRef={tempRef} />
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="stat-card">
      <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg font-bold text-slate-100">{value}</div>
      {sub && <div className="truncate text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function ChartBox({ title, chartRef }: { title: string; chartRef: React.RefObject<HTMLDivElement> }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500">{title}</div>
      <div ref={chartRef} className="h-28 w-full rounded-lg border border-slate-800 bg-slate-950/50" />
    </div>
  );
}
