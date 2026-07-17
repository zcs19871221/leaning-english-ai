#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Find BBC articles suitable for IELTS General reading practice.

Usage:
  ./scripts/find_bbc_ielts_g.sh [options]

Options:
  --proxy URL                 Proxy address, e.g. http://10.190.254.20:80
                              If omitted, no proxy is used.
  --topic-preset NAME         Topic preset: g_core | g_plus_science | economy_jobs
                              Default: g_plus_science
  --topics CSV                Custom topics (comma-separated). Overrides preset.
                              Example: "jobs,housing,cost of living,health"
  --feeds-preset NAME         Feed preset: ielts_focus | broad_news | all
                              Default: ielts_focus
  --feeds CSV                 Feed keys (comma-separated).
                              Available: uk,business,world,science,health,politics,education,technology,entertainment,travel,earth
                              Overrides --feeds-preset when provided.
  --min-words N               Minimum article word count. Default: 500
  --max-words N               Maximum article word count. Default: 1400
  --min-title-chars N         Minimum title length. Default: 30
  --min-h2 N                  Minimum meaningful H2 subheadings. Default: 1
  --limit N                   Max matched articles to output. Default: 12
  --max-items-per-feed N      Max RSS items to scan per feed. Default: 25
  --connect-timeout N         Curl connect timeout seconds. Default: 8
  --timeout N                 Curl timeout seconds. Default: 25
  --output FORMAT             table | tsv (default: table)
  --out-file PATH             Write final output to a file
  --quiet                     Suppress progress logs
  --list-topic-presets        Print built-in topic presets and exit
  --list-feed-presets         Print built-in feed presets and exit
  --help                      Show this help and exit

Examples:
  ./scripts/find_bbc_ielts_g.sh \
    --proxy http://10.190.254.20:80 \
    --topic-preset g_plus_science \
    --min-words 550 --max-words 1300 --min-title-chars 35 --min-h2 2

  ./scripts/find_bbc_ielts_g.sh \
    --topics "jobs,salary,housing,transport,health,climate,wildlife" \
    --feeds-preset ielts_focus
EOF
}

list_topic_presets() {
  cat <<'EOF'
g_core:
  jobs, employment, salary, wage, housing, rent, mortgage, cost of living,
  inflation, transport, commute, health, school, education, children, family,
  community, public services, energy, water, tax, benefits, law

g_plus_science (default):
  g_core + climate, environment, wildlife, conservation, research, science,
  technology, disease, vaccine

economy_jobs:
  jobs, salary, wage, layoffs, hiring, economy, inflation, prices, tax,
  business, debt, personal finance, buy now pay later
EOF
}

list_feed_presets() {
  cat <<'EOF'
ielts_focus (default):
  uk,business,world,science,health,education

broad_news:
  uk,business,world,science,health,education,technology,politics

all:
  uk,business,world,science,health,politics,education,technology,entertainment,travel,earth
EOF
}

preset_topics() {
  local name="$1"
  case "$name" in
    g_core)
      echo "jobs,employment,job,salary,wage,housing,rent,mortgage,cost of living,price,prices,inflation,transport,commute,health,school,education,children,family,community,public service,energy,water,tax,benefit,benefits,law,crime"
      ;;
    g_plus_science)
      echo "jobs,employment,job,salary,wage,housing,rent,mortgage,cost of living,price,prices,inflation,transport,commute,health,school,education,children,family,community,public service,energy,water,tax,benefit,benefits,law,crime,climate,environment,wildlife,conservation,research,science,technology,disease,vaccine"
      ;;
    economy_jobs)
      echo "jobs,employment,job,salary,wage,layoff,hiring,economy,inflation,price,prices,tax,business,debt,finance,personal finance,buy now pay later"
      ;;
    *)
      echo "Unknown preset: $name" >&2
      exit 1
      ;;
  esac
}

trim() {
  local s="$1"
  s="${s#${s%%[![:space:]]*}}"
  s="${s%${s##*[![:space:]]}}"
  printf '%s' "$s"
}

lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

split_csv_to_array() {
  local csv="$1"
  local -n out_arr="$2"
  out_arr=()
  IFS=',' read -r -a raw <<< "$csv"
  for item in "${raw[@]}"; do
    item="$(trim "$item")"
    [[ -n "$item" ]] && out_arr+=("$(lower "$item")")
  done
}

html_entity_decode_basic() {
  sed -E \
    -e 's/&nbsp;/ /g' \
    -e 's/&amp;/\&/g' \
    -e "s/&#x27;/'/g" \
    -e 's/&quot;/"/g' \
    -e 's/&lt;/</g' \
    -e 's/&gt;/>/g'
}

