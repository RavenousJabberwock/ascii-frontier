// Home route — mounts the Voidwake ASCII space sim.
import { createFileRoute } from "@tanstack/react-router";
import VoidwakeGame from "@/components/VoidwakeGame";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VOIDWAKE — ASCII Space Sim" },
      {
        name: "description",
        content:
          "VOIDWAKE: a fully playable ASCII space simulation with cockpit UI, trading, mining, combat, AI ships, and a procedural universe.",
      },
      { property: "og:title", content: "VOIDWAKE — ASCII Space Sim" },
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
