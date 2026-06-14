# Beacon

Beacon is a community map for finding nearby water, public restrooms, free food, and safe places to rest. It is built with TanStack Start, Vite, React, Leaflet, and Supabase.

## Features

- Interactive map with live pins and location-aware browsing
- Search and category filtering for nearby resources
- Add and verify places directly on the map
- Real-time updates from Supabase
- Route and distance helpers for getting to a pin

## Tech Stack

- TanStack Start
- React 19
- Vite
- Leaflet / React Leaflet
- Supabase
- Tailwind CSS v4

## Getting Started

### Prerequisites

- Node.js and npm or Bun
- A Supabase project with the matching schema and environment variables

### Install

```bash
npm install
```

### Environment Variables

Create a `.env` file in the project root with the values required by the app:

```bash
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_SUPABASE_PROJECT_ID=
```

The client uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, while server-side code also expects the non-`VITE_` Supabase variables.

### Run Locally

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Preview

```bash
npm run preview
```

### Lint

```bash
npm run lint
```

## Project Structure

- `src/routes` contains the TanStack Router route definitions
- `src/components/BeaconMap.tsx` is the main map experience
- `src/lib` contains routing, beacon data helpers, and utility functions
- `src/integrations/supabase` contains the Supabase client setup
- `supabase/migrations` contains database migrations

## Notes

- The app loads Leaflet only in the browser because it depends on `window`.
- `.env` is intentionally ignored by Git so local secrets stay private.
