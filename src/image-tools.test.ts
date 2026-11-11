import assert from 'node:assert/strict';
import test from 'node:test';
import jpeg from 'jpeg-js';
import {
  cropJpeg,
  formatIndexedRecord,
  parseImageData,
  parseImageId,
  parseWaypoint,
  recordMatches,
  waypointUrl,
} from './image-tools.js';

test('parseImageId takes bare IDs and viewer URLs', () => {
  assert.equal(parseImageId('3:1:S3HT-6SDK-MF'), '3:1:S3HT-6SDK-MF');
  assert.equal(parseImageId('https://www.familysearch.org/ark:/61903/3:1:S3HT-6SDK-MF?lang=pt&i=82'), '3:1:S3HT-6SDK-MF');
  assert.throws(() => parseImageId('QGVM-F7V7'));
});

test('waypointUrl accepts collection IDs, wc values and platform URLs only on familysearch.org', () => {
  assert.equal(waypointUrl('1582573'), 'https://www.familysearch.org/platform/records/collections/1582573/waypoints');
  assert.equal(
    waypointUrl('9GRZ-FMD:113331301,113331302,113605501', '1582573'),
    'https://www.familysearch.org/platform/records/waypoints/9GRZ-FMD:113331301,113331302,113605501?cc=1582573',
  );
  assert.equal(
    waypointUrl('https://familysearch.org/ark:/61903/3:1:S3HT-6SD7-6?cc=1582573&wc=9GRZ-FMD%3A113331301%2C113331302%2C113605501'),
    'https://www.familysearch.org/platform/records/waypoints/9GRZ-FMD:113331301,113331302,113605501?cc=1582573',
  );
  assert.throws(() => waypointUrl('https://evil.example/platform/records/waypoints/9GRZ-FMD:1'));
  assert.throws(() => waypointUrl('../../etc'));
});

test('parseWaypoint separates sub-folders from images and builds the path', () => {
  const listing = parseWaypoint('u', {
    description: '#src_1',
    sourceDescriptions: [
      { id: 'src_1', componentOf: { description: '#src_2' }, titles: [{ value: 'Matrimônios 1889' }], resourceType: 'http://gedcomx.org/Collection', about: 'https://sg30p0.familysearch.org/platform/records/waypoints/A' },
      { id: 'src_2', titles: [{ value: 'Rio Claro' }], resourceType: 'http://gedcomx.org/Collection' },
      { id: 'sd_5', componentOf: { description: '#src_1' }, about: 'https://www.familysearch.org/ark:/61903/3:1:S3HT-6SDN-W8?cc=1', resourceType: 'http://gedcomx.org/DigitalArtifact' },
      { id: 'sd_6', componentOf: { description: '#src_1' }, about: 'https://www.familysearch.org/ark:/61903/3:1:S3HT-6SD4-H7?cc=1', resourceType: 'http://gedcomx.org/DigitalArtifact' },
      { id: 'sd_7', componentOf: { description: '#src_1' }, about: 'https://sg30p0.familysearch.org/platform/records/waypoints/B', titles: [{ value: 'Índice' }], resourceType: 'http://gedcomx.org/Collection' },
    ],
  });
  assert.deepEqual(listing.path, ['Rio Claro', 'Matrimônios 1889']);
  assert.deepEqual(listing.images, [{ imageNumber: 1, imageId: '3:1:S3HT-6SDN-W8' }, { imageNumber: 2, imageId: '3:1:S3HT-6SD4-H7' }]);
  assert.deepEqual(listing.children, [{ title: 'Índice', url: 'https://www.familysearch.org/platform/records/waypoints/B' }]);
});

test('parseImageData resolves parents and grandparents of the principals', () => {
  const person = (id: string, name: string, gender: string, principal = false) => ({
    id, principal, names: [{ nameForms: [{ fullText: name }] }], gender: { type: `http://gedcomx.org/${gender}` },
    identifiers: principal ? { 'http://gedcomx.org/Persistent': [`https://www.familysearch.org/ark:/61903/1:1:${id.toUpperCase()}`] } : undefined,
  });
  const pc = (parent: string, child: string) => ({ type: 'http://gedcomx.org/ParentChild', person1: { resource: `#${parent}` }, person2: { resource: `#${child}` } });
  const page = parseImageData('3:1:S3HT-6SDK-MF', {
    meta: { links: { self: { offset: 83, results: 202 }, next: { href: 'https://www.familysearch.org/ark:/61903/3:1:S3HT-6SD3-PV?cc=1' } }, sourceDescriptions: [{ citations: [{ value: '<i>x</i> image 83' }] }] },
    records: [{
      links: { self: { href: 'https://www.familysearch.org/ark:/61903/1:2:QR92-4P8P' } },
      fields: [{ type: 'http://familysearch.org/types/fields/SourceEntryNbr', values: [{ text: '60', type: 'http://gedcomx.org/Original' }] }],
      persons: [
        person('kid', 'Maria', 'Female', true),
        person('dad', 'Symphronio Marcellino', 'Male'),
        person('mom', 'Antonia Maria da Conceição', 'Female'),
        person('gf', 'José Marcellino', 'Male'),
        person('wit', 'Testemunha', 'Male'),
      ],
      relationships: [pc('dad', 'kid'), pc('mom', 'kid'), pc('gf', 'dad'),
        { type: 'http://gedcomx.org/Couple', person1: { resource: '#dad' }, person2: { resource: '#mom' }, facts: [{ type: 'http://gedcomx.org/Marriage', date: { original: '7 Dez 1891' } }] }],
    }],
  });
  assert.equal(page.imageNumber, 83);
  assert.equal(page.totalImages, 202);
  assert.equal(page.nextImageId, '3:1:S3HT-6SD3-PV');
  assert.equal(page.citation, 'x image 83');
  const [record] = page.records;
  assert.equal(record.recordId, 'QR92-4P8P');
  assert.equal(record.entryNumber, '60');
  assert.equal(record.principals[0].father, 'Symphronio Marcellino');
  assert.equal(record.principals[0].mother, 'Antonia Maria da Conceição');
  assert.equal(record.principals[0].personaId, 'KID');
  assert.deepEqual(record.principals[0].grandparents, ['José Marcellino (paternal)']);
  assert.deepEqual(record.others, ['Testemunha']);
  assert.ok(recordMatches(record, 'sinfr, symphr'));
  assert.ok(!recordMatches(record, 'garutti'));
  assert.match(formatIndexedRecord(record), /Marriage: 7 Dez 1891/);
});

test('cropJpeg crops by fractions, never upscales and caps the width', () => {
  const width = 400;
  const height = 200;
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const x = i % width;
    data[i * 4] = x < width / 2 ? 0 : 255;
    data[i * 4 + 1] = data[i * 4];
    data[i * 4 + 2] = data[i * 4];
    data[i * 4 + 3] = 255;
  }
  const source = jpeg.encode({ data, width, height }, 90).data;

  const right = cropJpeg(source, { x: 0.5, width: 0.5 });
  assert.deepEqual(right.region, { x: 200, y: 0, width: 200, height: 200 });
  assert.equal(right.width, 200);
  const decoded = jpeg.decode(right.jpeg, { useTArray: true });
  assert.ok(decoded.data[0] > 200, 'right half is white');

  const small = cropJpeg(source, { maxWidth: 100 });
  assert.equal(small.width, 100);
  assert.equal(small.height, 50);

  const enhanced = cropJpeg(source, { enhance: true });
  assert.equal(enhanced.sourceWidth, 400);
});
