'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MAP_KEY } from '@/shared/config/site';
import { loadScript } from '@/shared/lib/load-script';

/** Where the map opens when the customer has not placed a pin yet. */
const MAKHACHKALA = { lat: 42.9764, lng: 47.5024 };

const MAPGL_SRC = 'https://mapgl.2gis.com/api/js/v1';

/** Close enough to see individual buildings, which is the point of the pin. */
const BUILDING_ZOOM = 16;

export interface Coordinates {
  lat: number;
  lng: number;
}

/** The slice of the MapGL API this component uses. */
interface MapGL {
  Map: new (
    container: HTMLElement,
    options: { key: string; center: [number, number]; zoom: number },
  ) => MapInstance;
  Marker: new (map: MapInstance, options: { coordinates: [number, number] }) => MarkerInstance;
}

interface MapInstance {
  on(event: 'click', handler: (event: { lngLat: [number, number] }) => void): void;
  destroy(): void;
}

interface MarkerInstance {
  setCoordinates(coordinates: [number, number]): void;
  destroy(): void;
}

declare global {
  interface Window {
    mapgl?: MapGL;
  }
}

/**
 * Lets the customer put a pin on their building.
 *
 * The address is still typed — this is not a geocoder. What the pin adds is
 * coordinates, which is what a courier actually navigates by and what a
 * delivery zone is measured against; a street and a house number cannot be
 * tested against a polygon.
 *
 * Renders nothing without a map key. A shop that has not got one keeps the
 * plain address form it has always had, rather than an empty grey box.
 */
export function AddressMapPicker({
  value,
  onChange,
}: {
  value: Coordinates | null;
  onChange: (coordinates: Coordinates) => void;
}) {
  const t = useTranslations('checkout');
  const container = useRef<HTMLDivElement>(null);
  const marker = useRef<MarkerInstance | null>(null);
  const [failed, setFailed] = useState(false);

  // The handler changes on every render; the map is created once, so it reads
  // the latest one through a ref instead of being torn down and rebuilt.
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    if (!MAP_KEY || !container.current) return;

    let map: MapInstance | null = null;
    let cancelled = false;

    loadScript(MAPGL_SRC)
      .then(() => {
        if (cancelled || !container.current || !window.mapgl) return;

        const start = value ?? MAKHACHKALA;
        map = new window.mapgl.Map(container.current, {
          key: MAP_KEY,
          center: [start.lng, start.lat],
          zoom: BUILDING_ZOOM,
        });

        if (value) {
          marker.current = new window.mapgl!.Marker(map, { coordinates: [value.lng, value.lat] });
        }

        map.on('click', ({ lngLat: [lng, lat] }) => {
          if (!map || !window.mapgl) return;
          // One marker, moved — creating a new one per tap leaves a trail of
          // pins the customer cannot remove.
          if (marker.current) marker.current.setCoordinates([lng, lat]);
          else marker.current = new window.mapgl.Marker(map, { coordinates: [lng, lat] });

          latest.current({ lat, lng });
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      marker.current?.destroy();
      marker.current = null;
      map?.destroy();
    };
    // Deliberately once: re-running would rebuild the map under the customer
    // every time they move the pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!MAP_KEY) return null;

  if (failed) {
    // The address itself is typed, so a dead map costs precision, not the order.
    return <p className="text-xs text-muted-foreground">{t('mapUnavailable')}</p>;
  }

  return (
    <div className="space-y-1.5">
      <div
        ref={container}
        role="application"
        aria-label={t('mapLabel')}
        className="h-56 w-full overflow-hidden rounded-md border bg-muted"
      />
      <p className="text-xs text-muted-foreground">{value ? t('pinPlaced') : t('pinHint')}</p>
    </div>
  );
}
