export type Category =
  | "water_fountain"
  | "bathroom"
  | "food"
  | "shelter"
  | "religious_center"
  | "library";

export const CATEGORIES: {
  id: Category;
  label: string;
  emoji: string;
  cssVar: string;
}[] = [
  { id: "water_fountain",   label: "Water Fountains",   emoji: "🚰", cssVar: "var(--color-water_fountain)" },
  { id: "bathroom",         label: "Bathrooms",         emoji: "🚻", cssVar: "var(--color-bathroom)" },
  { id: "food",             label: "Food",              emoji: "🍲", cssVar: "var(--color-food)" },
  { id: "shelter",          label: "Shelter",           emoji: "⛺", cssVar: "var(--color-shelter)" },
  { id: "religious_center", label: "Religious Centers", emoji: "🛐", cssVar: "var(--color-religious_center)" },
  { id: "library",          label: "Libraries",         emoji: "📚", cssVar: "var(--color-library)" },
];

export const CATEGORY_MAP = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<Category, (typeof CATEGORIES)[number]>;

export interface Pin {
  id: string;
  category: Category;
  lat: number;
  lng: number;
  description: string | null;
  upvotes: number;
  downvotes: number;
  created_at: string;
  updated_at: string;
  demo?: boolean;
  // Enriched (OSM + simulated)
  name?: string;
  address?: string;
  phone?: string;
  website?: string;
  opening_hours?: string;
  confidence?: number; // 0-100
}

export function pinStatus(p: Pin): "verified" | "neutral" | "flagged" {
  const net = p.upvotes - p.downvotes;
  if (net >= 1) return "verified";
  if (net <= -1) return "flagged";
  return "neutral";
}

/** Confidence adjusted by community votes: verified raises it, flagged drops it. */
export function displayConfidence(p: Pin): number {
  const base = p.confidence ?? 70;
  const s = pinStatus(p);
  const net = p.upvotes - p.downvotes;
  let adjusted = base;
  if (s === "verified") adjusted = base + Math.min(20, 5 + net * 3);
  else if (s === "flagged") adjusted = base - Math.min(45, 10 + Math.abs(net) * 6);
  return Math.max(5, Math.min(99, Math.round(adjusted)));
}

export function statusColor(s: ReturnType<typeof pinStatus>): string {
  if (s === "verified") return "oklch(0.78 0.2 145)";
  if (s === "flagged") return "oklch(0.7 0.22 25)";
  return "oklch(0.78 0.04 230)";
}

