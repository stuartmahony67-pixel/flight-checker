import { NextRequest, NextResponse } from "next/server";
import { analyzeArtwork } from "@/lib/preflight";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = Array.from(formData.values()).filter((value): value is File => value instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "Upload at least one PDF or AI file." }, { status: 400 });
    }

    const reports = await Promise.all(
      files.map(async (file) => {
        const bytes = await file.arrayBuffer();
        return analyzeArtwork(bytes, file.name);
      })
    );

    return NextResponse.json({ reports });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected preflight error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
