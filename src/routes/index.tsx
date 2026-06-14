import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { Toaster } from "sonner";

// Leaflet uses `window` at import time — load only in the browser.
const BeaconMap = lazy(() => import("@/components/BeaconMap"));

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Beacon — Find water, restrooms, food & sanctuary nearby" },
      {
        name: "description",
        content:
          "Beacon is a community map of immediate-need micro-utilities — potable water, public restrooms, free food, and safe rest — for everyone, no account needed.",
      },
      { property: "og:title", content: "Beacon" },
      {
        property: "og:description",
        content:
          "Community map of water, restrooms, food, and sanctuary — built for the people who need them most.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <>
      {mounted ? (
        <Suspense
          fallback={
            <div className="grid h-dvh w-full place-items-center bg-background text-muted-foreground">
              Loading map…
            </div>
          }
        >
          <BeaconMap />
        </Suspense>
      ) : (
        <div className="grid h-dvh w-full place-items-center bg-background text-muted-foreground">
          Loading…
        </div>
      )}
      <Toaster
        theme="dark"
        position="top-center"
        toastOptions={{
          style: {
            background: "oklch(0.22 0.014 250 / 0.95)",
            color: "oklch(0.97 0.005 250)",
            border: "1px solid oklch(0.32 0.02 250 / 0.6)",
            backdropFilter: "blur(12px)",
          },
        }}
      />
    </>
  );
}
