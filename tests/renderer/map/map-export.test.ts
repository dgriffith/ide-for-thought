/**
 * A map captured for an export (#2511): its pure parts — coordinates,
 * attribution, and the exported block in both shapes (image, or the places
 * when the map couldn't be drawn).
 */
import { describe, it, expect } from 'vitest';
import { attributionText, mapCaptureHtml, parseLatLng, type MapPlace } from '../../../src/renderer/lib/map/map-export';

const PLACES: MapPlace[] = [
  { path: 'trip/places/Kampa Museum.md', title: 'Kampa Museum', lat: 50.0835, lng: 14.4089 },
  { path: 'trip/places/Széchenyi.md', title: 'Széchenyi <Baths> & "Spa"', lat: 47.5186, lng: 19.0818 },
];

describe('parseLatLng', () => {
  it('reads "<lat>,<lng>" and rejects anything else', () => {
    expect(parseLatLng('50.08, 14.41')).toEqual([50.08, 14.41]);
    expect(parseLatLng('50.08')).toBeNull();
    expect(parseLatLng('north, east')).toBeNull();
    expect(parseLatLng(null)).toBeNull();
  });
});

describe('attributionText', () => {
  it('keeps every provider\'s credit, as text, once each', () => {
    const style = { sources: {
      a: { attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a>' },
      b: { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
      c: { attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a>' },
      d: {},
    } };
    expect(attributionText(style)).toBe('OpenFreeMap © OpenMapTiles · © OpenStreetMap contributors');
    expect(attributionText(null)).toBe('');
  });
});

describe('mapCaptureHtml', () => {
  it('a drawn map: the image at its frame size, places named in the alt text, credit under it', () => {
    const html = mapCaptureHtml({ ok: true, image: 'data:image/png;base64,AAAA', width: 760, height: 360, attribution: '© OpenStreetMap contributors', places: PLACES }, 'minerva-live-block', 'data-note-link');
    expect(html).toContain('<img src="data:image/png;base64,AAAA" width="760" height="360"');
    expect(html).toContain('alt="Map of 2 places: Kampa Museum, Széchenyi &lt;Baths&gt; &amp; &quot;Spa&quot;"');
    expect(html).toContain('<figcaption>© OpenStreetMap contributors</figcaption>');
    expect(html.startsWith('<div class="minerva-live-block"><style>')).toBe(true);
  });

  it('an undrawable map: says why, and lists every place with its coordinates, linked', () => {
    const html = mapCaptureHtml({ ok: false, reason: 'the map tiles took too long to load', places: PLACES }, 'minerva-live-block', 'data-note-link');
    expect(html).toContain("The map couldn't be drawn");
    expect(html).toContain('the map tiles took too long to load');
    expect(html).toContain('<a data-note-link="trip/places/Kampa Museum.md">Kampa Museum</a></td><td class="num">50.08350</td><td class="num">14.40890</td>');
    expect(html).toContain('Széchenyi &lt;Baths&gt; &amp; &quot;Spa&quot;');
    expect(html).not.toContain('<img');
  });

  it('an undrawable map with no located places: just the note', () => {
    const html = mapCaptureHtml({ ok: false, reason: 'offline', places: [] }, 'minerva-live-block', 'data-note-link');
    expect(html).toContain('(offline).');
    expect(html).not.toContain('<table');
  });
});
