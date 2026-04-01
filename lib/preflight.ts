import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import type {
  ArtworkCheckResult,
  ArtworkPageReport,
  ArtworkReport,
  BoundingBoxMm,
  PageGeometryMm,
  PreflightStatus,
  WarningRegion
} from "@/types";

const POINT_TO_MM = 25.4 / 72;
const MM_TO_INCH = 1 / 25.4;
const ALLOWED_BLEEDS_MM = [1.5, 2];
const BLEED_TOLERANCE_MM = 0.2;
const SAFETY_ZONE_MM = 3;

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function pointsToMm(value: number) {
  return value * POINT_TO_MM;
}

function extname(fileName: string) {
  return path.extname(fileName).toLowerCase();
}

function rankStatus(status: PreflightStatus) {
  if (status === "fail") return 3;
  if (status === "warn") return 2;
  return 1;
}

function maxStatus(...statuses: PreflightStatus[]) {
  return statuses.reduce<PreflightStatus>((current, next) => {
    return rankStatus(next) > rankStatus(current) ? next : current;
  }, "pass");
}

function createCheck(
  status: PreflightStatus,
  code: string,
  title: string,
  message: string,
  pageNumber?: number
): ArtworkCheckResult {
  return { status, code, title, message, pageNumber };
}

function boxToMm(box: { x: number; y: number; width: number; height: number }): PageGeometryMm {
  return {
    x: pointsToMm(box.x),
    y: pointsToMm(box.y),
    width: pointsToMm(box.width),
    height: pointsToMm(box.height)
  };
}

function boundsToMm(raw: { minX: number; minY: number; maxX: number; maxY: number }, pageHeightPoints: number): BoundingBoxMm {
  return {
    minX: pointsToMm(raw.minX),
    minY: pointsToMm(pageHeightPoints - raw.maxY),
    maxX: pointsToMm(raw.maxX),
    maxY: pointsToMm(pageHeightPoints - raw.minY)
  };
}

function safeBounds(trimBoxMm: PageGeometryMm): BoundingBoxMm {
  return {
    minX: trimBoxMm.x + SAFETY_ZONE_MM,
    minY: trimBoxMm.y + SAFETY_ZONE_MM,
    maxX: trimBoxMm.x + trimBoxMm.width - SAFETY_ZONE_MM,
    maxY: trimBoxMm.y + trimBoxMm.height - SAFETY_ZONE_MM
  };
}

function summarizeBounds(bounds: BoundingBoxMm): BoundingBoxMm {
  return {
    minX: round(bounds.minX),
    minY: round(bounds.minY),
    maxX: round(bounds.maxX),
    maxY: round(bounds.maxY)
  };
}

function isInside(bounds: BoundingBoxMm, box: BoundingBoxMm) {
  return (
    box.minX >= bounds.minX &&
    box.maxX <= bounds.maxX &&
    box.minY >= bounds.minY &&
    box.maxY <= bounds.maxY
  );
}

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs")
  ).toString();
  return pdfjs;
}

function summarizeStatus(status: PreflightStatus, count: number) {
  if (status === "pass") return `All ${count} preflight checks passed.`;
  if (status === "warn") return "Core geometry passed, but one or more warning items still need review.";
  return "The file failed one or more mandatory preflight rules.";
}

function tryGetImageObject(page: any, name: string) {
  const stores = [page.objs, page.commonObjs];

  for (const store of stores) {
    try {
      if (store && typeof store.has === "function" && store.has(name)) {
        return store.get(name);
      }
    } catch {}
  }

  return null;
}

function computeDpi(widthPx: number, heightPx: number, widthMm: number, heightMm: number) {
  const widthInches = widthMm * MM_TO_INCH;
  const heightInches = heightMm * MM_TO_INCH;

  if (widthInches <= 0 || heightInches <= 0) {
    return null;
  }

  return Math.min(widthPx / widthInches, heightPx / heightInches);
}

