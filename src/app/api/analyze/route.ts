import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

interface FrameAnalysis {
  frameNumber: number;
  timestamp: number;
  action: string;
  playerMovement: string;
  contact: string;
  ballStatus: string;
  foulIndicators: string[];
}

export async function POST(request: NextRequest) {
  try {
    const { frames, timestamp } = await request.json();

    if (!frames || !Array.isArray(frames)) {
      return NextResponse.json(
        { success: false, message: "Invalid frames data" },
        { status: 400 }
      );
    }

    // Initialize the model
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

    try {
      console.log(
        `🎬 Starting multi-frame analysis for ${frames.length} frames`
      );

      // Prepare all frames for batch analysis
      const frameImages = await Promise.all(
        frames.map(async (frame) => {
          const imageBuffer = await readFile(frame.path);
          return imageBuffer.toString("base64");
        })
      );

      // Enhanced prompt for multi-frame analysis with video-like context
      const prompt = `You are analyzing a basketball video that has been broken down into ${frames.length} sequential frames. These frames represent a continuous play captured at 1 frame per second. 

CRITICAL INSTRUCTION: Analyze this as if you're watching a VIDEO, not isolated images. Consider the full temporal context and motion between frames before making any foul determinations.

IMPORTANT CONTEXT FOR BASKETBALL FOULS:
- Incidental contact is NOT a foul - basketball is a contact sport
- A defender who establishes legal guarding position BEFORE an offensive player begins their upward motion has the right to that space
- An offensive player who initiates contact with a stationary, legal defender may be called for a charge
- Contact must affect the play or provide an advantage to be considered a foul
- Many plays that LOOK like fouls in a single frame are actually legal when viewed in motion

For EACH frame (numbered 1 to ${frames.length}), provide analysis in this EXACT format:

FRAME 1:
ACTION: [One sentence describing the main basketball action]
PLAYER_MOVEMENT: [Describe if players are moving, stationary, or changing direction - note changes from previous frame]
CONTACT: [Describe any physical contact - none, minimal, incidental, or significant]
BALL_STATUS: [Where is the ball and who has possession]
FOUL_INDICATORS: [ONLY list if there are CLEAR violations. If contact appears incidental or legal, leave empty]

FRAME 2:
ACTION: [One sentence describing the main basketball action]
PLAYER_MOVEMENT: [Describe movement and note how it differs from Frame 1]
CONTACT: [Describe contact and whether it's developing, continuing, or resolving from Frame 1]
BALL_STATUS: [Ball location and possession changes from Frame 1]
FOUL_INDICATORS: [ONLY list if there are CLEAR violations. If contact appears incidental or legal, leave empty]

Continue this pattern for all ${frames.length} frames, always noting changes and progression from previous frames.

After analyzing all frames, provide:

SEQUENCE_ANALYSIS:
PROGRESSION: [Describe the complete play from start to finish as if describing a video]
KEY_MOMENTS: [Which frames show the most important basketball actions - not just contact]
FOUL_DETERMINATION: [Based on the FULL SEQUENCE and NBA rules, is there a foul? Be conservative - when in doubt, it's likely incidental contact. Consider: Did the contact affect the play? Was it initiated by offense or defense? Did the defender have legal position?]

Remember:
- A play that shows contact in Frame 4 might be legal if the defender established position in Frame 2
- Fast movements between frames suggest momentum that can cause incidental contact
- Not all contact is a foul - focus on whether it's illegal AND affects the play
- Consider who initiated the contact and whether players were in legal positions

BE CONSERVATIVE: Only call fouls that are CLEAR violations when viewing the complete sequence.`;

      // Build content array with all frames
      const content = [
        {
          text: prompt,
        },
        ...frameImages.map((base64Image, index) => ({
          inlineData: {
            data: base64Image,
            mimeType: "image/jpeg",
          },
        })),
      ];

      // Send all frames to Gemini at once
      const result = await model.generateContent(content);
      const response = await result.response;
      const analysisText = response.text().trim();

      // Parse the multi-frame response
      const frameAnalyses = parseMultiFrameAnalysis(analysisText, frames);

      // Save analysis results to file
      try {
        const analysesDir = path.join(process.cwd(), "uploads", "analyses");

        // Create analyses directory if it doesn't exist
        if (!existsSync(analysesDir)) {
          await mkdir(analysesDir, { recursive: true });
        }

        // Use timestamp from request or generate one
        const analysisTimestamp = timestamp || Date.now();
        const analysisFilePath = path.join(
          analysesDir,
          `analysis_${analysisTimestamp}.json`
        );

        const analysisSummary = generateAnalysisSummary(frameAnalyses);

        const analysisData = {
          timestamp: analysisTimestamp,
          frameCount: frameAnalyses.length,
          analyses: frameAnalyses,
          createdAt: new Date().toISOString(),
          type: "basketball_foul_analysis",
          summary: analysisSummary,
          sequenceAnalysis: extractSequenceAnalysis(analysisText),
        };

        await writeFile(
          analysisFilePath,
          JSON.stringify(analysisData, null, 2)
        );

        // Call the foul determination API
        let foulDetermination = null;
        try {
          const foulResponse = await fetch(
            `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/foul`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ analysisId: analysisTimestamp }),
            }
          );

          if (foulResponse.ok) {
            const foulData = await foulResponse.json();
            foulDetermination = foulData;
          } else {
            console.error(
              "❌ Foul determination failed:",
              await foulResponse.text()
            );
          }
        } catch (foulError) {
          console.error("❌ Error calling foul determination:", foulError);
        }

        const response = {
          success: true,
          analyses: frameAnalyses,
          analysisId: analysisTimestamp,
          summary: analysisSummary,
          sequenceAnalysis: extractSequenceAnalysis(analysisText),
          foulDetermination,
          message: `Successfully analyzed ${frameAnalyses.length} frames for foul detection`,
        };

        return NextResponse.json(response);
      } catch (saveError) {
        console.error("❌ Error saving analysis:", saveError);

        // Still return success for analysis, but note the save error
        const response = {
          success: true,
          analyses: frameAnalyses,
          summary: generateAnalysisSummary(frameAnalyses),
          sequenceAnalysis: extractSequenceAnalysis(analysisText),
          message: `Successfully analyzed ${frameAnalyses.length} frames (warning: could not save to file)`,
        };

        return NextResponse.json(response);
      }
    } catch (analysisError) {
      console.error("❌ Error during Gemini analysis:", analysisError);

      // Fallback to individual frame processing if batch fails
      console.log("Falling back to individual frame processing...");

      const frameAnalyses: FrameAnalysis[] = [];

      // Process each frame individually as fallback
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];

        try {
          // Read the frame image
          const imageBuffer = await readFile(frame.path);
          const base64Image = imageBuffer.toString("base64");

          // Original single-frame prompt
          const prompt = `Analyze this basketball frame for potential foul scenarios. Provide a structured analysis in this exact format:

ACTION: [One sentence describing the main basketball action - dribbling, shooting, defending, etc.]
PLAYER_MOVEMENT: [Describe if players are moving, stationary, or changing direction - key for blocking vs charging fouls]
CONTACT: [Describe any physical contact between players - none, minimal, significant, or illegal contact]
BALL_STATUS: [Where is the ball and who has possession - dribbling, shooting, loose ball, etc.]
FOUL_INDICATORS: [List specific indicators that suggest a foul - illegal contact, moving screen, reach-in, blocking path, etc. If no foul indicators are present, leave this completely empty after the colon]
ANALYSIS_QUALITY: [Rate the clarity and visibility of the basketball action in this frame: excellent, good, fair, poor]

Focus on details that help determine fouls:
- Is the defender moving or stationary?
- Is there illegal contact (pushing, holding, hitting)?
- Is a player in legal guarding position?
- Are there any illegal screens or blocks?
- Is there a reach-in foul or hand checking?

IMPORTANT FOR FOUL_INDICATORS: 
- If you detect foul indicators, list them separated by commas: reach-in foul, illegal contact, moving screen
- If you detect NO foul indicators, leave it completely empty after the colon like this: "FOUL_INDICATORS:"
- Do NOT use brackets [], parentheses (), or placeholder text like "none"

Be specific and brief. Focus on basketball rules violations.`;

          // Send to Gemini
          const result = await model.generateContent([
            {
              inlineData: {
                data: base64Image,
                mimeType: "image/jpeg",
              },
            },
            prompt,
          ]);

          const response = await result.response;
          const analysisText = response.text().trim();

          // Parse the structured response
          const analysis = parseAnalysisResponse(analysisText);

          frameAnalyses.push({
            frameNumber: i + 1,
            timestamp: frame.timestamp,
            action: analysis.action,
            playerMovement: analysis.playerMovement,
            contact: analysis.contact,
            ballStatus: analysis.ballStatus,
            foulIndicators: analysis.foulIndicators,
          });
        } catch (error) {
          console.error(`❌ Error analyzing frame ${i + 1}:`, error);
          frameAnalyses.push({
            frameNumber: i + 1,
            timestamp: frame.timestamp,
            action: "Failed to analyze frame",
            playerMovement: "Unknown",
            contact: "Unknown",
            ballStatus: "Unknown",
            foulIndicators: [],
          });
        }
      }

      // Continue with saving results...
      const analysesDir = path.join(process.cwd(), "uploads", "analyses");
      if (!existsSync(analysesDir)) {
        await mkdir(analysesDir, { recursive: true });
      }

      const analysisTimestamp = timestamp || Date.now();
      const analysisFilePath = path.join(
        analysesDir,
        `analysis_${analysisTimestamp}.json`
      );

      const analysisSummary = generateAnalysisSummary(frameAnalyses);

      const analysisData = {
        timestamp: analysisTimestamp,
        frameCount: frameAnalyses.length,
        analyses: frameAnalyses,
        createdAt: new Date().toISOString(),
        type: "basketball_foul_analysis",
        summary: analysisSummary,
        fallbackMode: true,
      };

      await writeFile(analysisFilePath, JSON.stringify(analysisData, null, 2));

      // Call the foul determination API
      let foulDetermination = null;
      try {
        const foulResponse = await fetch(
          `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/foul`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ analysisId: analysisTimestamp }),
          }
        );

        if (foulResponse.ok) {
          const foulData = await foulResponse.json();
          foulDetermination = foulData;
        }
      } catch (foulError) {
        console.error("❌ Error calling foul determination:", foulError);
      }

      const response = {
        success: true,
        analyses: frameAnalyses,
        analysisId: analysisTimestamp,
        summary: analysisSummary,
        foulDetermination,
        message: `Successfully analyzed ${frameAnalyses.length} frames using fallback mode`,
      };

      return NextResponse.json(response);
    }
  } catch (error) {
    console.error("💥 Analysis error:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Basketball analysis failed",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// Helper function to parse multi-frame analysis response
function parseMultiFrameAnalysis(text: string, frames: any[]): FrameAnalysis[] {
  const frameAnalyses: FrameAnalysis[] = [];
  const lines = text.split("\n");

  let currentFrame: Partial<FrameAnalysis> | null = null;
  let currentFrameNumber = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Check for frame header - handle markdown bold formatting
    const frameMatch = trimmedLine.match(/^\*?\*?FRAME\s*(\d+):?\*?\*?/i);
    if (frameMatch) {
      // Save previous frame if exists
      if (currentFrame && currentFrameNumber > 0) {
        frameAnalyses.push({
          frameNumber: currentFrameNumber,
          timestamp: frames[currentFrameNumber - 1]?.timestamp || 0,
          action: currentFrame.action || "Unknown action",
          playerMovement: currentFrame.playerMovement || "Unknown movement",
          contact: currentFrame.contact || "Unknown contact",
          ballStatus: currentFrame.ballStatus || "Unknown ball status",
          foulIndicators: currentFrame.foulIndicators || [],
        });
      }

      // Start new frame
      currentFrameNumber = parseInt(frameMatch[1]);
      currentFrame = {};
      continue;
    }

    // Parse frame data
    if (currentFrame && trimmedLine) {
      if (trimmedLine.startsWith("ACTION:")) {
        currentFrame.action = trimmedLine.replace("ACTION:", "").trim();
      } else if (trimmedLine.startsWith("PLAYER_MOVEMENT:")) {
        currentFrame.playerMovement = trimmedLine
          .replace("PLAYER_MOVEMENT:", "")
          .trim();
      } else if (trimmedLine.startsWith("CONTACT:")) {
        currentFrame.contact = trimmedLine.replace("CONTACT:", "").trim();
      } else if (trimmedLine.startsWith("BALL_STATUS:")) {
        currentFrame.ballStatus = trimmedLine
          .replace("BALL_STATUS:", "")
          .trim();
      } else if (trimmedLine.startsWith("FOUL_INDICATORS:")) {
        const indicators = trimmedLine.replace("FOUL_INDICATORS:", "").trim();

        // Handle multi-line foul indicators (bullet points)
        if (!indicators || indicators === "") {
          // Check if next lines are bullet points
          const bulletIndicators: string[] = [];
          let nextIndex = lines.indexOf(line) + 1;

          while (nextIndex < lines.length) {
            const nextLine = lines[nextIndex].trim();
            if (nextLine.startsWith("*") || nextLine.startsWith("-")) {
              // Extract bullet point content
              const bulletContent = nextLine.replace(/^[\*\-]\s*/, "").trim();
              if (bulletContent) {
                bulletIndicators.push(bulletContent);
              }
              nextIndex++;
            } else if (
              nextLine.match(
                /^(ACTION:|PLAYER_MOVEMENT:|CONTACT:|BALL_STATUS:|FRAME|SEQUENCE_ANALYSIS)/i
              )
            ) {
              // Stop if we hit the next field
              break;
            } else if (nextLine === "") {
              // Skip empty lines
              nextIndex++;
            } else {
              // Stop on any other content
              break;
            }
          }

          currentFrame.foulIndicators = bulletIndicators;
        } else {
          currentFrame.foulIndicators = parseFoulIndicators(indicators);
        }
      }
    }

    // Stop parsing individual frames when we hit sequence analysis
    if (trimmedLine.match(/^\*?\*?SEQUENCE_ANALYSIS:?\*?\*?/i)) {
      break;
    }
  }

  // Save last frame
  if (currentFrame && currentFrameNumber > 0) {
    frameAnalyses.push({
      frameNumber: currentFrameNumber,
      timestamp: frames[currentFrameNumber - 1]?.timestamp || 0,
      action: currentFrame.action || "Unknown action",
      playerMovement: currentFrame.playerMovement || "Unknown movement",
      contact: currentFrame.contact || "Unknown contact",
      ballStatus: currentFrame.ballStatus || "Unknown ball status",
      foulIndicators: currentFrame.foulIndicators || [],
    });
  }

  // If parsing failed, create default entries
  if (frameAnalyses.length === 0) {
    console.error("❌ Failed to parse any frames from Gemini response");
    console.error("First 500 chars of response:", text.substring(0, 500));
    return frames.map((frame, index) => ({
      frameNumber: index + 1,
      timestamp: frame.timestamp,
      action: "Failed to parse multi-frame analysis",
      playerMovement: "Unknown",
      contact: "Unknown",
      ballStatus: "Unknown",
      foulIndicators: [],
    }));
  }

  return frameAnalyses;
}

// Helper function to parse foul indicators
function parseFoulIndicators(indicators: string): string[] {
  if (!indicators || indicators.length === 0) {
    return [];
  }

  // Handle various formats Gemini might return
  if (
    indicators === "[]" ||
    indicators === "[ ]" ||
    indicators.toLowerCase() === "none" ||
    indicators.toLowerCase() === "no indicators" ||
    indicators.toLowerCase() === "n/a"
  ) {
    return [];
  }

  // Remove brackets if present
  let cleaned = indicators;
  if (indicators.startsWith("[") && indicators.endsWith("]")) {
    cleaned = indicators.slice(1, -1).trim();
  }

  // Split by comma and filter
  return cleaned
    .split(",")
    .map((i) => i.trim())
    .filter(
      (i) =>
        i.length > 0 && i.toLowerCase() !== "none" && i.toLowerCase() !== "n/a"
    );
}

// Helper function to extract sequence analysis from response
function extractSequenceAnalysis(text: string) {
  // Look for SEQUENCE_ANALYSIS with or without markdown formatting
  const sequenceMatch = text.match(/\*?\*?SEQUENCE_ANALYSIS:?\*?\*?/i);
  if (!sequenceMatch || !sequenceMatch.index) return null;

  const sequenceText = text.substring(sequenceMatch.index);
  const lines = sequenceText.split("\n");

  const analysis: any = {};

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Remove markdown formatting and extract content
    const progressionMatch = trimmedLine.match(
      /\*?\*?PROGRESSION:?\*?\*?\s*(.+)/i
    );
    const keyMomentsMatch = trimmedLine.match(
      /\*?\*?KEY_MOMENTS:?\*?\*?\s*(.+)/i
    );
    const foulDeterminationMatch = trimmedLine.match(
      /\*?\*?FOUL_DETERMINATION:?\*?\*?\s*(.+)/i
    );

    if (progressionMatch) {
      analysis.progression = progressionMatch[1].trim();
    } else if (keyMomentsMatch) {
      analysis.keyMoments = keyMomentsMatch[1].trim();
    } else if (foulDeterminationMatch) {
      analysis.foulDetermination = foulDeterminationMatch[1].trim();
    }
  }

  return Object.keys(analysis).length > 0 ? analysis : null;
}

