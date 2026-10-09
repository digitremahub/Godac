"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui";

const TEAL = "#1BE4C1";

export interface BarDatum {
  name: string;
  value: number;
}

/**
 * Single-measure magnitude chart (one bar per vehicle/service) — one
 * hue, no legend needed (the axis labels already carry identity, a
 * color-per-bar would be decorative, not encoding anything — see the
 * dataviz skill's "color follows the entity" rule: here the entity is
 * already on the x-axis).
 */
export function BarChartCard({ title, data, valueSuffix, formatValue }: { title: string; data: BarDatum[]; valueSuffix?: string; formatValue?: (v: number) => string }) {
  const format = formatValue ?? ((v: number) => `${v.toLocaleString("fr-FR")}${valueSuffix ?? ""}`);
  return (
    <Card>
      <p className="mb-3 text-sm font-medium">{title}</p>
      {data.length === 0 ? (
        <p className="py-8 text-center text-xs text-navy/40">Pas assez de données sur la période.</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#0A0F1E0D" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#0A0F1E66" }} axisLine={{ stroke: "#0A0F1E1A" }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#0A0F1E66" }} axisLine={false} tickLine={false} width={48} />
            <Tooltip
              formatter={(v) => format(Number(v))}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #0A0F1E1A" }}
              cursor={{ fill: "#0A0F1E08" }}
            />
            <Bar dataKey="value" fill={TEAL} radius={[4, 4, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