export function pinOpacity(p: Pin): number {
  const ageMs = Date.now() - new Date(p.updated_at).getTime();
  const day = 24 * 60 * 60 * 1000;
  const t = Math.min(Math.max(ageMs / day, 0), 1);
  return 1 - t * 0.5;
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// California Bay Area bounding box (clamps every Overpass query)
// ---------------------------------------------------------------------------
export const BAY_AREA = {
  south: 36.85,
  west: -123.05,
  north: 38.95,
  east: -121.15,
};
export const BAY_AREA_CENTER: [number, number] = [37.7749, -122.4194];

export function inBayArea(lat: number, lng: number): boolean {
  return (
    lat >= BAY_AREA.south &&
    lat <= BAY_AREA.north &&
    lng >= BAY_AREA.west &&
    lng <= BAY_AREA.east
  );
}

// ---------------------------------------------------------------------------
// Overpass: real OSM places, restricted to Bay Area
// ---------------------------------------------------------------------------
interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const OVERPASS_FILTERS = [
  '["amenity"="drinking_water"]',
  '["amenity"="toilets"]',
  '["amenity"="food_bank"]',
  '["amenity"="soup_kitchen"]',
  '["social_facility"="food_bank"]',
  '["social_facility"="soup_kitchen"]',
  '["amenity"="shelter"]',
  '["social_facility"="shelter"]',
  '["social_facility"="homeless_shelter"]',
  '["amenity"="library"]',
  '["amenity"="place_of_worship"]',
];

function prettyTag(v: string): string {
  return v.replace(/[_:]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function categorize(tags: Record<string, string>): Category | null {
  const a = tags.amenity;
  const sf = tags.social_facility;
  const sfFor = tags["social_facility:for"] ?? "";
  if (a === "drinking_water" || tags.drinking_water === "yes") return "water_fountain";
  if (a === "toilets") return "bathroom";
  if (
    a === "food_bank" || a === "soup_kitchen" ||
    sf === "food_bank" || sf === "soup_kitchen" || sfFor.includes("food")
  ) return "food";
  if (a === "library") return "library";
  if (a === "place_of_worship") return "religious_center";
  if (
    a === "shelter" || sf === "shelter" || sf === "homeless_shelter" ||
    sfFor.includes("homeless")
  ) return "shelter";
  return null;
}

function nameFor(cat: Category, tags: Record<string, string>): string {
  if (tags.name) return tags.name;
  if (tags["name:en"]) return tags["name:en"];
  if (tags.operator) return tags.operator;
  if (tags.brand) return tags.brand;
  switch (cat) {
    case "water_fountain":   return "Public drinking fountain";
    case "bathroom":         return "Public restroom";
    case "food":             return tags.amenity === "soup_kitchen" ? "Soup kitchen" : "Food bank";
    case "shelter":          return tags.shelter_type ? `${prettyTag(tags.shelter_type)} shelter` : "Shelter";
    case "religious_center": {
      const r = (tags.religion ?? "").toLowerCase();
      if (r === "christian") return "Church";
      if (r === "muslim") return "Mosque";
      if (r === "hindu") return "Hindu temple";
      if (r === "buddhist") return "Buddhist temple";
      if (r === "sikh") return "Gurdwara";
      if (r === "jewish") return "Synagogue";
      return "Religious center";
    }
    case "library":          return "Public library";
  }
}

function addressFor(tags: Record<string, string>): string | undefined {
  const num = tags["addr:housenumber"];
  const street = tags["addr:street"];
  const city = tags["addr:city"];
  const state = tags["addr:state"];
  const parts: string[] = [];
  if (num && street) parts.push(`${num} ${street}`);
  else if (street) parts.push(street);
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (!parts.length && tags["addr:full"]) return tags["addr:full"];
  return parts.length ? parts.join(", ") : undefined;
}

// Tiny deterministic hash → stable simulated metadata
function hashId(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SIM_HOURS = [
  "Open 24 hours",
  "Mon–Fri 8am–6pm",
  "Mon–Sat 9am–9pm",
  "Daily 7am–10pm",
  "Mon–Fri 10am–5pm · Sat 10am–2pm",
  "Daily 6am–8pm",
  "Sun–Thu 9am–7pm",
];

function simulatedHoursFor(cat: Category, id: string): string {
  const h = hashId(id);
  if (cat === "water_fountain" || cat === "bathroom") return "Open 24 hours";
  return SIM_HOURS[h % SIM_HOURS.length];
}

function simulatedConfidenceFor(id: string, hasRichTags: boolean): number {
  const base = hasRichTags ? 78 : 62;
  return base + (hashId(id) % 22); // base..base+21
}

// ---------------------------------------------------------------------------
// Simulated address / phone / website for pins missing real OSM tags
// ---------------------------------------------------------------------------
const SIM_STREETS = [
  "Market St", "Mission St", "Valencia St", "Castro St", "Folsom St",
  "Geary Blvd", "Divisadero St", "Polk St", "Embarcadero", "Van Ness Ave",
  "Telegraph Ave", "Shattuck Ave", "University Ave", "El Camino Real",
  "Broadway", "Grand Ave", "Lakeshore Ave", "Park Blvd", "MacArthur Blvd",
];
const SIM_CITIES = [
  { city: "San Francisco", area: "415" },
  { city: "Oakland",       area: "510" },
  { city: "Berkeley",      area: "510" },
  { city: "San Jose",      area: "408" },
  { city: "Palo Alto",     area: "650" },
  { city: "San Mateo",     area: "650" },
  { city: "Daly City",     area: "415" },
  { city: "Richmond",      area: "510" },
];

function pad(n: number, w: number): string {
  const s = String(n);
  return s.length >= w ? s : "0".repeat(w - s.length) + s;
}

function simulatedAddressFor(id: string): { address: string; area: string } {
  const h = hashId(id);
  const num = 100 + (h % 4800);
  const street = SIM_STREETS[(h >>> 5) % SIM_STREETS.length];
  const c = SIM_CITIES[(h >>> 11) % SIM_CITIES.length];
  return { address: `${num} ${street}, ${c.city}, CA`, area: c.area };
}

function simulatedPhoneFor(id: string, area: string): string {
  const h = hashId("phone:" + id);
  const mid = 200 + (h % 800);
  const last = h % 10000;
  return `(${area}) ${mid}-${pad(last, 4)}`;
}

function simulatedWebsiteFor(cat: Category, id: string, name: string): string | undefined {
  // Skip websites for things that almost never have one
  if (cat === "water_fountain" || cat === "bathroom") return undefined;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || `beacon-${hashId(id) % 9999}`;
  const tlds = [".org", ".com", ".net"];
  const tld = tlds[hashId("tld:" + id) % tlds.length];
  return `https://${slug}${tld}`;
}


function describe(cat: Category, tags: Record<string, string>): string {
  const bits: string[] = [];
  if (cat === "bathroom") {
    if (tags.fee === "yes") bits.push("Fee required");
    else if (tags.fee === "no") bits.push("Free");
    if (tags.wheelchair === "yes") bits.push("Wheelchair accessible");
    if (tags.unisex === "yes") bits.push("Unisex");
    if (tags.changing_table === "yes") bits.push("Changing table");
  }
  if (cat === "water_fountain") {
    if (tags["drinking_water:refill"] === "yes") bits.push("Bottle refill station");
    if (tags.bottle === "yes") bits.push("Bottle filler");
  }
  if (cat === "shelter" && tags.shelter_type) bits.push(prettyTag(tags.shelter_type));
  
  if (tags.operator) bits.push(`Operated by ${tags.operator}`);
  if (tags.description) bits.push(tags.description);
  return bits.join(" · ");
}

export async function fetchOverpassPins(
  arg:
    | { lat: number; lng: number }
    | { south: number; west: number; north: number; east: number },
  radiusMeters = 2500,
): Promise<Pin[]> {
  // Clamp to Bay Area
  let bbox: { south: number; west: number; north: number; east: number };
  if ("south" in arg) {
    bbox = {
      south: Math.max(arg.south, BAY_AREA.south),
      west:  Math.max(arg.west,  BAY_AREA.west),
      north: Math.min(arg.north, BAY_AREA.north),
      east:  Math.min(arg.east,  BAY_AREA.east),
    };
  } else {
    if (!inBayArea(arg.lat, arg.lng)) return [];
    const dLat = radiusMeters / 111_320;
    const dLng = radiusMeters / (111_320 * Math.cos((arg.lat * Math.PI) / 180));
    bbox = {
      south: Math.max(arg.lat - dLat, BAY_AREA.south),
      north: Math.min(arg.lat + dLat, BAY_AREA.north),
      west:  Math.max(arg.lng - dLng, BAY_AREA.west),
      east:  Math.min(arg.lng + dLng, BAY_AREA.east),
    };
  }
  if (bbox.south >= bbox.north || bbox.west >= bbox.east) return [];

  const filter = `(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`;
  const selectors = OVERPASS_FILTERS.map((f) => `node${f}${filter};`).join("\n      ");
  const q = `
    [out:json][timeout:10];
    (
      ${selectors}
    );
    out body 600;
  `.trim();

  let data: { elements: OverpassElement[] } | null = null;
  for (const url of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Beacon Bay Area lookup",
        },
        body: "data=" + encodeURIComponent(q),
      });
      if (!res.ok) continue;
      data = await res.json();
      break;
    } catch { /* try next */ } finally { clearTimeout(timeout); }
  }
  if (!data?.elements) return [];

  const now = new Date().toISOString();
  const seen = new Set<string>();
  const pins: Pin[] = [];
  for (const el of data.elements) {
    const tags = el.tags ?? {};
    const cat = categorize(tags);
    if (!cat) continue;
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (!inBayArea(lat, lng)) continue;
    const id = `osm-${el.type}-${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const name = nameFor(cat, tags);
    const realAddress = addressFor(tags);
    const desc = describe(cat, tags);
    const richness =
      Number(!!tags.name) +
      Number(!!realAddress) +
      Number(!!tags.opening_hours) +
      Number(!!tags.phone) +
      Number(!!tags.website);
    const opening_hours = tags.opening_hours ?? simulatedHoursFor(cat, id);
    const confidence = simulatedConfidenceFor(id, richness >= 2);

    const sim = simulatedAddressFor(id);
    const address = realAddress ?? sim.address;
    const phone =
      tags.phone ?? tags["contact:phone"] ?? simulatedPhoneFor(id, sim.area);
    const website =
      tags.website ?? tags["contact:website"] ?? simulatedWebsiteFor(cat, id, name);

    pins.push({
      id,
      category: cat,
      lat, lng,
      description: desc || null,
      upvotes: 0,
      downvotes: 0,
      created_at: now,
      updated_at: now,
      demo: true,
      name,
      address,
      phone,
      website,
      opening_hours,
      confidence,
    });
  }
  return pins;
}

// ---------------------------------------------------------------------------
// Open / Closed parser — handles our simulated hours formats and a few common
// OSM opening_hours patterns. Returns null when we can't parse confidently.
// ---------------------------------------------------------------------------
const DAY_INDEX: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function parseClock(s: string): number | null {
  // "8am", "6:30pm", "14:00", "9"
  const m = s.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3];
  if (ap === "am") { if (h === 12) h = 0; }
  else if (ap === "pm") { if (h !== 12) h += 12; }
  if (h < 0 || h > 24 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function parseDayRange(token: string): number[] | null {
  // "Mon", "Mon–Fri", "Sun–Thu", "Daily"
  const t = token.trim().toLowerCase().replace(/[–—]/g, "-");
  if (t === "daily" || t === "everyday" || t === "every day") return [0,1,2,3,4,5,6];
  const parts = t.split("-");
  const a = DAY_INDEX[parts[0]?.slice(0, 3)];
  if (a === undefined) return null;
  if (parts.length === 1) return [a];
  const b = DAY_INDEX[parts[1]?.slice(0, 3)];
  if (b === undefined) return null;
  const out: number[] = [];
  let i = a;
  while (true) { out.push(i); if (i === b) break; i = (i + 1) % 7; if (out.length > 7) break; }
  return out;
}

function parseTimeRange(token: string): { start: number; end: number } | null {
  const t = token.trim().toLowerCase().replace(/[–—]/g, "-");
  const m = t.match(/^([0-9:apm\s]+)-([0-9:apm\s]+)$/);
  if (!m) return null;
  const start = parseClock(m[1]);
  const end = parseClock(m[2]);
  if (start === null || end === null) return null;
  return { start, end };
}

interface OpenWindow { days: number[]; start: number; end: number }

function parseHours(hours: string): OpenWindow[] | "always" | null {
  const h = hours.trim();
  if (!h) return null;
  if (/^(24\/7|open 24 hours|always open)$/i.test(h)) return "always";

  const windows: OpenWindow[] = [];
  for (const segRaw of h.split(/·|;|,/)) {
    const seg = segRaw.trim();
    if (!seg) continue;
    // Find boundary between day(s) and time(s) — first space before a digit
    const m = seg.match(/^([A-Za-z–—\-]+(?:\s+[A-Za-z–—\-]+)?)\s+(.+)$/);
    if (!m) return null;
    const days = parseDayRange(m[1]);
    const time = parseTimeRange(m[2]);
    if (!days || !time) return null;
    windows.push({ days, start: time.start, end: time.end });
  }
  return windows.length ? windows : null;
}

/**
 * Returns true if open now, false if closed, null if hours are unparseable.
 */
export function isOpenNow(hours: string | undefined | null, now: Date = new Date()): boolean | null {
  if (!hours) return null;
  const parsed = parseHours(hours);
  if (parsed === null) return null;
  if (parsed === "always") return true;
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const w of parsed) {
    if (!w.days.includes(day)) continue;
    if (w.end > w.start) {
      if (minutes >= w.start && minutes < w.end) return true;
    } else {
      // overnight (e.g. 10pm–2am)
      if (minutes >= w.start || minutes < w.end) return true;
    }
  }
  return false;
}