extract_rss_items() {
  # Input: RSS XML content
  # Output: title<TAB>link<TAB>description
  tr '\n' ' ' \
  | sed 's#</item>#</item>\n#g' \
  | awk '
    function between(s,a,b,   x,y,t) {
      x=index(s,a)
      if (!x) return ""
      x+=length(a)
      t=substr(s,x)
      y=index(t,b)
      if (!y) return ""
      return substr(t,1,y-1)
    }
    /<item>/ {
      title=between($0,"<title><![CDATA[","]]></title>")
      if (title=="") title=between($0,"<title>","</title>")
      desc=between($0,"<description><![CDATA[","]]></description>")
      if (desc=="") desc=between($0,"<description>","</description>")
      link=between($0,"<link>","</link>")
      if (title!="" && link!="") {
        gsub(/&amp;/,"&",link)
        print title "\t" link "\t" desc
      }
    }
  '
}

extract_article_block() {
  # Input: full HTML (single line preferred)
  # Output: article block if present, otherwise full HTML
  local html="$1"
  if [[ "$html" == *"<article"*"</article>"* ]]; then
    local after_article="${html#*<article}"
    local article_body="${after_article%%</article>*}"
    printf '<article%s</article>' "$article_body"
  else
    printf '%s' "$html"
  fi
}

extract_word_count() {
  local html_block="$1"
  local text
  text="$(printf '%s' "$html_block" \
    | sed -E 's/<script[^>]*>[^<]*(<[^>]+>[^<]*)*<\/script>/ /gi' \
    | sed -E 's/<style[^>]*>[^<]*(<[^>]+>[^<]*)*<\/style>/ /gi' \
    | sed -E 's/<[^>]+>/ /g' \
    | html_entity_decode_basic \
    | tr -s '[:space:]' ' '
  )"
  printf '%s' "$text" | wc -w | tr -d ' '
}

extract_meaningful_h2() {
  local html_block="$1"
  local raw cleaned
  raw="$(printf '%s' "$html_block" | grep -oiE '<h2[^>]*>[^<]+' || true)"
  cleaned="$(printf '%s' "$raw" \
    | sed -E 's/<h2[^>]*>//Ig' \
    | html_entity_decode_basic \
    | sed -E 's/^\s+|\s+$//g' \
    | awk 'length($0)>=8'
  )"

  printf '%s\n' "$cleaned" \
    | grep -Ev '^(Get in touch|Related topics|More on this story|The video playlist|Top stories|More to explore|Elsewhere on the BBC|Most read|BBC News Services|Related internet links|From other local news sites|Read more global business stories|More Technology of Business)$' \
    | sed '/^\s*$/d' \
    || true
}

match_topics() {
  local text="$1"
  shift
  local topics=("$@")
  local t
  for t in "${topics[@]}"; do
    [[ "$text" == *"$t"* ]] && return 0
  done
  return 1
}

preset_feeds() {
  local name="$1"
  case "$name" in
    ielts_focus)
      echo "uk,business,world,science,health,education"
      ;;
    broad_news)
      echo "uk,business,world,science,health,education,technology,politics"
      ;;
    all)
      echo "uk,business,world,science,health,politics,education,technology,entertainment,travel,earth"
      ;;
    *)
      echo "Unknown feed preset: $name" >&2
      exit 1
      ;;
  esac
}

# Defaults
PROXY=""
TOPIC_PRESET="g_plus_science"
CUSTOM_TOPICS=""
FEEDS_PRESET="ielts_focus"
CUSTOM_FEEDS=""
MIN_WORDS=500
MAX_WORDS=1400
MIN_TITLE_CHARS=30
MIN_H2=1
LIMIT=12
MAX_ITEMS_PER_FEED=25
CONNECT_TIMEOUT=8
TIMEOUT=25
OUTPUT_FORMAT="table"
OUT_FILE=""
QUIET=0

OUT_STREAM_INDEX=0

init_out_file() {
  [[ -z "$OUT_FILE" ]] && return 0
  mkdir -p "$(dirname "$OUT_FILE")"
  if [[ "$OUTPUT_FORMAT" == "tsv" ]]; then
    printf 'TITLE\tWORDS\tH2_COUNT\tLINK\tH2_SAMPLE\n' > "$OUT_FILE"
  else
    printf 'Streaming BBC IELTS-G results...\n' > "$OUT_FILE"
    printf '%-4s | %-6s | %-3s | %-70s\n' 'No.' 'Words' 'H2' 'Title' >> "$OUT_FILE"
    printf '%-4s-+-%-6s-+-%-3s-+-%-70s\n' '----' '------' '---' '----------------------------------------------------------------------' >> "$OUT_FILE"
  fi
}

