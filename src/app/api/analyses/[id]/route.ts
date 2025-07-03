import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Analysis ID is required" },
        { status: 400 }
      );
    }

    // Construct the analysis file path
    const analysisPath = path.join(
      process.cwd(),
      "uploads",
      "analyses",
      `analysis_${id}.json`
    );

    // Check if the analysis file exists
    if (!existsSync(analysisPath)) {
      return NextResponse.json(
        { success: false, message: "Analysis not found" },
        { status: 404 }
      );
    }

    // Read and parse the analysis file
    const analysisData = await readFile(analysisPath, "utf-8");
    const analysis = JSON.parse(analysisData);

    return NextResponse.json({
      success: true,
      analysis,
    });
  } catch (error) {
    console.error("Error retrieving analysis:", error);
    return NextResponse.json(
      { success: false, message: "Failed to retrieve analysis" },
      { status: 500 }
    );
  }
}
