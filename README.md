# FamilySearch MCP Server

A local [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for [FamilySearch](https://www.familysearch.org). Gives AI assistants access to search the Family Tree, view person details, explore ancestors and descendants, and search historical records.

## About this fork

This fork combines the work spread across the forks of
[JonathanReiss15/familysearch-mcp](https://github.com/JonathanReiss15/familysearch-mcp)
and adds a security pass on top:

| From | What it brings |
|---|---|
| [harrywesterman](https://github.com/harrywesterman/familysearch-mcp/tree/improvement) | Full-text (AI OCR) search, catalog search, film/DGS browsing, high-resolution downloads, rate limiting with cooldown |
| [twonky4](https://github.com/twonky4/familysearch-mcp/tree/feature/family-records-research-suggestions) | `get-family`, `get-record`, `get-research-suggestions`, record search by father/mother/spouse names and marriage place |
| [izzybps](https://github.com/izzybps/familysearch-mcp) | Fix for `get-descendants` never returning children |
| This fork | Same fix applied to `get-person` (spouses and children were always empty), cookies locked to `familysearch.org`, ID validation, downloads confined to one folder, dependencies with 0 known vulnerabilities |

See [AUDIT.md](AUDIT.md) for the full review.

## Features

- **Family Tree search** — find individuals by name, dates, places, and gender
- **Person details** — view a person card by ID, with parents, spouses (and marriage) and children
- **Family view** — parents, siblings, spouses and children in one call
- **Research suggestions** — record hints and FamilySearch research flags across your pedigree
- **Pedigree exploration** — ancestors (up to 8 generations) and descendants (up to 3)
- **Historical records** — search indexed records by the person, their father, mother or spouse, marriage or residence place, and open any record to see everyone on it
- **AI full-text search** — search OCR transcripts with OR, AND, or exact-phrase matching
- **Catalog and film browsing** — find catalog items and resolve pages in a DGS image group
- **High-resolution downloads** — download by ARK image ID or by DGS + image number
- **Browser session auth** — log in once with Brave, Chrome, or Chromium; no FamilySearch API key required

## How it works

FamilySearch does not approve direct API access for most personal projects. This server reuses your **browser session cookies** and calls the same internal `/service/` endpoints the website uses. Your session is stored locally at `~/.familysearch-mcp/config.json`.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- Brave, Chrome, or Chromium (Brave is preferred where available)
- A free FamilySearch account

## Installation

### 1. Clone and build

```bash
git clone https://github.com/G4rutti/familysearch-mcp.git
cd familysearch-mcp
npm install
npm run build
```

### 2. Log in to FamilySearch

```bash
npm run login
```

This opens an installed browser with a dedicated profile. Sign in when prompted. Your session is saved to `~/.familysearch-mcp/config.json`.

> **Tip:** You can also ask your AI assistant to run the `login-with-browser` tool after the MCP is connected.

### 3. Configure your MCP client

Add the server to your client using **stdio** transport. Replace `/path/to/familysearch-mcp` with the absolute path to this repo.

**Recommended config** (uses `cwd` so you don't need absolute paths in `args`):

```json
{
  "mcpServers": {
    "familysearch": {
      "command": "node",
      "args": ["build/index.js"],
      "cwd": "/path/to/familysearch-mcp"
    }
  }
}
```

Run `npm run build` whenever you pull changes.

---

## MCP client setup

### Cursor

**Project-scoped** — create `.cursor/mcp.json` in your project (or add globally in **Cursor Settings → MCP**):

```json
{
  "mcpServers": {
    "familysearch": {
      "command": "node",
      "args": ["build/index.js"],
      "cwd": "/path/to/familysearch-mcp"
    }
  }
}
```

Restart Cursor or reload MCP servers after saving.

### Claude Desktop

Edit `claude_desktop_config.json`:

| Platform | Config path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "familysearch": {
      "command": "node",
      "args": ["build/index.js"],
      "cwd": "/path/to/familysearch-mcp"
    }
  }
}
```

Restart Claude Desktop after saving.

### Claude Code

From the repo directory:

```bash
claude mcp add familysearch -- node build/index.js
```

Or with an absolute path from anywhere:

```bash
claude mcp add familysearch -- node /path/to/familysearch-mcp/build/index.js
```

Verify with `claude mcp list`.

### Codex

From the repo directory (after `npm run build`):

```bash
codex mcp add familysearch -- node build/index.js
```

Or add to `~/.codex/config.toml`:

```toml
[mcp_servers.familysearch]
command = "node"
args = ["build/index.js"]
cwd = "/path/to/familysearch-mcp"
```

Use `/mcp` in Codex to confirm the server is connected.

### VS Code

Add to your user MCP config (**Command Palette → `MCP: Open User Configuration`**) or `.vscode/mcp.json` in a workspace:

```json
{
  "servers": {
    "familysearch": {
      "command": "node",
      "args": ["build/index.js"],
      "cwd": "/path/to/familysearch-mcp"
    }
  }
}
```

### Windows

If `node` is not found, use the full path to your Node executable. For clients that struggle with direct `node` invocation, wrap with `cmd`:

```json
{
  "mcpServers": {
    "familysearch": {
      "command": "cmd",
      "args": ["/c", "node", "build/index.js"],
      "cwd": "C:\\path\\to\\familysearch-mcp"
    }
  }
}
```

---

## Authentication

### Option 1: Browser login (recommended)

```bash
npm run login
```

Opens Brave when available, otherwise Chrome or Chromium. Set
`FAMILYSEARCH_BROWSER_PATH` to select a different browser executable.

### Option 2: Copy cookies manually

> Prefer option 1. Cookies passed to `set-session-cookie` become part of the AI
> conversation (and so reach the model provider). `npm run login` writes them
> straight to the local config file.

1. Log in at [familysearch.org](https://www.familysearch.org)
2. In DevTools → Console, run: `copy(document.cookie)`
3. Use the `set-session-cookie` MCP tool with the copied string

The full cookie string is required — bot protection cookies like `reese84` and `incap_ses_*` must be included, not just `fssessionid`.

---

## Tools

| Tool | Description |
|---|---|
| `login-with-browser` | Open an installed browser, log in, and save the session locally |
| `set-session-cookie` | Authenticate by pasting cookies from your browser |
| `get-current-user` | View your authenticated account info |
| `search-persons` | Search individuals in the Family Tree (name, givenName/surname, dates, places, gender, limit/offset) |
| `get-person` | Get details for a person by ID, including parents, spouses (with marriage), children and notes |
| `get-family` | Parents, siblings, spouses with marriage date/place, and children of a person |
| `get-research-suggestions` | Ancestors with pending record hints or research flags such as `NO_SOURCES_ATTACHED` or `MISSING_VITAL_EVENT_YEAR` |
| `get-person-sources` | Sources attached to a person (the "Sources" tab): title, link to the original record or archive, citation, notes, date attached. Read-only |
| `find-duplicates` | Duplicate suspects around a person: look-alike parents when a person has several parent sets, and same-year children of one couple confirmed or ruled out by exact birth date and place. Read-only; suspects, not conclusions |
| `analyze-merge` | Dry run of merging two persons (survivor + duplicate): both people, what would be copied, conflicting resources, FamilySearch warnings, optional `filter` by category. Read-only; the merge itself is done on familysearch.org |
| `get-ancestors` | View ancestors (default 4 generations, max 8) |
| `get-descendants` | View descendants (default 2 generations, max 3) |
| `search-records` | Search indexed records by name, birth/death/marriage year ranges and places, residence, father/mother/spouse names, country, collection, or `filmNumber` (only records indexed from one film/DGS: searches inside a set of register books); each hit lists its facts, related persons and record link |
| `get-record` | Open a record (persona ID from `search-records`): collection, citation, image link, every person with facts and extra fields (age, occupation, residence), and their relationships |
| `search-full-text` | Search FamilySearch AI-OCR transcripts of unindexed scans by keywords, name, place, years, DGS or collection |
| `search-catalog` | Search the catalog by place, keywords, title, author, subject, surname, call number, film number, or DGS |
| `list-film-images` | Resolve a range of one-based image numbers in a DGS to permanent `3:1` ARK image IDs |
| `download-document` | Fetch a scan by ARK image ID or DGS + image number and return it inline; the file is deleted afterwards unless `keep: true` |
| `browse-waypoints` | Walk a collection's image folders like the viewer's breadcrumb (collection > place > register book): sub-folders, image count, and image IDs for a range |
| `get-image-index` | The viewer's "Image Index" tab for one or more consecutive images (max 10): entry/page numbers, event dates, principals with parents (and grandparents when indexed), persona IDs; optional `nameFilter` |
| `get-image` | A scan or a zoomed-in part of it returned inline (crop given as 0-1 fractions, `maxWidth` cap, never upscaled), with `enhance` for faded ink. No browser needed |

### Reading register books

`search-records` with `filmNumber` finds a name anywhere in a film's index in one call. When the index does not have it, `browse-waypoints` locates the book, `get-image-index` shows what is indexed image by image, and `get-image` crops the handwritten entry for reading. These three use the endpoints of FamilySearch's own image viewer (`/platform/records/waypoints`, `/search/filmdatainfo/image-data` and the deep-zoom `dist.jpg`), so they may change without notice; they go through the same throttle as every other call, about 5 seconds per request.

### Example prompts

```
Search for persons named "John Smith" born in "New York"
```

```
Get person with personId G2KQ-JTH
```

```
Get 4 generations of ancestors for personId G2KQ-JTH
```

```
Search historical records for surname "Reiss" in "Pennsylvania"
```

```
Search marriage records in Aiuruoca, Minas Gerais between 1905 and 1910 for a groom
surnamed Diniz whose bride is named Ana Maria
```

```
Show research suggestions for my ancestors, 6 generations up from GJZ7-7SH
```

```
Search the full text for "voogd" and "Leeuwarden" between 1700 and 1800
```

Set `matchMode` to `all` to require every word (`+word`) or to `exact` to
search for an exact quoted phrase. The default, `any`, retains FamilySearch's
OR behavior.

Full-text results include an OCR excerpt and a direct FamilySearch ARK link to the
scan. Set `includeFullTranscript` to `true` to return the complete AI transcript;
use a low result limit because transcripts can be large.

```
Download image 3:1:3QHK-93G5-35Q3 as a high-resolution JPG
```

```
Find catalog material for Leeuwarden with "trouwregister" in the title
```

```
List 20 images from DGS 008903222, starting at image 500
```

```
Download image 517 from DGS 008903222 as a high-resolution JPG
```

The image (or PDF) comes back inline in the tool result, and the file is deleted
from disk right after, so nothing piles up. Pass `keep: true` to keep it.
Files are written to `~/Downloads/familysearch-mcp` by default (set
`FAMILYSEARCH_DOWNLOAD_DIR` to change it). `outputDirectory` can only name a
sub-folder inside that root. The official
FamilySearch viewer opens briefly while preparing the file. JPG downloads use the
original scan resolution; PDF downloads are available with or without highlights.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Not authenticated" errors | Run `npm run login` or use `set-session-cookie` |
| Session expired / 401 errors | Re-run `npm run login` |
| "Request blocked by FamilySearch security (error 15)" | Re-run `npm run login` to refresh bot-protection cookies, then wait a few minutes before retrying. Repeated requests prolong the block |
| Browser not found | Install Brave, Chrome, or Chromium, or set `FAMILYSEARCH_BROWSER_PATH` to its executable |
| MCP tools not appearing | Confirm `npm run build` succeeded and restart your MCP client |
| `node` not found | Use the full path to your Node binary in the MCP config |

---

## Rate limiting

FamilySearch's security service blocks clients that issue requests too quickly
(`error 15`). This server is deliberately conservative to avoid getting your IP
address blocked. It:

- spaces every API request out by **at least ~4 seconds**, plus random jitter so
  the cadence is not perfectly regular
- retries transient failures (HTTP 429/5xx and network errors) with slow,
  jittered exponential backoff (starting at ~3s, capped at 60s)
- honors the `Retry-After` header when FamilySearch sends one
- enters a **15-minute cooldown** after a security block (error 15) or a
  rate-limit response, during which all requests fail fast instead of hammering
  the API

Error 15 is a hard bot-protection block and is **not** retried automatically. If
you see it, wait for the cooldown to finish, refresh your session with
`npm run login`, and then retry.

All values are configurable through environment variables in your MCP client
config (values are milliseconds unless noted):

| Variable | Default | Meaning |
|---|---|---|
| `FAMILYSEARCH_MIN_INTERVAL_MS` | `4000` | Minimum delay between requests |
| `FAMILYSEARCH_JITTER_FACTOR` | `0.5` | Random extra delay as a fraction of the interval (0–1) |
| `FAMILYSEARCH_MAX_RETRIES` | `2` | Retry attempts for transient failures |
| `FAMILYSEARCH_BACKOFF_MS` | `3000` | Base delay for exponential backoff |
| `FAMILYSEARCH_BACKOFF_MAX_MS` | `60000` | Maximum backoff delay |
| `FAMILYSEARCH_COOLDOWN_MS` | `900000` | Pause after a block / rate limit (15 min) |

To be extra gentle, raise the interval and cooldown, for example:

```json
{
  "mcpServers": {
    "familysearch": {
      "command": "node",
      "args": ["build/index.js"],
      "cwd": "/path/to/familysearch-mcp",
      "env": {
        "FAMILYSEARCH_MIN_INTERVAL_MS": "8000",
        "FAMILYSEARCH_COOLDOWN_MS": "1800000"
      }
    }
  }
}
```


## Security

- Session cookies are stored locally in `~/.familysearch-mcp/config.json`
  (`chmod 600` on macOS/Linux; on Windows it relies on your user profile's permissions)
- They grant the same access as your browser session — **never share this file**
- Sessions expire after inactivity; re-authenticate when tools return auth errors
- The server runs locally over stdio and only ever talks to `https://*.familysearch.org`:
  any other URL, including one returned by the API or reached through a redirect,
  is refused before the cookies are attached
- Person and record IDs are validated before they are put into request paths
- Downloads can only be written inside the download root
- All tools are read-only on FamilySearch; nothing edits your tree
- This is an unofficial client of FamilySearch's internal website endpoints,
  not its public API. Use it at a human pace (the defaults do this) and be aware
  it is outside FamilySearch's supported integrations

See [AUDIT.md](AUDIT.md) for details.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `FAMILYSEARCH_BROWSER_PATH` | auto-detected | Browser executable for login, film listing and downloads |
| `FAMILYSEARCH_DOWNLOAD_DIR` | `~/Downloads/familysearch-mcp` | Root folder for downloads |
| `FAMILYSEARCH_*` rate-limit settings | see [Rate limiting](#rate-limiting) | Request pacing |

## License

MIT
