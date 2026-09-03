# UKLASH Sell-Through Normaliser

Internal tool that takes retailer sell-through exports (CSV/XLSX, one of 8
different formats) and normalizes them into UKLASH's standard schema, ready
to load into Snowflake.

Runs entirely client-side — no backend, no server, no data ever leaves the
browser of whoever uploads a file. Static site, deployable to GitHub Pages.

## Status

Framework is complete: upload, retailer selection/auto-detect, preview,
validation, CSV download, combined-dataset download across multiple
retailers in one session, access gate. **All 8 retailers now have real,
tested parsers** — see "Adding a retailer" below for how each one works.

- **Real, tested parsers**:
  - John Lewis (`src/retailers/johnLewis.ts`) — verified against a real
    ~3,850-row export.
  - Sephora Online (`src/retailers/sephoraOnline.ts`) — verified against a
    real ~835-row export; summed `SALES_UNITS`/`SALES_AMOUNT` tie out
    exactly to the source file's own grand-total row.
  - Sephora Store (`src/retailers/sephoraStore.ts`) — verified against a
    real ~4,200-row export (17 stores × products × weeks); summed
    `SALES_UNITS`/`SALES_AMOUNT` tie out exactly to the source file's own
    "Total" column group.
  - ASOS (`src/retailers/asos.ts`) — verified against a real one-week
    export; sums each product's price-tier rows (Full Price/Promo/etc.)
    into a single row per product.
  - Lookfantastic (`src/retailers/lookfantastic.ts`) — verified against a
    real ~450-row export spanning 51 weeks; the simplest parser so far —
    clean CSV, header row 1, dates already exactly Monday-start weeks, no
    subtotal rows to strip.
  - Selfridges (`src/retailers/selfridges.ts`) — verified against a real
    260-row export (5 stores × 52 weeks); summed `SALES_AMOUNT` ties out
    to within £1 of the source file's own TOTAL row (rounding noise
    across 260 rows, not a bug). `PRODUCT_TITLE` is `null` — see "Open
    provisional decisions" for why.
  - Boots (`src/retailers/boots.ts`) — verified against a real
    ~1,050-row export spanning 52 weeks. The original spec guessed Boots
    would be store-totals-only (`PRODUCT_TITLE: null`) — that guess was
    wrong, the real export is SKU-level. Also mixes in the "Groa" brand
    like ASOS, and reports weeks as the closing Saturday of a
    Sunday-Saturday week (converted the same way as John Lewis's
    Sunday-start weeks, just from the other end).
  - Oliver Bonas (`src/retailers/oliverBonas.ts`) — verified against a
    real 13-tab export (one tab per month, Aug 2025–Aug 2026), 78 rows.
    The original spec's guess that Oliver Bonas would be
    store-totals-only was also wrong — it's SKU-level too. `PERIOD` is
    `"MONTH"` here, not `"WEEK"` — see "Open provisional decisions" for
    why, and for the `CHANNEL`/`STORE_LOCATION`/`REGION` placeholder
    pending a decision with the business.
  - Anthropologie (`src/retailers/anthropologie.ts`) — verified against a
    real 12-row single-month export; summed `SALES_UNITS` ties out
    exactly to the source file's own Total row, `SALES_AMOUNT` within £1
    (rounding noise). `PERIOD` is `"MONTH"` here too, and `CHANNEL` is
    `"Unknown"` — see "Open provisional decisions" for why.
- **All 8 retailers are now real, tested parsers** (9 parser entries,
  since Sephora is split into Online/Store).

