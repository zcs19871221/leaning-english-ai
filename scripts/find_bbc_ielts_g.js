#!/usr/bin/env node
"use strict";

const { execFile } = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const EXCLUDED_H2 = new Set([
  "Get in touch",
  "Related topics",
  "More on this story",
  "The video playlist",
  "Top stories",
  "More to explore",
  "Elsewhere on the BBC",
  "Most read",
  "BBC News Services",
  "Related internet links",
  "From other local news sites",
  "Read more global business stories",
  "More Technology of Business",
]);

function usage() {
  console.log(`Find BBC articles suitable for IELTS General reading practice (Node.js, concurrent fetch).

Usage:
  node ./scripts/find_bbc_ielts_g.js [options]

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
  --max-words N               Maximum article word count. Default: 0 (disabled)
                              Use 0 for no upper limit.
  --min-title-chars N         Minimum title length. Default: 0 (disabled)
  --min-h2 N                  Minimum meaningful H2 subheadings. Default: 0 (disabled)
  --limit N                   Max matched articles to output. Default: 12
                              Use 0 for no limit (scan all selected feeds).
  --max-items-per-feed N      Max RSS items to scan per feed. Default: 25
  --connect-timeout N         Curl connect timeout seconds. Default: 8
  --timeout N                 Curl timeout seconds. Default: 25
  --concurrency N             Concurrent article fetch workers. Default: 8
  --output FORMAT             table | tsv (default: table)
  --out-file PATH             Append output to a file (streaming; dedupe by LINK)
  --quiet                     Suppress progress logs
  --list-topic-presets        Print built-in topic presets and exit
  --list-feed-presets         Print built-in feed presets and exit
  --help                      Show this help and exit

Examples:
  node ./scripts/find_bbc_ielts_g.js \
    --proxy http://10.190.254.20:80 \
    --topic-preset g_plus_science \
    --feeds-preset ielts_focus \
    --min-words 450 --min-h2 0 --limit 0 \
    --out-file ./output/bbc_ielts_g.tsv --output tsv
`);
}

function listTopicPresets() {
  console.log(`g_core:
  jobs, employment, salary, wage, housing, rent, mortgage, cost of living,
  inflation, transport, commute, health, school, education, children, family,
  community, public services, energy, water, tax, benefits, law

g_plus_science (default):
  g_core + climate, environment, wildlife, conservation, research, science,
  technology, disease, vaccine

economy_jobs:
  jobs, salary, wage, layoffs, hiring, economy, inflation, prices, tax,
  business, debt, personal finance, buy now pay later`);
}

function listFeedPresets() {
  console.log(`ielts_focus (default):
  uk,business,world,science,health,education,travel,earth

broad_news:
  uk,business,world,science,health,education,technology,politics,travel,earth

all:
  uk,business,world,science,health,politics,education,technology,entertainment,travel,earth`);
}

function presetTopics(name) {
  switch (name) {
    case "g_core":
      return "jobs,employment,job,salary,wage,housing,rent,mortgage,cost of living,price,prices,inflation,transport,commute,health,school,education,children,family,community,public service,energy,water,tax,benefit,benefits,law,crime";
    case "g_plus_science":
      return "jobs,employment,job,salary,wage,housing,rent,mortgage,cost of living,price,prices,inflation,transport,commute,health,school,education,children,family,community,public service,energy,water,tax,benefit,benefits,law,crime,climate,environment,wildlife,conservation,research,science,technology,disease,vaccine";
    case "economy_jobs":
      return "jobs,employment,job,salary,wage,layoff,hiring,economy,inflation,price,prices,tax,business,debt,finance,personal finance,buy now pay later";
    default:
      throw new Error(`Unknown preset: ${name}`);
  }
}

function presetFeeds(name) {
  switch (name) {
    case "ielts_focus":
      return "uk,business,world,science,health,education,travel,earth";
    case "broad_news":
      return "uk,business,world,science,health,education,technology,politics,travel,earth";
    case "all":
      return "uk,business,world,science,health,politics,education,technology,entertainment,travel,earth";
    default:
      throw new Error(`Unknown feed preset: ${name}`);
  }
}

