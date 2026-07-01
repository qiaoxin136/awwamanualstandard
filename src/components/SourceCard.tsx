import { useState } from "react";
import type { Source } from "../types";
import { PdfViewer } from "./PdfViewer";

type Props = {
  source: Source;
};

export function SourceCard({ source }: Props) {
  const [showInline, setShowInline] = useState(false);

  const page = source.page; // 1-based PDF page, or null
  const scorePct =
    typeof source.score === "number"
      ? `${Math.round(source.score * 100)}% match`
      : null;

  return (
    <div className="source-card">
      <div className="title">{source.title}</div>
      <div className="meta">
        {page ? `Page ${page}` : "Page unknown"}
        {scorePct ? ` · ${scorePct}` : ""}
      </div>
      <div className="actions">
        {/* Opens the PDF in a new browser tab; #page=N jumps native viewers. */}
        <a
          className="primary"
          href={source.signedPageUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open PDF {page ? `at p.${page}` : ""}
        </a>
        <button onClick={() => setShowInline(true)}>View inline</button>
      </div>

      {showInline && (
        <PdfViewer
          url={source.presignedUrl}
          initialPage={page ?? 1}
          title={source.title}
          onClose={() => setShowInline(false)}
        />
      )}
    </div>
  );
}
