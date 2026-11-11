import {
  cropJpeg,
  isBotChallengePage,
  parseImageData,
  parseImageId,
  parseWaypoint,
  waypointUrl,
  type CropOptions,
  type CropResult,
  type ImageDataResponse,
  type ImageIndexPage,
  type WaypointListing,
  type WaypointResponse,
} from './image-tools.js';

const BASE_URL = 'https://www.familysearch.org';

// FamilySearch tree person IDs (e.g. GJZ7-7SH) and record persona IDs
// (e.g. QK1V-3Q9N) are short alphanumeric tokens with dashes. They are
// interpolated into URL paths, so anything else is rejected rather than
// letting a crafted value walk to another endpoint with the user's cookies.
const ID_PATTERN = /^[A-Za-z0-9]{1,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/;

export function assertFamilySearchId(value: string, label = 'ID'): string {
  const id = String(value || '').trim();
  if (!ID_PATTERN.test(id)) {
    throw new FamilySearchSessionError(`Invalid FamilySearch ${label}: ${JSON.stringify(value)}`, 400);
  }
  return id;
}

export function isFamilySearchUrl(url: URL): boolean {
  return url.protocol === 'https:' && (url.hostname === 'familysearch.org' || url.hostname.endsWith('.familysearch.org'));
}

export class FamilySearchSessionError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'FamilySearchSessionError';
  }
}

interface CardEventDetails {
  date?: { originalText?: string; localizedText?: string };
  place?: { originalText?: string; localizedText?: string };
}

interface CardEvent {
  details?: CardEventDetails;
}

export interface PersonCard {
  id?: string;
  name?: string;
  gender?: string;
  lifespan?: string;
  birth?: CardEvent;
  death?: CardEvent;
  living?: boolean;
  mePersonCisId?: string;
  genderConclusion?: { details?: { gender?: string } };
}

export function formatCardEvent(event?: CardEvent): { date?: string; place?: string } {
  return {
    date: event?.details?.date?.localizedText || event?.details?.date?.originalText,
    place: event?.details?.place?.localizedText || event?.details?.place?.originalText,
  };
}

export function formatCardBirthDeath(card: PersonCard): { birth: string; death: string } {
  const birthDetails = formatCardEvent(card.birth);
  const birth =
    birthDetails.date || birthDetails.place
      ? `${birthDetails.date || 'Unknown date'} - ${birthDetails.place || 'Unknown place'}`
      : 'Unknown';

  if (card.living) {
    return { birth, death: 'Living' };
  }

  const deathDetails = formatCardEvent(card.death);
  const death =
    deathDetails.date || deathDetails.place
      ? `${deathDetails.date || 'Unknown date'} - ${deathDetails.place || 'Unknown place'}`
      : 'Unknown';

  return { birth, death };
}

interface GedcomxName {
  nameForms?: Array<{ fullText?: string }>;
}

interface GedcomxFact {
  type?: string;
  date?: { original?: string };
  place?: { original?: string };
  value?: string;
}

interface GedcomxPerson {
  id?: string;
  principal?: boolean;
  gender?: { type?: string };
  names?: GedcomxName[];
  facts?: GedcomxFact[];
  fields?: Array<{ type?: string; values?: Array<{ type?: string; text?: string }> }>;
  sources?: Array<{ description?: string }>;
}

interface SourceDescription {
  id?: string;
  about?: string;
  titles?: Array<{ value?: string }>;
  collection?: { title?: string };
  resourceType?: string;
  citations?: Array<{ value?: string }>;
  notes?: Array<{ text?: string }>;
}

// GEDCOM X "source reference" as returned by /platform/tree/persons/{id}/sources.
interface PlatformSourceReference {
  description?: string;
  descriptionId?: string;
  attribution?: { modified?: number; changeMessage?: string };
}

interface PlatformSourcesResponse {
  persons?: Array<{ id?: string; sources?: PlatformSourceReference[] }>;
  sourceDescriptions?: SourceDescription[];
}

export interface PersonSource {
  id: string;
  title: string;
  citation: string;
  url: string;
  notes: string[];
  attachedOn: string;
  changeMessage: string;
}

export type MergeAnalysisFilter =
  | 'CoupleRelationships'
  | 'NonVitalConclusions'
  | 'ParentChildRelationshipsAsChild'
  | 'ParentChildRelationshipsAsParent'
  | 'SourceReferences'
  | 'VitalConclusions';

interface MergeResourceRef {
  resource?: string;
}

interface MergeAnalysisResponse {
  mergeAnalyses?: Array<{
    survivorResources?: MergeResourceRef[];
    duplicateResources?: MergeResourceRef[];
    conflictingResources?: Array<{ survivorResource?: MergeResourceRef; duplicateResource?: MergeResourceRef }>;
  }>;
}

export interface MergeAnalysisResult {
  survivor: PersonCard;
  duplicate: PersonCard;
  warning: string;
  survivorOnly: string[];
  duplicateOnly: string[];
  conflicts: Array<{ survivor: string; duplicate: string }>;
}

export interface DuplicateFinding {
  strength: 'strong' | 'possible';
  ids: [string, string];
  summary: string;
}

interface GedcomxRecord {
  persons?: GedcomxPerson[];
  relationships?: Array<{
    type?: string;
    person1?: { resource?: string };
    person2?: { resource?: string };
    facts?: GedcomxFact[];
  }>;
  sourceDescriptions?: SourceDescription[];
}

interface HrPersonasResponse {
  entries?: Array<{
    id?: string;
    title?: string;
    content?: {
      gedcomx?: GedcomxRecord & { description?: string | { title?: string } };
    };
  }>;
  results?: number;
  gedcomx?: { sourceDescriptions?: SourceDescription[] };
}

export interface HistoricalRecordResult {
  id: string;
  name: string;
  gender: string;
  facts: string;
  relatives: string[];
  collection: string;
  ark: string;
  url: string;
  sourceDescriptionId: string;
}

interface FullTextEntity {
  type?: string;
  value?: string;
}

interface FullTextSearchEntry {
  id?: string;
  sourceUrl?: string;
  collectionId?: string;
  collectionTitle?: string;
  content?: {
    recordDate?: string;
    recordType?: string;
    recordPlace?: string;
    title?: string;
    textDocument?: string;
    entities?: FullTextEntity[];
    highlightTexts?: string[];
  };
}

interface FullTextSearchResponse {
  entries?: FullTextSearchEntry[];
  index?: number;
  results?: number;
  links?: { next?: { href?: string } };
}

export interface FullTextSearchResult {
  id: string;
  title: string;
  collectionId: string;
  collectionTitle: string;
  recordDate: string;
  recordType: string;
  recordPlace: string;
  transcript: string;
  highlights: string[];
  entities: Array<{ type: string; value: string }>;
  sourceUrl: string;
}

export interface FullTextSearchResults {
  total: number;
  offset: number;
  nextUrl: string;
  entries: FullTextSearchResult[];
}

export type FullTextMatchMode = 'any' | 'all' | 'exact';

export function applyFullTextMatchMode(value: string, mode: FullTextMatchMode = 'any'): string {
  const trimmed = value.trim();
  if (!trimmed || mode === 'any') return trimmed;
  if (mode === 'exact') {
    return `"${trimmed.replace(/^"|"$/g, '').replace(/"/g, '\\"')}"`;
  }
  return trimmed
    .match(/"[^"]+"|\S+/g)
    ?.map((term) => (term.startsWith('+') || term.startsWith('-') ? term : `+${term}`))
    .join(' ') || '';
}

interface CatalogMetadata {
  identifier?: { value?: string };
  title?: Array<{ value?: string }>;
  creator?: Array<{ value?: string }>;
  contributor?: Array<{ value?: string }>;
  subject?: Array<{ value?: string }>;
  coverage?: Array<{ place?: string; datesOrig?: string }>;
  repositoryCalls?: Array<{ title?: string }>;
}

interface CatalogSearchResponse {
  totalHits?: number;
  offset?: number;
  searchHits?: Array<{ metadataHit?: { metadata?: CatalogMetadata; score?: number } }>;
}

