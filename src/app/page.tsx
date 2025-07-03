import VideoUpload from "@/components/video-upload";

export default function Home() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-8">
      <main className="flex flex-col gap-12 items-center w-full">
        <div className="text-center space-y-6 max-w-3xl">
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Is This A Foul?
          </h1>
          <p className="text-xl sm:text-2xl text-gray-300 leading-relaxed">
            Upload your basketball video clips and get instant AI-powered
            analysis to determine if a foul occurred
          </p>
        </div>

        <VideoUpload />
      </main>
    </div>
  );
}
