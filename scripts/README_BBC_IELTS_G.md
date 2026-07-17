# BBC IELTS G Article Filter (Git Bash)

This script finds BBC News articles that are closer to IELTS General reading style:
- topic filtering (jobs, housing, cost of living, health, etc.)
- article length filtering (word count)
- title length filtering
- subheading filtering (meaningful H2 count)
- optional proxy support

## Script

`scripts/find_bbc_ielts_g.sh`

## Quick Start

```bash
chmod +x ./scripts/find_bbc_ielts_g.sh

./scripts/find_bbc_ielts_g.sh \
  --proxy http://10.190.254.20:80 \
  --topic-preset g_plus_science \
  --feeds-preset ielts_focus \
  --min-words 550 --max-words 1300 \
  --min-title-chars 35 --min-h2 2 \
  --limit 10 \
  --out-file ./output/bbc_ielts_g.txt
```

## Why include science topics for IELTS G?

Including some natural science is useful because:
- IELTS Listening is shared across modules
- vocabulary overlap appears in health/environment/public issues
- mixed-topic reading improves adaptability

Use `g_plus_science` (default) to include this.

## Presets

```bash
./scripts/find_bbc_ielts_g.sh --list-topic-presets
```

- `g_core`: practical daily-life GT topics
- `g_plus_science`: g_core + science/environment/conservation
- `economy_jobs`: jobs/economy/finance focus

## Common Tweaks

If too few articles are returned:
- lower `--min-words` (e.g. 450)
- lower `--min-h2` (e.g. 1)
- lower `--min-title-chars` (e.g. 25)
- raise `--limit`

If results are too broad:
- pass custom `--topics "jobs,salary,housing,transport,health"`
- narrow `--feeds` to `uk,business`

Feed keys:
- `uk,business,world,science,health,politics,education,technology,entertainment`: BBC News RSS
- `travel,earth`: Google News RSS queries constrained to BBC domains

Feed presets:
- `ielts_focus` (default): `uk,business,world,science,health,education`
- `broad_news`: `uk,business,world,science,health,education,technology,politics`
- `all`: all feed keys above

For IELTS prep, use `ielts_focus` first and add `technology` only when you want extra variety.

## Output formats

- default: readable table
- `--output tsv`: machine-friendly output
- `--out-file PATH`: write output to a file (streaming as matches are found)

To watch results in real time:

```bash
tail -f ./output/bbc_ielts_g.tsv
```

## Fast/Stable Run (slow proxy)

```bash
./scripts/find_bbc_ielts_g.sh \
  --proxy http://10.190.254.20:80 \
  --topic-preset g_plus_science \
  --feeds-preset broad_news \
  --min-words 450 --max-words 1400 \
  --min-title-chars 28 --min-h2 1 \
  --max-items-per-feed 20 --connect-timeout 8 --timeout 20 \
  --limit 10 \
  --out-file ./output/bbc_ielts_g.tsv \
  --output tsv
```
