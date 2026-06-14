import { haversineMeters } from "./beacon";

export interface Route {
  coords: [number, number][]; // [lat, lng]
  distance: number; // meters
  duration: number; // seconds
  fallback?: boolean;
}

export async function fetchRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<Route> {
  try {
    const url = `https://router.project-osrm.org/route/v1/foot/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("osrm http " + res.status);
    const j = await res.json();
    const route = j.routes?.[0];
    if (!route) throw new Error("no route");
    const coords: [number, number][] = route.geometry.coordinates.map(
      (c: [number, number]) => [c[1], c[0]],
    );
    return { coords, distance: route.distance, duration: route.duration };
  } catch {
    // Haversine fallback — straight line + walking speed ~1.35 m/s
    const distance = haversineMeters(from, to);
    return {
      coords: [
        [from.lat, from.lng],
        [to.lat, to.lng],
      ],
      distance,
      duration: distance / 1.35,
      fallback: true,
    };
  }
}