Two decisions from the John Lewis mapping are marked provisional and may
need revisiting once more retailers are in (see "Open provisional
decisions" below): how Sunday-start weeks convert to our Monday-start
`WEEK_ENDING`, and how `REGION` is derived with no source region column.

There is no "Push to Snowflake" button in this version by design — v1 ships
clean CSV output only, loaded into Snowflake separately. This keeps the app
fully static (no server-held credentials to manage). It can be added later
as a small serverless function without changing the rest of the app.

## Combined dataset (multiple retailers in one session)

Uploading and loading each retailer's file into Snowflake one at a time
(upload → download → repeat → merge manually) got tedious with 6+
retailers a week, so the app now supports both:

- **Per-file download** (unchanged) — process one file, click "Download
  CSV", get just that retailer's normalized rows.
- **Combined download** — after reviewing a file (0 validation issues,
  same gate as the per-file download), click "Add to combined dataset"
  instead. It's added to a running list (`src/components/BatchPanel.tsx`,
  state lives in `App.tsx`) that persists across uploads in the same
  browser tab. Upload the next retailer's file the same way — the batch
  keeps accumulating. "Download combined CSV" concatenates every added
  retailer's rows into one file, ready to `MERGE` into Snowflake in a
  single load instead of one per retailer.

The "Download CSV"/"Add to combined dataset" buttons sit right after
validation, *above* the preview table (`App.tsx`) — not below a
potentially 50-row table, where they'd be easy to miss before moving on
to the next upload. The explanatory hint sits with them, in the same
spot. `BatchPanel` (`src/components/BatchPanel.tsx`) itself only renders
once at least one file has been added — it isn't shown as an empty box
up front, since the buttons being above the table already make the
feature hard to miss without needing a permanently-visible callout.

Adding a retailer that's already in the batch **replaces** its entry
rather than duplicating it (e.g. if you fix a file and re-add it). The
batch is in-memory only — it resets on page refresh, matching the rest of
the app's "nothing persists, nothing leaves the browser" design.

## Local development

```bash
npm install
npm run dev
```

## Building

```bash
npm run build
```

Output goes to `dist/`, which is a fully static site — open `dist/index.html`
via any static server, or deploy it anywhere that serves static files.

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. In the repo settings, go to **Pages** and set the source to **GitHub
   Actions**.
3. The included workflow (`.github/workflows/deploy.yml`) builds and
   deploys automatically on every push to `main`.
4. Your site will be live at `https://<your-username>.github.io/<repo-name>/`.

No environment variables are required for this version — everything runs
in the browser.

## Access gate