function splitCsv(csv) {
  return csv
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function decodeHtmlEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, " ");
}

function compactSpace(s) {
  return s.replace(/\s+/g, " ").trim();
}

function extractTag(item, tag) {
  const cdata = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i");
  const plain = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m1 = item.match(cdata);
  if (m1) return decodeHtmlEntities(m1[1].trim());
  const m2 = item.match(plain);
  if (!m2) return "";
  return decodeHtmlEntities(stripTags(m2[1]).trim());
}

function parseRssItems(xml) {
  const items = [];
  const matches = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const item of matches) {
    const title = extractTag(item, "title");
    const link = extractTag(item, "link");
    const desc = extractTag(item, "description");
    if (title && link) items.push({ title, link: link.replace(/&amp;/g, "&"), desc });
  }
  return items;
}

function extractArticleBlock(html) {
  const m = html.match(/<article\b[\s\S]*?<\/article>/i);
  return m ? m[0] : html;
}

function extractWordCount(htmlBlock) {
  const text = compactSpace(
    decodeHtmlEntities(
      stripTags(
        htmlBlock
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      )
    )
  );
  const words = text.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g);
  return words ? words.length : 0;
}

function extractMeaningfulH2(htmlBlock) {
  const out = [];
  const regex = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
  let m;
  while ((m = regex.exec(htmlBlock)) !== null) {
    const text = compactSpace(decodeHtmlEntities(stripTags(m[1])));
    if (text.length < 8) continue;
    if (EXCLUDED_H2.has(text)) continue;
    out.push(text);
  }
  return out;
}

function matchTopics(textLower, topics) {
  for (const t of topics) {
    if (textLower.includes(t)) return true;
  }
  return false;
}

function toInt(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`Invalid integer for ${name}: ${value}`);
  }
  return n;
}

function parseArgs(argv) {
  const cfg = {
    proxy: "",
    topicPreset: "g_plus_science",
    customTopics: "",
    feedsPreset: "ielts_focus",
    customFeeds: "",
    minWords: 500,
    maxWords: 0,
    minTitleChars: 0,
    minH2: 0,
    limit: 12,
    maxItemsPerFeed: 25,
    connectTimeout: 8,
    timeout: 25,
    outputFormat: "table",
    outFile: "",
    quiet: false,
    concurrency: 8,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return argv[i];
    };

    switch (arg) {
      case "--proxy": cfg.proxy = next(); break;
      case "--topic-preset": cfg.topicPreset = next(); break;
      case "--topics": cfg.customTopics = next(); break;
      case "--feeds-preset": cfg.feedsPreset = next(); break;
      case "--feeds": cfg.customFeeds = next(); break;
      case "--min-words": cfg.minWords = toInt(next(), "--min-words"); break;
      case "--max-words": cfg.maxWords = toInt(next(), "--max-words"); break;
      case "--min-title-chars": cfg.minTitleChars = toInt(next(), "--min-title-chars"); break;
      case "--min-h2": cfg.minH2 = toInt(next(), "--min-h2"); break;
      case "--limit": cfg.limit = toInt(next(), "--limit"); break;
      case "--max-items-per-feed": cfg.maxItemsPerFeed = toInt(next(), "--max-items-per-feed"); break;
      case "--connect-timeout": cfg.connectTimeout = toInt(next(), "--connect-timeout"); break;
      case "--timeout": cfg.timeout = toInt(next(), "--timeout"); break;
      case "--concurrency": cfg.concurrency = toInt(next(), "--concurrency"); break;
      case "--output": cfg.outputFormat = next(); break;
      case "--out-file": cfg.outFile = next(); break;
      case "--quiet": cfg.quiet = true; break;
      case "--list-topic-presets": listTopicPresets(); process.exit(0);
      case "--list-feed-presets": listFeedPresets(); process.exit(0);
      case "--help":
      case "-h": usage(); process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["table", "tsv"].includes(cfg.outputFormat)) {
    throw new Error(`Invalid --output format: ${cfg.outputFormat}`);
  }
  if (cfg.concurrency < 1) throw new Error("--concurrency must be >= 1");
  return cfg;
}

