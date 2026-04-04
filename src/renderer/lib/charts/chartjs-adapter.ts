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

export function renderChart(canvas: HTMLCanvasElement, config: ChartConfig): ChartHandle {
  const { series, type, title, height } = config;

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
      plugins: {
        title: title ? { display: true, text: title, color: '#cdd6f4', font: { size: 14, weight: 'bold' } } : { display: false },
        legend: { display: series.length > 1, labels: { color: '#cdd6f4' } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: useTime
          ? { type: 'time', time: { tooltipFormat: 'PPP' }, ticks: { color: '#6c7086' }, grid: { color: '#31324422' } }
          : { type: 'category', ticks: { color: '#6c7086' }, grid: { color: '#31324422' } },
        y: { ticks: { color: '#6c7086' }, grid: { color: '#31324433' }, beginAtZero: true },
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
