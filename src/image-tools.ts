// Image viewer helpers: the per-image index ("Image Index" tab), browse
// folders (waypoints) and crops of the scan itself. These use the same
// endpoints the FamilySearch image viewer calls.
import jpeg from 'jpeg-js';

export const IMAGE_ID_PATTERN = /3:1:[A-Z0-9]{4}(?:-[A-Z0-9]{1,6}){1,3}/i;

export class ImageToolError extends Error {}

/** Accepts a 3:1 image ID or any URL that contains one. */
export function parseImageId(value: string): string {
  const match = String(value || '').match(IMAGE_ID_PATTERN);
  if (!match) throw new ImageToolError(`Expected a FamilySearch image ID such as 3:1:S3HT-6SDK-MF (or an ARK URL containing one), got ${JSON.stringify(value)}`);
  return match[0].toUpperCase();
}

const WAYPOINT_ID_PATTERN = /^[A-Z0-9]{3,6}-[A-Z0-9]{2,6}:[0-9]+(?:,[0-9]+)*$/i;

/**
 * Turns what a user or an earlier tool result has into a platform waypoint URL:
 * a platform waypoint URL (any *.familysearch.org host), the `wc=` value of an
 * image URL (e.g. 9GRZ-FMD:113331301,113331302,113605501), an image URL
 * carrying wc=, or a bare collection ID (its top-level browse folders).
 */
export function waypointUrl(input: string, collectionId?: string): string {
  const raw = decodeURIComponent(String(input || '').trim());
  if (/^\d{4,9}$/.test(raw)) return `https://www.familysearch.org/platform/records/collections/${raw}/waypoints`;

  let id = '';
  let cc = collectionId || '';
  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    if (!url.hostname.endsWith('familysearch.org')) throw new ImageToolError('Waypoint URLs must be on familysearch.org');
    cc = cc || url.searchParams.get('cc') || '';
    const collectionMatch = url.pathname.match(/\/platform\/records\/collections\/(\d+)\/waypoints/);
    if (collectionMatch) return `https://www.familysearch.org/platform/records/collections/${collectionMatch[1]}/waypoints`;
    const pathMatch = url.pathname.match(/\/platform\/records\/waypoints\/([^/?]+)/);
    id = pathMatch ? decodeURIComponent(pathMatch[1]) : url.searchParams.get('wc') || '';
  } else {
    id = raw.replace(/^wc=/, '');
  }
  if (!WAYPOINT_ID_PATTERN.test(id)) {
    throw new ImageToolError(`Not a waypoint: ${JSON.stringify(input)}. Pass a waypoint URL from browse-waypoints, the wc= value of an image URL, or a collection ID.`);
  }
  return `https://www.familysearch.org/platform/records/waypoints/${id}${cc ? `?cc=${encodeURIComponent(cc)}` : ''}`;
}

// ---------------------------------------------------------------- waypoints

interface WaypointSourceDescription {
  id?: string;
  about?: string;
  resourceType?: string;
  componentOf?: { description?: string };
  titles?: Array<{ value?: string }>;
}

export interface WaypointResponse {
  description?: string;
  sourceDescriptions?: WaypointSourceDescription[];
}

export interface WaypointListing {
  url: string;
  title: string;
  path: string[];
  children: Array<{ title: string; url: string }>;
  images: Array<{ imageNumber: number; imageId: string }>;
}

export function parseWaypoint(url: string, data: WaypointResponse): WaypointListing {
  const sds = data.sourceDescriptions || [];
  const byRef = new Map(sds.map((sd) => [`#${sd.id}`, sd]));
  const selfRef = data.description || '';
  const self = byRef.get(selfRef);

  const path: string[] = [];
  const seen = new Set<string>();
  let cursor = self;
  while (cursor && !seen.has(cursor.id || '')) {
    seen.add(cursor.id || '');
    const title = cursor.titles?.[0]?.value;
    if (title && path[0] !== title) path.unshift(title);
    cursor = cursor.componentOf?.description ? byRef.get(cursor.componentOf.description) : undefined;
  }

  const children: WaypointListing['children'] = [];
  const images: WaypointListing['images'] = [];
  for (const sd of sds) {
    if (sd.componentOf?.description !== selfRef || sd === self) continue;
    if (sd.resourceType?.endsWith('DigitalArtifact')) {
      const imageId = sd.about?.match(IMAGE_ID_PATTERN)?.[0];
      if (imageId) images.push({ imageNumber: images.length + 1, imageId });
    } else if (sd.about) {
      children.push({ title: sd.titles?.[0]?.value || '(untitled)', url: sd.about.replace(/^https:\/\/[^/]+/, 'https://www.familysearch.org') });
    }
  }
  return { url, title: self?.titles?.[0]?.value || path[path.length - 1] || '', path, children, images };
}

