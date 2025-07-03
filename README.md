# Is This A Foul?

A Next.js application that analyzes basketball video clips to determine if a foul occurred using AI-powered frame analysis.

## Features

### Video Upload & Frame Extraction

- **Drag & Drop Interface**: Easy-to-use drag-and-drop area for video uploads
- **File Validation**: Supports MP4, MOV, AVI, WebM, and MKV formats
- **Size Limits**: Accepts video clips ≤8 seconds long (approximately ≤50MB)
- **FFmpeg Integration**: Automatically extracts frames at 1 frame per second
- **Frame Display**: Shows all extracted frames with timestamps

### AI-Powered Frame Analysis

- **Gemini Integration**: Uses Google's Gemini 2.5 Pro model for computer vision
- **Object Detection**: Identifies players, basketball, court elements in each frame
- **Action Recognition**: Describes the primary action happening in each frame
- **Confidence Scoring**: Provides confidence levels (high/medium/low) for each analysis
- **Structured Output**: Returns JSON-formatted analysis for easy processing
- **Basketball-Focused**: Specifically trained prompts for basketball referee scenarios

## How It Works

1. **Upload**: Drag and drop a video file or click to select
2. **Processing**: The video is uploaded to `/api/upload` where:
   - File is saved temporarily to the `uploads/` directory
   - FFmpeg extracts frames at 1fps using the command: `ffmpeg -i video.mp4 -vf fps=1 frames/frame_%02d.jpg`
   - Original video file is cleaned up after processing
3. **Display**: Extracted frames are displayed in a grid with timestamps
4. **AI Analysis**: Click "Analyze Frames with AI" to:
   - Send each frame to Gemini 2.5 Pro model
   - Get structured JSON analysis with objects, actions, and confidence
   - Display detailed results for each frame
5. **Review**: Examine AI analysis results with visual frame references

## Technical Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **UI Components**: Radix UI, shadcn/ui, Lucide React icons
- **File Upload**: react-dropzone for drag-and-drop functionality
- **Video Processing**: FFmpeg via fluent-ffmpeg and ffmpeg-static
- **Authentication**: NextAuth.js (configured)

## API Endpoints

- `POST /api/upload` - Handles video upload and frame extraction
- `GET /api/frames/[filename]` - Serves extracted frame images
- `POST /api/analyze` - Analyzes frames using Gemini AI for object detection and action recognition

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables:
   ```bash
   cp env.example .env.local
   ```
   Add your Gemini API key to `.env.local`:
   ```
   GEMINI_API_KEY=your-gemini-api-key-here
   ```
4. Run the development server:
   ```bash
   npm run dev
   ```
5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Dependencies

Key dependencies for video processing and AI analysis:

- `fluent-ffmpeg` - FFmpeg wrapper for Node.js
- `ffmpeg-static` - Static FFmpeg binary
- `react-dropzone` - File upload with drag-and-drop
- `@google/generative-ai` - Google Gemini AI SDK for computer vision analysis

## File Structure

```
src/
├── app/
│   ├── api/
│   │   ├── upload/route.ts          # Video upload and processing
│   │   ├── analyze/route.ts         # AI frame analysis with Gemini
│   │   └── frames/[filename]/route.ts # Frame image serving
│   └── page.tsx                     # Main page with video upload
├── components/
│   ├── video-upload.tsx             # Video upload component with AI analysis
│   └── ui/                          # shadcn/ui components
└── lib/
    └── utils.ts                     # Utility functions
```

## Usage

1. Navigate to the homepage
2. Drag and drop a basketball video clip (≤8 seconds) into the upload area
3. Wait for the video to process and frames to be extracted
4. View the extracted frames with timestamps
5. Click "Analyze Frames with AI" to get detailed analysis of each frame
6. Review the AI analysis results showing objects, actions, and confidence levels

## Notes

- Extracted frames are stored temporarily in the `uploads/frames/` directory
- The `uploads/` directory is gitignored to prevent committing uploaded files
- FFmpeg processing happens server-side for security and performance
- Frame extraction rate is fixed at 1 frame per second (1fps)

## Next Steps

- Implement AI-powered foul detection analysis
- Add frame annotation capabilities
- Integrate with computer vision models
- Add user authentication and video history

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
