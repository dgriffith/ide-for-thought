export interface ChartSeries {
  label: string;
  data: { x: string | number | Date; y: number }[];
}

export interface ChartConfig {
  title?: string;
  type: 'line' | 'bar' | 'area';
  height: number;
  series: ChartSeries[];
  xLabel?: string;
  yLabel?: string;
}

export interface ChartHandle {
  destroy(): void;
}