// -------------------------------------------------------------- image index

interface FieldValue { labelId?: string; text?: string; type?: string }
interface RecordField { type?: string; values?: FieldValue[] }
interface ImageFact { type?: string; date?: { original?: string }; place?: { original?: string }; value?: string }
interface ImagePerson {
  id?: string;
  principal?: boolean;
  gender?: { type?: string };
  names?: Array<{ nameForms?: Array<{ fullText?: string }> }>;
  facts?: ImageFact[];
  identifiers?: Record<string, string[]>;
}
interface ImageRecord {
  id?: string;
  fields?: RecordField[];
  persons?: ImagePerson[];
  relationships?: Array<{ type?: string; person1?: { resource?: string }; person2?: { resource?: string }; facts?: ImageFact[] }>;
  links?: Record<string, { href?: string }>;
}

export interface ImageDataResponse {
  records?: ImageRecord[];
  meta?: {
    links?: Record<string, { href?: string; offset?: number; results?: number }>;
    sourceDescriptions?: Array<{ citations?: Array<{ value?: string }>; rights?: string[] }>;
  };
}

export interface IndexedPerson {
  name: string;
  personaId?: string;
  gender?: string;
  father?: string;
  mother?: string;
  grandparents: string[];
  facts: string[];
}

export interface IndexedRecord {
  recordId?: string;
  entryNumber?: string;
  pageNumber?: string;
  events: string[];
  principals: IndexedPerson[];
  others: string[];
}

export interface ImageIndexPage {
  imageId: string;
  imageNumber?: number;
  totalImages?: number;
  citation?: string;
  restricted?: boolean;
  nextImageId?: string;
  previousImageId?: string;
  records: IndexedRecord[];
  error?: string;
}

