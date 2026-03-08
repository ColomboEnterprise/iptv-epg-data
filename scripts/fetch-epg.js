// scripts/fetch-epg.js
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');

// IPTV-EPG.org – aktuelle EPG-Daten, alle 2 Stunden aktualisiert
const EPG_BASE_URL = 'https://iptv-epg.org/files';

const COUNTRIES = [
  // Europa
  'de', 'at', 'ch', 'it', 'fr', 'es', 'pt', 'gb', 'ie',
  'nl', 'be', 'lu', 'dk', 'se', 'no', 'fi', 'is',
  'pl', 'cz', 'sk', 'hu', 'ro', 'bg', 'gr',
  'hr', 'si', 'rs', 'ba', 'me', 'al', 'mk',
  'tr', 'ru', 'ua', 'by', 'lt', 'lv', 'ee', 'md', 'cy', 'mt',
  // Nordamerika
  'us', 'ca', 'mx',
  // Südamerika
  'br', 'ar', 'cl', 'co', 'pe', 've', 'ec', 'bo', 'py', 'uy',
  // Asien
  'jp', 'kr', 'cn', 'tw', 'hk',
  'in', 'pk', 'bd', 'lk', 'np',
  'id', 'my', 'sg', 'th', 'vn', 'ph', 'mm', 'kh',
  'ir', 'iq', 'sa', 'sy', 'jo', 'lb', 'il', 'ps',
  'kw', 'bh', 'qa', 'ae', 'om',
  'uz', 'kz', 'ge', 'az', 'am',
  // Afrika
  'eg', 'za', 'ng', 'ke', 'gh', 'ma', 'dz', 'tn',
  'ly', 'sd', 'et', 'ug', 'tz', 'cm', 'sn', 'ci',
  // Ozeanien
  'au', 'nz', 'fj',
  // Karibik
  'cu', 'jm', 'do', 'pr', 'tt', 'bb'
];

// Parallele Downloads (max gleichzeitig)
const CONCURRENCY = 5;

const OUTPUT_DIR = path.join(__dirname, '../public');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false // String lassen für Datums-Parsing
});

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function downloadEPG(code) {
  const url = `${EPG_BASE_URL}/epg-${code}.xml`;
  console.log(`📥 Lade ${code} von ${url}...`);

  try {
    const response = await fetch(url, {
      headers: { 'Accept-Encoding': 'gzip' },
      timeout: 60000
    });

    if (!response.ok) {
      console.log(`   ⚠️ ${code}: Status ${response.status}`);
      return null;
    }

    const text = await response.text();
    const sizeMB = (text.length / 1024 / 1024).toFixed(2);
    console.log(`   ✅ ${sizeMB} MB`);
    return text;
  } catch (error) {
    console.log(`   ❌ ${code}: ${error.message}`);
    return null;
  }
}

function parseEPG(xmlText, countryCode) {
  try {
    const result = parser.parse(xmlText);

    if (!result.tv || !result.tv.programme) {
      console.log(`   ⚠️ ${countryCode}: Keine Programme`);
      return null;
    }

    const programmes = Array.isArray(result.tv.programme)
      ? result.tv.programme
      : [result.tv.programme];

    // Channels aus dem XML extrahieren (für besseres Matching)
    let channels = {};
    if (result.tv.channel) {
      const chList = Array.isArray(result.tv.channel)
        ? result.tv.channel
        : [result.tv.channel];
      for (const ch of chList) {
        const id = ch['@_id'] || '';
        const name = ch['display-name']
          ? (typeof ch['display-name'] === 'string'
            ? ch['display-name']
            : ch['display-name']['#text'] || ch['display-name'])
          : id;
        channels[id] = String(name);
      }
    }

    console.log(`   🔍 ${programmes.length} Programme, ${Object.keys(channels).length} Kanäle`);

    // KEIN Limit – alle Programme übernehmen
    const simplified = {
      updated: new Date().toISOString(),
      country: countryCode,
      count: programmes.length,
      channelCount: Object.keys(channels).length,
      channels: channels, // Channel-ID → Name Mapping
      programmes: programmes.map(p => {
        const title = p.title;
        const desc = p.desc;
        const cat = p.category;

        return {
          c: String(p['@_channel'] || ''),
          t: String(title && (title['#text'] || title) || 'Unbekannt'),
          s: String(p['@_start'] || ''),
          e: String(p['@_stop'] || ''),
          d: String(desc && (desc['#text'] || desc) || ''),
          cat: String(cat && (cat['#text'] || cat) || '')
        };
      })
    };

    return simplified;
  } catch (error) {
    console.log(`   ❌ ${countryCode}: Parse-Fehler - ${error.message}`);
    return null;
  }
}

async function saveJSON(data, countryCode) {
  if (!data) return null;

  const filePath = path.join(OUTPUT_DIR, `${countryCode}.json`);
  const jsonString = JSON.stringify(data);

  await fs.writeFile(filePath, jsonString);
  const sizeKB = (jsonString.length / 1024).toFixed(2);
  console.log(`   💾 ${sizeKB} KB gespeichert (${data.count} Programme, ${data.channelCount} Kanäle)`);

  return {
    country: countryCode,
    count: data.count || 0,
    channelCount: data.channelCount || 0,
    size: jsonString.length
  };
}

async function createIndex(results) {
  const index = {
    lastUpdate: new Date().toISOString(),
    source: 'iptv-epg.org',
    totalCountries: results.length,
    totalProgrammes: results.reduce((sum, r) => sum + (r.count || 0), 0),
    totalChannels: results.reduce((sum, r) => sum + (r.channelCount || 0), 0),
    countries: results.map(r => ({
      code: r.country,
      programmes: r.count || 0,
      channels: r.channelCount || 0,
      sizeKB: Math.round(r.size / 1024)
    }))
  };

  const indexPath = path.join(OUTPUT_DIR, 'index.json');
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
  console.log(`\n📊 Index erstellt: ${results.length} Länder, ${index.totalChannels} Kanäle, ${index.totalProgrammes} Programme`);
}

// Parallele Verarbeitung mit Concurrency-Limit
async function processInBatches(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + batchSize < items.length) {
      console.log(`   ⏳ Fortschritt: ${Math.min(i + batchSize, items.length)}/${items.length}\n`);
    }
  }
  return results;
}

async function processCountry(code) {
  try {
    const xmlText = await downloadEPG(code);
    if (!xmlText) return null;

    const data = parseEPG(xmlText, code);
    if (!data) return null;

    const result = await saveJSON(data, code);
    console.log('');
    return result;
  } catch (error) {
    console.log(`   ❌ ${code}: ${error.message}\n`);
    return null;
  }
}

async function main() {
  console.log('🚀 EPG-Update gestartet');
  console.log(`📡 Quelle: ${EPG_BASE_URL}`);
  console.log(`🌍 ${COUNTRIES.length} Länder\n`);

  await ensureDir(OUTPUT_DIR);

  const allResults = await processInBatches(COUNTRIES, CONCURRENCY, processCountry);
  const results = allResults.filter(Boolean);

  await createIndex(results);

  console.log(`\n✨ Fertig! ${results.length} von ${COUNTRIES.length} Ländern erfolgreich.`);
  console.log(`📁 Ausgabe: ${OUTPUT_DIR}`);
}

main().catch(console.error);