The app is protected by a simple client-side passphrase gate
(`src/auth/config.ts`), matching the pattern used by other internal UKLASH
GitHub Pages tools. **This is not real security** — it's a deterrent
against the tool being casually stumbled on, not a way to protect data
(there's no data to protect server-side; everything is processed in the
uploader's own browser). Change `ACCESS_PASSPHRASE` before deploying.

If UKLASH's GitHub plan is Enterprise Cloud, you can additionally restrict
the published Pages site itself to logged-in org members under repo
Settings → Pages → Visibility, which is real access control (unlike the
passphrase).

## Adding a retailer

Each retailer has one file in `src/retailers/`, implementing the
`RetailerParser` interface (`src/retailers/types.ts`):

- `key` — stable id, e.g. `"lookfantastic"`
- `label` — display name, also used as the `RETAILER` output value
- `skuLevel` — `true` if this retailer should always report a real
  `PRODUCT_TITLE` (blank is treated as a validation error); `false` for
  retailers that only report store-level totals (blank `PRODUCT_TITLE` is
  expected and valid). Don't trust the original spec's per-retailer
  guesses here without checking the real file first — it guessed Boots
  would be `false` (store-totals-only) and that turned out to be wrong
  (real Boots data is SKU-level); Selfridges is confirmed `false`, but
  only because the file has no per-product revenue at all (see "Open
  provisional decisions"), not because the spec assumed so
- `detect(sheet)` — return a 0–1 confidence score based on filename/headers,
  used only to *suggest* a retailer in the dropdown; the user always
  confirms or overrides
- `parse(sheet)` — map the raw rows into `ParsedRow[]` (`NormalizedRow`
  minus `ROW_KEY`, which is computed centrally afterward — see "ROW_KEY"
  below — never set it yourself). Throw `RetailerFormatError` with a
  specific message if the sheet doesn't match the expected layout — never
  guess or silently drop/blank a field just to make it fit

Once you write a real `parse()`, register it in
`src/retailers/registry.ts`. Nine fully worked examples to copy patterns
from (8 retailers, 9 parsers since Sephora is split into Online/Store):

- `src/retailers/johnLewis.ts` — a title row above the real header, and
  non-Monday-start weeks.
- `src/retailers/sephoraOnline.ts` — a multi-tab workbook (reads a
  specific named tab out of 20+, via `sheet.sheets['tab name']`), a
  report with repeated column headers across grouped sections (reads the
  "Total" group specifically, verifying sub-header text at the expected
  offset so a layout change fails loudly), a week label that's a
  year+week number rather than a date (`weekEndingFromIsoYearWeek()`),
  and blank cells that mean zero rather than missing data.
- `src/retailers/sephoraStore.ts` — same workbook shape as Sephora
  Online (same tab name, same "grouped columns" pattern), but grouped
  by **store** instead of UK/Other/Total, meaning one input row expands
  into up to 17 output rows (one per store) instead of one. Uses
  `discoverColumnGroups()`/`findSubColumnOffset()` to find each store's
  columns dynamically rather than assuming a fixed width — the real file
  has an inconsistent extra spacer column in 2 of the 17 store groups but
  not the rest, which a hardcoded offset would have silently mis-mapped.
  Also derives `REGION` by stripping a store name's bracketed suffix
  (`"Manchester (Trafford)"` → `"Manchester"`), matching the spec's own
  example format exactly.
- `src/retailers/asos.ts` — one file per week (not one file covering
  many weeks like the others), with the week's date range as free text
  in a title cell (`"Last Week: 24/08/2026 - 30/08/2026"`) rather than a
  real date column — the end date is validated as an actual Sunday
  before being trusted as `WEEK_ENDING`, so a future ASOS convention
  change fails loudly instead of silently shifting every week by a day.
  Also sums each product's multiple price-tier rows (Full Price, Promo,
  Markdown, ...) into one row per product, and tags rows with `BRAND`
  (see below) since the sheet mixes UKLASH's own product lines with
  another brand ("Groa") reported under the same category.
- `src/retailers/lookfantastic.ts` — the simple case: clean CSV, header
  row 1, `WEEK_ENDING` already given directly (`Week_End_Date`, ISO
  `YYYY-MM-DD`) as an exact Monday-start week's Sunday — no conversion
  needed, just validated as a genuine Sunday defensively. Worth noting:
  the file itself is named after the legal entity ("UK Skinlabs
  Limited"), not "Lookfantastic" — `detect()` can't rely on filename here
  and uses the header shape alone.
- `src/retailers/selfridges.ts` — the most involved parser so far.
  Revenue and units live in two separate tabs at *different* levels of
  detail (revenue only by store+week; units by product+store+week — see
  "Open provisional decisions"), joined by a `"store|week"` key built
  from each tab independently. Week rows are labeled `"week01"`.."week52"
  with no date anywhere in the sheet — the calendar year is extracted
  from the filename (e.g. `"UK Lash 2026 (2).xlsx"` → `2026`) and then
  cross-checked against the month labels sprinkled through the sheet
  (`"JAN"`, `"FEB"`, ...), so a wrong year (bad filename, or a future
  file using a genuinely different fiscal calendar) fails loudly instead
  of silently mislabeling every week. Also handles a column-group shape
  `discoverColumnGroups()` doesn't fit (a week's label repeats across
  every column in its block, rather than only appearing once at the
  start) via `groupRunsByLabel()` (`src/lib/rawSheet.ts`). `REGION` is a
  hardcoded lookup for Selfridges' 4 known UK stores (their names don't
  contain their region as a substring, unlike John Lewis/Sephora) —
  extend `REGION_BY_STORE` if a new store ever appears; it throws rather
  than guessing.
