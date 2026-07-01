import { useState } from "react";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// pdf.js needs a worker. Vite serves this URL at build/dev time.
import { pdfjs } from "react-pdf";
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type Props = {
  /** Presigned GET URL for the whole PDF. */
  url: string;
  /** Page to jump to when the viewer opens. */
  initialPage: number;
  title: string;
  onClose: () => void;
};

export function PdfViewer({ url, initialPage, title, onClose }: Props) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState<number>(Math.max(1, initialPage));
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="title" title={title}>
            {title}
          </span>
          <button className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="error">{error}</div>}
          <div className="pdf-nav">
            <button
              disabled={pageNumber <= 1}
              onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <span>
              Page {pageNumber}
              {numPages ? ` of ${numPages}` : ""}
            </span>
            <button
              disabled={!!numPages && pageNumber >= numPages}
              onClick={() => setPageNumber((p) => p + 1)}
            >
              Next
            </button>
          </div>
          <Document
            file={url}
            onLoadSuccess={({ numPages }) => {
              setNumPages(numPages);
              // Clamp the initial page if it exceeds the document length.
              if (initialPage > numPages) setPageNumber(numPages);
            }}
            onLoadError={(e) => setError(`Failed to load PDF: ${e.message}`)}
            loading={<div className="loading">Loading PDF…</div>}
          >
            <Page
              pageNumber={pageNumber}
              width={Math.min(820, window.innerWidth - 80)}
              renderAnnotationLayer
              renderTextLayer
            />
          </Document>
        </div>
      </div>
    </div>
  );
}
