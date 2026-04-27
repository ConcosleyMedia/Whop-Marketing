"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const AXIS_COLOR = "#94a3b8";
const GRID_COLOR = "rgba(148, 163, 184, 0.18)";

const TOOLTIP_STYLES: React.CSSProperties = {
  background: "hsl(var(--background, 0 0% 100%))",
  border: "1px solid rgba(148, 163, 184, 0.25)",
  borderRadius: 8,
  fontSize: 12,
  padding: "6px 10px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
};

function formatDollars(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

type DayPoint = { date: string; label: string; value: number };

export function RevenueTrendChart({ data }: { data: DayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={GRID_COLOR} vertical={false} />
        <XAxis
          dataKey="label"
          stroke={AXIS_COLOR}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          stroke={AXIS_COLOR}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={formatDollars}
          width={50}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLES}
          formatter={(value) => [formatDollars(Number(value)), "Revenue"]}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke="#0ea5e9"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SignupsTrendChart({ data }: { data: DayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
        <CartesianGrid stroke={GRID_COLOR} vertical={false} />
        <XAxis
          dataKey="label"
          stroke={AXIS_COLOR}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          stroke={AXIS_COLOR}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={28}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLES}
          formatter={(value) => [Number(value), "Signups"]}
        />
        <Bar dataKey="value" fill="#10b981" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

type ProductRevenue = { product: string; revenue: number };

export function RevenueByProductChart({ data }: { data: ProductRevenue[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 30)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
      >
        <XAxis
          type="number"
          stroke={AXIS_COLOR}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={formatDollars}
        />
        <YAxis
          type="category"
          dataKey="product"
          stroke={AXIS_COLOR}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={140}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLES}
          formatter={(value) => [formatDollars(Number(value)), "Revenue"]}
        />
        <Bar dataKey="revenue" fill="#6366f1" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
