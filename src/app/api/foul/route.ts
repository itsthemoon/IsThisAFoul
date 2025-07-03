import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Initialize AWS Bedrock Agent Runtime Client
const bedrockClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION || "us-east-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

interface FrameAnalysis {
  frameNumber: number;
  timestamp: number;
  action: string;
  playerMovement: string;
  contact: string;
  ballStatus: string;
  foulIndicators: string[];
}

interface AnalysisData {
  timestamp: number;
  frameCount: number;
  analyses: FrameAnalysis[];
  createdAt: string;
  type: string;
  summary: {
    totalFrames: number;
    framesWithFoulIndicators: number;
    foulIndicatorPercentage: number;
    commonFoulIndicators: string[];
    recommendation: string;
  };
  sequenceAnalysis?: {
    progression: string;
    keyMoments: string;
    foulDetermination: string;
  };
  fallbackMode?: boolean;
}

interface FoulDetermination {
  hasFoul: boolean;
  confidence: "high" | "medium" | "low";
  foulType?: string;
  ruleCitations: Array<{
    ruleNumber: string;
    ruleText: string;
    relevance: string;
  }>;
  explanation: string;
  keyMoments: Array<{
    frameNumber: number;
    description: string;
  }>;
}

export async function POST(request: NextRequest) {
  try {
    const { analysisId } = await request.json();

    if (!analysisId) {
      return NextResponse.json(
        { success: false, message: "Analysis ID is required" },
        { status: 400 }
      );
    }

    // Load the analysis data
    const analysisPath = path.join(
      process.cwd(),
      "uploads",
      "analyses",
      `analysis_${analysisId}.json`
    );

    const analysisContent = await readFile(analysisPath, "utf-8");
    const analysisData: AnalysisData = JSON.parse(analysisContent);

    // Extract key terms from the analysis for knowledge base query
    const keyTerms = extractKeyTerms(analysisData);

    // Query the AWS Knowledge Base for relevant NBA rules
    const relevantRules = await queryKnowledgeBase(keyTerms);

    // Use Gemini to make the final determination
    const foulDetermination = await makeFinalDetermination(
      analysisData,
      relevantRules
    );

    // Save the foul determination
    const foulPath = path.join(
      process.cwd(),
      "uploads",
      "analyses",
      `foul_${analysisId}.json`
    );

    await writeFile(
      foulPath,
      JSON.stringify(
        {
          analysisId,
          ...foulDetermination,
          createdAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    return NextResponse.json({
      success: true,
      ...foulDetermination,
    });
  } catch (error) {
    console.error("Foul determination error:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to determine foul",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

function extractKeyTerms(analysisData: AnalysisData): string[] {
  const terms = new Set<string>();

  // Add common foul indicators
  analysisData.summary.commonFoulIndicators.forEach((indicator) =>
    terms.add(indicator)
  );

  // Extract terms from frame analyses
  analysisData.analyses.forEach((frame) => {
    // Extract contact-related terms
    if (frame.contact.toLowerCase() !== "unknown contact") {
      const contactTerms = frame.contact
        .toLowerCase()
        .match(/\b(contact|push|hold|hit|grab|bump|collision)\b/g);
      contactTerms?.forEach((term) => terms.add(term));
    }

    // Extract movement-related terms
    if (frame.playerMovement.toLowerCase() !== "unknown movement") {
      const movementTerms = frame.playerMovement
        .toLowerCase()
        .match(/\b(moving|stationary|jumping|landing|screening|blocking)\b/g);
      movementTerms?.forEach((term) => terms.add(term));
    }

    // Add specific foul indicators
    frame.foulIndicators.forEach((indicator) => {
      terms.add(indicator.toLowerCase());
    });
  });

  // Add basketball-specific terms based on the analysis
  const hasShootingMotion = analysisData.analyses.some((f) =>
    f.action.toLowerCase().includes("shoot")
  );
  const hasScreening = analysisData.analyses.some((f) =>
    f.action.toLowerCase().includes("screen")
  );
  const hasCharging = analysisData.analyses.some((f) =>
    f.foulIndicators.some((i) => i.toLowerCase().includes("charging"))
  );
  const hasBlocking = analysisData.analyses.some((f) =>
    f.foulIndicators.some((i) => i.toLowerCase().includes("blocking"))
  );

  if (hasShootingMotion) terms.add("shooting foul");
  if (hasScreening) terms.add("illegal screen");
  if (hasCharging) terms.add("charging");
  if (hasBlocking) terms.add("blocking");

  return Array.from(terms);
}

async function queryKnowledgeBase(keyTerms: string[]): Promise<any[]> {
  try {
    // Create a comprehensive query from key terms
    const query = `NBA basketball rules regarding: ${keyTerms.join(
      ", "
    )}. Include specific rule numbers and definitions.`;

    const command = new RetrieveCommand({
      knowledgeBaseId: process.env.AWS_KNOWLEDGE_BASE_ID!,
      retrievalQuery: {
        text: query,
      },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: 5, // Get top 5 most relevant chunks
        },
      },
    });

    const response = await bedrockClient.send(command);

    return response.retrievalResults || [];
  } catch (error: any) {
    console.error("Knowledge base query error:", error);

    // If knowledge base doesn't exist or access is denied, return empty array
    // This allows the system to still make determinations based on frame analysis alone
    if (
      error.name === "ResourceNotFoundException" ||
      error.$fault === "client"
    ) {
      console.warn(
        "AWS Knowledge Base not accessible. Proceeding without NBA rulebook context."
      );
      return [];
    }

    // For other errors, still return empty array but log the full error
    console.error("Unexpected error querying knowledge base:", error);
    return [];
  }
}

async function makeFinalDetermination(
  analysisData: AnalysisData,
  knowledgeBaseResults: any[]
): Promise<FoulDetermination> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

  // Format the knowledge base results
  const rulebookContext = knowledgeBaseResults
    .map((result, index) => {
      const content = result.content?.text || "";
      const metadata = result.metadata || {};
      return `\nRule Reference ${index + 1}:\n${content}\nSource: ${
        metadata.source || "NBA Rulebook"
      }`;
    })
    .join("\n---");

  // Create a comprehensive prompt for final determination
  const prompt = `You are an expert NBA referee making a final foul determination. You must analyze this play as if watching a VIDEO, not isolated frames. Be CONSERVATIVE in your foul calls - basketball is a contact sport and incidental contact is part of the game.

FRAME-BY-FRAME ANALYSIS:
${JSON.stringify(analysisData.analyses, null, 2)}

ANALYSIS SUMMARY:
- Total frames analyzed: ${analysisData.summary.totalFrames}
- Frames with foul indicators: ${analysisData.summary.framesWithFoulIndicators}
- Common foul indicators: ${analysisData.summary.commonFoulIndicators.join(
    ", "
  )}

${
  analysisData.sequenceAnalysis
    ? `SEQUENCE ANALYSIS:
- Progression: ${analysisData.sequenceAnalysis.progression}
- Key Moments: ${analysisData.sequenceAnalysis.keyMoments}
- Initial Determination: ${analysisData.sequenceAnalysis.foulDetermination}`
    : ""
}

RELEVANT NBA RULEBOOK SECTIONS:
${rulebookContext}

CRITICAL REMINDERS BEFORE MAKING YOUR DETERMINATION:
1. NOT ALL CONTACT IS A FOUL - Incidental contact that doesn't affect the play is LEGAL
2. Consider the FULL SEQUENCE - A defender who establishes position early has rights
3. Basketball allows physical play - minor bumps, brushes, and contact are normal
4. The contact must provide an ADVANTAGE or significantly AFFECT THE PLAY to be a foul
5. When frames show rapid movement between positions, this suggests momentum and incidental contact
6. If you're unsure whether contact is incidental or illegal, it's probably INCIDENTAL

Based on this information, provide your determination in the following JSON format:
{
  "hasFoul": boolean,
  "confidence": "high" | "medium" | "low",
  "foulType": "string (e.g., 'blocking foul', 'charging foul', 'reach-in foul', etc.) - only if hasFoul is true",
  "ruleCitations": [
    {
      "ruleNumber": "string (e.g., 'Rule 12B, Section I, a')",
      "ruleText": "string (relevant excerpt from the rule)",
      "relevance": "string (how this rule applies to the play)"
    }
  ],
  "explanation": "string (detailed explanation of your decision, referencing specific frames and rules)",
  "keyMoments": [
    {
      "frameNumber": number,
      "description": "string (what happened in this frame that influenced the decision)"
    }
  ]
}

Consider:
1. Did the contact ACTUALLY affect the play or was it incidental?
2. Would this contact be called in a real NBA game (where refs allow physical play)?
3. Did the defender establish legal position BEFORE the offensive player's motion?
4. Is this the type of contact that happens dozens of times per game without calls?
5. Are you being influenced by slow-motion frames that make normal contact look worse?

BE CONSERVATIVE: Only call fouls for CLEAR violations that significantly affect the play. When in doubt, NO FOUL.`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const determination = JSON.parse(jsonMatch[0]);
      return determination;
    }

    // Fallback if JSON parsing fails
    return {
      hasFoul: false,
      confidence: "low",
      ruleCitations: [],
      explanation:
        "Unable to make a clear determination based on the available information.",
      keyMoments: [],
    };
  } catch (error) {
    console.error("Gemini determination error:", error);
    throw error;
  }
}