async function scanPage(pdfjs: any, page: any, pageHeightPoints: number) {
  const operatorList = await page.getOperatorList();
  const textContent = await page.getTextContent();
  const colorSpaces = new Set<string>();
  const textBounds: BoundingBoxMm[] = [];
  const vectorBounds: BoundingBoxMm[] = [];
  const images: Array<{ boundsMm: BoundingBoxMm; dpi: number | null }> = [];
  const rgbRegions: WarningRegion[] = [];
  let currentTransform = [1, 0, 0, 1, 0, 0];
  const transformStack: number[][] = [];
  let currentFillColorSpace = "Unknown";
  let currentStrokeColorSpace = "Unknown";
  const textBoundsQueue: BoundingBoxMm[] = [];

  for (const item of textContent.items as Array<{ transform: number[]; width?: number; height?: number }>) {
    const width = Math.max(0, item.width ?? 0);
    const height = Math.abs(item.height ?? 0) || 12;
    const raw = {
      minX: item.transform[4],
      maxX: item.transform[4] + width,
      minY: item.transform[5] - height * 0.2,
      maxY: item.transform[5] + height * 0.8
    };
    const bounds = boundsToMm(raw, pageHeightPoints);
    textBounds.push(bounds);
    textBoundsQueue.push(bounds);
  }

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index];
    const args = operatorList.argsArray[index];

    if (fn === pdfjs.OPS.save) {
      transformStack.push([...currentTransform]);
      continue;
    }

    if (fn === pdfjs.OPS.restore) {
      currentTransform = transformStack.pop() ?? [1, 0, 0, 1, 0, 0];
      continue;
    }

    if (fn === pdfjs.OPS.transform) {
      currentTransform = pdfjs.Util.transform(currentTransform, args);
      continue;
    }

    if (
      fn === pdfjs.OPS.setFillRGBColor ||
      fn === pdfjs.OPS.setStrokeRGBColor ||
      fn === pdfjs.OPS.setFillRGBColorN ||
      fn === pdfjs.OPS.setStrokeRGBColorN
    ) {
      colorSpaces.add("RGB");
      if (fn === pdfjs.OPS.setFillRGBColor || fn === pdfjs.OPS.setFillRGBColorN) {
        currentFillColorSpace = "RGB";
      }
      if (fn === pdfjs.OPS.setStrokeRGBColor || fn === pdfjs.OPS.setStrokeRGBColorN) {
        currentStrokeColorSpace = "RGB";
      }
      continue;
    }

    if (fn === pdfjs.OPS.setFillCMYKColor || fn === pdfjs.OPS.setStrokeCMYKColor) {
      colorSpaces.add("CMYK");
      if (fn === pdfjs.OPS.setFillCMYKColor) {
        currentFillColorSpace = "CMYK";
      }
      if (fn === pdfjs.OPS.setStrokeCMYKColor) {
        currentStrokeColorSpace = "CMYK";
      }
      continue;
    }

    if (fn === pdfjs.OPS.setFillGray || fn === pdfjs.OPS.setStrokeGray) {
      colorSpaces.add("Grayscale");
      if (fn === pdfjs.OPS.setFillGray) {
        currentFillColorSpace = "Grayscale";
      }
      if (fn === pdfjs.OPS.setStrokeGray) {
        currentStrokeColorSpace = "Grayscale";
      }
      continue;
    }

    if (fn === pdfjs.OPS.setFillColorSpace || fn === pdfjs.OPS.setStrokeColorSpace) {
      const name = String(args?.[0] ?? "").toLowerCase();
      let detected = "Unknown";

      if (name.includes("cmyk")) {
        colorSpaces.add("CMYK");
        detected = "CMYK";
      }

      if (name.includes("rgb")) {
        colorSpaces.add("RGB");
        detected = "RGB";
      }

      if (name.includes("separation") || name.includes("spot")) {
        colorSpaces.add("Spot");
        detected = "Spot";
      }

      if (fn === pdfjs.OPS.setFillColorSpace) {
        currentFillColorSpace = detected;
      }

      if (fn === pdfjs.OPS.setStrokeColorSpace) {
        currentStrokeColorSpace = detected;
      }
      continue;
    }

    if (fn === pdfjs.OPS.constructPath) {
      const [ops, coordinates] = args as [number[], number[]];
      let cursor = 0;
      let pathBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

      const expand = (x: number, y: number) => {
        const tx = currentTransform[0] * x + currentTransform[2] * y + currentTransform[4];
        const ty = currentTransform[1] * x + currentTransform[3] * y + currentTransform[5];

        if (!pathBounds) {
          pathBounds = { minX: tx, minY: ty, maxX: tx, maxY: ty };
          return;
        }

        pathBounds.minX = Math.min(pathBounds.minX, tx);
        pathBounds.minY = Math.min(pathBounds.minY, ty);
        pathBounds.maxX = Math.max(pathBounds.maxX, tx);
        pathBounds.maxY = Math.max(pathBounds.maxY, ty);
      };

      for (const op of ops) {
        if (op === pdfjs.OPS.moveTo || op === pdfjs.OPS.lineTo) {
          expand(coordinates[cursor], coordinates[cursor + 1]);
          cursor += 2;
          continue;
        }

        if (op === pdfjs.OPS.curveTo) {
          expand(coordinates[cursor], coordinates[cursor + 1]);
          expand(coordinates[cursor + 2], coordinates[cursor + 3]);
          expand(coordinates[cursor + 4], coordinates[cursor + 5]);
          cursor += 6;
          continue;
        }

        if (op === pdfjs.OPS.curveTo2 || op === pdfjs.OPS.curveTo3) {
          expand(coordinates[cursor], coordinates[cursor + 1]);
          expand(coordinates[cursor + 2], coordinates[cursor + 3]);
          cursor += 4;
          continue;
        }

        if (op === pdfjs.OPS.rectangle) {
          expand(coordinates[cursor], coordinates[cursor + 1]);
          expand(coordinates[cursor] + coordinates[cursor + 2], coordinates[cursor + 1] + coordinates[cursor + 3]);
          cursor += 4;
        }
      }

      if (pathBounds) {
        const bounds = boundsToMm(pathBounds, pageHeightPoints);
        vectorBounds.push(bounds);

        if (currentFillColorSpace === "RGB" || currentStrokeColorSpace === "RGB") {
          rgbRegions.push({
            status: "fail",
            label: "RGB vector/object",
            kind: "colour",
            boundsMm: summarizeBounds(bounds)
          });
        }
      }

      continue;
    }

    if (
      fn === pdfjs.OPS.showText ||
      fn === pdfjs.OPS.showSpacedText ||
      fn === pdfjs.OPS.nextLineShowText ||
      fn === pdfjs.OPS.nextLineSetSpacingShowText
    ) {
      const bounds = textBoundsQueue.shift();

      if (bounds && currentFillColorSpace === "RGB") {
        rgbRegions.push({
          status: "fail",
          label: "RGB text",
          kind: "colour",
          boundsMm: summarizeBounds(bounds)
        });
      }

      continue;
    }

    if (
      fn === pdfjs.OPS.paintImageXObject ||
      fn === pdfjs.OPS.paintInlineImageXObject ||
      fn === pdfjs.OPS.paintImageMaskXObject
    ) {
      const widthPoints = Math.hypot(currentTransform[0], currentTransform[1]);
      const heightPoints = Math.hypot(currentTransform[2], currentTransform[3]);
      const raw = {
        minX: currentTransform[4],
        minY: currentTransform[5],
        maxX: currentTransform[4] + widthPoints,
        maxY: currentTransform[5] + heightPoints
      };
      const imageObject =
        typeof args?.[0] === "string"
          ? tryGetImageObject(page, args[0])
          : args?.[0] && typeof args[0] === "object"
            ? args[0]
            : null;
      const widthMm = pointsToMm(Math.abs(widthPoints));
      const heightMm = pointsToMm(Math.abs(heightPoints));
      const widthPx = Number(imageObject?.width);
      const heightPx = Number(imageObject?.height);
      const dpi =
        Number.isFinite(widthPx) && Number.isFinite(heightPx)
          ? computeDpi(widthPx, heightPx, widthMm, heightMm)
          : null;

      images.push({
        boundsMm: boundsToMm(raw, pageHeightPoints),
        dpi: dpi ? round(dpi) : null
      });
    }
  }

  return { colorSpaces, textBounds, vectorBounds, images, rgbRegions };
}