const typeName = (uri?: string) => uri?.split('/').pop() || '';
const refId = (ref?: { resource?: string }) => ref?.resource?.replace(/^.*#/, '') || '';
const nameOf = (person?: ImagePerson) => person?.names?.[0]?.nameForms?.[0]?.fullText?.trim() || '';

function fieldText(fields: RecordField[] | undefined, typeSuffix: string): string | undefined {
  const field = (fields || []).find((f) => f.type?.endsWith(`/${typeSuffix}`));
  const values = field?.values || [];
  return (values.find((v) => v.type?.endsWith('Interpreted')) || values[0])?.text;
}

function factText(fact: ImageFact): string {
  const parts = [fact.value, fact.date?.original, fact.place?.original].filter(Boolean);
  return parts.length ? `${typeName(fact.type) || 'Event'}: ${parts.join(', ')}` : '';
}

export function parseImageRecord(record: ImageRecord): IndexedRecord {
  const persons = record.persons || [];
  const byId = new Map(persons.map((p) => [p.id || '', p]));
  const parentsOf = new Map<string, string[]>();
  const used = new Set<string>();
  const events = new Set<string>();

  for (const rel of record.relationships || []) {
    const a = refId(rel.person1);
    const b = refId(rel.person2);
    if (rel.type?.endsWith('ParentChild')) parentsOf.set(b, [...(parentsOf.get(b) || []), a]);
    for (const fact of rel.facts || []) {
      const text = factText(fact);
      if (text) events.add(text);
    }
  }

  const split = (ids: string[]) => {
    let father: string | undefined;
    let mother: string | undefined;
    const rest: string[] = [];
    for (const id of ids) {
      const parent = byId.get(id);
      const gender = typeName(parent?.gender?.type);
      if (gender === 'Male' && !father) father = id;
      else if (gender === 'Female' && !mother) mother = id;
      else rest.push(id);
    }
    return { father, mother, rest };
  };

  const principals: IndexedPerson[] = [];
  for (const person of persons.filter((p) => p.principal)) {
    used.add(person.id || '');
    const { father, mother, rest } = split(parentsOf.get(person.id || '') || []);
    const grandparents: string[] = [];
    for (const [label, parentId] of [['paternal', father], ['maternal', mother]] as const) {
      if (!parentId) continue;
      used.add(parentId);
      for (const gp of parentsOf.get(parentId) || []) {
        used.add(gp);
        grandparents.push(`${nameOf(byId.get(gp)) || '?'} (${label})`);
      }
    }
    rest.forEach((id) => used.add(id));
    const personaArk = Object.values(person.identifiers || {}).flat().find((id) => id.includes('1:1:'));
    principals.push({
      name: nameOf(person) || '(no name indexed)',
      personaId: personaArk?.match(/1:1:([A-Z0-9-]+)/i)?.[1],
      gender: typeName(person.gender?.type) || undefined,
      father: father ? nameOf(byId.get(father)) : rest[0] ? nameOf(byId.get(rest[0])) : undefined,
      mother: mother ? nameOf(byId.get(mother)) : undefined,
      grandparents,
      facts: (person.facts || []).map(factText).filter(Boolean),
    });
  }

  const others = persons
    .filter((p) => !used.has(p.id || '') && nameOf(p))
    .map((p) => nameOf(p));

  return {
    recordId: record.links?.self?.href?.match(/1:2:([A-Z0-9-]+)/i)?.[1] || record.id,
    entryNumber: fieldText(record.fields, 'SourceEntryNbr'),
    pageNumber: fieldText(record.fields, 'SourcePageNbr'),
    events: [...events],
    principals,
    others,
  };
}

export function parseImageData(imageId: string, data: ImageDataResponse): ImageIndexPage {
  const links = data.meta?.links || {};
  const sd = data.meta?.sourceDescriptions?.[0];
  const rights = sd?.rights?.join(' ') || '';
  return {
    imageId,
    imageNumber: links.self?.offset,
    totalImages: links.self?.results,
    citation: sd?.citations?.[0]?.value?.replace(/<[^>]+>/g, ''),
    restricted: /restricted=true/.test(rights) || /authorized=false/.test(rights) || undefined,
    nextImageId: links.next?.href?.match(IMAGE_ID_PATTERN)?.[0],
    previousImageId: links.prev?.href?.match(IMAGE_ID_PATTERN)?.[0],
    records: (data.records || []).map(parseImageRecord),
  };
}

export function normalizeForMatch(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** True when any person on the record contains one of the comma-separated fragments. */
export function recordMatches(record: IndexedRecord, filter?: string): boolean {
  const terms = (filter || '').split(',').map((t) => normalizeForMatch(t.trim())).filter(Boolean);
  if (!terms.length) return true;
  const haystack = normalizeForMatch([
    ...record.principals.flatMap((p) => [p.name, p.father || '', p.mother || '', ...p.grandparents]),
    ...record.others,
  ].join(' | '));
  return terms.some((term) => haystack.includes(term));
}

export function formatIndexedRecord(record: IndexedRecord): string {
  const head = [
    record.entryNumber ? `entry ${record.entryNumber}` : '',
    record.pageNumber ? `page ${record.pageNumber}` : '',
    ...record.events,
  ].filter(Boolean).join(' | ');
  const lines = [`  • ${head || 'record'}${record.recordId ? ` [record ${record.recordId}]` : ''}`];
  for (const p of record.principals) {
    const parents = [p.father ? `father ${p.father}` : '', p.mother ? `mother ${p.mother}` : ''].filter(Boolean).join('; ');
    lines.push(`      ${p.name}${p.personaId ? ` (persona ${p.personaId})` : ''}${parents ? ` — ${parents}` : ''}`);
    if (p.grandparents.length) lines.push(`        grandparents: ${p.grandparents.join(', ')}`);
    if (p.facts.length) lines.push(`        ${p.facts.join('; ')}`);
  }
  if (record.others.length) lines.push(`      also named: ${record.others.join(', ')}`);
  return lines.join('\n');
}

// --------------------------------------------------------------- image crop

export interface CropOptions {
  /** Left edge, 0–1 fraction of the full width (default 0). */
  x?: number;
  /** Top edge, 0–1 fraction of the full height (default 0). */
  y?: number;
  /** Width, 0–1 fraction (default: to the right edge). */
  width?: number;
  /** Height, 0–1 fraction (default: to the bottom edge). */
  height?: number;
  /** Output width cap in pixels; the crop is never upscaled. */
  maxWidth?: number;
  /** Grayscale + auto-contrast, helps with faded ink. */
  enhance?: boolean;
  quality?: number;
}

export interface CropResult {
  jpeg: Buffer;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  region: { x: number; y: number; width: number; height: number };
}

const clamp01 = (v: number | undefined, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

export function cropJpeg(input: Buffer | Uint8Array, options: CropOptions = {}): CropResult {
  const image = jpeg.decode(input, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 200 });
  const W = image.width;
  const H = image.height;
  const fx = clamp01(options.x, 0);
  const fy = clamp01(options.y, 0);
  const x0 = Math.min(W - 1, Math.round(fx * W));
  const y0 = Math.min(H - 1, Math.round(fy * H));
  const rw = Math.max(1, Math.min(W - x0, Math.round(clamp01(options.width, 1 - fx) * W)));
  const rh = Math.max(1, Math.min(H - y0, Math.round(clamp01(options.height, 1 - fy) * H)));

  const maxWidth = Math.max(50, Math.round(options.maxWidth || 1600));
  // Keep tall crops bounded too, so a full page does not come back enormous.
  const scale = Math.min(1, maxWidth / rw, (maxWidth * 1.5) / rh);
  const ow = Math.max(1, Math.round(rw * scale));
  const oh = Math.max(1, Math.round(rh * scale));
  const out = new Uint8Array(ow * oh * 4);
  const src = image.data;

  // Box filter: each output pixel averages the source pixels it covers.
  for (let oy = 0; oy < oh; oy++) {
    const sy0 = y0 + Math.floor((oy * rh) / oh);
    const sy1 = Math.max(sy0 + 1, y0 + Math.floor(((oy + 1) * rh) / oh));
    for (let ox = 0; ox < ow; ox++) {
      const sx0 = x0 + Math.floor((ox * rw) / ow);
      const sx1 = Math.max(sx0 + 1, x0 + Math.floor(((ox + 1) * rw) / ow));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        let i = (sy * W + sx0) * 4;
        for (let sx = sx0; sx < sx1; sx++, i += 4) {
          r += src[i]; g += src[i + 1]; b += src[i + 2]; n++;
        }
      }
      const o = (oy * ow + ox) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }

  if (options.enhance) {
    const histogram = new Uint32Array(256);
    const lum = new Uint8Array(ow * oh);
    for (let p = 0, o = 0; p < lum.length; p++, o += 4) {
      const l = Math.round(0.299 * out[o] + 0.587 * out[o + 1] + 0.114 * out[o + 2]);
      lum[p] = l;
      histogram[l]++;
    }
    const cut = lum.length * 0.01;
    let lo = 0, hi = 255, acc = 0;
    while (lo < 255 && (acc += histogram[lo]) < cut) lo++;
    acc = 0;
    while (hi > 0 && (acc += histogram[hi]) < cut) hi--;
    const span = Math.max(1, hi - lo);
    for (let p = 0, o = 0; p < lum.length; p++, o += 4) {
      const v = Math.max(0, Math.min(255, Math.round(((lum[p] - lo) * 255) / span)));
      out[o] = out[o + 1] = out[o + 2] = v;
    }
  }

  const encoded = jpeg.encode({ data: out, width: ow, height: oh }, Math.min(95, Math.max(40, options.quality || 85)));
  return {
    jpeg: encoded.data,
    width: ow,
    height: oh,
    sourceWidth: W,
    sourceHeight: H,
    region: { x: x0, y: y0, width: rw, height: rh },
  };
}
