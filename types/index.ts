export type PreflightStatus = "pass" | "warn" | "fail";

export type PageGeometryMm = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BoundingBoxMm = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type ArtworkCheckResult = {
  status: PreflightStatus;
  code: string;
  title: string;
  message: string;
  pageNumber?: number;
};

export type ArtworkPageReport = {
  pageNumber: number;
  status: PreflightStatus;
  pageSizeMm: {
    width: number;
    height: number;
  };
  trimBoxMm: PageGeometryMm;
  bleedBoxMm: PageGeometryMm;
  safeBoundsMm: BoundingBoxMm;
  bleedMm: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  detectedColorSpaces: string[];
  textCount: number;
  vectorCount: number;
  imageCount: number;
  warningRegions: WarningRegion[];
};

export type WarningRegion = {
  status: PreflightStatus;
  label: string;
  kind: "text" | "vector" | "image" | "colour";
  boundsMm: BoundingBoxMm;
};

export type ArtworkReport = {
  fileName: string;
  fileType: "PDF" | "AI";
  pdfCompatible: boolean;
  status: PreflightStatus;
  summary: string;
  pageCount: number;
  primaryTrimSizeMm: {
    width: number;
    height: number;
  } | null;
  checks: ArtworkCheckResult[];
  pages: ArtworkPageReport[];
};
