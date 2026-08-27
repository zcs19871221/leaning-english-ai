# BBC IELTS G Article Filter (Node.js)

This script finds BBC articles useful for IELTS General Reading practice, especially
Section 3 and vocabulary that transfers to Sections 1 and 2:
- practical topic filtering (work, housing, consumer services, travel, health, etc.)
- article length filtering (word count)
- title length filtering
- subheading filtering (meaningful H2 count)
- optional proxy support

BBC articles do not reproduce the advertisements, notices, forms, timetables and
workplace documents typical of Sections 1 and 2. Use official IELTS practice tests
for those formats; use this script mainly for Section 3 reading fluency, vocabulary,
paraphrase recognition and identifying main ideas.

## Script

`scripts/find_bbc_ielts_g.js`

Note:
- Use the Node.js command (`node ./scripts/find_bbc_ielts_g.js ...`) as the primary entrypoint.
- Do not use the legacy `find_bbc_ielts_g.sh` command in new runs.

## Quick Start

```bash
node -v

node ./scripts/find_bbc_ielts_g.js \
  --proxy http://10.190.254.20:80 \
  --topic-preset g_reading \
  --feeds-preset g_reading \
  --min-words 550 \
  --max-words 1400 \
  --min-h2 0 \
  --limit 0 \
  --concurrency 8 \
  --out-file ./output/bbc_ielts_g.tsv \
  --output tsv
```

## Optional science topics

Including some natural science is useful because:
- IELTS Listening is shared across modules
- vocabulary overlap appears in health/environment/public issues
- mixed-topic reading improves adaptability

Use `g_plus_science` when you specifically want this extra variety. The default
`g_reading` preset stays focused on higher-priority General Training topics.

## Presets

```bash
node ./scripts/find_bbc_ielts_g.js --list-topic-presets
```

- `g_reading`: balanced GT practical vocabulary and Section 3 topics
- `g_core`: practical daily-life GT topics
- `g_plus_science`: g_core + science/environment/conservation
- `economy_jobs`: jobs/economy/finance focus

## Common Tweaks

If too few articles are returned:
- lower `--min-words` (e.g. 450)
- H2 filter is disabled by default (`--min-h2 0`)
- set `--min-h2 1` or higher only if you want more structured articles
- title filter is disabled by default (`--min-title-chars 0`)
- set `--min-title-chars 25` only if you want to remove short headlines
- word upper bound is disabled by default (`--max-words 0`)
- set `--max-words 1400` only if you want to exclude very long articles
- raise `--limit`

If you want to scan all selected feeds without early stop:
- set `--limit 0`

If you want articles with more subheadings:
- set `--min-h2 3` or `--min-h2 4`

If results are too broad:
- pass custom `--topics "jobs,salary,housing,transport,health"`
- narrow `--feeds` to `uk,business`

Feed keys:
- `uk,business,world,science,health,politics,education,technology,entertainment`: BBC News RSS
- `travel,earth`: official `bbc.com` RSS (`travel/feed.rss`, `future/feed.rss`)

Feed presets:
- `g_reading` (default): `uk,business,health,technology,travel`
- `ielts_focus`: `uk,business,world,science,health,education,travel,earth`
- `broad_news`: `uk,business,world,science,health,education,technology,politics,travel,earth`
- `all`: all feed keys above

For IELTS General Reading, start with `g_reading`. It avoids dedicated education
and broad science feeds while retaining practical travel, health and technology.
It also rejects titles clearly centred on violent crime, deaths, war or obituaries.

## Output formats

- default: readable table
- `--output tsv`: machine-friendly output
- `--out-file PATH`: append output to a file (streaming, dedupe by `LINK`)
- `--concurrency N`: article fetch concurrency (default: 8)

When `--limit N` is greater than zero, the total output limit is distributed as evenly
as possible across the selected feeds. If a feed has too few matching articles, its
unused quota is passed to later feeds. For example, 5 feeds and `--limit 10` starts
with a target of 2 articles per feed.

When `--out-file` is used, file columns are simplified to:
- `TITLE`, `WORDS`, `LINK`

If the target file already exists:
- script appends new rows instead of truncating the file
- rows whose `LINK` already exists in the target file are skipped

To watch results in real time:

```bash
tail -f ./output/bbc_ielts_g.tsv
```

## Fast/Stable Run (slow proxy)

```bash
node ./scripts/find_bbc_ielts_g.js \
  --proxy http://10.190.254.20:80 \
  --topic-preset g_plus_science \
  --feeds-preset broad_news \
  --min-words 450 \
  --min-h2 0 \
  --concurrency 10 \
  --max-items-per-feed 20 --connect-timeout 8 --timeout 20 \
  --limit 0 \
  --out-file ./output/bbc_ielts_g.tsv \
  --output tsv
```


建议优先级：

第一优先：就业、消费、住房、交通、旅游、公共服务；
第二优先：健康、环境、实用科技；
第三优先：这类教育政策文章。