stream_write_record() {
  local title="$1"
  local words="$2"
  local h2="$3"
  local link="$4"
  local sample="$5"

  [[ -z "$OUT_FILE" ]] && return 0

  if [[ "$OUTPUT_FORMAT" == "tsv" ]]; then
    printf '%s\t%s\t%s\t%s\t%s\n' "$title" "$words" "$h2" "$link" "$sample" >> "$OUT_FILE"
  else
    OUT_STREAM_INDEX=$((OUT_STREAM_INDEX + 1))
    local short_title="$title"
    if (( ${#short_title} > 70 )); then
      short_title="${short_title:0:67}..."
    fi
    printf '%-4s | %-6s | %-3s | %-70s\n' "$OUT_STREAM_INDEX" "$words" "$h2" "$short_title" >> "$OUT_FILE"
    printf '      Link: %s\n' "$link" >> "$OUT_FILE"
    printf '      H2:   %s\n' "$sample" >> "$OUT_FILE"
  fi
}

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --proxy) PROXY="${2:-}"; shift 2 ;;
    --topic-preset) TOPIC_PRESET="${2:-}"; shift 2 ;;
    --topics) CUSTOM_TOPICS="${2:-}"; shift 2 ;;
    --feeds-preset) FEEDS_PRESET="${2:-}"; shift 2 ;;
    --feeds) CUSTOM_FEEDS="${2:-}"; shift 2 ;;
    --min-words) MIN_WORDS="${2:-}"; shift 2 ;;
    --max-words) MAX_WORDS="${2:-}"; shift 2 ;;
    --min-title-chars) MIN_TITLE_CHARS="${2:-}"; shift 2 ;;
    --min-h2) MIN_H2="${2:-}"; shift 2 ;;
    --limit) LIMIT="${2:-}"; shift 2 ;;
    --max-items-per-feed) MAX_ITEMS_PER_FEED="${2:-}"; shift 2 ;;
    --connect-timeout) CONNECT_TIMEOUT="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;;
    --output) OUTPUT_FORMAT="${2:-}"; shift 2 ;;
    --out-file) OUT_FILE="${2:-}"; shift 2 ;;
    --quiet) QUIET=1; shift ;;
    --list-topic-presets) list_topic_presets; exit 0 ;;
    --list-feed-presets) list_feed_presets; exit 0 ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -n "$PROXY" ]]; then
  export http_proxy="$PROXY"
  export https_proxy="$PROXY"
else
  unset http_proxy || true
  unset https_proxy || true
fi

if [[ -n "$CUSTOM_FEEDS" ]]; then
  FEEDS_CSV="$CUSTOM_FEEDS"
else
  FEEDS_CSV="$(preset_feeds "$FEEDS_PRESET")"
fi

if [[ -n "$CUSTOM_TOPICS" ]]; then
  TOPICS_CSV="$CUSTOM_TOPICS"
else
  TOPICS_CSV="$(preset_topics "$TOPIC_PRESET")"
fi