function analyseBleed(trimBoxMm: PageGeometryMm, bleedBoxMm: PageGeometryMm, pageNumber: number) {
  const left = round(trimBoxMm.x - bleedBoxMm.x);
  const bottom = round(trimBoxMm.y - bleedBoxMm.y);
  const right = round(bleedBoxMm.x + bleedBoxMm.width - (trimBoxMm.x + trimBoxMm.width));
  const top = round(bleedBoxMm.y + bleedBoxMm.height - (trimBoxMm.y + trimBoxMm.height));
  const values = [top, right, bottom, left];

  const matchesAllowed = ALLOWED_BLEEDS_MM.find((allowed) =>
    values.every((value) => Math.abs(value - allowed) <= BLEED_TOLERANCE_MM)
  );

  const message = matchesAllowed
    ? `Bleed is consistent on all sides at ${round(matchesAllowed)} mm.`
    : `Bleed values are ${values.map((value) => `${value} mm`).join(", ")}. Only 1.5 mm or 2 mm is allowed.`;

  return {
    bleedMm: { top, right, bottom, left },
    check: createCheck(matchesAllowed ? "pass" : "fail", "bleed", "Bleed", message, pageNumber)
  };
}

function analyseSafety(trimBoxMm: PageGeometryMm, scan: Awaited<ReturnType<typeof scanPage>>, pageNumber: number) {
  const inside = safeBounds(trimBoxMm);
  const textViolations = scan.textBounds.filter((box) => !isInside(inside, box));
  const vectorViolations = scan.vectorBounds.filter((box) => !isInside(inside, box));
  const imageViolations = scan.images.filter((item) => !isInside(inside, item.boundsMm));
  const results: ArtworkCheckResult[] = [];
  const warningRegions: WarningRegion[] = [];

  results.push(
    textViolations.length > 0
      ? createCheck("fail", "safety-text", "Safety zone", `${textViolations.length} text item(s) sit inside the 3 mm keep-clear area.`, pageNumber)
      : createCheck("pass", "safety-text", "Safety zone", "Detected text stays at least 3 mm inside trim.", pageNumber)
  );

  warningRegions.push(
    ...textViolations.map((boundsMm) => ({
      status: "fail" as const,
      label: "Text inside safety zone",
      kind: "text" as const,
      boundsMm: summarizeBounds(boundsMm)
    }))
  );

  if (vectorViolations.length > 0) {
    results.push(
      createCheck("warn", "safety-vector", "Vector proximity", `${vectorViolations.length} vector path(s) cross into the safety zone and should be reviewed manually.`, pageNumber)
    );
    warningRegions.push(
      ...vectorViolations.map((boundsMm) => ({
        status: "warn" as const,
        label: "Vector near trim",
        kind: "vector" as const,
        boundsMm: summarizeBounds(boundsMm)
      }))
    );
  }

  if (imageViolations.length > 0) {
    results.push(
      createCheck("warn", "safety-image", "Image proximity", `${imageViolations.length} image placement(s) cross into the safety zone. This may be fine for background bleed but should be checked.`, pageNumber)
    );
    warningRegions.push(
      ...imageViolations.map((item) => ({
        status: "warn" as const,
        label: "Image near trim",
        kind: "image" as const,
        boundsMm: summarizeBounds(item.boundsMm)
      }))
    );
  }

  return { checks: results, warningRegions, safeBoundsMm: summarizeBounds(inside) };
}