- `src/retailers/boots.ts` — two column blocks (sales amount, units)
  that each repeat their own label across all 52 of their week columns
  (another `groupRunsByLabel()` case, promoted to `rawSheet.ts` once a
  second retailer needed the same pattern). Reports each week by its
  *closing Saturday* rather than an opening Sunday or any Monday-start
  date — `weekEndingFromSaturdayClose()` converts it, verifying the
  source date is actually a Saturday first so a convention change fails
  loudly. No store/channel breakdown at all (confirmed with the business
  to treat as `Online`), and mixes in the "Groa" brand like ASOS. Also:
  the original spec guessed Boots would be store-totals-only
  (`PRODUCT_TITLE: null`) — the real file is SKU-level, so don't assume
  the spec's per-retailer guesses hold once real data arrives.
- `src/retailers/oliverBonas.ts` — one tab per month (13 tabs so far,
  Aug 2025–Aug 2026) rather than one sheet with many rows, so `parse()`
  loops over every sheet and concatenates. Units are genuinely reported
  weekly and split by Store/Web channel, but revenue is only reported
  once per product per month, already blended across both channels —
  see "Open provisional decisions" for how that's handled (`PERIOD:
  "MONTH"` instead of `"WEEK"`, the first retailer where that varies).
  The month itself is parsed directly from a `"Mon-YY"` header (e.g.
  `"Aug-26"`) rather than inferred from context. Cross-checks that the
  weekly Store+Web units actually sum to the stated month total for
  every row, catching a layout drift immediately rather than silently
  mis-summing.
- `src/retailers/anthropologie.ts` — the simplest of the month-grain
  retailers: a single sheet per month (no tabs to loop over), with the
  report period given as free text (`"FY27_CY26 Aug"`) rather than any
  real date cell. Also the first retailer with genuinely zero channel
  signal — no Store/Web split, no store column, nothing to infer a split
  from — so `CHANNEL`/`STORE_LOCATION`/`REGION` are `"Unknown"` rather
  than a guess (see "Open provisional decisions"). The product
  description column has no header text of its own; it's found
  positionally, immediately before the "Sales U" column.

Shared helpers already exist so you don't need to duplicate logic per
retailer:

- `src/lib/dateUtils.ts` — parsing `DD/MM/YYYY` (`parseDDMMYYYY`) or ISO
  `YYYY-MM-DD` (`parseYYYYMMDD`), deriving
  `WEEK_ENDING`/`CALENDAR_YYYY_WW`/`CALENDAR_YYYY_MM`/`FINANCIAL_YYYY_WW`/
  `FINANCIAL_YYYY_MM` from any date via `deriveDateFields(date)`, and
  `weekEndingFromIsoYearWeek(year, week)` for retailers that label rows
  with an ISO year+week number instead of an actual date (verified as a
  true round-trip inverse of `calendarYYYYWW()` across 2020–2030,
  including 53-week years), and `weekEndingFromSundayWeekStart()` /
  `weekEndingFromSaturdayClose()` for the two non-Monday-start week
  shapes seen so far (both PROVISIONAL — see "Open provisional decisions")
- `src/lib/currency.ts` — `parseCurrencyToNumber(string)` to parse a raw
  source value (e.g. `"£1,234.56"`, `"-£12.50"`, `"(12.50)"`) into a plain
  number, `roundToPence(number)` to avoid floating-point noise before
  assigning it to `SALES_AMOUNT`, and `parseIntegerUnits(string)` — every
  retailer's `SALES_UNITS` parsing should use this, not a bare
  `Number(...)`. An older real Sephora Store export had every cell,
  including units (not just money), prefixed with a stray literal `"$"`
  from an Excel number-format artifact (e.g. `"$4"`, even `"$£114.00"`)
  — `parseIntegerUnits()` strips that the same way `SALES_AMOUNT` parsing
  already did, so a future retailer with a similar formatting quirk in
  its units column won't hit the same bug.
- `src/lib/rawSheet.ts` — `findHeaderRowIndex()`/`gridRowsFromHeader()`
  for locating a header row that isn't row 1, and
  `discoverColumnGroups()`/`findSubColumnOffset()` for reports with a
  repeated-header column-group pattern (one group per store/region/etc.)
- For multi-tab XLSX workbooks, `RawSheet.sheets` (in
  `src/retailers/types.ts`) gives every tab as a raw grid keyed by tab
  name — `rawGrid` alone is only the first tab

### SALES_AMOUNT is a float, not a formatted string

The original spec called for `SALES_AMOUNT` as a formatted string
(`"£14,154.54"`). That's been changed on request: it's a plain `number`
(e.g. `76`, `-190.5`) with no currency symbol or comma separators, so it
loads straight into a Snowflake `FLOAT` column — matching how other
revenue figures are already stored there. Every retailer's `parse()`
should assign a `number` (via `parseCurrencyToNumber()` +
`roundToPence()`), not a formatted string.

### BRAND — added beyond the original spec

Not in the original spec's schema. Added because ASOS's export mixes
UKLASH's own product lines (UKLASH/UKBROW/UKHAIR/UKLIPS — all tagged
`"UKLASH"`) with another brand, "Groa", reported under the same "Skin,
Body & Hair Brands" category — rather than silently dropping or
mis-attributing those rows, they're kept and tagged `BRAND: "GROA"`.
Boots' export mixes in "Groa" too. Every retailer's `parse()` must set
`BRAND` (defaults to `"UKLASH"` for retailers with no multi-brand signal
in their source data — confirmed so far for John Lewis, both Sephora
files, Selfridges, Oliver Bonas, and Anthropologie). If more brands turn
up in other retailers' files, extend `deriveBrand()`-style detection per
retailer rather than assuming "Groa" is the only other brand.

### ROW_KEY — added beyond the original spec, for avoiding duplicate loads

Not in the original spec's schema. Every row gets a stable computed key
(`src/lib/rowKey.ts`, applied centrally in `App.tsx` after a retailer's
`parse()` runs — individual parsers never set it themselves) built from
`RETAILER|BRAND|PRODUCT_TITLE|WEEK_ENDING|CHANNEL|STORE_LOCATION|PERIOD`.
Two rows get the same key if and only if they represent the same
real-world sales fact (same product, week, store/channel), regardless of
which upload or file they came from.

**Why this exists:** the tool itself has no memory between uploads, and
most retailers here send a rolling window that re-includes old weeks
alongside new ones every time (John Lewis, Sephora, Lookfantastic,
Selfridges, and Boots all do this — only ASOS sends one week per file).
Without a key, loading that into Snowflake as plain `INSERT`/append
would duplicate every previously-loaded week, every time.

**Recommended Snowflake pattern:** load into a staging table, then
`MERGE INTO` the real table on `ROW_KEY` (update on match, insert
otherwise). This makes it safe — and actually preferable — to upload a
retailer's *entire* file every time rather than trying to figure out
"what's new": unchanged historical rows just update to identical values
(no-op in effect), new weeks get inserted, and if a retailer revises a
past week (e.g. a late-processed return), the correction flows through
automatically on the next upload instead of leaving stale data sitting
in Snowflake. Roughly:

```sql
MERGE INTO sell_through AS target
USING staging_table AS source
ON target.ROW_KEY = source.ROW_KEY
WHEN MATCHED THEN UPDATE SET ... -- all columns
WHEN NOT MATCHED THEN INSERT (...) VALUES (...)
```

### Financial year convention

UKLASH's financial year runs April–March, labeled by the calendar year it
ends in (April 2026–March 2027 = "FY2027"). `FINANCIAL_YYYY_WW` counts
plain Monday-start weeks from the Mon–Sun week containing April 1st (week
1), **not** a 4-4-5 retail calendar. If that ever needs to change, the only
place to update is `financialWeek()` in `src/lib/dateUtils.ts`.

### Currency

All 8 retailers are assumed to report in GBP. If a retailer reporting in a
different currency turns up, flag it — the schema and validation currently
assume `SALES_AMOUNT` is always GBP.

## Open provisional decisions

These were shipped with a working default so the affected retailer(s)
could be tested now, but the underlying question is explicitly still open
— revisit before this is treated as final:

- **Sunday–Saturday weeks → `WEEK_ENDING`.** John Lewis reports weeks as
  Sunday–Saturday (given the opening Sunday date); Boots reports the same
  Sunday–Saturday week shape but gives the *closing Saturday* instead.
  Our schema wants Monday–Sunday. There's no daily-level data to convert
  exactly, so `weekEndingFromSundayWeekStart()` / `weekEndingFromSaturdayClose()`
  in `src/lib/dateUtils.ts` both shift to the following Sunday (they're
  mathematically the same conversion, just expressed from either end of
  the week), which gives 6/7 days' overlap with our Monday-start week
  (vs. 1/7 if used as-is) — the better of the two simple options, but
  still an approximation. Decision was deliberately deferred until more
  retailers' week conventions are known, in case a single unified rule
  makes more sense than a per-retailer one. If another retailer turns up
  with its own non-Monday-start weeks, check whether it should reuse one
  of these two helpers or needs its own rule.
- **`REGION` with no source region column.** John Lewis's file has branch
  names only (e.g. "John Lewis Cardiff"), no actual region field.
  `deriveRegion()` in `src/retailers/johnLewis.ts` currently just strips
  the "John Lewis " prefix to get a place name (e.g. "Cardiff") — not a
  true UK region grouping. Fine for now; flagged as wanting eventual
  consistency with however other retailers' regions turn out to be
  represented, and a real store→region mapping if UKLASH has (or wants) a
  formal regional grouping.
- **Selfridges: `PRODUCT_TITLE` is `null` (store-level only), discarding
  real per-SKU unit detail.** Selfridges' file has revenue only at
  (store, week) — no per-product revenue anywhere — but units *are*
  available at (product, store, week) in a separate tab. Explicitly
  decided (2026-09-02) to go store-level-only for now rather than
  estimate per-product revenue by splitting each store-week's total
  across products by unit share, since that assumes a uniform average
  price across products (untrue — a serum and a gift set don't cost the
  same) and could meaningfully misstate revenue by product. The real
  per-SKU unit breakdown in `src/retailers/selfridges.ts` is currently
  summed away into store totals rather than surfaced. Revisit once
  there's a decision on whether/how to estimate or source per-product
  revenue — `parseUnitsByStoreWeek()` already parses the full per-SKU
  detail, so a future product-level version wouldn't need to rebuild
  that part.
- **Oliver Bonas: `PERIOD` is `"MONTH"`, and `CHANNEL`/`STORE_LOCATION`/
  `REGION` are `"Combined"`.** Same underlying problem as Selfridges,
  on a different axis: Oliver Bonas reports units genuinely at
  product+week+channel (Store vs Web) detail, but revenue only once per
  product per month, already blended across both channels. Explicitly
  decided (2026-09-03) to report at the coarser but real month grain
  (`PERIOD: "MONTH"`, `WEEK_ENDING` = last day of the month) rather than
  estimate weekly or per-channel revenue — same reasoning as the
  Selfridges decision. Unlike Selfridges, `PRODUCT_TITLE` is real here
  (Oliver Bonas's file is genuinely SKU-level), so only the
  time/channel axis is collapsed, not the product axis.
  `CHANNEL`/`STORE_LOCATION`/`REGION` are all `"Combined"` — deliberately
  chosen over `"Unknown"` because we *do* know it's a real blend of
  Store+Web (the discarded weekly unit split shows every product at
  74–99% store mix), unlike Anthropologie below where there's no signal
  at all. `"Combined"` reflects "we know both channels contributed, just
  not how much revenue each one"; `"Unknown"` would understate what we
  actually know here. This is a placeholder pending a conversation with
  the business about whether to instead split into separate Store/Web
  rows with revenue allocated by each channel's real unit share for that
  product — more defensible than the Selfridges case (same product/price
  in both channels, not different products), but still an allocation,
  not a directly reported figure, so explicitly deferred rather than
  done silently. The weekly Store/Web unit detail is discarded (summed
  into the month total) in the meantime, same pattern as Selfridges'
  per-SKU units.
- **Anthropologie: `CHANNEL`/`STORE_LOCATION`/`REGION` are `"Unknown"`.**
  Unlike every other retailer, Anthropologie's file has zero channel
  signal at all — no Store/Web split anywhere, nothing to infer one
  from. Forcing a guess into `"Online"` or `"Store"` would be less
  honest than saying we don't know, so `"Unknown"` was added as a schema
  value (2026-09-03) rather than defaulting to one of the other two. If
  Anthropologie ever starts reporting a channel breakdown, this should
  switch to a real value like every other retailer.

## Validation rules

Applied to every normalized row before download is enabled
(`src/lib/validate.ts`):

- `WEEK_ENDING` must parse as a valid `DD/MM/YYYY` date
- `SALES_UNITS` must be an integer
- `SALES_AMOUNT` must be a finite number (negative values are allowed —
  some retailers report net-negative weeks where returns exceed sales for
  a given SKU/store, e.g. John Lewis)
- `PRODUCT_TITLE` blank is only valid for retailers with `skuLevel: false`
- `CHANNEL` must be `Online`, `Store`, `Unknown`, or `Combined`; `Online`
  rows must have `STORE_LOCATION`/`REGION` set to `Online`, `Unknown`
  rows must have them set to `Unknown`, and `Combined` rows must have
  them set to `Combined`

If a file is missing required source columns entirely, the retailer's
`parse()` should throw before any rows are produced, rather than
downloading has any blank/zero placeholder values.

## CSV output encoding

`downloadCsv()` in `src/lib/csvExport.ts` prepends a UTF-8 byte-order mark
(BOM) to the file. Without it, Excel ignores the file's declared UTF-8
charset and falls back to the system codepage, which garbles non-ASCII
characters (this bit us with `£` when `SALES_AMOUNT` was still a
formatted string — worth keeping in mind if any retailer's raw data ever
needs a non-ASCII character preserved in the output). Snowflake's CSV file format defaults
`SKIP_BYTE_ORDER_MARK` to `TRUE`, so it strips this BOM automatically on
load — no special handling needed on the Snowflake side unless that
default has been overridden.

## Known future work

- **Product naming isn't unified across retailers.** Each retailer names
  the same UKLASH product differently (John Lewis's `Product Description`
  is a mix of readable names and SKU-like slugs, e.g. `#uklash-3ml` vs.
  `great lengths set`). `PRODUCT_TITLE` is currently passed through as
  given by each retailer. Making product names consistent across
  retailers would need a master SKU/product-name mapping table, which
  doesn't exist yet — worth building once more retailers' naming is known.
