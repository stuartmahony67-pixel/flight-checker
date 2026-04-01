"use client";

import { useEffect, useRef, useState } from "react";
import type { ArtworkPageReport, ArtworkReport, BoundingBoxMm, PageGeometryMm, PreflightStatus } from "@/types";

type ArtworkPreviewProps = {
  file: File | undefined;
  report: ArtworkReport;
};

type RenderState = "idle" | "loading" | "ready" | "error";

const PREVIEW_WIDTH = 420;

function lineClassName(status: PreflightStatus) {
  if (status === "fail") return "overlay-box overlay-box-fail";
  if (status === "warn") return "overlay-box overlay-box-warn";
  return "overlay-box overlay-box-pass";
}

function toOverlayRect(boundsMm: BoundingBoxMm, page: ArtworkPageReport) {
  const scaleX = PREVIEW_WIDTH / page.pageSizeMm.width;
  const previewHeight = page.pageSizeMm.height * scaleX;

  return {
    left: boundsMm.minX * scaleX,
    top: (page.pageSizeMm.height - boundsMm.maxY) * scaleX,
    width: Math.max((boundsMm.maxX - boundsMm.minX) * scaleX, 2),
    height: Math.max((boundsMm.maxY - boundsMm.minY) * scaleX, 2),
    previewHeight
  };
}

function toGuideRect(boxMm: PageGeometryMm, page: ArtworkPageReport) {
  const scaleX = PREVIEW_WIDTH / page.pageSizeMm.width;
  const previewHeight = page.pageSizeMm.height * scaleX;

  return {
    left: boxMm.x * scaleX,
    top: (page.pageSizeMm.height - (boxMm.y + boxMm.height)) * scaleX,
    width: Math.max(boxMm.width * scaleX, 2),
    height: Math.max(boxMm.height * scaleX, 2),
    previewHeight
  };
}

function toSafeRect(boundsMm: BoundingBoxMm, page: ArtworkPageReport) {
  const scaleX = PREVIEW_WIDTH / page.pageSizeMm.width;
  const previewHeight = page.pageSizeMm.height * scaleX;

  return {
    left: boundsMm.minX * scaleX,
    top: (page.pageSizeMm.height - boundsMm.maxY) * scaleX,
    width: Math.max((boundsMm.maxX - boundsMm.minX) * scaleX, 2),
    height: Math.max((boundsMm.maxY - boundsMm.minY) * scaleX, 2),
    previewHeight
  };
}

function PagePreview({
  file,
  page,
  pageIndex
}: {
  file: File | undefined;
  page: ArtworkPageReport;
  pageIndex: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<RenderState>(file ? "loading" : "error");
  const trimRect = toGuideRect(page.trimBoxMm, page);
  const bleedRect = toGuideRect(page.bleedBoxMm, page);
  const safeRect = toSafeRect(page.safeBoundsMm, page);
  const previewHeight = trimRect.previewHeight;
  const trimStyle = {
    left: trimRect.left,
    top: trimRect.top,
    width: trimRect.width,
    height: trimRect.height
  };
  const bleedStyle = {
    left: bleedRect.left,
    top: bleedRect.top,
    width: bleedRect.width,
    height: bleedRect.height
  };
  const safeStyle = {
    left: safeRect.left,
    top: safeRect.top,
    width: safeRect.width,
    height: safeRect.height
  };

  useEffect(() => {
    let cancelled = false;

    async function renderPage() {
      if (!file || !canvasRef.current) {
        setState("error");
        return;
      }

      try {
        setState("loading");
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const bytes = await file.arrayBuffer();
        const document = await pdfjs.getDocument({
          data: bytes,
          disableWorker: true,
          isEvalSupported: false,
          useSystemFonts: false
        } as never).promise;
        const pdfPage = await document.getPage(pageIndex + 1);
        const viewport = pdfPage.getViewport({ scale: PREVIEW_WIDTH / pdfPage.getViewport({ scale: 1 }).width });
        const canvas = canvasRef.current;

        if (!canvas || cancelled) {
          return;
        }

        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("Canvas context unavailable.");
        }

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await pdfPage.render({ canvasContext: context, viewport }).promise;

        if (!cancelled) {
          setState("ready");
        }
      } catch {
        if (!cancelled) {
          setState("error");
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
    };
  }, [file, pageIndex]);

  return (
    <div className="page-preview-shell">
      <div className="page-preview-meta">
        <span className="pill pill-soft">Page {page.pageNumber}</span>
        <span className={page.status === "fail" ? "pill pill-fail" : page.status === "warn" ? "pill pill-warn" : "pill pill-pass"}>
          {page.status}
        </span>
      </div>

      <div className="page-preview-stage" style={{ height: `${previewHeight}px` }}>
        <canvas ref={canvasRef} className="page-preview-canvas" />

        <div className="guide-box guide-box-bleed" style={bleedStyle} />
        <div className="guide-box guide-box-trim" style={trimStyle} />
        <div className="guide-box guide-box-safe" style={safeStyle} />

        {page.warningRegions.map((region, index) => {
          const rect = toOverlayRect(region.boundsMm, page);
          const overlayStyle = {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
          };

          return (
            <div
              key={`${page.pageNumber}-${region.label}-${index}`}
              className={lineClassName(region.status)}
              style={overlayStyle}
              title={region.label}
            >
              <span className="overlay-label">{region.label}</span>
            </div>
          );
        })}

        {state === "loading" ? <div className="page-preview-overlay">Rendering preview…</div> : null}
        {state === "error" ? <div className="page-preview-overlay">Preview unavailable</div> : null}
      </div>

      <div className="preview-legend">
        <span><i className="legend-swatch legend-bleed" /> Bleed box</span>
        <span><i className="legend-swatch legend-trim" /> Trim box</span>
        <span><i className="legend-swatch legend-safe" /> Safe zone</span>
      </div>
    </div>
  );
}

export function ArtworkPreview({ file, report }: ArtworkPreviewProps) {
  return (
    <div className="preview-grid">
      {report.pages.map((page, index) => (
        <PagePreview key={`${report.fileName}-preview-${page.pageNumber}`} file={file} page={page} pageIndex={index} />
      ))}
    </div>
  );
}
