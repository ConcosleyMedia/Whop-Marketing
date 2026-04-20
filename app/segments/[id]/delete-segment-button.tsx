"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteSegmentAction } from "../actions";

export function DeleteSegmentButton({ id }: { id: string }) {
  return (
    <form
      action={deleteSegmentAction}
      onSubmit={(e) => {
        if (!confirm("Delete this segment? This cannot be undone.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </Button>
    </form>
  );
}
