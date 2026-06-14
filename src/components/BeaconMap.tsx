import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { Drawer } from "vaul";
import { toast } from "sonner";
import {
  ArrowUp,
  ArrowDown,
  LocateFixed,
  Plus,
  Search,
  X,
  Footprints,
  MapPin,
  Sparkles,
  Clock,
  Phone,
  Globe,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  CATEGORIES,
  CATEGORY_MAP,
  BAY_AREA_CENTER,
  inBayArea,
  formatDistance,
  formatDuration,
  haversineMeters,
  pinOpacity,
  pinStatus,
  statusColor,
  displayConfidence,
  isOpenNow,
  timeAgo,
  type Category,
  type Pin,
} from "@/lib/beacon";
import { getOverpassPins } from "@/lib/overpass.functions";
import { fetchRoute, type Route } from "@/lib/routing";
import { useUserLocation } from "@/hooks/useUserLocation";

function pinDivIcon(p: Pin) {
  const c = CATEGORY_MAP[p.category];
  const opacity = pinOpacity(p);
  const html = `
    <div class="beacon-pin" style="color: ${c.cssVar}; --pin-opacity: ${opacity.toFixed(2)}">
      <div class="pulse"></div>
      <div class="ring"></div>
      <div class="core"></div>
    </div>`;
  return L.divIcon({ className: "", html, iconSize: [28, 28], iconAnchor: [14, 14] });
}

function userIcon(accuracyPx: number) {
  const html = `
    <div class="user-location">
      <div class="accuracy" style="inset:${-accuracyPx / 2}px; width:${accuracyPx}px; height:${accuracyPx}px;"></div>
      <div class="ring"></div>
      <div class="dot"></div>
    </div>`;
  return L.divIcon({ className: "", html, iconSize: [22, 22], iconAnchor: [11, 11] });
}

function FlyToFirstFix({ loc }: { loc: { lat: number; lng: number } | null }) {
  const map = useMap();
  const flown = useRef(false);
  useEffect(() => {
    if (!loc || flown.current) return;
    flown.current = true;
    // Only fly to user if they're inside the Bay Area
    if (inBayArea(loc.lat, loc.lng)) {
      map.flyTo([loc.lat, loc.lng], 14, { duration: 1.2 });
    }
  }, [loc, map]);
  return null;
}