function analyseColour(scan: Awaited<ReturnType<typeof scanPage>>, pageNumber: number) {
  const detected = Array.from(scan.colorSpaces).sort();

  if (detected.length === 0) {
    return createCheck("warn", "colour", "Colour usage", "No explicit colour-space operators were detected, so colour intent should be checked manually.", pageNumber);
  }

  if (detected.includes("RGB")) {
    return createCheck("fail", "colour", "Colour usage", `RGB content was detected (${detected.join(", ")}), and highlighted regions are shown where the parser could map them.`, pageNumber);
  }

  if (detected.includes("Spot")) {
    return createCheck("warn", "colour", "Colour usage", `Spot colour usage was detected (${detected.join(", ")}). Confirm the print workflow supports it.`, pageNumber);
  }

  return createCheck("pass", "colour", "Colour usage", `Detected colour spaces are ${detected.join(", ")}.`, pageNumber);
}

function analyseRaster(scan: Awaited<ReturnType<typeof scanPage>>, pageNumber: number) {
  if (scan.images.length === 0) {
    return {
      check: createCheck("pass", "raster", "Raster content", "No raster images were detected on this page.", pageNumber),
      warningRegions: [] as WarningRegion[]
    };
  }

  const resolvedDpi = scan.images.map((image) => image.dpi).filter((dpi): dpi is number => dpi !== null);

  if (resolvedDpi.length === 0) {
    return {
      check: createCheck("warn", "raster", "Raster content", `${scan.images.length} raster image placement(s) were found, but effective DPI could not be resolved confidently.`, pageNumber),
      warningRegions: scan.images.map((image) => ({
        status: "warn" as const,
        label: "Image DPI unknown",
        kind: "image" as const,
        boundsMm: summarizeBounds(image.boundsMm)
      }))
    };
  }

  const lowDpiImages = scan.images.filter((image) => image.dpi !== null && image.dpi < 300);

  if (lowDpiImages.length > 0) {
    return {
      check: createCheck("fail", "raster", "Raster content", "At least one detected image placement falls below 300 DPI.", pageNumber),
      warningRegions: lowDpiImages.map((image) => ({
        status: "fail" as const,
        label: `Image below 300 DPI${image.dpi ? ` (${image.dpi} DPI)` : ""}`,
        kind: "image" as const,
        boundsMm: summarizeBounds(image.boundsMm)
      }))
    };
  }

  return {
    check: createCheck("pass", "raster", "Raster content", "Resolved image placements are at or above 300 DPI.", pageNumber),
    warningRegions: [] as WarningRegion[]
  };
}

