// VoidwakeGame.tsx
// Thin React wrapper that mounts the Voidwake ASCII engine onto a canvas.
// All gameplay lives in src/game/voidwake.ts so the engine is portable.

import { useEffect, useRef, useState } from "react";
import { Voidwake } from "@/game/voidwake";

export default function VoidwakeGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Voidwake | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      // Voidwake's constructor throws if 2D canvas context is unavailable
      // (very old browsers, blocked canvas, GPU-disabled headless contexts).
      // Catching here prevents a blank screen and surfaces a readable fallback.
      const engine = new Voidwake(canvasRef.current);
      engineRef.current = engine;
      engine.start();
    } catch (err) {
      console.error("Voidwake initialization failed:", err);
      setInitError(err instanceof Error ? err.message : String(err));
      return;
    }
    return () => engineRef.current?.stop();
  }, []);

  if (initError) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-black p-4 text-emerald-300">
        <div className="max-w-md text-center font-mono text-sm">
          <h1 className="mb-2 text-lg">ASCII Frontier could not start</h1>
          <p className="mb-3 opacity-80">
            Your browser refused to give us a 2D canvas. This is usually fixed
            by enabling hardware acceleration, disabling a canvas-blocking
            extension, or trying a recent Chromium / Firefox / Safari build.
          </p>
          <pre className="whitespace-pre-wrap break-words rounded border border-emerald-900 bg-black/40 p-2 text-xs">
            {initError}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-black p-2">
      <canvas
        ref={canvasRef}
        className="h-[95vh] w-full max-w-[1400px] border border-emerald-900 bg-black"
        tabIndex={0}
        aria-label="Voidwake ASCII space simulation"
      />
    </div>
  );
}