- **VAT treatment isn't confirmed consistent across retailers.** Sephora's
  only revenue figure is "Sales Ex Vat" (VAT-exclusive) — that's what
  feeds `SALES_AMOUNT` for Sephora, since it's the only figure the report
  offers. Whether other retailers' revenue columns are VAT-inclusive or
  -exclusive hasn't been checked (John Lewis's "Sales Value" wasn't
  specifically confirmed either way). Worth a pass across all 8 once
  they're all mapped, to make sure `SALES_AMOUNT` means the same thing
  retailer-to-retailer. ASOS adds another wrinkle here: its "Retail Sales
  Value" (used for `SALES_AMOUNT`, per instruction) is gross — before
  returns are deducted — whereas "Net Sales Value" is net of returns,
  unlike every other retailer mapped so far. Worth checking this doesn't
  distort ASOS vs. other-retailer comparisons once VAT is also reconciled.
- **ASOS's "Overview" tab is assumed to already be the sum of its 3
  "Warehouse" tabs** (FC01/FC04/P005 — per-fulfilment-centre breakdowns of
  the same data), spot-checked against one product's figures rather than
  fully reconciled. `asos.ts` only reads "Overview"; the Warehouse tabs
  are unused. Worth a full reconciliation if ASOS numbers ever look off.
