"use client";

import { useRouter } from "next/navigation";

type TemplateOption = {
  id: string;
  name: string;
  labels: string[] | null;
  suggested_subject: string | null;
};

export function TemplatePicker({
  templates,
  preservedSegment,
}: {
  templates: TemplateOption[];
  preservedSegment: string | null;
}) {
  const router = useRouter();

  return (
    <select
      id="pick_template"
      aria-label="Pick a template"
      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      defaultValue=""
      onChange={(e) => {
        const id = e.currentTarget.value;
        if (!id) return;
        const params = new URLSearchParams({ template: id });
        if (preservedSegment) params.set("segment", preservedSegment);
        router.push(`/campaigns/new?${params.toString()}`);
      }}
    >
      <option value="" disabled>
        Pick from template library…
      </option>
      {templates.map((tpl) => (
        <option key={tpl.id} value={tpl.id}>
          {tpl.name}
          {tpl.labels && tpl.labels.length > 0
            ? ` · ${tpl.labels.slice(0, 3).join(", ")}`
            : ""}
        </option>
      ))}
    </select>
  );
}