async function curlGet(url, cfg) {
  const args = [
    "-L",
    "--silent",
    "--connect-timeout",
    String(cfg.connectTimeout),
    "--max-time",
    String(cfg.timeout),
    url,
  ];

  const env = { ...process.env };
  if (cfg.proxy) {
    env.http_proxy = cfg.proxy;
    env.https_proxy = cfg.proxy;
  } else {
    delete env.http_proxy;
    delete env.https_proxy;
  }

  try {
    const { stdout } = await execFileAsync("curl", args, { env, maxBuffer: 16 * 1024 * 1024 });
    return stdout || "";
  } catch {
    return "";
  }
}

async function mapLimit(items, limit, worker) {
  const result = [];
  let idx = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const cur = idx;
      idx += 1;
      if (cur >= items.length) return;
      result[cur] = await worker(items[cur], cur);
    }
  });

  await Promise.all(runners);
  return result;
}

function renderTable(records) {
  const lines = [];
  lines.push(`${"No.".padEnd(4)} | ${"Words".padEnd(6)} | ${"H2".padEnd(3)} | ${"Title".padEnd(70)}`);
  lines.push(`${"----"}-+-${"------"}-+-${"---"}-+-${"-".repeat(70)}`);
  let n = 0;
  for (const r of records) {
    n += 1;
    const title = r.title.length > 70 ? `${r.title.slice(0, 67)}...` : r.title;
    lines.push(`${String(n).padEnd(4)} | ${String(r.words).padEnd(6)} | ${String(r.h2).padEnd(3)} | ${title.padEnd(70)}`);
    lines.push(`      Link: ${r.link}`);
    lines.push(`      H2:   ${r.sample}`);
  }
  return lines.join("\n");
}

