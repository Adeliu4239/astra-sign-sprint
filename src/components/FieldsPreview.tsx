"use client";

import { PdfPages } from "./PdfPages";
import { KIND_LABEL, type FieldKind } from "./FieldEditor";

interface PreviewField {
  id: string;
  kind: FieldKind;
  page_index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Read-only document view with the placed fields outlined. */
export function FieldsPreview({ url, fields }: { url: string; fields: PreviewField[] }) {
  return (
    <PdfPages
      url={url}
      renderOverlay={(page) =>
        fields
          .filter((f) => f.page_index === page.index)
          .map((f) => (
            <div
              key={f.id}
              data-testid="placed-field"
              data-page={f.page_index + 1}
              className="absolute flex items-center justify-center rounded border-2 border-dashed border-indigo-500 bg-indigo-500/10 text-[11px] font-semibold text-indigo-900"
              style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%` }}
            >
              <span className="truncate px-1">{KIND_LABEL[f.kind]}</span>
            </div>
          ))
      }
    />
  );
}
