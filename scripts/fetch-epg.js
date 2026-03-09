// scripts/fetch-epg.js
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');

// Mehrere EPG-Quellen für Redundanz
const EPG_SOURCES = [
  'https://iptv-org.github.io/epg/guides',      // iptv-org (täglich aktualisiert)
  'https://iptv-epg.pages.dev/files',            // Cloudflare Pages Mirror
  'https://iptv-epg-data.pages.dev',             // Ihr eigenes Repository
  'https://epg.pw'                               // epg.pw (Alternative)
];

// Max Programme pro Land – verhindert >100MB Dateien
const MAX_PROGRAMMES_PER_COUNTRY = 20000;

// Parallele Downloads
const CONCURRENCY = 3;

// Nur relevante Länder (die in Ihrer App vorkommen)
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
  'jp', 'kr', 'cn', 'tw', 'hk', 'in', 'pk', 'bd', 'lk', 'np',
  'id', 'my', 'sg', 'th', 'vn', 'ph', 'mm', 'kh',
  'ir', 'iq', 'sa', 'sy', 'jo', 'lb', 'il', 'ps',
  'kw', 'bh', 'qa', 'ae', 'om', 'uz', 'kz', 'ge', 'az', 'am',
  // Afrika
  'eg', 'za', 'ng', 'ke', 'gh', 'ma', 'dz', 'tn',
  // Ozeanien
  'au', 'nz',
  // International
  'int'
];

const OUTPUT_DIR = path.join(__dirname, '../public');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: true,
  trimValues: true,
  isArray: (name) => ['programme', 'channel'].includes(name)
});

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function downloadEPG(code) {
  // Versuche alle Quellen
  for (const source of EPG_SOURCES) {
    let url;
    if (source.includes('iptv-org')) {
      url = `${source}/${code}.xml`;
    } else if (source.includes('epg.pw')) {
      url = `${source}/epg/${code}.xml`;
    } else {
      url = `${source}/epg-${code}.xml`;
    }

    console.log(`📥 Lade ${code} von ${url}...`);

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'IPTV-EPG-Fetcher/1.0' },
        timeout: 30000
      });

      if (!response.ok) {
        console.log(`   ⚠️ ${code}: Status ${response.status} von ${source}`);
        continue;
      }

      const text = await response.text();
      
      if (!text.includes('<?xml') && !text.includes('<tv>')) {
        console.log(`   ⚠️ ${code}: Kein gültiges XML von ${source}`);
        continue;
      }

      const sizeMB = (text.length / 1024 / 1024).toFixed(2);
      console.log(`   ✅ ${sizeMB} MB von ${source}`);
      return { text, source };
    } catch (error) {
      console.log(`   ❌ ${code} von ${source}: ${error.message}`);
    }
  }

  console.log(`   ❌ ${code}: Alle Quellen fehlgeschlagen`);
  return null;
}

function parseEPG(xmlText, countryCode) {
  try {
    const result = parser.parse(xmlText);

    if (!result.tv || !result.tv.programme) {
      console.log(`   ⚠️ ${countryCode}: Keine Programme gefunden`);
      return null;
    }

    let programmes = Array.isArray(result.tv.programme) 
      ? result.tv.programme 
      : [result.tv.programme];

    // Channels parsen
    let channels = {};
    if (result.tv.channel) {
      const chList = Array.isArray(result.tv.channel) 
        ? result.tv.channel 
        : [result.tv.channel];
      
      for (const ch of chList) {
        const id = ch.id || '';
        const displayName = ch['display-name'];
        const name = displayName 
          ? (typeof displayName === 'string' ? displayName : displayName[0] || '')
          : id;
        if (id) channels[id] = String(name);
      }
    }

    const totalFound = programmes.length;

    // Filter: Nur Programme der nächsten 7 Tage
    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      const clean = dateStr.split(' ')[0];
      if (clean.length === 14) {
        const year = clean.slice(0, 4);
        const month = clean.slice(4, 6);
        const day = clean.slice(6, 8);
        const hour = clean.slice(8, 10);
        const min = clean.slice(10, 12);
        const sec = clean.slice(12, 14);
        return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);
      }
      return null;
    };

    // Nach Datum filtern
    programmes = programmes
      .filter(p => {
        const start = parseDate(p.start || p['start']);
        return start && start <= sevenDaysLater;
      })
      .sort((a, b) => {
        const sa = String(a.start || a['start'] || '');
        const sb = String(b.start || b['start'] || '');
        return sa.localeCompare(sb);
      });

    // Limitieren
    if (programmes.length > MAX_PROGRAMMES_PER_COUNTRY) {
      programmes = programmes.slice(0, MAX_PROGRAMMES_PER_COUNTRY);
      console.log(`   ✂️ ${countryCode}: ${totalFound} → ${MAX_PROGRAMMES_PER_COUNTRY} Programme`);
    }

    console.log(`   🔍 ${programmes.length} Programme, ${Object.keys(channels).length} Kanäle`);

    return {
      updated: new Date().toISOString(),
      country: countryCode,
      count: programmes.length,
      totalAvailable: totalFound,
      channelCount: Object.keys(channels).length,
      channels: channels,
      programmes: programmes.map(p => ({
        c: String(p.channel || p['channel'] || ''),
        t: String(p.title || 'Unbekannt'),
        s: String(p.start || p['start'] || ''),
        e: String(p.stop || p['stop'] || ''),
        d: String(p.desc || ''),
        cat: String(p.category || '')
      }))
    };
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
  console.log(`   💾 ${sizeKB} KB gespeichert (${data.count} Programme)`);

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
    source: 'iptv-org',
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
  console.log(`\n📊 Index erstellt: ${results.length} Länder`);
}

async function processInBatches(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    console.log(`\n📦 Batch ${Math.floor(i/batchSize)+1}/${Math.ceil(items.length/batchSize)}`);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults.filter(Boolean));
  }
  return results;
}

async function processCountry(code) {
  try {
    const result = await downloadEPG(code);
    if (!result) return null;

    const data = parseEPG(result.text, code);
    if (!data) return null;

    return await saveJSON(data, code);
  } catch (error) {
    console.log(`   ❌ ${code}: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('🚀 EPG-Update gestartet');
  console.log(`📡 Quellen: ${EPG_SOURCES.length} verfügbar`);
  console.log(`🌍 ${COUNTRIES.length} Länder`);
  console.log(`📏 Max ${MAX_PROGRAMMES_PER_COUNTRY} Programme/Land\n`);

  await ensureDir(OUTPUT_DIR);

  const results = await processInBatches(COUNTRIES, CONCURRENCY, processCountry);
  
  if (results.length > 0) {
    await createIndex(results);
    console.log(`\n✨ Fertig! ${results.length} Länder erfolgreich.`);
  } else {
    console.log('\n❌ Keine Daten konnten geladen werden!');
  }
}

main().catch(console.error);
