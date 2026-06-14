import { useEffect, useRef, useState } from "react";

export interface UserLocation {
  lat: number;
  lng: number;
  accuracy: number;
  approximate?: boolean;
}

export type LocationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; location: UserLocation }
  | { status: "error"; message: string };

export function useUserLocation(): LocationState {
  const [state, setState] = useState<LocationState>({ status: "loading" });
  const ipFallbackTried = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let watchId: number | null = null;

    async function tryIpFallback(reason: string) {
      if (ipFallbackTried.current || cancelled) return;
      ipFallbackTried.current = true;
      try {
        const res = await fetch("https://ipapi.co/json/");
        if (!res.ok) throw new Error("ip lookup failed");
        const j = await res.json();
        if (cancelled) return;
        if (typeof j.latitude === "number" && typeof j.longitude === "number") {
          setState({
            status: "ready",
            location: {
              lat: j.latitude,
              lng: j.longitude,
              accuracy: 5000,
              approximate: true,
            },
          });
          return;
        }
        throw new Error("no coords");
      } catch {
        if (!cancelled) setState({ status: "error", message: reason });
      }
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      tryIpFallback("Geolocation unavailable");
      return () => {
        cancelled = true;
      };
    }

    // One-shot fix first (faster than waiting on watchPosition)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        setState({
          status: "ready",
          location: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          },
        });
      },
      (err) => {
        // Permission denied / unavailable / timeout → IP fallback
        tryIpFallback(err.message || "Location unavailable");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );

    // Live updates
    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (cancelled) return;
          setState({
            status: "ready",
            location: {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            },
          });
        },
        () => {
          /* ignore — handled by initial getCurrentPosition */
        },
        { enableHighAccuracy: true, maximumAge: 5000 },
      );
    } catch {
      /* noop */
    }

    return () => {
      cancelled = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  return state;
}
