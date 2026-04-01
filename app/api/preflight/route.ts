import { NextRequest, NextResponse } from "next/server";
import { analyzeArtwork } from "@/lib/preflight";

export const runtime = "nodejs";

const MAX_FILES_PER_REQUEST = 1;
const MAX_FILE_SIZE_BYTES = 12 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = Array.from(formData.values()).filter((value): value is File => value instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "Upload at least one PDF or AI file." }, { status: 400 });
    }

    if (files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        { error: `Upload one file at a time. This hosting environment is configured for single-file preflight jobs.` },
        { status: 400 }
      );
    }

    const reports = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json(
          { error: `${file.name} is too large. Limit uploads to 12 MB on this hosted version.` },
          { status: 413 }
        );
      }

      const bytes = await file.arrayBuffer();
      reports.push(await analyzeArtwork(bytes, file.name));
    }

    return NextResponse.json({ reports });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected preflight error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
