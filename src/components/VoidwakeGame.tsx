// VoidwakeGame.tsx
// Thin React wrapper that mounts the Voidwake ASCII engine onto a canvas.
// All gameplay lives in src/game/voidwake.ts so the engine is portable.

import { useEffect, useRef } from "react";
import { Voidwake } from "@/game/voidwake";

export default function VoidwakeGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Voidwake | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new Voidwake(canvasRef.current);
    engineRef.current = engine;
    engine.start();
    return () => engine.stop();
  }, []);

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
