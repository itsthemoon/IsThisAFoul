import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";

// Set the FFmpeg binary path with proper error handling
try {
  if (ffmpegStatic) {
    let ffmpegPath = ffmpegStatic;

    // Handle the case where ffmpeg-static returns a complex path in development
    if (typeof ffmpegPath === "string") {
      // If the path contains Next.js build artifacts or is not accessible, try alternatives
      if (
        ffmpegPath.includes("[project]") ||
        ffmpegPath.includes("[app-route]") ||
        !existsSync(ffmpegPath)
      ) {
        // Try to find the actual ffmpeg binary in node_modules
        const possiblePaths = [
          path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
          path.join(
            process.cwd(),
            "node_modules",
            "ffmpeg-static",
            "bin",
            "ffmpeg"
          ),
          path.join(process.cwd(), "node_modules", ".bin", "ffmpeg"),
        ];

        let foundPath = false;
        for (const possiblePath of possiblePaths) {
          if (existsSync(possiblePath)) {
            ffmpegPath = possiblePath;
            foundPath = true;
            break;
          }
        }

        if (!foundPath) {
          throw new Error(
            `Could not find FFmpeg binary. Tried paths: ${possiblePaths.join(
              ", "
            )}`
          );
        }
      }
    } else {
      throw new Error(
        `ffmpeg-static returned unexpected type: ${typeof ffmpegPath}`
      );
    }

    ffmpeg.setFfmpegPath(ffmpegPath);
  } else {
    throw new Error("ffmpeg-static path is null or undefined");
  }
} catch (error) {
  console.error("Error setting FFmpeg path:", error);
  throw new Error(
    `FFmpeg configuration failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}

interface FrameData {
  path: string;
  timestamp: number;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("video") as File;

    if (!file) {
      return NextResponse.json(
        { success: false, message: "No video file provided" },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.type.startsWith("video/")) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid file type. Please upload a video file.",
        },
        { status: 400 }
      );
    }

    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(process.cwd(), "uploads");
    const framesDir = path.join(uploadsDir, "frames");
    const analysesDir = path.join(uploadsDir, "analyses");

    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }

    if (!existsSync(framesDir)) {
      await mkdir(framesDir, { recursive: true });
    }

    if (!existsSync(analysesDir)) {
      await mkdir(analysesDir, { recursive: true });
    }

    // Clean up previous uploads (to prevent storage bloat)
    try {
      const frameFiles = await readdir(framesDir);
      const analysisFiles = await readdir(analysesDir);

      // Remove old frame files
      for (const file of frameFiles) {
        await unlink(path.join(framesDir, file));
      }

      // Remove old analysis files
      for (const file of analysisFiles) {
        await unlink(path.join(analysesDir, file));
      }
    } catch (cleanupError) {
      console.warn("Failed to clean up previous uploads:", cleanupError);
      // Continue with upload even if cleanup fails
    }

    // Generate unique filename
    const timestamp = Date.now();
    const fileExtension = path.extname(file.name);
    const filename = `video_${timestamp}${fileExtension}`;
    const filepath = path.join(uploadsDir, filename);

    // Save the uploaded file
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filepath, buffer);

    // Extract frames using FFmpeg
    const framePrefix = `frames_${timestamp}`;
    const framePattern = path.join(framesDir, `${framePrefix}_%02d.jpg`);

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(filepath)
          .videoFilters("fps=1") // Extract 1 frame per second
          .output(framePattern)
          .on("end", () => {
            resolve();
          })
          .on("error", (err) => {
            console.error("FFmpeg error:", err);
            reject(err);
          })
          .run();
      });

      // Read the extracted frames
      const frameFiles = await readdir(framesDir);
      const extractedFrames = frameFiles
        .filter((file) => file.startsWith(framePrefix))
        .sort()
        .map(
          (filename, index): FrameData => ({
            path: path.join(framesDir, filename),
            timestamp: index + 1, // Since we extract at 1fps, timestamp is just the frame number
          })
        );

      // Clean up the original video file
      try {
        await unlink(filepath);
      } catch (cleanupError) {
        console.warn("Failed to clean up original video file:", cleanupError);
      }

      // Prepare analysis file path for the next step
      const analysisFilePath = path.join(
        analysesDir,
        `analysis_${timestamp}.json`
      );

      return NextResponse.json({
        success: true,
        frames: extractedFrames,
        analysisPath: analysisFilePath,
        timestamp: timestamp,
        message: `Successfully extracted ${extractedFrames.length} frames`,
      });
    } catch (ffmpegError) {
      console.error("FFmpeg processing failed:", ffmpegError);

      // Clean up the uploaded file on error
      try {
        await unlink(filepath);
      } catch (cleanupError) {
        console.warn(
          "Failed to clean up video file after FFmpeg error:",
          cleanupError
        );
      }

      return NextResponse.json(
        {
          success: false,
          message:
            "Failed to process video. Please ensure the video is valid and ≤8 seconds long.",
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}

// Handle unsupported methods
export async function GET() {
  return NextResponse.json(
    { success: false, message: "Method not allowed" },
    { status: 405 }
  );
}
