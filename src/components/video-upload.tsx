"use client";

import { useCallback, useState, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Video,
  CheckCircle,
  AlertCircle,
  Loader2,
  Shield,
  Eye,
  ArrowRight,
  X,
  ZoomIn,
} from "lucide-react";

interface FrameData {
  path: string;
  timestamp: number;
}

interface FrameAnalysis {
  frameNumber: number;
  timestamp: number;
  action: string;
  playerMovement: string;
  contact: string;
  ballStatus: string;
  foulIndicators: string[];
}

interface AnalysisSummary {
  totalFrames: number;
  framesWithFoulIndicators: number;
  foulIndicatorPercentage: number;
  commonFoulIndicators: string[];
  recommendation: string;
}

interface UploadResponse {
  success: boolean;
  frames?: FrameData[];
  timestamp?: number;
  message?: string;
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

interface AnalysisResponse {
  success: boolean;
  analyses?: FrameAnalysis[];
  analysisId?: number;
  summary?: AnalysisSummary;
  foulDetermination?: FoulDetermination;
  message?: string;
}

export default function VideoUpload() {
  const [uploadStatus, setUploadStatus] = useState<
    | "initial"
    | "idle"
    | "validating"
    | "uploading"
    | "processing"
    | "success"
    | "analyzing"
    | "analyzed"
    | "error"
  >("initial");
  const [frames, setFrames] = useState<FrameData[]>([]);
  const [analyses, setAnalyses] = useState<FrameAnalysis[]>([]);
  const [analysisSummary, setAnalysisSummary] =
    useState<AnalysisSummary | null>(null);
  const [foulDetermination, setFoulDetermination] =
    useState<FoulDetermination | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadTimestamp, setUploadTimestamp] = useState<number | null>(null);
  const [zoomedFrame, setZoomedFrame] = useState<{
    src: string;
    alt: string;
    frameNumber: number;
    timestamp: number;
  } | null>(null);