async function main() {
  let cfg;
  try {
    cfg = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err.message || err));
    usage();
    process.exit(1);
  }

  const feedMap = {
    uk: "https://feeds.bbci.co.uk/news/uk/rss.xml",
    business: "https://feeds.bbci.co.uk/news/business/rss.xml",
    world: "https://feeds.bbci.co.uk/news/world/rss.xml",
    science: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
    health: "https://feeds.bbci.co.uk/news/health/rss.xml",
    politics: "https://feeds.bbci.co.uk/news/politics/rss.xml",
    education: "https://feeds.bbci.co.uk/news/education/rss.xml",
    technology: "https://feeds.bbci.co.uk/news/technology/rss.xml",
    entertainment: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
    travel: "https://www.bbc.com/travel/feed.rss",
    earth: "https://www.bbc.com/future/feed.rss",
  };

  const feedsCsv = cfg.customFeeds || presetFeeds(cfg.feedsPreset);
  const topicsCsv = cfg.customTopics || presetTopics(cfg.topicPreset);
  const feedKeys = splitCsv(feedsCsv);
  const topics = splitCsv(topicsCsv);

  if (!feedKeys.length) {
    console.error("No feeds selected. Use --feeds.");
    process.exit(1);
  }
  if (!topics.length) {
    console.error("No topics configured. Use --topics or --topic-preset.");
    process.exit(1);
  }

  const records = [];
  const seenLinks = new Set();
  const existingOutLinks = new Set();
  let matched = 0;

  let writeChain = Promise.resolve();
  const outFile = cfg.outFile ? path.resolve(cfg.outFile) : "";
  if (outFile) {
    await fsp.mkdir(path.dirname(outFile), { recursive: true });

    const exists = fs.existsSync(outFile);
    if (exists) {
      const content = await fsp.readFile(outFile, "utf8");
      const lines = content.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        if (line.startsWith("TITLE\t") || line.startsWith("Streaming BBC IELTS-G results") || line.startsWith("No.")) {
          continue;
        }
        if (cfg.outputFormat === "tsv") {
          const cols = line.split("\t");
          if (cols.length >= 3) {
            const link = cols[2].trim();
            if (link) existingOutLinks.add(link);
          }
        } else {
          const m = line.match(/^\s*Link:\s*(\S+)\s*$/i);
          if (m && m[1]) existingOutLinks.add(m[1]);
        }
      }
    } else {
      const header = cfg.outputFormat === "tsv"
        ? "TITLE\tWORDS\tLINK\n"
        : [
            "Streaming BBC IELTS-G results...",
            `${"No.".padEnd(4)} | ${"Words".padEnd(6)} | ${"Title".padEnd(70)}`,
            `${"----"}-+-${"------"}-+-${"-".repeat(70)}`,
            "",
          ].join("\n");
      await fsp.writeFile(outFile, header, "utf8");
    }
  }

  async function appendRecord(record) {
    records.push(record);
    if (!outFile) return;

    writeChain = writeChain.then(async () => {
      if (cfg.outputFormat === "tsv") {
        const row = `${record.title}\t${record.words}\t${record.link}\n`;
        await fsp.appendFile(outFile, row, "utf8");
      } else {
        const i = records.length;
        const title = record.title.length > 70 ? `${record.title.slice(0, 67)}...` : record.title;
        const block = [
          `${String(i).padEnd(4)} | ${String(record.words).padEnd(6)} | ${title.padEnd(70)}`,
          `      Link: ${record.link}`,
        ].join("\n") + "\n";
        await fsp.appendFile(outFile, block, "utf8");
      }
    });
    await writeChain;
  }

  for (const key of feedKeys) {
    if (cfg.limit > 0 && matched >= cfg.limit) break;

    if (!cfg.quiet) {
      console.error(`Scanning feed: ${key}`);
    }

    const url = feedMap[key];
    if (!url) {
      console.error(`Skip unknown feed key: ${key}`);
      continue;
    }

    const rss = await curlGet(url, cfg);
    if (!rss) continue;

    const items = parseRssItems(rss).slice(0, cfg.maxItemsPerFeed);

    await mapLimit(items, cfg.concurrency, async (item) => {
      if (cfg.limit > 0 && matched >= cfg.limit) return;
      if (!item.title || !item.link) return;
      if (item.title.length < cfg.minTitleChars) return;

      const cleanLink = item.link.split("?")[0];
      if (seenLinks.has(cleanLink)) return;
      seenLinks.add(cleanLink);
      if (existingOutLinks.has(cleanLink)) return;

      const haystack = `${item.title} ${item.desc}`.toLowerCase();
      if (!matchTopics(haystack, topics)) return;

      const html = await curlGet(cleanLink, cfg);
      if (!html) return;

      const articleBlock = extractArticleBlock(html);
      const wordCount = extractWordCount(articleBlock);
      if (wordCount < cfg.minWords) return;
      if (cfg.maxWords > 0 && wordCount > cfg.maxWords) return;

      const h2List = extractMeaningfulH2(articleBlock);
      const h2Count = h2List.length;
      if (h2Count < cfg.minH2) return;

      // Keep matching updates atomic to honor --limit under concurrency.
      if (cfg.limit > 0 && matched >= cfg.limit) return;
      matched += 1;
      if (cfg.limit > 0 && matched > cfg.limit) return;

      const sample = h2List.slice(0, 3).join("; ");
      existingOutLinks.add(cleanLink);
      await appendRecord({ title: item.title, words: wordCount, h2: h2Count, link: cleanLink, sample });
    });
  }

  if (!records.length) {
    console.error("No matched articles. Try relaxing filters: --min-words, --min-h2, --min-title-chars.");
    process.exit(2);
  }

  if (outFile) {
    if (!cfg.quiet) {
      console.log(`Wrote output to: ${cfg.outFile}`);
    }
    return;
  }

  if (cfg.outputFormat === "tsv") {
    console.log("TITLE\tWORDS\tH2_COUNT\tLINK\tH2_SAMPLE");
    for (const r of records) {
      console.log(`${r.title}\t${r.words}\t${r.h2}\t${r.link}\t${r.sample}`);
    }
  } else {
    console.log(renderTable(records));
  }
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