declare -a TOPICS
split_csv_to_array "$TOPICS_CSV" TOPICS
if [[ ${#TOPICS[@]} -eq 0 ]]; then
  echo "No topics configured. Use --topics or --topic-preset." >&2
  exit 1
fi

declare -A FEED_MAP=(
  [uk]="https://feeds.bbci.co.uk/news/uk/rss.xml"
  [business]="https://feeds.bbci.co.uk/news/business/rss.xml"
  [world]="https://feeds.bbci.co.uk/news/world/rss.xml"
  [science]="https://feeds.bbci.co.uk/news/science_and_environment/rss.xml"
  [health]="https://feeds.bbci.co.uk/news/health/rss.xml"
  [politics]="https://feeds.bbci.co.uk/news/politics/rss.xml"
  [education]="https://feeds.bbci.co.uk/news/education/rss.xml"
  [technology]="https://feeds.bbci.co.uk/news/technology/rss.xml"
  [entertainment]="https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml"
  [travel]="https://news.google.com/rss/search?q=site:bbc.com/travel&hl=en-GB&gl=GB&ceid=GB:en"
  [earth]="https://news.google.com/rss/search?q=site:bbc.com/future%20earth%20OR%20site:bbc.com/future&hl=en-GB&gl=GB&ceid=GB:en"
)

declare -a FEED_KEYS
split_csv_to_array "$FEEDS_CSV" FEED_KEYS
if [[ ${#FEED_KEYS[@]} -eq 0 ]]; then
  echo "No feeds selected. Use --feeds." >&2
  exit 1
fi

declare -A SEEN_LINKS
RESULTS_TSV="$(mktemp)"
trap 'rm -f "$RESULTS_TSV"' EXIT

init_out_file

matched=0
for key in "${FEED_KEYS[@]}"; do
  if [[ "$QUIET" -eq 0 ]]; then
    echo "Scanning feed: $key" >&2
  fi

  url="${FEED_MAP[$key]:-}"
  if [[ -z "$url" ]]; then
    echo "Skip unknown feed key: $key" >&2
    continue
  fi

  rss="$(curl -L --silent --connect-timeout "$CONNECT_TIMEOUT" --max-time "$TIMEOUT" "$url" || true)"
  [[ -z "$rss" ]] && continue

  feed_item_count=0
  while IFS=$'\t' read -r title link desc; do
    feed_item_count=$((feed_item_count + 1))
    (( feed_item_count > MAX_ITEMS_PER_FEED )) && break

    [[ -z "$title" || -z "$link" ]] && continue
    clean_link="${link%%\?*}"
    [[ -n "${SEEN_LINKS[$clean_link]:-}" ]] && continue
    SEEN_LINKS[$clean_link]=1

    title_chars=${#title}
    (( title_chars < MIN_TITLE_CHARS )) && continue

    haystack="$(lower "$title $desc")"
    if ! match_topics "$haystack" "${TOPICS[@]}"; then
      continue
    fi

    html="$(curl -L --silent --connect-timeout "$CONNECT_TIMEOUT" --max-time "$TIMEOUT" "$clean_link" || true)"
    [[ -z "$html" ]] && continue

    compact_html="$(printf '%s' "$html" | tr '\n' ' ')"
    article_block="$(extract_article_block "$compact_html")"

    word_count="$(extract_word_count "$article_block")"
    (( word_count < MIN_WORDS )) && continue
    (( word_count > MAX_WORDS )) && continue

    meaningful_h2="$(extract_meaningful_h2 "$article_block")"
    h2_count="$(printf '%s\n' "$meaningful_h2" | sed '/^\s*$/d' | wc -l | tr -d ' ')"
    (( h2_count < MIN_H2 )) && continue

    sample_h2="$(printf '%s\n' "$meaningful_h2" | head -n 3 | paste -sd '; ' -)"

    printf '%s\t%s\t%s\t%s\t%s\n' \
      "$title" "$word_count" "$h2_count" "$clean_link" "$sample_h2" \
      >> "$RESULTS_TSV"

    stream_write_record "$title" "$word_count" "$h2_count" "$clean_link" "$sample_h2"

    matched=$((matched + 1))
    (( matched >= LIMIT )) && break
  done < <(printf '%s' "$rss" | extract_rss_items)

  (( matched >= LIMIT )) && break
done

if [[ ! -s "$RESULTS_TSV" ]]; then
  echo "No matched articles. Try relaxing filters: --min-words, --min-h2, --min-title-chars." >&2
  exit 2
fi

render_output() {
  if [[ "$OUTPUT_FORMAT" == "tsv" ]]; then
    printf 'TITLE\tWORDS\tH2_COUNT\tLINK\tH2_SAMPLE\n'
    cat "$RESULTS_TSV"
  else
    printf '%-4s | %-6s | %-3s | %-70s\n' 'No.' 'Words' 'H2' 'Title'
    printf '%-4s-+-%-6s-+-%-3s-+-%-70s\n' '----' '------' '---' '----------------------------------------------------------------------'
    n=0
    while IFS=$'\t' read -r title words h2 link sample; do
      n=$((n + 1))
      short_title="$title"
      if (( ${#short_title} > 70 )); then
        short_title="${short_title:0:67}..."
      fi
      printf '%-4s | %-6s | %-3s | %-70s\n' "$n" "$words" "$h2" "$short_title"
      printf '      Link: %s\n' "$link"
      printf '      H2:   %s\n' "$sample"
    done < "$RESULTS_TSV"
  fi
}

if [[ -n "$OUT_FILE" ]]; then
  if [[ "$QUIET" -eq 0 ]]; then
    echo "Wrote output to: $OUT_FILE"
  fi
else
  render_output
fi
