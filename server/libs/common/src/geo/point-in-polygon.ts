/** A point on the map, in the order GeoJSON writes them: longitude first. */
export type Position = [lng: number, lat: number];

/**
 * A closed ring. The last vertex need not repeat the first — the test treats
 * the ring as closed either way.
 */
export type Polygon = Position[];

/**
 * Whether a point falls inside a polygon, by ray casting.
 *
 * Counts how many edges a ray drawn east from the point crosses: an odd count
 * means inside. Plain planar geometry, which is right here — a delivery zone
 * spans a few kilometres of one city, where the error from ignoring the
 * curvature of the Earth is far smaller than the width of the street the
 * boundary was drawn along.
 *
 * Deliberately not PostGIS: one extension, one migration path and one more
 * thing to install, to answer a question a dozen lines of arithmetic settles
 * for a shop with a handful of zones.
 */
export function isPointInPolygon(point: Position, polygon: Polygon): boolean {
  // Fewer than three vertices is a line or a dot: nothing can be inside it.
  if (polygon.length < 3) return false;

  const [x, y] = point;
  let inside = false;

  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const [xi, yi] = polygon[current];
    const [xj, yj] = polygon[previous];

    // Does this edge straddle the ray's latitude? Comparing with `>` on one
    // side and `<=` on the other is what stops a vertex exactly level with
    // the ray from being counted twice.
    const straddles = yi > y !== yj > y;
    if (!straddles) continue;

    // Longitude where the edge crosses the ray.
    const crossingX = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (x < crossingX) inside = !inside;
  }

  return inside;
}

/** Narrows loosely typed JSON — a polygon read back out of a `Json` column. */
export function asPolygon(value: unknown): Polygon | null {
  if (!Array.isArray(value)) return null;

  const ring: Polygon = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) return null;
    const [lng, lat] = entry;
    if (typeof lng !== 'number' || typeof lat !== 'number') return null;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    ring.push([lng, lat]);
  }

  return ring.length >= 3 ? ring : null;
}
