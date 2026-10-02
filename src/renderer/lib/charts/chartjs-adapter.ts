import {
  Chart,
  LineController,
  BarController,
  LineElement,
  BarElement,
  PointElement,
  LinearScale,
  TimeScale,
  CategoryScale,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import type { ChartConfig, ChartHandle } from './types';

Chart.register(
  LineController,
  BarController,
  LineElement,
  BarElement,
  PointElement,
  LinearScale,
  TimeScale,
  CategoryScale,
  Title,
  Tooltip,
  Legend,
  Filler,
);

const SERIES_COLORS = [
  '#89b4fa', // blue (accent)
  '#a6e3a1', // green
  '#fab387', // peach
  '#cba6f7', // mauve
  '#f38ba8', // red
  '#94e2d5', // teal
  '#f9e2af', // yellow
  '#74c7ec', // sapphire
];

function isTimeData(values: (string | number | Date)[]): boolean {
  if (values.length === 0) return false;
  const sample = String(values[0]);
  return /^\d{4}-\d{2}/.test(sample);
}

/** Text and grid colours for a chart. The default is the app's dark preview
 *  palette; an export passes a light one (#2512) so a chart reads on white. */
export interface ChartPalette {
  text: string;
  tick: string;
  grid: string;
}
const DARK_PALETTE: ChartPalette = { text: '#cdd6f4', tick: '#6c7086', grid: '#31324433' };

export interface RenderChartOptions {
  /** false draws the final frame at once — for a snapshot, which must not
   *  capture a chart mid-animation (#2512). Default: animate. */
  animate?: boolean;
  palette?: ChartPalette;
}

export function renderChart(canvas: HTMLCanvasElement, config: ChartConfig, opts: RenderChartOptions = {}): ChartHandle {
  const { series, type, title, height } = config;
  const palette = opts.palette ?? DARK_PALETTE;

  canvas.style.height = `${height}px`;
  canvas.height = height;

  const xValues = series[0]?.data.map(d => d.x) ?? [];
  const useTime = isTimeData(xValues);

  const datasets = series.map((s, i) => ({
    label: s.label,
    data: s.data.map(d => ({ x: d.x, y: d.y })),
    borderColor: SERIES_COLORS[i % SERIES_COLORS.length],
    backgroundColor: type === 'area'
      ? SERIES_COLORS[i % SERIES_COLORS.length] + '33'
      : SERIES_COLORS[i % SERIES_COLORS.length],
    fill: type === 'area',
    tension: 0.3,
    pointRadius: 3,
    borderWidth: 2,
  }));

  const chart = new Chart(canvas, {
    type: type === 'area' ? 'line' : type,
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      ...(opts.animate === false ? { animation: false as const } : {}),
      plugins: {
        title: title ? { display: true, text: title, color: palette.text, font: { size: 14, weight: 'bold' } } : { display: false },
        legend: { display: series.length > 1, labels: { color: palette.text } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: useTime
          ? { type: 'time', time: { tooltipFormat: 'PPP' }, ticks: { color: palette.tick }, grid: { color: palette.grid } }
          : { type: 'category', ticks: { color: palette.tick }, grid: { color: palette.grid } },
        y: { ticks: { color: palette.tick }, grid: { color: palette.grid }, beginAtZero: true },
      },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
    },
  });

  return {
    destroy() {
      chart.destroy();
    },
  };
}
