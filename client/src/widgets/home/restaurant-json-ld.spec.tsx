import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RestaurantJsonLd } from './restaurant-json-ld';

describe('Restaurant structured data', () => {
  it.each([
    '</script><script>alert(1)</script>',
    '</SCRIPT><SCRIPT>alert(1)</SCRIPT>',
    '</script foo="bar"><script>alert(1)</script>',
  ])('keeps editable contact details inside JSON: %s', (address) => {
    const html = renderToStaticMarkup(<RestaurantJsonLd address={address} phone="123" />);
    const document = new DOMParser().parseFromString(html, 'text/html');
    const scripts = document.querySelectorAll('script');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].type).toBe('application/ld+json');
    const payload = scripts[0].textContent;
    expect(JSON.parse(payload).address.streetAddress).toBe(address);
    expect(html).not.toContain(address);
  });
});