function MapClickHandler({
  enabled,
  onClick,
}: {
  enabled: boolean;
  onClick: (latlng: { lat: number; lng: number }) => void;
}) {
  useMapEvents({
    click(e) {
      if (enabled) onClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function MapMoveWatcher({ onMove }: { onMove: () => void }) {
  useMapEvents({ moveend: onMove, zoomend: onMove });
  return null;
}

function MapRefBridge({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
  }, [map, onReady]);
  return null;
}

export default function BeaconMap() {
  const locState = useUserLocation();
  const userLoc = locState.status === "ready" ? locState.location : null;

  const [dbPins, setDbPins] = useState<Pin[]>([]);
  const [demoPins, setDemoPins] = useState<Pin[]>([]);
  const [activeCats, setActiveCats] = useState<Set<Category>>(
    new Set(CATEGORIES.map((c) => c.id)),
  );
  const [selected, setSelected] = useState<Pin | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [routePinId, setRoutePinId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [addCat, setAddCat] = useState<Category>("water_fountain");
  const [addLatLng, setAddLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [addDescription, setAddDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [needMode, setNeedMode] = useState(false);
  const mapRef = useRef<L.Map | null>(null);

  const approxNotified = useRef(false);
  useEffect(() => {
    if (locState.status === "ready" && locState.location.approximate && !approxNotified.current) {
      approxNotified.current = true;
      toast("Approximate location used", {
        description: "Browser GPS unavailable — using IP-based estimate.",
      });
    }
    if (locState.status === "error" && !approxNotified.current) {
      approxNotified.current = true;
      toast("Couldn't get your location", { description: locState.message });
    }
  }, [locState]);

  const seenIdsRef = useRef<Set<string>>(new Set());
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstLoadToastRef = useRef(false);

  function fetchPinsForCurrentView() {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const bbox = {
      south: b.getSouth(),
      west: b.getWest(),
      north: b.getNorth(),
      east: b.getEast(),
    };
    const spanDeg = Math.max(bbox.north - bbox.south, bbox.east - bbox.west);
    if (spanDeg > 1.5) return;
    getOverpassPins({ data: bbox })
      .then((pins) => {
        const fresh: Pin[] = [];
        for (const p of pins) {
          if (seenIdsRef.current.has(p.id)) continue;
          seenIdsRef.current.add(p.id);
          fresh.push(p);
        }
        if (fresh.length) setDemoPins((prev) => [...prev, ...fresh]);
        if (!firstLoadToastRef.current && pins.length > 0) {
          firstLoadToastRef.current = true;
          toast(`Loaded ${fresh.length} Bay Area places`, {
            description: "Pan or zoom the map to load more.",
          });
        }
      })
      .catch(() => {
        if (!firstLoadToastRef.current) {
          firstLoadToastRef.current = true;
          toast("Couldn't reach OpenStreetMap", {
            description: "Real-place lookup is offline right now.",
          });
        }
      });
  }

  function scheduleFetchForCurrentView(delay = 700) {
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(fetchPinsForCurrentView, delay);
  }

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("pins")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(500);
      if (!active) return;
      if (error) {
        console.error(error);
        return;
      }
      setDbPins((data as Pin[]) ?? []);
    })();

    const ch = supabase
      .channel("pins-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pins" },
        (payload) => {
          setDbPins((prev) => {
            if (payload.eventType === "INSERT") {
              return [payload.new as Pin, ...prev.filter((p) => p.id !== (payload.new as Pin).id)];
            }
            if (payload.eventType === "UPDATE") {
              return prev.map((p) =>
                p.id === (payload.new as Pin).id ? (payload.new as Pin) : p,
              );
            }
            if (payload.eventType === "DELETE") {
              return prev.filter((p) => p.id !== (payload.old as Pin).id);
            }
            return prev;
          });
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, []);

  const allPins = useMemo(() => [...dbPins, ...demoPins], [dbPins, demoPins]);
  const visiblePins = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allPins.filter((p) => {
      if (!activeCats.has(p.category)) return false;
      if (q) {
        const hay = `${p.name ?? ""} ${p.description ?? ""} ${p.address ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (needMode && pinStatus(p) === "flagged") return false;
      return true;
    });
  }, [allPins, activeCats, search, needMode]);

  function toggleCat(c: Category) {
    setActiveCats((prev) => {
      const next = new Set(prev);
      if (needMode) {
        next.clear();
        next.add(c);
        return next;
      }
      if (next.has(c)) next.delete(c);
      else next.add(c);
      if (next.size === 0) return new Set(CATEGORIES.map((x) => x.id));
      return next;
    });
  }

  async function selectPin(p: Pin) {
    setSelected(p);
    if (!userLoc) {
      setRoute(null);
      setRoutePinId(p.id);
      return;
    }
    setRoutePinId(p.id);
    setRoute(null);
    const r = await fetchRoute(userLoc, { lat: p.lat, lng: p.lng });
    setRoute(r);
    const map = mapRef.current;
    if (map && r.coords.length >= 2) {
      const bounds = L.latLngBounds(r.coords.map(([la, ln]) => L.latLng(la, ln)));
      bounds.extend([userLoc.lat, userLoc.lng]);
      // Leave room on the right for the side panel
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 17, paddingTopLeft: [0, 0], paddingBottomRight: [380, 0] });
    }
  }

  async function vote(p: Pin, kind: "up" | "down") {
    if (p.demo) {
      const updated: Pin = {
        ...p,
        upvotes: kind === "up" ? p.upvotes + 1 : p.upvotes,
        downvotes: kind === "down" ? p.downvotes + 1 : p.downvotes,
        updated_at: new Date().toISOString(),
      };
      setDemoPins((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
      setSelected(updated);
      toast(kind === "up" ? "Verified" : "Flagged", {
        description: "OpenStreetMap place — verification saved locally.",
      });
      return;
    }
    const { data, error } = await supabase.rpc("vote_on_pin", { pin_id: p.id, vote_type: kind });
    if (error) {
      toast("Couldn't record vote", { description: error.message });
      return;
    }
    if (data) setSelected(data as Pin);
    toast(kind === "up" ? "Verified" : "Flagged");
  }

  async function submitNewPin() {
    if (!addLatLng) return;
    if (!inBayArea(addLatLng.lat, addLatLng.lng)) {
      toast("Outside the Bay Area", {
        description: "Beacons can only be added within the California Bay Area.",
      });
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase
      .from("pins")
      .insert({
        category: addCat,
        lat: addLatLng.lat,
        lng: addLatLng.lng,
        description: addDescription.trim() || null,
      })
      .select()
      .single();
    setSubmitting(false);
    if (error) {
      toast("Couldn't add beacon", { description: error.message });
      return;
    }
    toast("Beacon added", { description: `${CATEGORY_MAP[addCat].label} dropped.` });
    setAddMode(false);
    setAddLatLng(null);
    setAddDescription("");
    if (data) selectPin(data as Pin);
  }

  function recenter() {
    if (!mapRef.current) return;
    if (userLoc && inBayArea(userLoc.lat, userLoc.lng)) {
      mapRef.current.flyTo([userLoc.lat, userLoc.lng], 15, { duration: 0.8 });
    } else {
      mapRef.current.flyTo(BAY_AREA_CENTER, 10, { duration: 0.8 });
      toast("Centered on the Bay Area", {
        description: userLoc ? "You're outside the Bay Area." : "Sharing location helps personalize.",
      });
    }
  }

  const [accuracyPx, setAccuracyPx] = useState(36);
  useEffect(() => {
    if (!mapRef.current || !userLoc) return;
    function update() {
      const m = mapRef.current!;
      const center = m.latLngToContainerPoint([userLoc!.lat, userLoc!.lng]);
      const edge = m.latLngToContainerPoint(
        L.latLng(userLoc!.lat, userLoc!.lng).toBounds(userLoc!.accuracy * 2).getNorthEast(),
      );
      const r = Math.min(Math.max(center.distanceTo(edge), 22), 240);
      setAccuracyPx(r);
    }
    update();
    mapRef.current.on("zoom move", update);
    return () => {
      mapRef.current?.off("zoom move", update);
    };
  }, [userLoc]);

  const sel = selected;
  const selName = sel?.name ?? (sel ? CATEGORY_MAP[sel.category].label : "");

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
      <MapContainer
        center={BAY_AREA_CENTER}
        zoom={10}
        zoomControl={false}
        className="absolute inset-0 z-0"
        style={{ cursor: addMode ? "crosshair" : undefined }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapRefBridge
          onReady={(m) => {
            mapRef.current = m;
            scheduleFetchForCurrentView(150);
          }}
        />
        <MapMoveWatcher onMove={() => scheduleFetchForCurrentView(700)} />
        <FlyToFirstFix loc={userLoc} />
        <MapClickHandler enabled={addMode} onClick={(latlng) => setAddLatLng(latlng)} />

        {visiblePins.map((p) => (
          <Marker
            key={p.id}
            position={[p.lat, p.lng]}
            icon={pinDivIcon(p)}
            eventHandlers={{ click: () => selectPin(p) }}
          />
        ))}

        {userLoc && (
          <Marker
            position={[userLoc.lat, userLoc.lng]}
            icon={userIcon(accuracyPx)}
            interactive={false}
          />
        )}

        {addLatLng && (
          <Marker
            position={[addLatLng.lat, addLatLng.lng]}
            icon={L.divIcon({
              className: "",
              html: `<div class="beacon-pin" style="color: ${CATEGORY_MAP[addCat].cssVar}"><div class="ring" style="color: var(--color-beacon)"></div><div class="core"></div></div>`,
              iconSize: [28, 28],
              iconAnchor: [14, 14],
            })}
          />
        )}

        {route && route.coords.length >= 2 && (
          <>
            <Polyline
              positions={route.coords}
              pathOptions={{ color: "#000", weight: 10, opacity: 0.35, lineCap: "round", lineJoin: "round" }}
            />
            <Polyline
              positions={route.coords}
              pathOptions={{
                color: "oklch(0.78 0.04 230)",
                weight: 4,
                opacity: 0.95,
                dashArray: route.fallback ? "2 10" : "1 10",
                lineCap: "round",
                lineJoin: "round",
              }}
            />
          </>
        )}
      </MapContainer>

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="glass flex h-12 items-center gap-2 rounded-full px-4">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              style={{ color: "var(--color-beacon)" }}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {/* Light rays */}
              <path d="M12 3v1.5" />
              <path d="M5.5 6 6.7 7.2" />
              <path d="M18.5 6 17.3 7.2" />
              {/* Lamp room */}
              <rect x="9" y="5" width="6" height="4" rx="0.6" />
              {/* Gallery */}
              <path d="M8 9h8" />
              {/* Tower */}
              <path d="M9.2 9 8 20" />
              <path d="M14.8 9 16 20" />
              <path d="M8.6 13.5h6.8" />
              {/* Base */}
              <path d="M6.5 20h11" />
            </svg>
            <span className="text-sm font-semibold tracking-tight">Beacon</span>
          </div>
          <div className="glass flex h-12 flex-1 items-center gap-2 rounded-full px-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Bay Area beacons…"
              className="h-full flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="rounded-full p-1 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => {
              setNeedMode((v) => !v);
              if (!needMode) {
                toast("Need Mode on", {
                  description: "Tap a category to focus on one need.",
                  duration: 2000,
                });
              }
            }}
            className={`glass flex h-12 items-center gap-2 rounded-full px-4 text-sm font-medium transition ${
              needMode ? "ring-2 ring-[var(--color-beacon)]" : ""
            }`}
            aria-pressed={needMode}
          >
            <Sparkles className="h-4 w-4" style={{ color: "var(--color-beacon)" }} />
            <span>Need</span>
          </button>
        </div>

        {/* Category pills */}
        <div className="pointer-events-auto flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const active = activeCats.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleCat(c.id)}
                className={`glass flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  active ? "" : "opacity-50"
                }`}
                style={{
                  boxShadow: active
                    ? `0 0 0 1.5px ${c.cssVar}, 0 6px 20px oklch(0 0 0 / 0.5)`
                    : undefined,
                }}
              >
                <span aria-hidden>{c.emoji}</span>
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Locate me FAB */}
      <button
        onClick={recenter}
        className="glass absolute bottom-28 right-4 z-10 flex h-12 w-12 items-center justify-center rounded-full"
        aria-label="Recenter on me"
      >
        <LocateFixed className="h-5 w-5" />
      </button>

      {/* Add Beacon button — labeled, subtle */}
      <button
        onClick={() => {
          setAddMode((v) => !v);
          setAddLatLng(null);
          if (!addMode) {
            toast("Tap the map to drop a beacon", {
              description: "Then pick a category and confirm.",
            });
          }
        }}
        className="glass absolute bottom-10 right-4 z-10 flex h-14 items-center gap-2 rounded-full px-5 text-sm font-semibold text-foreground shadow-2xl transition active:scale-95"
        style={{
          boxShadow:
            "0 10px 30px oklch(0 0 0 / 0.5), inset 0 0 0 1.5px var(--color-water_fountain)",
        }}
        aria-label={addMode ? "Cancel add beacon" : "Add Beacon"}
      >
        {addMode ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
        <span>{addMode ? "Cancel" : "Add Beacon"}</span>
      </button>

      {/* Status chip */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="rounded-full bg-card/70 px-2 py-1 backdrop-blur">
          {visiblePins.length} beacons · Bay Area{userLoc?.approximate ? " · approx location" : ""}
        </span>
      </div>

      {/* ---------- Side detail panel (right) ---------- */}
      <Drawer.Root
        direction="right"
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/30" />
          <Drawer.Content
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-border bg-card text-card-foreground outline-none"
          >
            <Drawer.Title className="sr-only">Beacon details</Drawer.Title>
            <Drawer.Description className="sr-only">
              View, verify, flag, or navigate to this beacon.
            </Drawer.Description>
            {sel && (
              <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-xl"
                    style={{
                      background: `color-mix(in oklch, ${CATEGORY_MAP[sel.category].cssVar} 25%, transparent)`,
                      color: CATEGORY_MAP[sel.category].cssVar,
                    }}
                  >
                    {CATEGORY_MAP[sel.category].emoji}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold">{selName}</div>
                    <div className="text-xs text-muted-foreground">
                      {CATEGORY_MAP[sel.category].label} · Updated {timeAgo(sel.updated_at)}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Status + confidence row */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-border bg-background/60 p-3">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <ShieldCheck className="h-3 w-3" /> Status
                    </div>
                    <div
                      className="mt-1 text-sm font-semibold"
                      style={{ color: statusColor(pinStatus(sel)) }}
                    >
                      {pinStatus(sel) === "verified"
                        ? "Verified"
                        : pinStatus(sel) === "flagged"
                          ? "Flagged"
                          : "Unconfirmed"}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border bg-background/60 p-3">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Confidence
                    </div>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <div className="text-3xl font-bold leading-none">{displayConfidence(sel)}%</div>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {pinStatus(sel) === "verified"
                        ? "boosted by verifies"
                        : pinStatus(sel) === "flagged"
                          ? "lowered by flags"
                          : "community"}
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${displayConfidence(sel)}%`,
                          background: CATEGORY_MAP[sel.category].cssVar,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Info rows */}
                <div className="flex flex-col gap-2">
                  {sel.address && (
                    <InfoRow icon={<MapPin className="h-4 w-4" />} label="Address" value={sel.address} />
                  )}
                  <InfoRow
                    icon={<Clock className="h-4 w-4" />}
                    label="Hours"
                    value={
                      <div className="flex flex-col gap-0.5">
                        <span>{sel.opening_hours ?? "Hours unknown"}</span>
                        {(() => {
                          const open = isOpenNow(sel.opening_hours);
                          if (open === null) return null;
                          return (
                            <span
                              className="text-[11px] font-semibold"
                              style={{ color: open ? "oklch(0.78 0.2 145)" : "oklch(0.7 0.22 25)" }}
                            >
                              {open ? "● Open now" : "● Closed"}
                            </span>
                          );
                        })()}
                      </div>
                    }
                  />
                  {sel.phone && (
                    <InfoRow
                      icon={<Phone className="h-4 w-4" />}
                      label="Phone"
                      value={
                        <a className="hover:underline" href={`tel:${sel.phone}`}>
                          {sel.phone}
                        </a>
                      }
                    />
                  )}
                  {sel.website && (
                    <InfoRow
                      icon={<Globe className="h-4 w-4" />}
                      label="Website"
                      value={
                        <a
                          href={sel.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate hover:underline"
                        >
                          {sel.website.replace(/^https?:\/\//, "")}
                        </a>
                      }
                    />
                  )}
                </div>

                {sel.description && (
                  <p className="text-sm leading-relaxed text-foreground/90">{sel.description}</p>
                )}

                {/* Routing card */}
                <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/60 p-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-xl"
                    style={{
                      background: "color-mix(in oklch, var(--color-beacon) 22%, transparent)",
                      color: "var(--color-beacon)",
                    }}
                  >
                    <Footprints className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {userLoc ? (
                      route ? (
                        <>
                          <div className="text-sm font-semibold">
                            {formatDuration(route.duration)} walk · {formatDistance(route.distance)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {route.fallback ? "Straight-line estimate" : "Best walking path"}
                          </div>
                        </>
                      ) : routePinId === sel.id ? (
                        <>
                          <div className="text-sm font-semibold">Finding route…</div>
                          <div className="text-xs text-muted-foreground">
                            ~{formatDistance(haversineMeters(userLoc, { lat: sel.lat, lng: sel.lng }))} away
                          </div>
                        </>
                      ) : null
                    ) : (
                      <>
                        <div className="text-sm font-semibold">Share your location</div>
                        <div className="text-xs text-muted-foreground">to see the best walking path.</div>
                      </>
                    )}
                  </div>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${sel.lat},${sel.lng}&travelmode=walking`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background"
                  >
                    Open
                  </a>
                </div>

                {/* Verify / Flag */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => vote(sel, "up")}
                    className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-background/50 text-sm font-medium hover:bg-background"
                  >
                    <ArrowUp className="h-4 w-4" style={{ color: "oklch(0.78 0.2 145)" }} />
                    Verify ({sel.upvotes})
                  </button>
                  <button
                    onClick={() => vote(sel, "down")}
                    className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-background/50 text-sm font-medium hover:bg-background"
                  >
                    <ArrowDown className="h-4 w-4" style={{ color: "oklch(0.7 0.22 25)" }} />
                    Flag ({sel.downvotes})
                  </button>
                </div>

                <div className="mt-auto flex items-center gap-1.5 pt-2 text-[11px] text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  {sel.lat.toFixed(5)}, {sel.lng.toFixed(5)}
                  {sel.demo && " · from OpenStreetMap"}
                </div>
              </div>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* ---------- Add beacon sheet (bottom) ---------- */}
      <Drawer.Root
        open={addMode && !!addLatLng}
        onOpenChange={(o) => {
          if (!o) setAddLatLng(null);
        }}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-xl flex-col rounded-t-3xl border border-border bg-card text-card-foreground">
            <Drawer.Title className="sr-only">Add a beacon</Drawer.Title>
            <Drawer.Description className="sr-only">
              Choose category and confirm the new beacon location.
            </Drawer.Description>
            <div className="mx-auto my-3 h-1.5 w-12 rounded-full bg-muted" />
            <div className="flex flex-col gap-4 px-5 pb-7">
              <div className="text-base font-semibold">New beacon</div>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setAddCat(c.id)}
                    className={`flex flex-col items-center gap-1 rounded-2xl border p-3 text-xs font-medium transition ${
                      addCat === c.id ? "" : "opacity-60"
                    }`}
                    style={{
                      borderColor: addCat === c.id ? c.cssVar : "var(--color-border)",
                      background:
                        addCat === c.id
                          ? `color-mix(in oklch, ${c.cssVar} 18%, transparent)`
                          : "transparent",
                    }}
                  >
                    <span className="text-xl" aria-hidden>
                      {c.emoji}
                    </span>
                    {c.label}
                  </button>
                ))}
              </div>
              <textarea
                value={addDescription}
                onChange={(e) => setAddDescription(e.target.value)}
                placeholder="What's here? (optional)"
                rows={2}
                className="resize-none rounded-2xl border border-border bg-background/50 p-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--color-beacon)]"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setAddLatLng(null)}
                  className="h-12 flex-1 rounded-2xl border border-border text-sm font-medium"
                >
                  Pick again
                </button>
                <button
                  onClick={submitNewPin}
                  disabled={submitting}
                  className="h-12 flex-1 rounded-2xl bg-foreground text-sm font-semibold text-background disabled:opacity-60"
                >
                  {submitting ? "Adding…" : "Drop beacon"}
                </button>
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-background/40 p-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="min-w-0 text-sm text-foreground/90 break-words">{value}</div>
      </div>
    </div>
  );
}
