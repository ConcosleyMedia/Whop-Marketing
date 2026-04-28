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

// Whoop-style dark palette. The home dashboard is the only consumer of
// these charts, so dark colors are baked in instead of theme-switching.
const AXIS_COLOR = "#52525b"; // zinc-600
const GRID_COLOR = "rgba(82, 82, 91, 0.25)";
const ACCENT_LIME = "#A3E635"; // lime-400, neon green like Whoop's brand
const ACCENT_CYAN = "#22D3EE"; // cyan-400
const ACCENT_VIOLET = "#A78BFA"; // violet-400

const TOOLTIP_STYLES: React.CSSProperties = {
  background: "#09090b", // zinc-950
  border: "1px solid rgba(163, 230, 53, 0.4)",
  borderRadius: 8,
  fontSize: 11,
  fontFamily: "var(--font-geist-mono), monospace",
  padding: "6px 10px",
  color: "#fafafa",
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
};

function formatDollars(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

type DayPoint = { date: string; label: string; value: number };

export function RevenueTrendChart({ data }: { data: DayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT_LIME} stopOpacity={0.8} />
            <stop offset="100%" stopColor={ACCENT_LIME} stopOpacity={0.2} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID_COLOR} vertical={false} />
        <XAxis
          dataKey="label"
          stroke={AXIS_COLOR}
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          stroke={AXIS_COLOR}
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={formatDollars}
          width={50}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLES}
          cursor={{ stroke: ACCENT_LIME, strokeOpacity: 0.3 }}
          formatter={(value) => [formatDollars(Number(value)), "Revenue"]}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={ACCENT_LIME}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: ACCENT_LIME, stroke: "#09090b", strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SignupsTrendChart({ data }: { data: DayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
        <CartesianGrid stroke={GRID_COLOR} vertical={false} />
        <XAxis
          dataKey="label"
          stroke={AXIS_COLOR}
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          stroke={AXIS_COLOR}
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={28}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLES}
          cursor={{ fill: "rgba(34, 211, 238, 0.08)" }}
          formatter={(value) => [Number(value), "Signups"]}
        />
        <Bar dataKey="value" fill={ACCENT_CYAN} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

type ProductRevenue = { product: string; revenue: number };

export function RevenueByProductChart({ data }: { data: ProductRevenue[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 32)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
      >
        <XAxis
          type="number"
          stroke={AXIS_COLOR}
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={formatDollars}
        />
        <YAxis
          type="category"
          dataKey="product"
          stroke="#a1a1aa"
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={150}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLES}
          cursor={{ fill: "rgba(167, 139, 250, 0.08)" }}
          formatter={(value) => [formatDollars(Number(value)), "Revenue"]}
        />
        <Bar dataKey="revenue" fill={ACCENT_VIOLET} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
