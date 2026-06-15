// Home route — mounts the ASCII Frontier space sim.
import { createFileRoute } from "@tanstack/react-router";
import VoidwakeGame from "@/components/VoidwakeGame";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ASCII Frontier — ASCII Space Sim" },
      {
        name: "description",
        content:
          "ASCII Frontier: a fully playable ASCII space simulation with cockpit UI, trading, mining, combat, AI ships, and a procedural universe.",
      },
      { property: "og:title", content: "ASCII Frontier — ASCII Space Sim" },
      {
        property: "og:description",
        content:
          "Fly an ASCII starship through a procedural universe. Trade, mine, fight, and progress.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return <VoidwakeGame />;
}