export interface CatalogSearchResult {
  title: string;
  identifier: string;
  url: string;
  creators: string[];
  subjects: string[];
  coverage: string[];
  holdings: string[];
  score: number;
}

export interface CatalogSearchResults {
  total: number;
  offset: number;
  entries: CatalogSearchResult[];
}

function extractRecords(data: HrPersonasResponse): HistoricalRecordResult[] {
  const globalSources = data.gedcomx?.sourceDescriptions || [];

  return (data.entries || []).map((record) => {
    const gedcomx = record.content?.gedcomx;
    const primaryPerson = gedcomx?.persons?.find((person) => person.principal) || gedcomx?.persons?.[0];

    const sources = [...(gedcomx?.sourceDescriptions || []), ...globalSources];
    const sourceRef = primaryPerson?.sources?.[0]?.description?.replace(/^#/, '');
    const source = sources.find((entry) => entry.id === sourceRef) || sources[0];
    const ark = source?.about || '';
    const sourceTitle = source?.titles?.[0]?.value;
    const descriptionTitle =
      typeof gedcomx?.description === 'object' ? gedcomx?.description?.title : undefined;
    const collection =
      source?.collection?.title ||
      collectionTitle(gedcomx) ||
      descriptionTitle ||
      sourceTitle ||
      'Unknown collection';

    return {
      id: record.id || 'Unknown',
      name: primaryPerson ? personName(primaryPerson) : record.title || 'Unknown',
      gender: gedcomxType(primaryPerson?.gender?.type) || 'Unknown',
      facts: primaryPerson ? formatFacts(primaryPerson) : '',
      relatives: primaryPerson && gedcomx ? describeRelatives(gedcomx, primaryPerson) : [],
      collection,
      ark,
      url: ark,
      sourceDescriptionId: source?.id || '',
    };
  });
}

export interface SessionClientOptions {
  sessionId?: string;
  fsAnid?: string;
  cookies?: string;
  minIntervalMs?: number;
  maxRetries?: number;
  jitterFactor?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  cooldownMs?: number;
}

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

interface RequestInitLite {
  method?: string;
  body?: string;
}

const BROWSER_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://www.familysearch.org',
  Referer: 'https://www.familysearch.org/en/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'sec-ch-ua': '"Chromium";v="144", "Not(A:Brand";v="24", "Google Chrome";v="144"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'User-Agent': BROWSER_USER_AGENT,
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// Deliberately conservative defaults: FamilySearch blocks clients that issue
// requests too quickly (error 15), so we space calls out and pause entirely
// after a rate-limit/security signal. Every value can be tuned with the
// FAMILYSEARCH_* environment variables.
const DEFAULT_MIN_INTERVAL_MS = envInt('FAMILYSEARCH_MIN_INTERVAL_MS', 4000);
const DEFAULT_MAX_RETRIES = envInt('FAMILYSEARCH_MAX_RETRIES', 2);
const DEFAULT_JITTER_FACTOR = envFloat('FAMILYSEARCH_JITTER_FACTOR', 0.5);
const DEFAULT_BACKOFF_BASE_MS = envInt('FAMILYSEARCH_BACKOFF_MS', 3000);
const DEFAULT_BACKOFF_MAX_MS = envInt('FAMILYSEARCH_BACKOFF_MAX_MS', 60_000);
const DEFAULT_COOLDOWN_MS = envInt('FAMILYSEARCH_COOLDOWN_MS', 15 * 60_000);
// Full-resolution scans are several MB each, so they get a wider spacing than API calls.
const DEFAULT_IMAGE_INTERVAL_MS = envInt('FAMILYSEARCH_IMAGE_INTERVAL_MS', 8000);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasErrorCode(data: unknown, code: string): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'errorCode' in data &&
    String((data as { errorCode?: string | number }).errorCode) === code
  );
}