// Helper function to parse the structured analysis response
function parseAnalysisResponse(text: string) {
  const lines = text.split("\n");
  const analysis = {
    action: "Unknown action",
    playerMovement: "Unknown movement",
    contact: "Unknown contact",
    ballStatus: "Unknown ball status",
    foulIndicators: [] as string[],
    analysisQuality: "fair" as string,
  };

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("ACTION:")) {
      analysis.action = trimmedLine.replace("ACTION:", "").trim();
    } else if (trimmedLine.startsWith("PLAYER_MOVEMENT:")) {
      analysis.playerMovement = trimmedLine
        .replace("PLAYER_MOVEMENT:", "")
        .trim();
    } else if (trimmedLine.startsWith("CONTACT:")) {
      analysis.contact = trimmedLine.replace("CONTACT:", "").trim();
    } else if (trimmedLine.startsWith("BALL_STATUS:")) {
      analysis.ballStatus = trimmedLine.replace("BALL_STATUS:", "").trim();
    } else if (trimmedLine.startsWith("ANALYSIS_QUALITY:")) {
      analysis.analysisQuality = trimmedLine
        .replace("ANALYSIS_QUALITY:", "")
        .trim()
        .toLowerCase();
    } else if (trimmedLine.startsWith("FOUL_INDICATORS:")) {
      const indicators = trimmedLine.replace("FOUL_INDICATORS:", "").trim();

      // Handle bracket format that Gemini is returning
      if (indicators && indicators.length > 0) {
        // Check if it's empty brackets or whitespace brackets
        if (
          indicators === "[]" ||
          indicators === "[ ]" ||
          indicators.trim() === "[]" ||
          indicators.trim() === "[ ]"
        ) {
          analysis.foulIndicators = [];
        } else if (indicators.startsWith("[") && indicators.endsWith("]")) {
          // Remove brackets and parse content
          const bracketContent = indicators.slice(1, -1).trim();
          if (
            bracketContent &&
            bracketContent.toLowerCase() !== "none" &&
            bracketContent.toLowerCase() !== "no indicators" &&
            bracketContent.toLowerCase() !== "n/a"
          ) {
            const parsedIndicators = bracketContent
              .split(",")
              .map((i) => i.trim())
              .filter(
                (i) =>
                  i.length > 0 &&
                  i.toLowerCase() !== "none" &&
                  i.toLowerCase() !== "n/a"
              );

            analysis.foulIndicators = parsedIndicators;
          } else {
            analysis.foulIndicators = [];
          }
        } else {
          // Handle non-bracket format (original logic)
          if (
            indicators.toLowerCase() !== "none" &&
            indicators.toLowerCase() !== "no indicators" &&
            indicators.toLowerCase() !== "no foul indicators" &&
            indicators.toLowerCase() !== "n/a" &&
            indicators.toLowerCase() !== "not applicable"
          ) {
            const parsedIndicators = indicators
              .split(",")
              .map((i) => i.trim())
              .filter(
                (i) =>
                  i.length > 0 &&
                  i.toLowerCase() !== "none" &&
                  i.toLowerCase() !== "n/a"
              );

            analysis.foulIndicators = parsedIndicators;
          } else {
            analysis.foulIndicators = [];
          }
        }
      } else {
        analysis.foulIndicators = [];
      }
    }
  }

  return analysis;
}

// Helper function to generate analysis summary
function generateAnalysisSummary(analyses: FrameAnalysis[]) {
  const totalFrames = analyses.length;
  const framesWithFoulIndicators = analyses.filter(
    (a) => a.foulIndicators.length > 0
  ).length;
  const allFoulIndicators = analyses.flatMap((a) => a.foulIndicators);
  const uniqueFoulIndicators = [...new Set(allFoulIndicators)];

  const summary = {
    totalFrames,
    framesWithFoulIndicators,
    foulIndicatorPercentage: Math.round(
      (framesWithFoulIndicators / totalFrames) * 100
    ),
    commonFoulIndicators: uniqueFoulIndicators,
    recommendation:
      framesWithFoulIndicators > 0
        ? "Potential foul detected - review flagged frames"
        : "No clear foul indicators detected",
  };

  return summary;
}

export async function GET() {
  return NextResponse.json(
    { success: false, message: "Method not allowed" },
    { status: 405 }
  );
}
