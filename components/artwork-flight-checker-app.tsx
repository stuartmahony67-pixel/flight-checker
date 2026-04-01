"use client";

import { ChangeEvent, DragEvent, useMemo, useState } from "react";
import { ArtworkPreview } from "@/components/artwork-preview";
import type { ArtworkCheckResult, ArtworkReport, PreflightStatus } from "@/types";

const ACCEPTED_EXTENSIONS = [".pdf", ".ai"];

function statusLabel(status: PreflightStatus) {
  if (status === "pass") return "Pass";
  if (status === "warn") return "Warn";
  return "Fail";
}

function statusClassName(status: PreflightStatus) {
  if (status === "pass") return "pill pill-pass";
  if (status === "warn") return "pill pill-warn";
  return "pill pill-fail";
}

function groupChecks(checks: ArtworkCheckResult[]) {
  return checks.reduce<Record<PreflightStatus, ArtworkCheckResult[]>>(
    (groups, check) => {
      groups[check.status].push(check);
      return groups;
    },
    { pass: [], warn: [], fail: [] }
  );
}

function formatMm(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "--";
  }

  return `${value.toFixed(2)} mm`;
}

export function ArtworkFlightCheckerApp() {
  const [files, setFiles] = useState<File[]>([]);
  const [reports, setReports] = useState<ArtworkReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const summary = useMemo(() => {
    return {
      totalFiles: reports.length,
      passCount: reports.filter((report) => report.status === "pass").length,
      warnCount: reports.filter((report) => report.status === "warn").length,
      failCount: reports.filter((report) => report.status === "fail").length
    };
  }, [reports]);

  const filesByName = useMemo(
    () => new Map(files.map((file) => [file.name, file])),
    [files]
  );

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;

    const accepted = Array.from(fileList).filter((file) =>
      ACCEPTED_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))
    );

    setFiles(accepted);
    setReports([]);
    setError(accepted.length === 0 ? "Choose at least one PDF or AI file." : null);
  };

  const submit = async () => {
    if (files.length === 0) {
      setError("Choose at least one PDF or AI file.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const formData = new FormData();

      files.forEach((file, index) => {
        formData.append(`file-${index}`, file);
      });

      const response = await fetch("/api/preflight", {
        method: "POST",
        body: formData
      });
      const payload = (await response.json()) as { error?: string; reports?: ArtworkReport[] };

      if (!response.ok || !payload.reports) {
        throw new Error(payload.error ?? "Preflight failed.");
      }

      setReports(payload.reports);
    } catch (requestError) {
      setReports([]);
      setError(requestError instanceof Error ? requestError.message : "Unexpected preflight error.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="page-shell">
      <section className="panel hero">
        <div>
          <p className="eyebrow">Artwork Flight Checker</p>
          <h1>Preflight PDF and AI artwork before it reaches production.</h1>
          <p className="hero-copy">
            This MVP checks PDF files and PDF-compatible Illustrator files for trim size, allowed
            bleed, a 3 mm internal safety zone, colour-space risks, and raster-image uncertainty.
          </p>
        </div>

        <div className="hero-rules">
          <div className="rule-card">Bleed must be exactly 1.5 mm or 2 mm on every side.</div>
          <div className="rule-card">Important content should stay 3 mm inside the trim line.</div>
          <div className="rule-card">RGB is treated as a production issue that needs correction.</div>
          <div className="rule-card">Raster content is checked best-effort and warned when uncertain.</div>
        </div>
      </section>

      <section className="content-grid">
        <div>
          <div className="panel upload-panel">
            <div
              className="drop-zone"
              onDragOver={(event: DragEvent<HTMLDivElement>) => event.preventDefault()}
              onDrop={(event: DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                handleFiles(event.dataTransfer.files);
              }}
            >
              <p className="eyebrow">Upload</p>
              <h2>Drop PDF or AI files here</h2>
              <p className="helper">
                `.ai` files must be saved with Illustrator&apos;s PDF compatibility enabled, otherwise
                the checker will mark them as unsupported.
              </p>

              <div className="button-row">
                <label className="button button-primary">
                  Choose files
                  <input
                    className="hidden-input"
                    type="file"
                    multiple
                    accept=".pdf,.ai,application/pdf"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => handleFiles(event.target.files)}
                  />
                </label>
                <button className="button button-secondary" type="button" onClick={() => {
                  setFiles([]);
                  setReports([]);
                  setError(null);
                }}>
                  Clear
                </button>
                <button
                  className="button button-alert"
                  type="button"
                  onClick={() => void submit()}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Checking artwork..." : "Run preflight"}
                </button>
              </div>

              {error ? <div className="error">{error}</div> : null}
            </div>
          </div>

          <div className="panel upload-panel" style={{ marginTop: 24 }}>
            <p className="eyebrow">Queue</p>
            <h2>Files ready for inspection</h2>
            <div className="queue">
              {files.length === 0 ? (
                <div className="queue-item">
                  <div className="muted">No files loaded yet.</div>
                </div>
              ) : null}

              {files.map((file) => (
                <div key={`${file.name}-${file.size}`} className="queue-item">
                  <div>
                    <div>{file.name}</div>
                    <div className="muted mono" style={{ marginTop: 4 }}>
                      {(file.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <span className="pill pill-soft">
                    {file.name.toLowerCase().endsWith(".ai") ? "AI" : "PDF"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="summary-grid">
            <div className="summary-card">
              <p className="eyebrow">Files Checked</p>
              <p className="summary-value">{summary.totalFiles}</p>
            </div>
            <div className="summary-card">
              <p className="eyebrow">Pass</p>
              <p className="summary-value" style={{ color: "var(--green)" }}>{summary.passCount}</p>
            </div>
            <div className="summary-card">
              <p className="eyebrow">Warn</p>
              <p className="summary-value" style={{ color: "var(--amber)" }}>{summary.warnCount}</p>
            </div>
            <div className="summary-card">
              <p className="eyebrow">Fail</p>
              <p className="summary-value" style={{ color: "var(--red)" }}>{summary.failCount}</p>
            </div>
          </div>

          <div className="panel results-panel" style={{ marginTop: 24 }}>
            <p className="eyebrow">Results</p>
            <h2>Your preflight report</h2>

            {reports.length === 0 ? (
              <p className="helper">
                Run the checker to see pass, warn, and fail results for each uploaded file.
              </p>
            ) : null}

            <div className="results-list">
              {reports.map((report) => {
                const groupedChecks = groupChecks(report.checks);
                const file = filesByName.get(report.fileName);

                return (
                  <article key={report.fileName} className="result-card">
                    <div className="result-head">
                      <div className="pill-row">
                        <span className={statusClassName(report.status)}>{statusLabel(report.status)}</span>
                        <span className="pill pill-soft">{report.fileType}</span>
                        {!report.pdfCompatible ? <span className="pill pill-soft">Not PDF compatible</span> : null}
                      </div>

                      <div>
                        <h3 style={{ margin: 0 }}>{report.fileName}</h3>
                        <p className="helper" style={{ margin: "8px 0 0" }}>{report.summary}</p>
                      </div>

                      <div className="pill-row">
                        <span className="pill pill-soft">Pages {report.pageCount}</span>
                        <span className="pill pill-soft">
                          Trim {formatMm(report.primaryTrimSizeMm?.width ?? null)} x {formatMm(report.primaryTrimSizeMm?.height ?? null)}
                        </span>
                      </div>
                    </div>

                    <div className="result-body">
                      <div>
                        {(["fail", "warn", "pass"] as const).map((status) =>
                          groupedChecks[status].length > 0 ? (
                            <div key={status} className="check-group">
                              <p className="eyebrow" style={{ marginTop: 0 }}>{statusLabel(status)}</p>
                              {groupedChecks[status].map((check, index) => (
                                <div key={`${check.code}-${index}`} className="check-card">
                                  <div className="pill-row">
                                    <strong>{check.title}</strong>
                                    <span className={statusClassName(check.status)}>{statusLabel(check.status)}</span>
                                  </div>
                                  <p className="helper" style={{ marginBottom: 0 }}>
                                    {check.pageNumber ? `Page ${check.pageNumber}: ` : ""}
                                    {check.message}
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : null
                        )}
                      </div>

                      <div className="page-grid">
                        {report.pages.map((page) => (
                          <div key={`${report.fileName}-page-${page.pageNumber}`} className="page-card">
                            <div className="pill-row">
                              <span className="pill pill-soft">Page {page.pageNumber}</span>
                              <span className={statusClassName(page.status)}>{statusLabel(page.status)}</span>
                            </div>

                            <p style={{ margin: "12px 0 0", fontWeight: 700 }}>
                              {formatMm(page.trimBoxMm.width)} x {formatMm(page.trimBoxMm.height)}
                            </p>

                            <div className="page-meta" style={{ marginTop: 14 }}>
                              <div className="page-box">
                                <strong>Bleed</strong>
                                <div className="helper" style={{ marginBottom: 0 }}>
                                  T {formatMm(page.bleedMm.top)} / R {formatMm(page.bleedMm.right)}
                                  <br />
                                  B {formatMm(page.bleedMm.bottom)} / L {formatMm(page.bleedMm.left)}
                                </div>
                              </div>

                              <div className="page-box">
                                <strong>Content scan</strong>
                                <div className="helper" style={{ marginBottom: 0 }}>
                                  {page.textCount} text block(s)
                                  <br />
                                  {page.vectorCount} vector path(s)
                                  <br />
                                  {page.imageCount} image placement(s)
                                </div>
                              </div>
                            </div>

                            <div className="tag-row">
                              {page.detectedColorSpaces.length === 0 ? (
                                <span className="pill pill-soft">Colour space not detected</span>
                              ) : (
                                page.detectedColorSpaces.map((space) => (
                                  <span key={`${report.fileName}-${page.pageNumber}-${space}`} className="pill pill-soft">
                                    {space}
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div>
                        <p className="eyebrow" style={{ marginTop: 0 }}>Preview</p>
                        <ArtworkPreview file={file} report={report} />
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