function isUnauthorized(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'status' in data &&
    (data as { status?: string }).status === 'UNAUTHORIZED'
  );
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export class FamilySearchSessionClient {
  private cookies: string;
  private sessionId: string;
  private minIntervalMs: number;
  private maxRetries: number;
  private jitterFactor: number;
  private backoffBaseMs: number;
  private backoffMaxMs: number;
  private cooldownMs: number;
  private lastRequestAt = 0;
  private lastBinaryAt = 0;
  private throttleQueue: Promise<void> = Promise.resolve();
  private cooldownUntil = 0;
  private cooldownReason = '';

  constructor(options: SessionClientOptions) {
    this.cookies = options.cookies || buildCookieHeader(options.sessionId, options.fsAnid);
    this.sessionId = options.sessionId || extractCookieValue(this.cookies, 'fssessionid');
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.jitterFactor = options.jitterFactor ?? DEFAULT_JITTER_FACTOR;
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.backoffMaxMs = options.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  isAuthenticated(): boolean {
    return Boolean(this.cookies);
  }

  setSession(sessionId: string, fsAnid?: string, cookies?: string): void {
    this.cookies = cookies || buildCookieHeader(sessionId, fsAnid);
    this.sessionId = sessionId || extractCookieValue(this.cookies, 'fssessionid');
  }

  private cookieHeader(): string {
    return this.cookies;
  }

  private async throttle(): Promise<void> {
    const previous = this.throttleQueue;
    let release!: () => void;
    this.throttleQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      // Add jitter proportional to the configured interval so requests do not
      // arrive at a perfectly regular, bot-like cadence.
      const interval = this.minIntervalMs * (1 + this.jitterFactor * Math.random());
      const wait = interval - (Date.now() - this.lastRequestAt);
      if (wait > 0) {
        await sleep(wait);
      }
      this.lastRequestAt = Date.now();
    } finally {
      release();
    }
  }

  private backoffMs(attempt: number): number {
    const base = Math.min(this.backoffBaseMs * 2 ** attempt, this.backoffMaxMs);
    return Math.round(base + base * 0.2 * Math.random());
  }

  private retryAfterMs(response: Response): number | null {
    const header = response.headers.get('retry-after');
    if (!header) return null;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
  }

  private enterCooldown(ms: number, reason: string): void {
    const until = Date.now() + ms;
    if (until > this.cooldownUntil) {
      this.cooldownUntil = until;
      this.cooldownReason = reason;
    }
  }

  private cooldownError(): FamilySearchSessionError | null {
    if (this.cooldownUntil <= Date.now()) return null;
    const remaining = Math.ceil((this.cooldownUntil - Date.now()) / 1000);
    return new FamilySearchSessionError(
      `Paused to avoid an IP block (${this.cooldownReason}); ${remaining}s remaining. ` +
        'Wait for the cooldown to finish, then re-run login-with-browser if the session has expired.',
      429,
    );
  }

  private async pauseForRetry(response: Response | null, attempt: number, reason: string): Promise<void> {
    const retryAfter = response ? this.retryAfterMs(response) : null;
    if (retryAfter && retryAfter > 0) {
      this.enterCooldown(retryAfter, reason);
    }
    await sleep(retryAfter ?? this.backoffMs(attempt));
  }

  // Most /platform/ resources answer GEDCOM X; the merge resource only answers
  // the FamilySearch media type and returns 406 for the other one.
  private async platformRequest<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    inspect?: (response: Response) => void,
    accept = 'application/x-gedcomx-v1+json',
  ): Promise<T> {
    if (!this.sessionId) {
      throw new FamilySearchSessionError('No fssessionid in session cookies. Re-run login-with-browser.', 401);
    }
    return this.request<T>(
      path,
      params,
      {
        Accept: accept,
        Authorization: `Bearer ${this.sessionId}`,
      },
      inspect,
    );
  }

  // `inspect` sees every raw response (status, headers) before it is parsed or
  // turned into an error, e.g. to read the Warning header of a merge analysis.
  private async request<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    extraHeaders: Record<string, string> = {},
    inspect?: (response: Response) => void,
    init: RequestInitLite = {},
  ): Promise<T> {
    if (!this.cookies) {
      throw new FamilySearchSessionError('Not authenticated. Set a browser session cookie first.');
    }

    const cooldown = this.cooldownError();
    if (cooldown) throw cooldown;

    const url = new URL(path.startsWith('http') ? path : `${BASE_URL}${path}`);
    // Absolute URLs can come from API responses; never send the session to another host.
    if (!isFamilySearchUrl(url)) {
      throw new FamilySearchSessionError(`Refusing to send the FamilySearch session to ${url.origin} (only https://*.familysearch.org)`);
    }
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.throttle();

      let response: Response;
      try {
        // Redirects are followed by hand so a 3xx can never carry the cookies
        // to a host outside familysearch.org.
        response = await this.fetchFamilySearch(
          url,
          {
            ...BROWSER_HEADERS,
            Cookie: this.cookieHeader(),
            ...extraHeaders,
          },
          init,
        );
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries) {
          await sleep(this.backoffMs(attempt));
          continue;
        }
        throw new FamilySearchSessionError(
          `Network error contacting ${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      inspect?.(response);
      const text = await response.text();
      let data: unknown;
      const contentType = response.headers.get('content-type') || '';
      try {
        data = text && (contentType.includes('json') || /^[\[{]/.test(text.trim())) ? JSON.parse(text) : text;
      } catch {
        // A few legacy DAS endpoints advertise application/json but return a
        // bare identifier such as TH-123 instead of a JSON string.
        if (response.ok && !/^[\[{]/.test(text.trim())) {
          data = text;
        } else {
          const parseError = new FamilySearchSessionError(
            `Invalid JSON response (${response.status}) from ${path}: ${text.slice(0, 200)}`,
            response.status,
          );
          if (isRetryableStatus(response.status) && attempt < this.maxRetries) {
            lastError = parseError;
            await this.pauseForRetry(response, attempt, `HTTP ${response.status}`);
            continue;
          }
          throw parseError;
        }
      }

      // FamilySearch-specific errors are handled before the generic !response.ok
      // branch, because they arrive with a non-2xx status that would otherwise
      // mask the useful message. Error 15 is a hard bot-protection block: do not
      // retry it, as hammering only prolongs the block.
      if (hasErrorCode(data, '15')) {
        this.enterCooldown(this.cooldownMs, 'security block (error 15)');
        throw new FamilySearchSessionError(
          'Request blocked by FamilySearch security (error 15). Pausing all requests for a while to avoid a longer IP block. Re-run login-with-browser to refresh cookies, then retry.',
          403,
        );
      }

      if (isUnauthorized(data)) {
        throw new FamilySearchSessionError(String((data as { message?: string }).message || 'Session expired'), 401);
      }

      if (!response.ok) {
        const rawMessage =
          typeof data === 'object' &&
          data !== null &&
          ('message' in data ? String((data as { message?: string }).message) : JSON.stringify(data));
        const message = typeof rawMessage === 'string' ? rawMessage : '';

        if (isRetryableStatus(response.status) && attempt < this.maxRetries) {
          lastError = new FamilySearchSessionError(message, response.status);
          await this.pauseForRetry(response, attempt, `HTTP ${response.status}`);
          continue;
        }

        throw new FamilySearchSessionError(message || `Request failed with status ${response.status}`, response.status);
      }

      return data as T;
    }

    throw lastError instanceof Error
      ? lastError
      : new FamilySearchSessionError(`Request to ${path} failed after ${this.maxRetries + 1} attempts`);
  }

  private async fetchFamilySearch(url: URL, headers: Record<string, string>, init: RequestInitLite = {}): Promise<Response> {
    let current = url;
    for (let hop = 0; hop <= 5; hop++) {
      const response = await fetch(current, { headers, redirect: 'manual', method: init.method || 'GET', body: init.body });
      // Only GETs are re-issued on a redirect; a redirected POST is returned as is.
      if (init.method && init.method !== 'GET') return response;
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get('location');
      if (!location) return response;
      const next = new URL(location, current);
      if (!isFamilySearchUrl(next)) {
        throw new FamilySearchSessionError(
          `FamilySearch redirected to ${next.origin}; not following it with the session cookies. The session may have expired: re-run login-with-browser.`,
          response.status,
        );
      }
      current = next;
    }
    throw new FamilySearchSessionError(`Too many redirects from ${url.pathname}`);
  }

  async validateSession(fallback?: {
    displayName?: string;
    personId?: string;
  }): Promise<{ displayName: string; personId: string; cisId: string }> {
    if (fallback?.personId) {
      try {
        const person = await this.getPersonCard(fallback.personId);
        return {
          displayName: person.name || fallback.displayName || 'Authenticated FamilySearch user',
          personId: fallback.personId,
          cisId: person.mePersonCisId || '',
        };
      } catch {
        // Fall through to search-based validation.
      }
    }
    const data = await this.request<{
      entries?: Array<{
        content?: {
          gedcomx?: {
            persons?: Array<{
              id?: string;
              names?: Array<{ nameForms?: Array<{ fullText?: string }> }>;
            }>;
          };
        };
      }>;
    }>('/service/search/tree/v2/personas', {
      count: 1,
      offset: 0,
      'q.givenName': 'John',
      'q.surname': 'Smith',
    });

    if (!data.entries?.length) {
      throw new FamilySearchSessionError('Session cookie is invalid or expired', 401);
    }

    return {
      displayName: fallback?.displayName || 'Authenticated FamilySearch user',
      personId: fallback?.personId || '',
      cisId: '',
    };
  }

  async searchPersons(params: {
    name?: string;
    givenName?: string;
    surname?: string;
    birthDate?: string;
    birthPlace?: string;
    deathDate?: string;
    deathPlace?: string;
    gender?: 'MALE' | 'FEMALE';
    limit?: number;
    offset?: number;
  }) {
    const query: Record<string, string | number> = {
      count: params.limit || 10,
      offset: params.offset || 0,
      'm.defaultFacets': 'on',
    };

    if (params.givenName) query['q.givenName'] = params.givenName;
    if (params.surname) query['q.surname'] = params.surname;

    if (!params.givenName && !params.surname && params.name) {
      const parts = params.name.trim().split(/\s+/);
      if (parts.length === 1) {
        query['q.surname'] = parts[0];
      } else {
        query['q.givenName'] = parts.slice(0, -1).join(' ');
        query['q.surname'] = parts[parts.length - 1];
      }
    }

    if (params.birthDate) query['q.birthLikeDate.from'] = params.birthDate;
    if (params.birthPlace) query['q.birthLikePlace'] = params.birthPlace;
    if (params.deathDate) query['q.deathLikeDate.from'] = params.deathDate;
    if (params.deathPlace) query['q.deathLikePlace'] = params.deathPlace;
    if (params.gender) query['q.sex'] = params.gender === 'MALE' ? 'Male' : 'Female';

    const data = await this.request<{
      entries?: Array<{
        id?: string;
        title?: string;
        content?: {
          gedcomx?: {
            persons?: Array<{
              gender?: { type?: string };
              names?: Array<{ nameForms?: Array<{ fullText?: string }> }>;
              facts?: Array<{
                type?: string;
                date?: { original?: string };
                place?: { original?: string };
              }>;
            }>;
          };
        };
      }>;
    }>('/service/search/tree/v2/personas', query);

    return (data.entries || []).map((entry) => {
      const person = entry.content?.gedcomx?.persons?.[0];
      const birthEvent = person?.facts?.find((fact) => fact.type === 'http://gedcomx.org/Birth');
      const deathEvent = person?.facts?.find((fact) => fact.type === 'http://gedcomx.org/Death');

      return {
        id: entry.id || 'Unknown',
        name: person?.names?.[0]?.nameForms?.[0]?.fullText || entry.title || 'Unknown',
        gender: person?.gender?.type?.replace('http://gedcomx.org/', '') || 'Unknown',
        birth: birthEvent
          ? `${birthEvent.date?.original || 'Unknown date'} - ${birthEvent.place?.original || 'Unknown place'}`
          : 'Unknown',
        death: deathEvent
          ? `${deathEvent.date?.original || 'Unknown date'} - ${deathEvent.place?.original || 'Unknown place'}`
          : 'Unknown',
      };
    });
  }

  async getPersonCard(personId: string): Promise<PersonCard> {
    personId = assertFamilySearchId(personId, 'person ID');
    return this.request<PersonCard>(`/service/tree/tree-data/v8/person/${personId}/card`, { treeId: 'PRIVATE' });
  }

  async getPersonDetails(personId: string) {
    personId = assertFamilySearchId(personId, 'person ID');
    const [card, notes, family] = await Promise.all([
      this.getPersonCard(personId),
      this.request<{ notes?: unknown[] }>(`/service/tree/tree-data/v8/person/${personId}/notes/all`).catch(() => ({ notes: [] })),
      this.getFamilyMembers(personId).catch(() => ({} as FamilyMembersResponse)),
    ]);

    return { card, notes: notes.notes || [], family };
  }

  async getFamilyMembers(personId: string): Promise<FamilyMembersResponse> {
    personId = assertFamilySearchId(personId, 'person ID');
    return this.request<FamilyMembersResponse>(`/service/tree/tree-data/r9/family-members/person/${personId}`, {
      includePhotos: false,
      treeId: 'PRIVATE',
    });
  }

  async getFamily(personId: string) {
    personId = assertFamilySearchId(personId, 'person ID');
    const family = await this.getFamilyMembers(personId);
    const lines: string[] = [];

    for (const group of family.parents || []) {
      lines.push(`Parents: ${formatSummary(group.parent1)} & ${formatSummary(group.parent2)}${formatMarriage(group)}`);
      for (const { child } of group.children || []) {
        if (child?.id && child.id !== personId) lines.push(`  Sibling: ${formatSummary(child)}`);
      }
    }

    for (const group of family.spouses || []) {
      const spouse = group.parent1?.id === personId ? group.parent2 : group.parent1;
      lines.push(`Spouse: ${formatSummary(spouse)}${formatMarriage(group)}`);
      for (const { child } of group.children || []) {
        if (child?.id) lines.push(`  Child: ${formatSummary(child)}`);
      }
    }

    return lines.length ? lines : ['No family members found.'];
  }

  // The platform /matches endpoint answers 204 for every person, so hints come from the pedigree view.
  async getResearchSuggestions(personId: string, generations = 4) {
    personId = assertFamilySearchId(personId, 'person ID');
    const data = await this.request<{ ancestors?: PedigreeCouple[][]; children?: PedigreeCouple[] }>(
      `/service/tree/tree-data/r9/portrait-pedigree/${personId}`,
      {
        numGenerations: Math.min(Math.max(generations, 1), 8),
        treeId: 'PRIVATE',
        includePhotos: false,
        includeTempleRollupStatus: false,
        includeRecordHints: true,
        includeSpouseAncestry: false,
      },
    );

    const people = new Map<string, PedigreePerson>();
    const coupleLines: string[] = [];
    for (const couple of [...(data.ancestors || []).flat(), ...(data.children || [])]) {
      for (const person of [couple.parent1, couple.parent2]) {
        if (person?.id && !people.has(person.id)) people.set(person.id, person);
      }
      const names = suggestionNames(couple);
      if (names.length) {
        coupleLines.push(`- Couple ${couple.parent1?.name || '?'} & ${couple.parent2?.name || '?'}: ${names.join(', ')}`);
      }
    }

    const lines: string[] = [];
    for (const person of people.values()) {
      const flags = [...(person.hasRecordHints ? ['RECORD_HINTS'] : []), ...suggestionNames(person)];
      if (flags.length) lines.push(`- ${formatSummary(person)}: ${flags.join(', ')}`);
    }
    return [...lines, ...coupleLines];
  }

  async getRecord(recordId: string) {
    recordId = assertFamilySearchId(recordId, 'record ID');
    const persona = await this.platformRequest<GedcomxRecord>(`/platform/records/personas/${recordId}`);

    // A persona only carries its own person; the full record (all persons and
    // relationships) sits behind the 1:2 ark. That URL comes from the response,
    // so request() re-checks it is on familysearch.org before sending cookies.
    const recordUrl = persona.sourceDescriptions?.find((sd) => sd.resourceType === 'http://gedcomx.org/Record')?.about;
    let record: GedcomxRecord | undefined;
    if (recordUrl) {
      record = await this.platformRequest<GedcomxRecord>(recordUrl).catch(() => undefined);
    }
    const source = record?.persons?.length ? record : persona;

    const lines = [`Record: ${recordId}`, `Collection: ${collectionTitle(persona) || 'Unknown'}`];
    const citation = persona.sourceDescriptions?.find((sd) => sd.citations?.length)?.citations?.[0]?.value;
    if (citation) lines.push(`Citation: ${citation.replace(/<[^>]+>/g, '')}`);
    const image = persona.sourceDescriptions?.find((sd) => sd.resourceType === 'http://gedcomx.org/DigitalArtifact')?.about;
    if (image) lines.push(`Image: ${image}`);

    const names = new Map<string, string>();
    for (const person of source.persons || []) {
      names.set(person.id || '', personName(person));
    }

    lines.push('', 'Persons:');
    for (const person of source.persons || []) {
      const gender = gedcomxType(person.gender?.type) || '';
      const role = person.principal ? ' [principal]' : '';
      lines.push(`- ${personName(person)}${gender ? ` (${gender})` : ''}${role}`);
      const facts = formatFacts(person);
      if (facts) lines.push(`    ${facts}`);
      const fields = formatFields(person.fields);
      if (fields) lines.push(`    ${fields}`);
    }

    if (source.relationships?.length) {
      lines.push('', 'Relationships:');
      for (const rel of source.relationships) {
        const p1 = names.get(resourceId(rel.person1)) || rel.person1?.resource || '?';
        const p2 = names.get(resourceId(rel.person2)) || rel.person2?.resource || '?';
        const type = gedcomxType(rel.type) || 'Relationship';
        const facts = (rel.facts || []).map(formatFact).join('; ');
        lines.push(`- ${type}: ${p1} → ${p2}${facts ? ` (${facts})` : ''}`);
      }
    }

    return lines;
  }

  // Read-only: the sources attached to a Family Tree person (the "Sources" tab),
  // including user-created ones whose `about` points to an external archive.
  async getPersonSources(personId: string): Promise<PersonSource[]> {
    personId = assertFamilySearchId(personId, 'person ID');
    const data = await this.platformRequest<PlatformSourcesResponse | string>(`/platform/tree/persons/${personId}/sources`);
    // 204 (no sources) comes back as an empty body.
    if (!data || typeof data !== 'object') return [];

    const descriptions = new Map((data.sourceDescriptions || []).map((sd) => [sd.id || '', sd] as const));
    const person = data.persons?.find((p) => p.id === personId) || data.persons?.[0];
    const refs = person?.sources || [];

    const toSource = (id: string, description?: SourceDescription, ref?: PlatformSourceReference): PersonSource => ({
      id,
      title: description?.titles?.[0]?.value || 'Untitled source',
      citation: (description?.citations?.[0]?.value || '').replace(/<[^>]+>/g, '').trim(),
      url: description?.about || '',
      notes: (description?.notes || []).map((note) => note.text || '').filter(Boolean),
      attachedOn: ref?.attribution?.modified ? new Date(ref.attribution.modified).toISOString().slice(0, 10) : '',
      changeMessage: ref?.attribution?.changeMessage || '',
    });

    if (!refs.length) {
      return [...descriptions].map(([id, description]) => toSource(id, description));
    }
    return refs.map((ref) => {
      const id = ref.descriptionId || ref.description?.split(/[#/]/).pop() || '';
      return toSource(id, descriptions.get(id), ref);
    });
  }

  // Read-only dry run: GET on the merge resource only analyses the merge, it
  // never performs it. Lists what would be copied from each side and which
  // resources conflict. A `Warning` header (e.g. 450 "must switch order") is returned as-is.
  async analyzeMerge(
    survivorId: string,
    duplicateId: string,
    filter?: MergeAnalysisFilter,
  ): Promise<MergeAnalysisResult> {
    survivorId = assertFamilySearchId(survivorId, 'survivor person ID');
    duplicateId = assertFamilySearchId(duplicateId, 'duplicate person ID');
    if (survivorId === duplicateId) {
      throw new FamilySearchSessionError('Survivor and duplicate must be different people.', 400);
    }

    let warning = '';
    const data = await this.platformRequest<MergeAnalysisResponse | string>(
      `/platform/tree/persons/${survivorId}/merges/${duplicateId}`,
      filter ? { filter } : undefined,
      (response) => {
        warning = response.headers.get('warning') || '';
      },
      'application/x-fs-v1+json',
    );
    const analysis = data && typeof data === 'object' ? data.mergeAnalyses?.[0] : undefined;

    const [survivor, duplicate] = await Promise.all([this.getPersonCard(survivorId), this.getPersonCard(duplicateId)]);
    return {
      survivor: { ...survivor, id: survivor.id || survivorId },
      duplicate: { ...duplicate, id: duplicate.id || duplicateId },
      warning,
      survivorOnly: (analysis?.survivorResources || []).map(mergeResourceLabel),
      duplicateOnly: (analysis?.duplicateResources || []).map(mergeResourceLabel),
      conflicts: (analysis?.conflictingResources || []).map((pair) => ({
        survivor: mergeResourceLabel(pair.survivorResource),
        duplicate: mergeResourceLabel(pair.duplicateResource),
      })),
    };
  }

  // Read-only. The platform /matches endpoint answers 204 for every person (see
  // getResearchSuggestions), so duplicates are found from the family structure:
  //  1. a person linked to several sets of parents, where the parents look alike;
  //  2. children of one couple born in the same year, confirmed or ruled out by
  //     comparing exact birth date and place on their person cards.
  async findDuplicates(
    personId: string,
    maxCardChecks = 6,
  ): Promise<{ findings: DuplicateFinding[]; unchecked: number }> {
    personId = assertFamilySearchId(personId, 'person ID');
    const family = await this.getFamilyMembers(personId);
    const findings: DuplicateFinding[] = [];
    const seen = new Set<string>();
    const pairKey = (a: string, b: string) => [a, b].sort().join('|');

    const parentGroups = family.parents || [];
    if (parentGroups.length > 1) {
      const parents: PersonSummary[] = [];
      for (const group of parentGroups) {
        for (const parent of [group.parent1, group.parent2]) {
          if (parent?.id && !parents.some((known) => known.id === parent.id)) parents.push(parent);
        }
      }
      for (let i = 0; i < parents.length; i++) {
        for (let j = i + 1; j < parents.length; j++) {
          const a = parents[i];
          const b = parents[j];
          if (!a.id || !b.id || !looksLikeSameParent(a, b)) continue;
          seen.add(pairKey(a.id, b.id));
          const sameGiven = firstGivenName(a.name) === firstGivenName(b.name);
          findings.push({
            strength: 'possible',
            ids: [a.id, b.id],
            summary:
              `${formatSummary(a)} and ${formatSummary(b)}: both appear as parents of ${personId} ` +
              `(${parentGroups.length} parent sets), similar surname and birth year, ` +
              `${sameGiven ? 'same given name' : 'different given name (could be a brother or a wrong link)'}`,
          });
        }
      }
    }

    const candidates: Array<[PersonSummary, PersonSummary]> = [];
    for (const group of [...parentGroups, ...(family.spouses || [])]) {
      const children = (group.children || [])
        .map((entry) => entry.child)
        .filter((child): child is PersonSummary => Boolean(child?.id));
      for (let i = 0; i < children.length; i++) {
        for (let j = i + 1; j < children.length; j++) {
          const a = children[i];
          const b = children[j];
          const year = birthYear(a);
          if (!year || year !== birthYear(b)) continue;
          if (a.gender && b.gender && a.gender.toUpperCase() !== b.gender.toUpperCase()) continue;
          const key = pairKey(a.id!, b.id!);
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push([a, b]);
        }
      }
    }

    for (const [a, b] of candidates.slice(0, maxCardChecks)) {
      const [cardA, cardB] = await Promise.all([this.getPersonCard(a.id!), this.getPersonCard(b.id!)]);
      const birthA = formatCardEvent(cardA.birth);
      const birthB = formatCardEvent(cardB.birth);
      if (birthA.date && birthB.date && birthA.date.toLowerCase() !== birthB.date.toLowerCase()) continue;

      const sameDate = Boolean(birthA.date && birthB.date);
      const samePlace = Boolean(birthA.place && birthB.place && birthA.place.toLowerCase() === birthB.place.toLowerCase());
      findings.push({
        strength: sameDate ? 'strong' : 'possible',
        ids: [a.id!, b.id!],
        summary:
          `${formatSummary(a)} and ${formatSummary(b)}: same parents, ` +
          (sameDate
            ? `same birth date (${birthA.date})${samePlace ? ` and place (${birthA.place})` : ''}`
            : `same birth year, exact date missing on one side (could be twins)`),
      });
    }

    return { findings, unchecked: Math.max(0, candidates.length - maxCardChecks) };
  }

  async getAncestors(personId: string, generations = 4) {
    personId = assertFamilySearchId(personId, 'person ID');
    const gens = Math.min(Math.max(generations, 1), 8);
    const data = await this.request<{ ancestors?: AncestorGeneration[][] }>(
      `/service/tree/tree-data/r9/portrait-pedigree/${personId}`,
      {
        numGenerations: gens,
        treeId: 'PRIVATE',
        includePhotos: false,
        includeTempleRollupStatus: false,
        includeFullHasSiblings: true,
        includeRecordHints: false,
        includeSpouseAncestry: false,
      },
    );

    const lines: string[] = [];
    const seen = new Set<string>([personId]);
    const formatPerson = (person?: PersonSummary) => {
      if (!person) return 'Unknown';
      const year = person.lifespan?.match(/\d{4}/)?.[0] || person.birth?.date?.match(/\d{4}/)?.[0] || '?';
      return `${person.name || 'Unknown'} (${year}) [${person.id || '?'}]`;
    };
    const addAncestor = (person: PersonSummary | undefined, generation: number) => {
      if (!person?.id || seen.has(person.id)) return;
      seen.add(person.id);
      const prefix = '  '.repeat(generation);
      const relation = person.gender === 'FEMALE' ? 'Mother' : person.gender === 'MALE' ? 'Father' : 'Ancestor';
      lines.push(`${prefix}${relation}: ${formatPerson(person)}`);
    };

    if (!data.ancestors?.length) {
      return [`No ancestors found for person ${personId}`];
    }

    const rootCouple = data.ancestors[0]?.[0];
    const rootPerson = rootCouple?.parent1?.id === personId ? rootCouple.parent1 : rootCouple?.parent2;
    lines.push(`Root: ${formatPerson(rootPerson || { id: personId, name: 'Unknown' })}`);

    for (let generation = 1; generation < data.ancestors.length; generation++) {
      const couples = data.ancestors[generation] || [];
      for (const couple of couples) {
        addAncestor(couple.parent1, generation);
        addAncestor(couple.parent2, generation);
      }
    }

    return lines;
  }

  async getDescendants(personId: string, generations = 2) {
    personId = assertFamilySearchId(personId, 'person ID');
    const gens = Math.min(Math.max(generations, 1), 3);
    const lines: string[] = [];
    const visited = new Set<string>();

    const formatPerson = (person?: PersonSummary) => {
      if (!person) return 'Unknown';
      const year = person.lifespan?.match(/\d{4}/)?.[0] || '?';
      return `${person.name || 'Unknown'} (${year}) [${person.id || '?'}]`;
    };

    const walk = async (currentId: string, depth: number, prefix: string) => {
      if (depth > gens || visited.has(currentId)) return;
      visited.add(currentId);

      const family = await this.getFamilyMembers(currentId);
      const children = new Map<string, PersonSummary>();

      for (const spouseGroup of family.spouses || []) {
        for (const { child } of spouseGroup.children || []) {
          if (child?.id) children.set(child.id, child);
        }
      }

      for (const child of children.values()) {
        lines.push(`${prefix}Child: ${formatPerson(child)}`);
        if (depth < gens && child.id) {
          await walk(child.id, depth + 1, prefix + '  ');
        }
      }
    };

    const root = await this.getPersonCard(personId);
    lines.push(`Root: ${formatPerson({ id: personId, name: root.name, lifespan: root.lifespan })}`);
    await walk(personId, 1, '');

    if (lines.length === 1) {
      lines.push('  No descendants found.');
    }

    return lines;
  }

  async searchRecords(params: RecordSearchParams): Promise<{ total: number; records: HistoricalRecordResult[] }> {
    const query: Record<string, string | number> = {
      count: Math.min(Math.max(params.limit || 10, 1), 100),
      offset: params.offset || 0,
      'm.defaultFacets': 'on',
      'm.facetNestCollectionInCategory': 'on',
      'm.queryRequireDefault': 'on',
    };

    for (const [param, key] of RECORD_SEARCH_PARAMS) {
      const value = params[param];
      if (value) query[key] = value;
    }
    // birthDate/deathDate are open-ended lower bounds kept for older callers;
    // the explicit *YearFrom fields win when both are given.
    if (params.birthDate && !params.birthYearFrom) query['q.birthLikeDate.from'] = params.birthDate;
    if (params.deathDate && !params.deathYearFrom) query['q.deathLikeDate.from'] = params.deathDate;
    if (params.exactSurname) query['q.surname.exact'] = 'on';
    if (params.gender) query['q.sex'] = params.gender === 'MALE' ? 'Male' : 'Female';
    // Restricts the search to one film / image group (DGS). With
    // m.queryRequireDefault=on above it is a hard filter, not a ranking hint.
    if (params.filmNumber) {
      const digits = String(params.filmNumber).replace(/\D/g, '');
      if (!digits || digits.length > 9) throw new FamilySearchSessionError('filmNumber must be a DGS/film number of up to 9 digits', 400);
      query['q.filmNumber'] = digits.padStart(9, '0');
    }

    const data = await this.request<HrPersonasResponse>('/service/search/hr/v2/personas', query);
    const records = extractRecords(data);
    return { total: data.results ?? records.length, records };
  }

  // ---------------------------------------------------------------------------
  // Image viewer endpoints: browse folders (waypoints), the per-image index and
  // crops of the scan. Each call goes through the same throttle as the API.

  private waypointCache = new Map<string, WaypointListing>();

  async browseWaypoint(waypoint: string, collectionId?: string): Promise<WaypointListing> {
    const url = waypointUrl(waypoint, collectionId);
    const cached = this.waypointCache.get(url);
    if (cached) return cached;
    const data = await this.platformRequest<WaypointResponse>(url);
    const listing = parseWaypoint(url, data);
    this.waypointCache.set(url, listing);
    return listing;
  }

  /** imageId wins; otherwise the image at imageNumber (1-based) inside a waypoint. */
  async resolveImageId(locator: { imageId?: string; waypoint?: string; imageNumber?: number }): Promise<string> {
    if (locator.imageId) return parseImageId(locator.imageId);
    if (!locator.waypoint || !locator.imageNumber) {
      throw new FamilySearchSessionError('Provide imageId, or waypoint plus imageNumber.', 400);
    }
    const listing = await this.browseWaypoint(locator.waypoint);
    const image = listing.images[locator.imageNumber - 1];
    if (!image) {
      throw new FamilySearchSessionError(`"${listing.title}" has ${listing.images.length} images; there is no image ${locator.imageNumber}.`, 400);
    }
    return image.imageId;
  }

  /** The viewer's own call: citation, prev/next and every indexed record on one image. */
  async getImageIndexPage(imageId: string): Promise<ImageIndexPage> {
    imageId = parseImageId(imageId);
    const imageURL = `${BASE_URL}/ark:/61903/${imageId}`;
    const data = await this.request<ImageDataResponse>(
      '/search/filmdatainfo/image-data',
      undefined,
      { 'Content-Type': 'application/json', Referer: imageURL },
      undefined,
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'image-data',
          args: { imageURL, locale: 'en', state: { imageOrFilmUrl: '', selectedImageIndex: -1, viewMode: 'i' } },
        }),
      },
    );
    return parseImageData(imageId, data);
  }

  /** Walks `count` images forward from imageId using each image's next link. */
  async getImageIndexRange(imageId: string, count: number): Promise<ImageIndexPage[]> {
    const pages: ImageIndexPage[] = [];
    let current: string | undefined = parseImageId(imageId);
    for (let i = 0; i < count && current; i++) {
      const thisImage: string = current;
      try {
        const page = await this.getImageIndexPage(thisImage);
        pages.push(page);
        current = page.nextImageId;
      } catch (error) {
        pages.push({ imageId: thisImage, records: [], error: error instanceof Error ? error.message : String(error) });
        // Without the response there is no next link to follow.
        break;
      }
    }
    return pages;
  }

  /** Downloads the full-resolution scan and returns a cropped, scaled JPEG. */
  async getImageCrop(imageId: string, options: CropOptions): Promise<CropResult & { imageId: string }> {
    imageId = parseImageId(imageId);
    const original = await this.requestBinary(`/service/records/storage/deepzoomcloud/dz/v1/${imageId}/dist.jpg`);
    return { ...cropJpeg(original, options), imageId };
  }

  private async requestBinary(path: string): Promise<Buffer> {
    if (!this.cookies) {
      throw new FamilySearchSessionError('Not authenticated. Set a browser session cookie first.');
    }
    const cooldown = this.cooldownError();
    if (cooldown) throw cooldown;

    const url = new URL(path.startsWith('http') ? path : `${BASE_URL}${path}`);
    if (!isFamilySearchUrl(url)) {
      throw new FamilySearchSessionError(`Refusing to send the FamilySearch session to ${url.origin} (only https://*.familysearch.org)`);
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const imageWait = DEFAULT_IMAGE_INTERVAL_MS - (Date.now() - this.lastBinaryAt);
      if (imageWait > 0) await sleep(imageWait);
      await this.throttle();
      this.lastBinaryAt = Date.now();
      let response: Response;
      try {
        response = await this.fetchFamilySearch(url, {
          ...BROWSER_HEADERS,
          Accept: 'image/avif,image/webp,image/jpeg,image/*;q=0.8,*/*;q=0.5',
          'Sec-Fetch-Dest': 'image',
          'Sec-Fetch-Mode': 'no-cors',
          Cookie: this.cookieHeader(),
        });
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries) {
          await sleep(this.backoffMs(attempt));
          continue;
        }
        throw new FamilySearchSessionError(
          `Network error contacting ${url.pathname}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const contentType = response.headers.get('content-type') || '';
      if (response.ok && contentType.startsWith('image/')) {
        return Buffer.from(await response.arrayBuffer());
      }
      const text = await response.text().catch(() => '');
      // The bot filter answers with an HTML interstitial (often HTTP 200). Retrying
      // only prolongs the block, so stop everything for a while.
      if (isBotChallengePage(contentType, text)) {
        this.enterCooldown(this.cooldownMs, 'bot-protection page ("Pardon Our Interruption")');
        throw new FamilySearchSessionError(
          'FamilySearch showed its bot-protection page instead of the image. Pausing all requests to avoid a longer block. Open familysearch.org in your browser, solve the check if one appears, then retry later.',
          response.status,
        );
      }
      if (isRetryableStatus(response.status) && attempt < this.maxRetries) {
        lastError = new FamilySearchSessionError(`HTTP ${response.status}`, response.status);
        await this.pauseForRetry(response, attempt, `HTTP ${response.status}`);
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new FamilySearchSessionError(
          `FamilySearch refused the image (HTTP ${response.status}). It may be a restricted image, or the session expired (re-run login-with-browser).`,
          response.status,
        );
      }
      throw new FamilySearchSessionError(
        `Image request failed (HTTP ${response.status}, ${contentType || 'no content type'}): ${text.slice(0, 200)}`,
        response.status,
      );
    }
    throw lastError instanceof Error ? lastError : new FamilySearchSessionError(`Image request to ${url.pathname} failed`);
  }

  async searchFullText(params: {
    keywords?: string;
    fullName?: string;
    place?: string;
    yearFrom?: number;
    yearTo?: number;
    imageGroupNumber?: string;
    collectionId?: string;
    limit?: number;
    offset?: number;
    matchMode?: FullTextMatchMode;
  }): Promise<FullTextSearchResults> {
    const query: Record<string, string | number> = {
      count: params.limit ?? 5,
      offset: params.offset ?? 0,
      'm.defaultFacets': 'on',
      'm.queryRequireDefault': 'on',
    };

    if (params.keywords) query['q.text'] = applyFullTextMatchMode(params.keywords, params.matchMode);
    if (params.fullName) query['q.fullName'] = applyFullTextMatchMode(params.fullName, params.matchMode);
    if (params.place) query['q.anyPlace'] = params.place;
    if (params.yearFrom !== undefined) query['q.anyDate.from'] = params.yearFrom;
    if (params.yearTo !== undefined) query['q.anyDate.to'] = params.yearTo;
    if (params.imageGroupNumber) query['q.groupName'] = params.imageGroupNumber;
    if (params.collectionId) query['f.collectionId'] = params.collectionId;

    const data = await this.request<FullTextSearchResponse>('/service/search/fulltext/search', query);
    return {
      total: data.results ?? 0,
      offset: data.index ?? params.offset ?? 0,
      nextUrl: data.links?.next?.href || '',
      entries: (data.entries || []).map((entry) => ({
        id: entry.id || 'Unknown',
        title: entry.content?.title || entry.collectionTitle || 'Untitled document',
        collectionId: entry.collectionId || '',
        collectionTitle: entry.collectionTitle || '',
        recordDate: entry.content?.recordDate || 'Unknown',
        recordType: entry.content?.recordType || 'Unknown',
        recordPlace: entry.content?.recordPlace || 'Unknown',
        transcript: entry.content?.textDocument || '',
        highlights: (entry.content?.highlightTexts || []).filter(Boolean),
        entities: (entry.content?.entities || [])
          .filter((entity): entity is { type: string; value: string } => Boolean(entity.type && entity.value))
          .map((entity) => ({ type: entity.type, value: entity.value })),
        sourceUrl: entry.sourceUrl || (entry.id ? `https://www.familysearch.org/ark:/61903/${entry.id}` : ''),
      })),
    };
  }

  async searchCatalog(params: {
    place?: string;
    keywords?: string;
    title?: string;
    author?: string;
    subject?: string;
    surname?: string;
    callNumber?: string;
    filmNumber?: string;
    onlineOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<CatalogSearchResults> {
    const query: Record<string, string | number | boolean> = {
      count: params.limit ?? 10,
      offset: params.offset ?? 0,
      'm.defaultFacets': 'on',
      'm.queryRequireDefault': 'on',
    };
    if (params.place) query['q.place'] = params.place;
    if (params.keywords) query['q.keywords'] = params.keywords;
    if (params.title) query['q.title'] = params.title;
    if (params.author) query['q.author'] = params.author;
    if (params.subject) query['q.subject'] = params.subject;
    if (params.surname) query['q.surname'] = params.surname;
    if (params.callNumber) query['q.callNumber'] = params.callNumber;
    if (params.filmNumber) query['q.filmNumber'] = params.filmNumber.replace(/^0+/, '') || '0';
    if (params.onlineOnly) query['f.availability'] = 'online';

    const data = await this.request<CatalogSearchResponse>('/service/search/catalog/v3/search', query);
    return {
      total: data.totalHits ?? 0,
      offset: data.offset ?? params.offset ?? 0,
      entries: (data.searchHits || []).map((hit) => {
        const metadata = hit.metadataHit?.metadata || {};
        const identifier = metadata.identifier?.value || '';
        const catalogKey = identifier.match(/\/item\/(koha:[^/?#]+)/)?.[1];
        return {
          title: metadata.title?.map((entry) => entry.value).find(Boolean) || 'Untitled catalog item',
          identifier,
          url: catalogKey ? `https://www.familysearch.org/en/search/catalog/${catalogKey}` : identifier,
          creators: [...(metadata.creator || []), ...(metadata.contributor || [])]
            .map((entry) => entry.value || '')
            .filter(Boolean),
          subjects: (metadata.subject || []).map((entry) => entry.value || '').filter(Boolean),
          coverage: (metadata.coverage || [])
            .map((entry) => [entry.place, entry.datesOrig].filter(Boolean).join('; '))
            .filter(Boolean),
          holdings: (metadata.repositoryCalls || []).map((entry) => entry.title || '').filter(Boolean),
          score: hit.metadataHit?.score ?? 0,
        };
      }),
    };
  }

}

export interface PersonSummary {
  id?: string;
  name?: string;
  gender?: string;
  lifespan?: string;
  fullLifespan?: string;
  birth?: { date?: string; place?: string };
}

// The family-members endpoint names both members of a couple parent1/parent2,
// in parent groups and in spouse groups alike, and wraps each child.
export interface FamilyGroup {
  parent1?: PersonSummary;
  parent2?: PersonSummary;
  children?: Array<{ child?: PersonSummary }>;
  event?: {
    details?: {
      date?: { originalText?: string; normalizedText?: string };
      place?: { originalText?: string; normalizedText?: string };
    };
  };
}

export interface FamilyMembersResponse {
  parents?: FamilyGroup[];
  spouses?: FamilyGroup[];
}

interface AncestorGeneration {
  parent1?: PersonSummary;
  parent2?: PersonSummary;
}

interface SuggestionHolder {
  suggestions?: {
    researchSuggestionList?: Array<{ type?: { name?: string } }> | null;
    dataQualityList?: Array<{ type?: { name?: string } }> | null;
  };
}

interface PedigreePerson extends PersonSummary, SuggestionHolder {
  hasRecordHints?: boolean;
}

interface PedigreeCouple extends SuggestionHolder {
  parent1?: PedigreePerson;
  parent2?: PedigreePerson;
}

function suggestionNames(holder: SuggestionHolder): string[] {
  return [...(holder.suggestions?.researchSuggestionList || []), ...(holder.suggestions?.dataQualityList || [])]
    .map((suggestion) => suggestion.type?.name)
    .filter((name): name is string => Boolean(name));
}

function formatSummary(person?: PersonSummary): string {
  if (!person?.id) return 'Unknown';
  return `${person.name || 'Unknown'} (${person.fullLifespan || person.lifespan || '?'}) [${person.id}]`;
}

export function formatMarriage(group: FamilyGroup): string {
  const date = group.event?.details?.date?.originalText || group.event?.details?.date?.normalizedText;
  const place = group.event?.details?.place?.originalText || group.event?.details?.place?.normalizedText;
  if (!date && !place) return '';
  return ` — married ${[date, place].filter(Boolean).join(', ')}`;
}

// "…/persons/P12-345/conclusions/ABCD" -> "conclusions/ABCD"
function mergeResourceLabel(ref?: MergeResourceRef): string {
  return (ref?.resource || '').split('/').filter(Boolean).slice(-2).join('/') || '?';
}

function birthYear(person: PersonSummary): string {
  return person.birth?.date?.match(/\d{4}/)?.[0] || person.lifespan?.match(/^\s*(\d{4})/)?.[1] || '';
}

// Lower-case, no accents or punctuation, doubled letters collapsed
// (Garutti/Garuti, Carmellina/Carmelina) so spelling variants compare equal.
export function normalizeName(name?: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/(.)\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstGivenName(name?: string): string {
  return normalizeName(name).split(' ')[0] || '';
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

export function surnamesAlike(a?: string, b?: string): boolean {
  const lastA = normalizeName(a).split(' ').pop() || '';
  const lastB = normalizeName(b).split(' ').pop() || '';
  if (!lastA || !lastB) return false;
  if (lastA === lastB || levenshtein(lastA, lastB) <= 1) return true;
  const [shorter, longer] = lastA.length <= lastB.length ? [lastA, lastB] : [lastB, lastA];
  return shorter.length >= 4 && longer.startsWith(shorter);
}

// Two people linked as parents of the same child: they can both be right only
// if they differ in gender, so same-gender look-alikes are duplicate suspects.
export function looksLikeSameParent(a: PersonSummary, b: PersonSummary): boolean {
  if (a.gender && b.gender && a.gender.toUpperCase() !== b.gender.toUpperCase()) return false;
  if (!surnamesAlike(a.name, b.name)) return false;
  const yearA = birthYear(a);
  const yearB = birthYear(b);
  return !yearA || !yearB || Math.abs(Number(yearA) - Number(yearB)) <= 10;
}

export function formatPersonSources(sources: PersonSource[]): string[] {
  if (!sources.length) return ['No sources attached.'];
  const lines: string[] = [`${sources.length} source${sources.length === 1 ? '' : 's'}:`];
  sources.forEach((source, index) => {
    lines.push('', `${index + 1}. ${source.title}${source.attachedOn ? ` (attached ${source.attachedOn})` : ''}`);
    if (source.url) lines.push(`   Link: ${source.url}`);
    if (source.citation) lines.push(`   Citation: ${source.citation}`);
    for (const note of source.notes) lines.push(`   Note: ${note.replace(/\s+/g, ' ').trim()}`);
    if (source.changeMessage) lines.push(`   Reason: ${source.changeMessage}`);
  });
  return lines;
}

export function formatMergeAnalysis(result: MergeAnalysisResult, filter?: MergeAnalysisFilter): string[] {
  const describe = (card: PersonCard) => {
    const { birth, death } = formatCardBirthDeath(card);
    return `${card.name || 'Unknown'} [${card.id}] — b. ${birth}; d. ${death}`;
  };
  const lines = [
    `Merge analysis (dry run, nothing was changed)${filter ? ` — filter: ${filter}` : ''}`,
    `Survivor:  ${describe(result.survivor)}`,
    `Duplicate: ${describe(result.duplicate)}`,
  ];
  if (result.warning) lines.push(`Warning from FamilySearch: ${result.warning}`);
  lines.push(
    '',
    `Resources only on the survivor: ${result.survivorOnly.length}`,
    `Resources only on the duplicate (would be copied): ${result.duplicateOnly.length}`,
    `Conflicting pairs (one side must be chosen): ${result.conflicts.length}`,
  );
  for (const conflict of result.conflicts) {
    lines.push(`  - survivor ${conflict.survivor}  vs  duplicate ${conflict.duplicate}`);
  }
  if (!filter) {
    lines.push('', 'Tip: call again with a filter (VitalConclusions, SourceReferences, CoupleRelationships, …) to see one category at a time.');
  }
  return lines;
}

function personName(person: GedcomxPerson): string {
  return person.names?.[0]?.nameForms?.[0]?.fullText || 'Unknown';
}

function gedcomxType(uri?: string): string | undefined {
  return uri?.split('/').pop();
}

function resourceId(ref?: { resource?: string }): string {
  return ref?.resource?.replace(/^.*#/, '') || '';
}

function formatFact(fact: GedcomxFact): string {
  const type = gedcomxType(fact.type) || 'Fact';
  const parts = [fact.value, fact.date?.original, fact.place?.original].filter(Boolean);
  return `${type}: ${parts.join(', ') || '?'}`;
}

function formatFacts(person: GedcomxPerson): string {
  return (person.facts || []).map(formatFact).join('; ');
}

// Record fields carry extras such as age, occupation or residence that are not modelled as facts.
function formatFields(fields: GedcomxPerson['fields']): string {
  return (fields || [])
    .filter((field) => !field.type?.includes('SortKey'))
    .map((field) => {
      const type = gedcomxType(field.type) || 'Field';
      const text = field.values?.find((v) => v.type?.endsWith('Interpreted'))?.text || field.values?.[0]?.text;
      return text ? `${type}: ${text}` : '';
    })
    .filter(Boolean)
    .join('; ');
}

export function describeRelatives(record: GedcomxRecord, principal: GedcomxPerson): string[] {
  const byId = new Map((record.persons || []).map((p) => [p.id || '', p]));
  const self = principal.id || '';
  return (record.relationships || []).flatMap((rel) => {
    const p1 = resourceId(rel.person1);
    const p2 = resourceId(rel.person2);
    if (p1 !== self && p2 !== self) return [];
    const other = byId.get(p1 === self ? p2 : p1);
    if (!other) return [];
    const role = rel.type?.endsWith('Couple')
      ? 'Spouse'
      : rel.type?.endsWith('ParentChild')
        ? p2 === self
          ? 'Parent'
          : 'Child'
        : 'Related';
    return [`${role}: ${personName(other)}`];
  });
}

function collectionTitle(record?: GedcomxRecord): string | undefined {
  return record?.sourceDescriptions?.find((sd) => sd.resourceType === 'http://gedcomx.org/Collection')?.titles?.[0]
    ?.value;
}

export interface RecordSearchParams {
  givenName?: string;
  surname?: string;
  exactSurname?: boolean;
  gender?: 'MALE' | 'FEMALE';
  birthDate?: string;
  birthYearFrom?: string;
  birthYearTo?: string;
  birthPlace?: string;
  deathDate?: string;
  deathYearFrom?: string;
  deathYearTo?: string;
  deathPlace?: string;
  marriageYearFrom?: string;
  marriageYearTo?: string;
  marriagePlace?: string;
  residencePlace?: string;
  anyPlace?: string;
  spouseGivenName?: string;
  spouseSurname?: string;
  fatherGivenName?: string;
  fatherSurname?: string;
  motherGivenName?: string;
  motherSurname?: string;
  recordCountry?: string;
  collectionId?: string;
  filmNumber?: string;
  limit?: number;
  offset?: number;
}

type StringSearchParam = Exclude<
  keyof RecordSearchParams,
  'exactSurname' | 'gender' | 'birthDate' | 'deathDate' | 'filmNumber' | 'limit' | 'offset'
>;

const RECORD_SEARCH_PARAMS: ReadonlyArray<[StringSearchParam, string]> = [
  ['givenName', 'q.givenName'],
  ['surname', 'q.surname'],
  ['birthYearFrom', 'q.birthLikeDate.from'],
  ['birthYearTo', 'q.birthLikeDate.to'],
  ['birthPlace', 'q.birthLikePlace'],
  ['deathYearFrom', 'q.deathLikeDate.from'],
  ['deathYearTo', 'q.deathLikeDate.to'],
  ['deathPlace', 'q.deathLikePlace'],
  ['marriageYearFrom', 'q.marriageLikeDate.from'],
  ['marriageYearTo', 'q.marriageLikeDate.to'],
  ['marriagePlace', 'q.marriageLikePlace'],
  ['residencePlace', 'q.residencePlace'],
  ['anyPlace', 'q.anyPlace'],
  ['spouseGivenName', 'q.spouseGivenName'],
  ['spouseSurname', 'q.spouseSurname'],
  ['fatherGivenName', 'q.fatherGivenName'],
  ['fatherSurname', 'q.fatherSurname'],
  ['motherGivenName', 'q.motherGivenName'],
  ['motherSurname', 'q.motherSurname'],
  ['recordCountry', 'f.recordCountry'],
  ['collectionId', 'f.collectionId'],
];

export function extractCookieValue(cookieHeader: string, name: string): string {
  return cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] || '';
}

export function formatPersonSummary(person?: PersonSummary): string {
  if (!person) return 'Unknown';
  const year =
    person.lifespan?.match(/\d{4}/)?.[0] || person.birth?.date?.match(/\d{4}/)?.[0] || '?';
  return `${person.name || 'Unknown'} (${year}) [${person.id || '?'}]`;
}

function buildCookieHeader(sessionId?: string, fsAnid?: string): string {
  const parts: string[] = [];
  if (sessionId) parts.push(`fssessionid=${sessionId}`);
  if (fsAnid) parts.push(`fs_anid=${fsAnid}`);
  return parts.join('; ');
}
