import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RestaurantJsonLd } from './restaurant-json-ld';

describe('Restaurant structured data', () => {
  it('keeps editable contact details inside JSON instead of opening an HTML script', () => {
    const address = '</script><script>alert(1)</script>';
    const html = renderToStaticMarkup(<RestaurantJsonLd address={address} phone="123" />);
    expect(html.match(/<script/g)).toHaveLength(1);
    const payload = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    expect(JSON.parse(payload).address.streetAddress).toBe(address);
    expect(html).not.toContain(address);
  });
});