  const validateVideoDuration = (file: File): Promise<boolean> => {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      const url = URL.createObjectURL(file);

      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(video.duration <= 8);
      };

      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(false);
      };

      video.src = url;
    });
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("video/")) {
      setErrorMessage("Please upload a video file");
      setUploadStatus("error");
      return;
    }

    setUploadStatus("validating");
    setErrorMessage("");

    // Validate video duration
    try {
      const isValidDuration = await validateVideoDuration(file);
      if (!isValidDuration) {
        setErrorMessage(
          "Video is longer than 8 seconds. Please use video editing software to trim your clip to 8 seconds or less, then try uploading again."
        );
        setUploadStatus("error");
        return;
      }
    } catch (error) {
      console.error("Error validating video duration:", error);
      setErrorMessage(
        "Unable to validate video duration. Please try a different file."
      );
      setUploadStatus("error");
      return;
    }

    setUploadedFile(file);
    setUploadStatus("uploading");

    try {
      const formData = new FormData();
      formData.append("video", file);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const result: UploadResponse = await response.json();

      if (result.success && result.frames) {
        setFrames(result.frames);
        setUploadTimestamp(result.timestamp || null);
        setUploadStatus("success");
      } else {
        setErrorMessage(result.message || "Upload failed");
        setUploadStatus("error");
      }
    } catch (error) {
      console.error("Upload error:", error);
      setErrorMessage("Network error during upload");
      setUploadStatus("error");
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "video/*": [".mp4", ".mov", ".avi", ".webm", ".mkv"],
    },
    maxFiles: 1,
    disabled:
      uploadStatus === "validating" ||
      uploadStatus === "uploading" ||
      uploadStatus === "processing" ||
      uploadStatus === "analyzing",
  });

  const analyzeFrames = async () => {
    if (frames.length === 0) return;

    setUploadStatus("analyzing");
    setErrorMessage("");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ frames, timestamp: uploadTimestamp }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Response error text:", errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const responseText = await response.text();

      let result: AnalysisResponse;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        console.error("❌ JSON parse error:", parseError);
        console.error("🔍 Failed to parse response:", responseText);
        throw new Error("Failed to parse response as JSON");
      }

      if (result.success && result.analyses) {
        setAnalyses(result.analyses);
        setAnalysisSummary(result.summary || null);
        setFoulDetermination(result.foulDetermination || null);
        setUploadStatus("analyzed");
      } else if (result.success) {
        // Handle case where success is true but analyses might be missing
        // Try to recover by checking if analyses is an empty array
        if (Array.isArray(result.analyses) && result.analyses.length === 0) {
          setAnalyses([]);
          setAnalysisSummary(result.summary || null);
          setUploadStatus("analyzed");
        } else {
          // If we truly don't have analyses data despite success
          console.error("❌ Success response but no analyses data found");
          setErrorMessage("Analysis completed but no data received");
          setUploadStatus("error");
        }
      } else {
        setErrorMessage(result.message || "Analysis failed");
        setUploadStatus("error");
      }
    } catch (error) {
      console.error("💥 Analysis error:", error);
      setErrorMessage("Network error during analysis");
      setUploadStatus("error");
    }
  };

  const resetUpload = () => {
    setUploadStatus("idle");
    setFrames([]);
    setAnalyses([]);
    setAnalysisSummary(null);
    setFoulDetermination(null);
    setErrorMessage("");
    setUploadedFile(null);
    setUploadTimestamp(null);
  };

  const handleGetStarted = () => {
    setUploadStatus("idle");
  };

  const openZoomedFrame = (
    src: string,
    alt: string,
    frameNumber: number,
    timestamp: number
  ) => {
    setZoomedFrame({ src, alt, frameNumber, timestamp });
  };

  const closeZoomedFrame = () => {
    setZoomedFrame(null);
  };

  // Handle keyboard events for closing the modal
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && zoomedFrame) {
        closeZoomedFrame();
      }
    };

    if (zoomedFrame) {
      document.addEventListener("keydown", handleKeyDown);
      // Prevent body scroll when modal is open
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [zoomedFrame]);

  return (
    <div className="w-full max-w-4xl mx-auto p-6">
      <div className="space-y-6">
        {/* Initial state - Just show Get Started button */}
        {uploadStatus === "initial" && (
          <div className="flex flex-col items-center space-y-8">
            <div className="flex justify-center">
              <Button
                onClick={handleGetStarted}
                size="lg"
                className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white px-10 py-6 text-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
              >
                Get Started
                <ArrowRight className="ml-2 h-5 w-5 animate-pulse" />
              </Button>
            </div>
            <div className="flex items-center space-x-8 text-sm text-gray-400">
              <div className="flex items-center space-x-2">
                <Shield className="w-4 h-4" />
                <span>AI-Powered</span>
              </div>
              <div className="flex items-center space-x-2">
                <Video className="w-4 h-4" />
                <span>≤8 seconds</span>
              </div>
              <div className="flex items-center space-x-2">
                <Eye className="w-4 h-4" />
                <span>Instant Analysis</span>
              </div>
            </div>
          </div>
        )}

        {/* Show header only when not in initial or analyzing state */}
        {uploadStatus !== "analyzed" &&
          uploadStatus !== "initial" &&
          uploadStatus !== "analyzing" && (
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-2">
                Upload Video for Foul Analysis
              </h2>
              <p className="text-gray-400">
                Upload a basketball video clip (≤8 seconds) to analyze for
                potential fouls
              </p>
            </div>
          )}

        {uploadStatus === "idle" && (
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragActive
                ? "border-white bg-white/10"
                : "border-white/60 hover:border-white bg-neutral-800"
            }`}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center space-y-4">
              <div className="p-4 bg-gray-800 rounded-full">
                <Upload className="w-8 h-8 text-gray-400" />
              </div>
              {isDragActive ? (
                <p className="text-lg">Drop the video file here...</p>
              ) : (
                <div>
                  <p className="text-lg font-medium">
                    Drag & drop a basketball video file here
                  </p>
                  <p className="text-sm text-gray-400 mt-1">
                    or click to select a file
                  </p>
                </div>
              )}
              <p className="text-xs text-gray-500">
                Supports MP4, MOV, AVI, WebM, MKV (≤8 seconds)
              </p>
            </div>
          </div>
        )}

        {uploadStatus === "validating" && (
          <div className="flex flex-col items-center space-y-4 p-8">
            <Loader2 className="w-8 h-8 animate-spin text-green-500" />
            <p className="text-lg">Validating video duration...</p>
            {uploadedFile && (
              <p className="text-sm text-gray-500">{uploadedFile.name}</p>
            )}
            <p className="text-sm text-gray-500">
              Checking that video is ≤8 seconds
            </p>
          </div>
        )}

        {uploadStatus === "uploading" && (
          <div className="flex flex-col items-center space-y-4 p-8">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <p className="text-lg">Uploading video...</p>
            {uploadedFile && (
              <p className="text-sm text-gray-500">{uploadedFile.name}</p>
            )}
          </div>
        )}

        {uploadStatus === "processing" && (
          <div className="flex flex-col items-center space-y-4 p-8">
            <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
            <p className="text-lg">Processing video and extracting frames...</p>
            <p className="text-sm text-gray-500">This may take a few moments</p>
          </div>
        )}

        {uploadStatus === "analyzing" && (
          <div className="flex flex-col items-center space-y-4 p-8">
            <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
            <p className="text-lg">Analyzing frames for fouls with AI...</p>
            <p className="text-sm text-gray-500">
              Using AI to analyze basketball actions and detect potential fouls
            </p>
          </div>
        )}

        {uploadStatus === "error" && (
          <div className="flex flex-col items-center space-y-4 p-8">
            <AlertCircle className="w-8 h-8 text-red-500" />
            <p className="text-lg text-red-600">Error</p>
            <p className="text-sm text-red-500">{errorMessage}</p>
            <Button onClick={resetUpload} variant="outline">
              Try Again
            </Button>
          </div>
        )}

        {uploadStatus === "success" && (
          <div className="space-y-6">
            <div className="flex items-center justify-center space-x-2 p-4 bg-green-500/10 rounded-lg border border-green-500/20">
              <CheckCircle className="w-6 h-6 text-green-400" />
              <p className="text-lg text-green-400">
                Frames extracted successfully!
              </p>
            </div>

            <div className="space-y-4">
              <h3 className="text-xl font-semibold">
                Extracted Frames ({frames.length})
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {frames.map((frame, index) => (
                  <div key={index} className="space-y-2">
                    <div
                      className="aspect-video bg-gray-800 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all duration-200 group relative"
                      onClick={() =>
                        openZoomedFrame(
                          `/api/frames/${frame.path.split("/").pop()}`,
                          `Frame ${index + 1}`,
                          index + 1,
                          frame.timestamp
                        )
                      }
                    >
                      <img
                        src={`/api/frames/${frame.path.split("/").pop()}`}
                        alt={`Frame ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 flex items-center justify-center">
                        <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 text-center">
                      Frame {index + 1} (t={frame.timestamp}s)
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-center space-x-4">
              <Button onClick={resetUpload} variant="outline">
                Upload Another Video
              </Button>
              <Button
                onClick={analyzeFrames}
                className="bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600"
              >
                <Shield className="w-4 h-4 mr-2" />
                Analyze for Fouls with AI
              </Button>
            </div>
          </div>
        )}

        {uploadStatus === "analyzed" && (
          <div className="space-y-6">
            {/* Main Foul Determination Card */}
            {foulDetermination && (
              <div
                className={`rounded-xl shadow-2xl overflow-hidden ${
                  foulDetermination.hasFoul
                    ? "bg-gradient-to-br from-red-950/50 to-red-900/30 border-2 border-red-500/50"
                    : "bg-gradient-to-br from-green-950/50 to-green-900/30 border-2 border-green-500/50"
                }`}
              >
                {/* Header with verdict */}
                <div
                  className={`p-6 text-center ${
                    foulDetermination.hasFoul
                      ? "bg-red-600 text-white"
                      : "bg-green-600 text-white"
                  }`}
                >
                  <div className="flex items-center justify-center space-x-3">
                    {foulDetermination.hasFoul ? (
                      <AlertCircle className="w-10 h-10" />
                    ) : (
                      <CheckCircle className="w-10 h-10" />
                    )}
                    <h2 className="text-4xl font-bold">
                      {foulDetermination.hasFoul ? "FOUL" : "NO FOUL"}
                    </h2>
                  </div>
                  {foulDetermination.foulType && (
                    <p className="text-xl mt-2 font-medium">
                      {foulDetermination.foulType}
                    </p>
                  )}
                  <p className="text-sm mt-1 opacity-90">
                    Confidence: {foulDetermination.confidence}
                  </p>
                </div>

                {/* Video Playback */}
                <div className="p-6 pb-4">
                  <div className="bg-black/40 rounded-lg p-4 border border-white/10">
                    <h3 className="font-semibold text-gray-100 mb-3 flex items-center">
                      <Video className="w-5 h-5 mr-2" />
                      Video Replay
                    </h3>
                    {uploadedFile && (
                      <div className="aspect-video bg-black rounded-lg overflow-hidden">
                        <video
                          controls
                          className="w-full h-full"
                          preload="metadata"
                        >
                          <source
                            src={URL.createObjectURL(uploadedFile)}
                            type={uploadedFile.type}
                          />
                          Your browser does not support the video tag.
                        </video>
                      </div>
                    )}
                  </div>
                </div>

                {/* Explanation */}
                <div className="px-6 pb-4 space-y-4">
                  <div className="bg-black/40 rounded-lg p-4 border border-white/10">
                    <h3 className="font-semibold text-gray-100 mb-2">
                      Why this call?
                    </h3>
                    <p className="text-gray-300 leading-relaxed">
                      {foulDetermination.explanation}
                    </p>
                  </div>

                  {/* Key Evidence */}
                  {foulDetermination.keyMoments.length > 0 && (
                    <div className="bg-black/40 rounded-lg p-4 border border-white/10">
                      <h3 className="font-semibold text-gray-100 mb-1">
                        Key Evidence
                      </h3>
                      <p className="text-xs text-gray-400 mb-3">
                        Evidence from specific frames in the video
                      </p>
                      <div className="space-y-3">
                        {foulDetermination.keyMoments.map((moment, index) => (
                          <div
                            key={index}
                            className="flex items-start space-x-3"
                          >
                            <div className="flex-shrink-0 flex items-center space-x-1">
                              <Video className="w-3 h-3 text-gray-400" />
                              <div
                                className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${
                                  foulDetermination.hasFoul
                                    ? "bg-red-500/20 text-red-400"
                                    : "bg-green-500/20 text-green-400"
                                }`}
                              >
                                {moment.frameNumber}
                              </div>
                            </div>
                            <p className="text-sm text-gray-300 flex-1">
                              {moment.description}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Rule Citations - Collapsible on mobile */}
                <div className="px-6 pb-4">
                  {foulDetermination.ruleCitations.length > 0 && (
                    <details className="bg-black/40 rounded-lg overflow-hidden border border-white/10">
                      <summary className="p-4 cursor-pointer hover:bg-white/5 font-semibold text-gray-100">
                        NBA Rules Applied (
                        {foulDetermination.ruleCitations.length})
                      </summary>
                      <div className="px-4 pb-4 space-y-3">
                        {foulDetermination.ruleCitations.map(
                          (citation, index) => (
                            <div
                              key={index}
                              className="border-l-4 border-gray-600 pl-4 space-y-1"
                            >
                              <h5 className="font-medium text-sm text-gray-100">
                                {citation.ruleNumber}
                              </h5>
                              <p className="text-sm text-gray-300 italic">
                                "{citation.ruleText}"
                              </p>
                              <p className="text-xs text-gray-400">
                                {citation.relevance}
                              </p>
                            </div>
                          )
                        )}
                      </div>
                    </details>
                  )}
                </div>

                {/* Quick Stats */}
                <div className="px-6 pb-6">
                  {analysisSummary && (
                    <div className="flex justify-center space-x-6 text-center">
                      <div>
                        <p className="text-2xl font-bold text-gray-100">
                          {analysisSummary.framesWithFoulIndicators}
                        </p>
                        <p className="text-xs text-gray-400">
                          Frames with indicators
                        </p>
                      </div>
                      <div className="border-l border-gray-600"></div>
                      <div>
                        <p className="text-2xl font-bold text-gray-100">
                          {analysisSummary.totalFrames}
                        </p>
                        <p className="text-xs text-gray-400">
                          Total frames analyzed
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Frame-by-Frame Analysis */}
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-lg font-semibold text-gray-200">
                  Supporting Frame Analysis
                </h3>
                <p className="text-sm text-gray-400 mt-1">
                  Detailed breakdown of each analyzed frame
                </p>
              </div>
              <div className="space-y-3">
                {analyses.map((analysis, index) => (
                  <div
                    key={index}
                    className={`border rounded-lg overflow-hidden bg-neutral-800 shadow-lg ${
                      analysis.foulIndicators.length > 0
                        ? "border-red-500/50"
                        : "border-gray-700"
                    }`}
                  >
                    {/* Frame header with image */}
                    <div className="flex items-center p-3 bg-neutral-700 border-b border-gray-700">
                      <div className="flex-shrink-0 mr-3">
                        <div
                          className="aspect-video w-20 bg-gray-700 rounded overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all duration-200 group relative"
                          onClick={() =>
                            openZoomedFrame(
                              `/api/frames/${frames[
                                analysis.frameNumber - 1
                              ]?.path
                                .split("/")
                                .pop()}`,
                              `Frame ${analysis.frameNumber}`,
                              analysis.frameNumber,
                              analysis.timestamp
                            )
                          }
                        >
                          <img
                            src={`/api/frames/${frames[
                              analysis.frameNumber - 1
                            ]?.path
                              .split("/")
                              .pop()}`}
                            alt={`Frame ${analysis.frameNumber}`}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 flex items-center justify-center">
                            <ZoomIn className="w-3 h-3 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                          </div>
                        </div>
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-sm text-gray-200">
                          Frame {analysis.frameNumber}
                        </p>
                        <p className="text-xs text-gray-400">
                          t={analysis.timestamp}s
                        </p>
                      </div>
                      {analysis.foulIndicators.length > 0 && (
                        <div className="flex-shrink-0">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            {analysis.foulIndicators.length} indicator
                            {analysis.foulIndicators.length > 1 ? "s" : ""}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Frame details */}
                    <div className="p-4 space-y-3">
                      <div>
                        <p className="text-sm text-gray-200">
                          {analysis.action}
                        </p>
                      </div>

                      {/* Collapsible details on mobile */}
                      <details className="text-sm">
                        <summary className="cursor-pointer text-gray-400 hover:text-gray-200 font-medium">
                          View details
                        </summary>
                        <div className="mt-3 space-y-2 pl-4 border-l-2 border-gray-600">
                          <div>
                            <span className="font-medium text-gray-300">
                              Movement:
                            </span>
                            <p className="text-gray-400">
                              {analysis.playerMovement}
                            </p>
                          </div>
                          <div>
                            <span className="font-medium text-gray-300">
                              Contact:
                            </span>
                            <p className="text-gray-400">{analysis.contact}</p>
                          </div>
                          <div>
                            <span className="font-medium text-gray-300">
                              Ball:
                            </span>
                            <p className="text-gray-400">
                              {analysis.ballStatus}
                            </p>
                          </div>
                        </div>
                      </details>

                      {analysis.foulIndicators.length > 0 && (
                        <div className="pt-2 border-t border-gray-700">
                          <p className="text-xs font-medium text-red-400 mb-2">
                            Foul Indicators:
                          </p>
                          <div className="space-y-1">
                            {analysis.foulIndicators.map((indicator, idx) => (
                              <p
                                key={idx}
                                className="text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded"
                              >
                                • {indicator}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-center">
              <Button onClick={resetUpload} variant="outline">
                Upload Another Video
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Zoom Modal */}
      {zoomedFrame && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={closeZoomedFrame}
        >
          <div className="relative max-w-4xl max-h-[90vh] w-full">
            {/* Close button */}
            <button
              onClick={closeZoomedFrame}
              className="absolute -top-12 right-0 z-10 p-2 bg-gray-800 hover:bg-gray-700 rounded-full text-white transition-colors duration-200"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Frame info */}
            <div className="absolute -top-12 left-0 z-10 text-white">
              <p className="text-sm font-medium">
                {zoomedFrame.alt} (t={zoomedFrame.timestamp}s)
              </p>
            </div>

            {/* Image */}
            <div
              className="bg-gray-900 rounded-lg overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={zoomedFrame.src}
                alt={zoomedFrame.alt}
                className="w-full h-auto max-h-[80vh] object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