export async function analyzeArtwork(bytes: ArrayBuffer, fileName: string): Promise<ArtworkReport> {
  const extension = extname(fileName);
  const fileType = extension === ".ai" ? "AI" : "PDF";

  if (extension !== ".pdf" && extension !== ".ai") {
    throw new Error(`Unsupported file type for ${fileName}.`);
  }

  const pdfBytes = new Uint8Array(bytes);
  let pdfDoc;
  let pdfjs;
  let pdfjsDoc;

  try {
    [pdfDoc, pdfjs] = await Promise.all([
      PDFDocument.load(pdfBytes, { ignoreEncryption: true }),
      loadPdfJs()
    ]);
    pdfjsDoc = await pdfjs.getDocument({
      data: pdfBytes,
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: false
    } as never).promise;
  } catch (error) {
    if (extension === ".ai") {
      const check = createCheck(
        "fail",
        "ai-compatibility",
        "AI compatibility",
        "This Illustrator file is not PDF compatible, so it cannot be preflighted by this app."
      );

      return {
        fileName,
        fileType,
        pdfCompatible: false,
        status: "fail",
        summary: check.message,
        pageCount: 0,
        primaryTrimSizeMm: null,
        checks: [check],
        pages: []
      };
    }

    throw error;
  }

  const checks: ArtworkCheckResult[] = [];
  const pages: ArtworkPageReport[] = [];

  for (let index = 0; index < pdfDoc.getPageCount(); index += 1) {
    const pageNumber = index + 1;
    const libPage = pdfDoc.getPage(index);
    const jsPage = await pdfjsDoc.getPage(pageNumber);
    const viewport = jsPage.getViewport({ scale: 1 });
    const pageSizeMm = {
      width: round(pointsToMm(viewport.width)),
      height: round(pointsToMm(viewport.height))
    };
    const trimBoxMm = boxToMm(libPage.getTrimBox());
    const bleedBoxMm = boxToMm(libPage.getBleedBox());
    const scan = await scanPage(pdfjs, jsPage, viewport.height);
    const bleed = analyseBleed(trimBoxMm, bleedBoxMm, pageNumber);
    const colour = analyseColour(scan, pageNumber);
    const safety = analyseSafety(trimBoxMm, scan, pageNumber);
    const raster = analyseRaster(scan, pageNumber);
    const pageChecks = [bleed.check, colour, raster.check, ...safety.checks];
    const pageStatus = pageChecks.reduce<PreflightStatus>((current, check) => maxStatus(current, check.status), "pass");

    checks.push(...pageChecks);
    pages.push({
      pageNumber,
      status: pageStatus,
      pageSizeMm,
      trimBoxMm: {
        x: round(trimBoxMm.x),
        y: round(trimBoxMm.y),
        width: round(trimBoxMm.width),
        height: round(trimBoxMm.height)
      },
      bleedBoxMm: {
        x: round(bleedBoxMm.x),
        y: round(bleedBoxMm.y),
        width: round(bleedBoxMm.width),
        height: round(bleedBoxMm.height)
      },
      safeBoundsMm: safety.safeBoundsMm,
      bleedMm: bleed.bleedMm,
      detectedColorSpaces: Array.from(scan.colorSpaces).sort(),
      textCount: scan.textBounds.length,
      vectorCount: scan.vectorBounds.length,
      imageCount: scan.images.length,
      warningRegions: [...safety.warningRegions, ...raster.warningRegions, ...scan.rgbRegions]
    });
  }

  const status = checks.reduce<PreflightStatus>((current, check) => maxStatus(current, check.status), "pass");
  const firstPage = pages[0];

  return {
    fileName,
    fileType,
    pdfCompatible: true,
    status,
    summary: summarizeStatus(status, checks.length),
    pageCount: pages.length,
    primaryTrimSizeMm: firstPage
      ? {
          width: firstPage.trimBoxMm.width,
          height: firstPage.trimBoxMm.height
        }
      : null,
    checks,
    pages
  };
}
