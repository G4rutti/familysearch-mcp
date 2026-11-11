import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyFullTextMatchMode,
  assertFamilySearchId,
  FamilySearchSessionClient,
  formatMergeAnalysis,
  formatPersonSources,
  isFamilySearchUrl,
  normalizeName,
  surnamesAlike,
} from './session-client.js';

test('applyFullTextMatchMode supports OR, AND, and exact phrase searches', () => {
  assert.equal(applyFullTextMatchMode('Ebel Hanses', 'any'), 'Ebel Hanses');
  assert.equal(applyFullTextMatchMode('Ebel Hanses', 'all'), '+Ebel +Hanses');
  assert.equal(applyFullTextMatchMode('Ebel Hanses', 'exact'), '"Ebel Hanses"');
  assert.equal(applyFullTextMatchMode('"Ebel Hanses"', 'exact'), '"Ebel Hanses"');
});

test('searchFullText maps filters and returns OCR metadata', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';

  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      results: 42,
      index: 10,
      links: { next: { href: 'https://example.test/next' } },
      entries: [{
        id: '3:1:TEST-ID',
        sourceUrl: 'https://www.familysearch.org/ark:/61903/3:1:TEST-ID',
        collectionId: 'COLLECTION-1',
        collectionTitle: 'Test collection',
        content: {
          title: 'Test document',
          recordDate: '1750',
          recordType: 'Court records',
          recordPlace: 'Leeuwarden',
          textDocument: 'Full OCR transcript',
          highlightTexts: ['Leeuwarden'],
          entities: [{ type: 'PLACE', value: 'Leeuwarden' }],
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const client = new FamilySearchSessionClient({ cookies: 'session=test', minIntervalMs: 0, maxRetries: 0 });
    const result = await client.searchFullText({
      keywords: 'voogd',
      fullName: 'Jan de Vries',
      place: 'Leeuwarden',
      yearFrom: 1700,
      yearTo: 1800,
      imageGroupNumber: '008903222',
      collectionId: 'COLLECTION-1',
      limit: 5,
      offset: 10,
      matchMode: 'all',
    });

    const url = new URL(requestedUrl);
    assert.equal(url.pathname, '/service/search/fulltext/search');
    assert.equal(url.searchParams.get('q.text'), '+voogd');
    assert.equal(url.searchParams.get('q.fullName'), '+Jan +de +Vries');
    assert.equal(url.searchParams.get('q.anyPlace'), 'Leeuwarden');
    assert.equal(url.searchParams.get('q.anyDate.from'), '1700');
    assert.equal(url.searchParams.get('q.anyDate.to'), '1800');
    assert.equal(url.searchParams.get('q.groupName'), '008903222');
    assert.equal(url.searchParams.get('f.collectionId'), 'COLLECTION-1');
    assert.equal(url.searchParams.get('count'), '5');
    assert.equal(url.searchParams.get('offset'), '10');

    assert.equal(result.total, 42);
    assert.equal(result.offset, 10);
    assert.equal(result.entries[0]?.transcript, 'Full OCR transcript');
    assert.equal(result.entries[0]?.sourceUrl, 'https://www.familysearch.org/ark:/61903/3:1:TEST-ID');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('enters a cooldown after an error 15 block and stops calling fetch', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ errorCode: 15 }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const client = new FamilySearchSessionClient({
      cookies: 'session=test',
      minIntervalMs: 0,
      maxRetries: 0,
      cooldownMs: 60_000,
    });
    await assert.rejects(() => client.searchPersons({ surname: 'Smith' }), /error 15/i);
    await assert.rejects(() => client.searchPersons({ surname: 'Smith' }), /Paused to avoid an IP block/i);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('honors the Retry-After header on retryable responses', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const start = Date.now();
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ message: 'slow down' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '1' },
      });
    }
    return new Response(JSON.stringify({ entries: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const client = new FamilySearchSessionClient({
      cookies: 'session=test',
      minIntervalMs: 0,
      maxRetries: 1,
      cooldownMs: 0,
    });
    const result = await client.searchPersons({ surname: 'Smith' });
    assert.deepEqual(result, []);
    assert.equal(calls, 2);
    assert.ok(Date.now() - start >= 900, 'expected to wait for the Retry-After delay');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchCatalog maps DGS searches and catalog metadata', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      totalHits: 1,
      offset: 0,
      searchHits: [{
        metadataHit: {
          score: 12,
          metadata: {
            identifier: { value: 'https://www.familysearch.org/service/search/catalog/item/koha:123' },
            title: [{ value: 'Test register' }],
            creator: [{ value: 'Test archive' }],
            subject: [{ value: 'Church records' }],
            coverage: [{ place: 'Leeuwarden', datesOrig: '1600-1700' }],
          },
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const client = new FamilySearchSessionClient({ cookies: 'session=test', minIntervalMs: 0, maxRetries: 0 });
    const result = await client.searchCatalog({ filmNumber: '008903222', keywords: 'trouwregister', limit: 2 });
    const url = new URL(requestedUrl);
    assert.equal(url.pathname, '/service/search/catalog/v3/search');
    assert.equal(url.searchParams.get('q.filmNumber'), '8903222');
    assert.equal(url.searchParams.get('q.keywords'), 'trouwregister');
    assert.equal(url.searchParams.get('m.defaultFacets'), 'on');
    assert.equal(url.searchParams.get('m.queryRequireDefault'), 'on');
    assert.equal(result.total, 1);
    assert.equal(result.entries[0]?.title, 'Test register');
    assert.equal(result.entries[0]?.url, 'https://www.familysearch.org/en/search/catalog/koha:123');
    assert.deepEqual(result.entries[0]?.coverage, ['Leeuwarden; 1600-1700']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---- Combined fork: family shape, record search, security guards ----

function mockFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fastClient = () =>
  new FamilySearchSessionClient({ cookies: 'fssessionid=abc; other=1', minIntervalMs: 0, maxRetries: 0 });

test('assertFamilySearchId accepts tree/record IDs and rejects path tricks', () => {
  for (const id of ['GJZ7-7SH', 'P7CH-Q3T', 'QK1V-3Q9N', 'MXYZ-ABC1']) {
    assert.equal(assertFamilySearchId(id), id);
  }
  for (const bad of ['', '../v8/person', 'GJZ7-7SH/notes', 'GJZ7 7SH', 'a?b=c', 'https://evil.test', 'GJZ7-7SH#x']) {
    assert.throws(() => assertFamilySearchId(bad), /Invalid FamilySearch/);
  }
});

test('isFamilySearchUrl only allows https on familysearch.org and its subdomains', () => {
  assert.equal(isFamilySearchUrl(new URL('https://www.familysearch.org/x')), true);
  assert.equal(isFamilySearchUrl(new URL('https://familysearch.org/x')), true);
  assert.equal(isFamilySearchUrl(new URL('https://sg30p0.familysearch.org/x')), true);
  assert.equal(isFamilySearchUrl(new URL('http://www.familysearch.org/x')), false);
  assert.equal(isFamilySearchUrl(new URL('https://familysearch.org.evil.test/x')), false);
  assert.equal(isFamilySearchUrl(new URL('https://evilfamilysearch.org/x')), false);
});

test('never sends cookies to a non-FamilySearch URL taken from a response', async () => {
  const mock = mockFetch((url) => {
    if (url.pathname.startsWith('/platform/records/personas/')) {
      return json({
        persons: [{ id: 'p1', principal: true, names: [{ nameForms: [{ fullText: 'Serafim Diniz' }] }] }],
        sourceDescriptions: [{ resourceType: 'http://gedcomx.org/Record', about: 'https://evil.test/steal' }],
      });
    }
    throw new Error(`unexpected request to ${url.href}`);
  });
  try {
    const lines = await fastClient().getRecord('QK1V-3Q9N');
    assert.ok(lines.some((line) => line.includes('Serafim Diniz')));
    assert.ok(mock.calls.every((call) => call.url.hostname.endsWith('familysearch.org')));
  } finally {
    mock.restore();
  }
});

test('does not follow a redirect off familysearch.org with the session', async () => {
  const mock = mockFetch((url) => {
    if (url.hostname === 'www.familysearch.org') {
      return new Response(null, { status: 302, headers: { location: 'https://evil.test/collect' } });
    }
    throw new Error(`cookies sent to ${url.href}`);
  });
  try {
    await assert.rejects(fastClient().getPersonCard('GJZ7-7SH'), /not following it/);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].init?.redirect, 'manual');
  } finally {
    mock.restore();
  }
});

test('rejects malformed IDs before any request is made', async () => {
  const mock = mockFetch(() => json({}));
  try {
    await assert.rejects(fastClient().getPersonDetails('../../service/x'), /Invalid FamilySearch person ID/);
    await assert.rejects(fastClient().getRecord('a/b'), /Invalid FamilySearch record ID/);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

const familyMembers = {
  parents: [
    {
      parent1: { id: 'P001-AAA', name: 'Osvaldo José Diniz', lifespan: '1906–1966' },
      parent2: { id: 'P002-BBB', name: 'Geralda Maria da Silva Diniz', lifespan: '1917–' },
      children: [{ child: { id: 'P7CH-Q3T', name: 'Celio Diniz' } }, { child: { id: 'P003-CCC', name: 'Jozelia Diniz Moura' } }],
    },
  ],
  spouses: [
    {
      parent1: { id: 'P7CH-Q3T', name: 'Celio Diniz' },
      parent2: { id: 'P7C4-V27', name: 'Marieta Sinfronio Diniz' },
      children: [{ child: { id: 'GJZ7-81D', name: 'Weber Alexsandro Diniz', lifespan: '1978–' } }],
      event: { details: { date: { originalText: '1970' }, place: { originalText: 'Barra Mansa' } } },
    },
  ],
};

test('getDescendants reads wrapped children from spouse groups only', async () => {
  const mock = mockFetch((url) => {
    if (url.pathname.endsWith('/card')) return json({ name: 'Celio Diniz', lifespan: '1940–' });
    if (url.pathname.endsWith('/P7CH-Q3T')) return json(familyMembers);
    return json({});
  });
  try {
    const lines = await fastClient().getDescendants('P7CH-Q3T', 1);
    assert.ok(lines.some((line) => line.includes('Child: Weber Alexsandro Diniz')));
    assert.ok(!lines.some((line) => line.includes('Jozelia')), 'siblings must not be listed as descendants');
  } finally {
    mock.restore();
  }
});

test('getFamily lists parents, siblings, spouse with marriage and children', async () => {
  const mock = mockFetch(() => json(familyMembers));
  try {
    const lines = await fastClient().getFamily('P7CH-Q3T');
    assert.ok(lines[0].startsWith('Parents: Osvaldo José Diniz'));
    assert.ok(lines.some((line) => line.includes('Sibling: Jozelia Diniz Moura')));
    assert.ok(!lines.some((line) => line.includes('Sibling: Celio')));
    assert.ok(lines.some((line) => line.includes('Spouse: Marieta Sinfronio Diniz') && line.includes('married 1970, Barra Mansa')));
    assert.ok(lines.some((line) => line.includes('Child: Weber Alexsandro Diniz')));
  } finally {
    mock.restore();
  }
});

test('searchRecords maps parent/spouse/marriage filters and returns facts, relatives and ark', async () => {
  const mock = mockFetch(() =>
    json({
      results: 3,
      entries: [
        {
          id: 'QK1V-3Q9N',
          content: {
            gedcomx: {
              persons: [
                { id: 'mother', names: [{ nameForms: [{ fullText: 'Ana Maria da Conceição' }] }] },
                {
                  id: 'p1',
                  principal: true,
                  gender: { type: 'http://gedcomx.org/Male' },
                  names: [{ nameForms: [{ fullText: 'Serafim José Diniz' }] }],
                  facts: [{ type: 'http://gedcomx.org/Marriage', date: { original: '15 Sep 1908' }, place: { original: 'Aiuruoca, Minas Gerais' } }],
                  sources: [{ description: '#sd1' }],
                },
              ],
              relationships: [
                { type: 'http://gedcomx.org/Couple', person1: { resource: '#p1' }, person2: { resource: '#mother' } },
              ],
              sourceDescriptions: [
                { id: 'sd1', about: 'https://www.familysearch.org/ark:/61903/1:1:QK1V-3Q9N', collection: { title: 'Brasil, Registros da Igreja Católica' } },
              ],
            },
          },
        },
      ],
    }),
  );
  try {
    const { total, records } = await fastClient().searchRecords({
      surname: 'Diniz',
      exactSurname: true,
      marriageYearFrom: '1905',
      marriageYearTo: '1910',
      marriagePlace: 'Aiuruoca',
      spouseGivenName: 'Ana Maria',
      fatherSurname: 'Diniz',
      recordCountry: 'Brazil',
      limit: 500,
    });
    const url = mock.calls[0].url;
    assert.equal(url.searchParams.get('q.surname.exact'), 'on');
    assert.equal(url.searchParams.get('q.marriageLikeDate.from'), '1905');
    assert.equal(url.searchParams.get('q.marriageLikePlace'), 'Aiuruoca');
    assert.equal(url.searchParams.get('q.spouseGivenName'), 'Ana Maria');
    assert.equal(url.searchParams.get('q.fatherSurname'), 'Diniz');
    assert.equal(url.searchParams.get('f.recordCountry'), 'Brazil');
    assert.equal(url.searchParams.get('count'), '100', 'limit is capped at 100');
    assert.equal(total, 3);
    assert.equal(records[0].name, 'Serafim José Diniz');
    assert.equal(records[0].gender, 'Male');
    assert.match(records[0].facts, /Marriage: 15 Sep 1908, Aiuruoca/);
    assert.deepEqual(records[0].relatives, ['Spouse: Ana Maria da Conceição']);
    assert.equal(records[0].collection, 'Brasil, Registros da Igreja Católica');
    assert.equal(records[0].ark, 'https://www.familysearch.org/ark:/61903/1:1:QK1V-3Q9N');
  } finally {
    mock.restore();
  }
});

// ---- Read-only duplicate / merge / source tools ----

const isReadOnly = (calls: Array<{ init?: RequestInit }>) =>
  calls.every((call) => !call.init?.method || call.init.method === 'GET');

test('getPersonSources resolves each reference to its description and keeps the original link', async () => {
  const mock = mockFetch((url) => {
    assert.equal(url.pathname, '/platform/tree/persons/G8BH-KNV/sources');
    return json({
      persons: [
        {
          id: 'G8BH-KNV',
          sources: [
            {
              description: 'https://api.familysearch.org/platform/sources/descriptions/SD-1',
              descriptionId: 'SD-1',
              attribution: { modified: Date.UTC(2025, 11, 16), changeMessage: 'Imigração' },
            },
            { description: '#SD-2' },
          ],
        },
      ],
      sourceDescriptions: [
        {
          id: 'SD-1',
          about: 'http://imagem.sian.an.gov.br/acervo/derivadas/doc.pdf',
          titles: [{ value: 'Imigração ao Brasil – Vapor Roma (1888)' }],
          citations: [{ value: '<i>HRJ</i> 228/257' }],
          notes: [{ text: 'Veio ao Brasil, aos 42 anos, casado' }],
        },
        { id: 'SD-2', titles: [{ value: 'Registro civil de Modena' }] },
      ],
    });
  });
  try {
    const sources = await fastClient().getPersonSources('G8BH-KNV');
    assert.equal(sources.length, 2);
    assert.equal(sources[0].title, 'Imigração ao Brasil – Vapor Roma (1888)');
    assert.equal(sources[0].url, 'http://imagem.sian.an.gov.br/acervo/derivadas/doc.pdf');
    assert.equal(sources[0].citation, 'HRJ 228/257');
    assert.equal(sources[0].attachedOn, '2025-12-16');
    assert.deepEqual(sources[0].notes, ['Veio ao Brasil, aos 42 anos, casado']);
    assert.equal(sources[1].title, 'Registro civil de Modena');

    const text = formatPersonSources(sources).join('\n');
    assert.match(text, /2 sources:/);
    assert.match(text, /Link: http:\/\/imagem\.sian\.an\.gov\.br/);
    assert.equal((mock.calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer abc');
    assert.ok(isReadOnly(mock.calls));
  } finally {
    mock.restore();
  }
});

test('getPersonSources treats an empty 204 answer as no sources and validates the ID', async () => {
  const mock = mockFetch(() => new Response(null, { status: 204 }));
  try {
    const sources = await fastClient().getPersonSources('P7CC-25G');
    assert.deepEqual(sources, []);
    assert.deepEqual(formatPersonSources(sources), ['No sources attached.']);
    await assert.rejects(fastClient().getPersonSources('../x'), /Invalid FamilySearch person ID/);
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
  }
});

const mergeCards: Record<string, unknown> = {
  'G494-RV6': {
    name: 'Carmellina Anna Maria Garuti',
    birth: { details: { date: { localizedText: '17 August 1876' }, place: { localizedText: 'Soliera, Modena, Italy' } } },
  },
  'PMJX-JLH': {
    name: 'Crimilina Garut',
    birth: { details: { date: { localizedText: '17 August 1876' }, place: { localizedText: 'Soliera, Modena, Italy' } } },
  },
};

test('analyzeMerge is a GET dry run that reports the warning, copies and conflicts', async () => {
  const mock = mockFetch((url) => {
    if (url.pathname === '/platform/tree/persons/G494-RV6/merges/PMJX-JLH') {
      return new Response(
        JSON.stringify({
          mergeAnalyses: [
            {
              survivorResources: [{ resource: 'https://api.familysearch.org/platform/tree/persons/G494-RV6/conclusions/AAAA' }],
              duplicateResources: [
                { resource: 'https://api.familysearch.org/platform/tree/persons/PMJX-JLH/conclusions/BBBB' },
                { resource: 'https://api.familysearch.org/platform/tree/persons/PMJX-JLH/source-references/CCCC' },
              ],
              conflictingResources: [
                {
                  survivorResource: { resource: 'https://api.familysearch.org/platform/tree/persons/G494-RV6/conclusions/NAME1' },
                  duplicateResource: { resource: 'https://api.familysearch.org/platform/tree/persons/PMJX-JLH/conclusions/NAME2' },
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json', warning: '450 FamilySearch "Can merge, but must switch order"' },
        },
      );
    }
    const id = url.pathname.split('/').at(-2) || '';
    return json(mergeCards[id] || {});
  });
  try {
    const result = await fastClient().analyzeMerge('G494-RV6', 'PMJX-JLH', 'VitalConclusions');
    assert.equal(mock.calls[0].url.searchParams.get('filter'), 'VitalConclusions');
    assert.ok(isReadOnly(mock.calls), 'analysis must never POST');
    // Found against the live API: the merge resource answers 406 to the GEDCOM X media type.
    assert.equal((mock.calls[0].init?.headers as Record<string, string>).Accept, 'application/x-fs-v1+json');
    assert.match(result.warning, /must switch order/);
    assert.deepEqual(result.survivorOnly, ['conclusions/AAAA']);
    assert.deepEqual(result.duplicateOnly, ['conclusions/BBBB', 'source-references/CCCC']);
    assert.deepEqual(result.conflicts, [{ survivor: 'conclusions/NAME1', duplicate: 'conclusions/NAME2' }]);

    const text = formatMergeAnalysis(result, 'VitalConclusions').join('\n');
    assert.match(text, /dry run, nothing was changed/);
    assert.match(text, /Survivor:\s+Carmellina Anna Maria Garuti \[G494-RV6\]/);
    assert.match(text, /Duplicate: Crimilina Garut \[PMJX-JLH\]/);
    assert.match(text, /Warning from FamilySearch/);
    assert.match(text, /Conflicting pairs \(one side must be chosen\): 1/);
  } finally {
    mock.restore();
  }
});

test('analyzeMerge refuses the same person twice and bad IDs before any request', async () => {
  const mock = mockFetch(() => json({}));
  try {
    await assert.rejects(fastClient().analyzeMerge('G494-RV6', 'G494-RV6'), /must be different/);
    await assert.rejects(fastClient().analyzeMerge('G494-RV6', '../x'), /Invalid FamilySearch duplicate person ID/);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test('name helpers treat spelling variants as alike', () => {
  assert.equal(normalizeName('Garutti'), normalizeName('Garuti'));
  assert.equal(normalizeName('Carmellina Anna'), 'carmelina ana');
  assert.equal(surnamesAlike('Costantino Garuti', 'Constante Garutti'), true);
  assert.equal(surnamesAlike('Crimilina Garut', 'Carmellina Garuti'), true);
  assert.equal(surnamesAlike('Diomira di Antonio Cantarelli', 'Diomira Cantarelli'), true);
  assert.equal(surnamesAlike('Costantino Garuti', 'Diomira Cantarelli'), false);
});

// Mirrors the real mess around the Garuti family: the child is linked to three
// parent sets, and two daughters share one birth date.
const duplicateFamily = {
  parents: [
    {
      parent1: { id: 'G8BH-KNV', name: 'Costantino Garuti', gender: 'MALE', lifespan: '1845–' },
      parent2: { id: 'GQKW-XJX', name: 'Diomira Cantarelli', gender: 'FEMALE', lifespan: '1850–' },
      children: [
        { child: { id: 'G494-RV6', name: 'Carmellina Anna Maria Garuti', gender: 'FEMALE', lifespan: '1876–' } },
        { child: { id: 'PMJX-JLH', name: 'Crimilina Garut', gender: 'FEMALE', lifespan: '1876–' } },
        { child: { id: 'GQKW-KXZ', name: 'Angelo Giuseppe Maria Garuti', gender: 'MALE', lifespan: '1877–' } },
      ],
    },
    {
      parent1: { id: 'PFBM-B76', name: 'Constante Garutti', gender: 'MALE', lifespan: '1846–' },
      parent2: { id: 'PFB9-2LS', name: 'Diomira di Antonio Cantarelli', gender: 'FEMALE', lifespan: '1859–' },
      children: [{ child: { id: 'G494-RV6', name: 'Carmellina Anna Maria Garuti', gender: 'FEMALE', lifespan: '1876–' } }],
    },
    {
      parent1: { id: 'G494-PNQ', name: 'Nicolo Garuti', gender: 'MALE', lifespan: '1843–' },
      children: [{ child: { id: 'G494-RV6', name: 'Carmellina Anna Maria Garuti', gender: 'FEMALE', lifespan: '1876–' } }],
    },
  ],
  spouses: [],
};

test('findDuplicates flags look-alike parents and confirms same-date siblings from the cards', async () => {
  const mock = mockFetch((url) => {
    if (url.pathname.includes('/family-members/')) return json(duplicateFamily);
    if (url.pathname.endsWith('/card')) return json(mergeCards[url.pathname.split('/').at(-2) || ''] || {});
    throw new Error(`unexpected request to ${url.href}`);
  });
  try {
    const { findings, unchecked } = await fastClient().findDuplicates('G494-RV6');
    assert.equal(unchecked, 0);
    assert.ok(isReadOnly(mock.calls));

    const strong = findings.filter((finding) => finding.strength === 'strong');
    assert.equal(strong.length, 1);
    assert.deepEqual([...strong[0].ids].sort(), ['G494-RV6', 'PMJX-JLH']);
    assert.match(strong[0].summary, /same birth date \(17 August 1876\) and place \(Soliera, Modena, Italy\)/);

    const possible = findings.filter((finding) => finding.strength === 'possible');
    const pair = (a: string, b: string) =>
      possible.find((finding) => [...finding.ids].sort().join() === [a, b].sort().join());
    assert.match(pair('G8BH-KNV', 'PFBM-B76')?.summary || '', /different given name/);
    assert.match(pair('G8BH-KNV', 'G494-PNQ')?.summary || '', /different given name/);
    assert.match(pair('GQKW-XJX', 'PFB9-2LS')?.summary || '', /same given name/);
    assert.equal(pair('G8BH-KNV', 'GQKW-XJX'), undefined, 'a father and a mother are not duplicates');
    assert.equal(possible.length, 4);
  } finally {
    mock.restore();
  }
});

test('findDuplicates drops same-year siblings whose exact birth dates differ and honours the card cap', async () => {
  const family = {
    parents: [
      {
        parent1: { id: 'P001-AAA', name: 'Pai Teste', gender: 'MALE', lifespan: '1840–' },
        children: [
          { child: { id: 'C001-AAA', name: 'Gêmea Um', gender: 'FEMALE', lifespan: '1880–' } },
          { child: { id: 'C002-BBB', name: 'Gêmea Dois', gender: 'FEMALE', lifespan: '1880–' } },
        ],
      },
    ],
  };
  const cards: Record<string, unknown> = {
    'C001-AAA': { name: 'Gêmea Um', birth: { details: { date: { localizedText: '2 March 1880' } } } },
    'C002-BBB': { name: 'Gêmea Dois', birth: { details: { date: { localizedText: '9 November 1880' } } } },
  };
  const mock = mockFetch((url) => {
    if (url.pathname.includes('/family-members/')) return json(family);
    return json(cards[url.pathname.split('/').at(-2) || ''] || {});
  });
  try {
    const checked = await fastClient().findDuplicates('C001-AAA');
    assert.deepEqual(checked.findings, []);
    assert.equal(checked.unchecked, 0);

    const capped = await fastClient().findDuplicates('C001-AAA', 0);
    assert.deepEqual(capped.findings, []);
    assert.equal(capped.unchecked, 1);
  } finally {
    mock.restore();
  }
});
