import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { loadScript } from '@/shared/lib/load-script';
import { AddressMapPicker } from './address-map-picker';

const mapKey = vi.hoisted(() => ({ current: 'test-map-key' }));

vi.mock('@/shared/config/site', () => ({
  get MAP_KEY() {
    return mapKey.current;
  },
}));
vi.mock('@/shared/lib/load-script', () => ({ loadScript: vi.fn() }));

/** Captures the click handler the picker registers, so a tap can be replayed. */
let clickHandler: ((event: { lngLat: [number, number] }) => void) | null = null;

const marker = { setCoordinates: vi.fn(), destroy: vi.fn() };
const mapInstance = {
  on: vi.fn((_event: string, handler: (event: { lngLat: [number, number] }) => void) => {
    clickHandler = handler;
  }),
  destroy: vi.fn(),
};

// Called with `new`, so these have to be constructible — an arrow function is
// not. Returning an object from a constructor call yields that object.
type MapOptions = { key: string; center: [number, number]; zoom: number };

const Map = vi.fn(function (_container: HTMLElement, _options: MapOptions) {
  return mapInstance;
});
const Marker = vi.fn(function (_map: unknown, _options: { coordinates: [number, number] }) {
  return marker;
});

beforeEach(() => {
  vi.clearAllMocks();
  clickHandler = null;
  mapKey.current = 'test-map-key';
  vi.mocked(loadScript).mockResolvedValue(undefined);
  vi.stubGlobal('mapgl', { Map, Marker });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AddressMapPicker — when it appears', () => {
  it('loads the map bundle and opens on Makhachkala', async () => {
    renderWithProviders(<AddressMapPicker value={null} onChange={vi.fn()} />);

    await waitFor(() => expect(Map).toHaveBeenCalled());
    expect(loadScript).toHaveBeenCalledWith('https://mapgl.2gis.com/api/js/v1');
    expect(Map.mock.calls[0][1]).toMatchObject({
      key: 'test-map-key',
      center: [47.5024, 42.9764],
    });
  });

  /**
   * A shop with no map key keeps the plain address form it has always had,
   * rather than an empty grey box that never fills in.
   */
  it('renders nothing without a key, and loads no bundle', () => {
    mapKey.current = '';
    const { container } = renderWithProviders(<AddressMapPicker value={null} onChange={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
    expect(loadScript).not.toHaveBeenCalled();
  });

  it('opens on the existing pin when the address already has one', async () => {
    renderWithProviders(<AddressMapPicker value={{ lat: 42.99, lng: 47.47 }} onChange={vi.fn()} />);

    await waitFor(() => expect(Map).toHaveBeenCalled());
    expect(Map.mock.calls[0][1]).toMatchObject({ center: [47.47, 42.99] });
    expect(Marker).toHaveBeenCalledWith(mapInstance, { coordinates: [47.47, 42.99] });
  });
});

describe('AddressMapPicker — placing the pin', () => {
  it('reports the tapped coordinates', async () => {
    const onChange = vi.fn();
    renderWithProviders(<AddressMapPicker value={null} onChange={onChange} />);
    await waitFor(() => expect(clickHandler).not.toBeNull());

    clickHandler!({ lngLat: [47.5, 42.98] });

    expect(onChange).toHaveBeenCalledWith({ lat: 42.98, lng: 47.5 });
  });

  it('moves the one marker instead of dropping a trail of them', async () => {
    renderWithProviders(<AddressMapPicker value={null} onChange={vi.fn()} />);
    await waitFor(() => expect(clickHandler).not.toBeNull());

    clickHandler!({ lngLat: [47.5, 42.98] });
    clickHandler!({ lngLat: [47.51, 42.99] });

    expect(Marker).toHaveBeenCalledTimes(1);
    expect(marker.setCoordinates).toHaveBeenCalledWith([47.51, 42.99]);
  });

  it('tells the customer whether the building is marked', async () => {
    const { rerender } = renderWithProviders(<AddressMapPicker value={null} onChange={vi.fn()} />);
    await waitFor(() => expect(Map).toHaveBeenCalled());

    expect(screen.getByText(/Нажмите на карте/)).toBeInTheDocument();

    rerender(<AddressMapPicker value={{ lat: 42.98, lng: 47.5 }} onChange={vi.fn()} />);
    expect(screen.getByText('Дом отмечен на карте')).toBeInTheDocument();
  });
});

describe('AddressMapPicker — when the map does not load', () => {
  it('says so instead of showing a dead box', async () => {
    vi.mocked(loadScript).mockRejectedValue(new Error('blocked'));
    renderWithProviders(<AddressMapPicker value={null} onChange={vi.fn()} />);

    // The address is typed either way, so a dead map costs precision, not the
    // order.
    expect(await screen.findByText(/Карта не загрузилась/)).toBeInTheDocument();
  });
});

describe('AddressMapPicker — cleanup', () => {
  it('destroys the map and the marker on unmount', async () => {
    const { unmount } = renderWithProviders(
      <AddressMapPicker value={{ lat: 42.98, lng: 47.5 }} onChange={vi.fn()} />,
    );
    await waitFor(() => expect(Map).toHaveBeenCalled());

    unmount();

    expect(marker.destroy).toHaveBeenCalled();
    expect(mapInstance.destroy).toHaveBeenCalled();
  });
});
