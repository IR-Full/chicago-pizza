import { asPolygon, isPointInPolygon, type Polygon } from './point-in-polygon';

/** A unit square, the simplest shape with an inside and an outside. */
const SQUARE: Polygon = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
];

/**
 * A concave shape: a square with a bite taken out of the right-hand side.
 * Ray casting is chosen precisely because it handles these, and a zone drawn
 * around a bay or a railway line will be one.
 */
const C_SHAPE: Polygon = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 8],
  [3, 8],
  [3, 2],
  [10, 2],
  [10, 0],
];

describe('isPointInPolygon — simple shapes', () => {
  it('finds a point in the middle', () => {
    expect(isPointInPolygon([5, 5], SQUARE)).toBe(true);
  });

  it.each([
    ['east', [15, 5]],
    ['west', [-1, 5]],
    ['north', [5, 15]],
    ['south', [5, -5]],
  ])('rejects a point outside to the %s', (_label, point) => {
    expect(isPointInPolygon(point as [number, number], SQUARE)).toBe(false);
  });

  it('rejects a point level with a vertex but outside the shape', () => {
    // The classic ray-casting bug: a ray grazing a vertex counted twice.
    expect(isPointInPolygon([20, 10], SQUARE)).toBe(false);
  });
});

describe('isPointInPolygon — concave shapes', () => {
  it('finds a point in one of the arms', () => {
    expect(isPointInPolygon([1, 5], C_SHAPE)).toBe(true);
  });

  it('rejects a point in the bite, which is outside the zone', () => {
    // Inside the bounding box, outside the polygon — the case a naive
    // rectangle test gets wrong.
    expect(isPointInPolygon([6, 5], C_SHAPE)).toBe(false);
  });
});

describe('isPointInPolygon — degenerate input', () => {
  it.each([
    ['an empty ring', []],
    ['a single point', [[0, 0]]],
    ['a line', [[0, 0], [10, 10]]],
  ])('treats %s as containing nothing', (_label, ring) => {
    expect(isPointInPolygon([5, 5], ring as Polygon)).toBe(false);
  });
});

describe('asPolygon', () => {
  it('accepts a well-formed ring', () => {
    expect(asPolygon([[47.5, 42.9], [47.6, 42.9], [47.6, 43], [47.5, 43]])).toHaveLength(4);
  });

  /**
   * The ring comes out of a `Json` column, so it is whatever was put in —
   * possibly by an earlier version of the admin API, possibly by hand.
   */
  it.each([
    ['not an array', { lat: 1 }],
    ['too few vertices', [[0, 0], [1, 1]]],
    ['a pair that is not a pair', [[0, 0], [1], [2, 2]]],
    ['strings instead of numbers', [['0', '0'], [1, 1], [2, 2]]],
    ['a NaN', [[Number.NaN, 0], [1, 1], [2, 2]]],
  ])('rejects %s', (_label, value) => {
    expect(asPolygon(value)).toBeNull();
  });
});
