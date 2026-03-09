// scripts/fetch-epg.js
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');

// EPG-Quellen (Stand März 2026)
const EPG_SOURCES = [
  'https://iptv-org.github.io/epg/guides',           // iptv-org (primär)
  'https://epg.pw/epg',                               // epg.pw (Fallback 1)
  'https://raw.githubusercontent.com/iptv-org/epg/master/guides' // GitHub raw (Fallback 2)
];

// Ländercode-Mapping für unterschiedliche Quellen
const COUNTRY_CODE_MAP = {
  'gb': 'uk',      // Großbritannien: iptv-org verwendet 'uk' statt 'gb'
  'gr': 'el',      // Griechenland: 'el' statt 'gr'
  'il': 'he',      // Israel: 'he' statt 'il'
  'kr': 'ko',      // Südkorea: 'ko' statt 'kr'
  'cn': 'zh',      // China: 'zh' statt 'cn'
  'jp': 'ja',      // Japan: 'ja' statt 'jp'
  'sa': 'ar',      // Saudi-Arabien: 'ar' statt 'sa'
  'ae': 'ar',      // VAE: auch 'ar'
  'eg': 'ar',      // Ägypten: auch 'ar'
  'ua': 'uk',      // Ukraine: 'ua' bleibt 'ua', aber Achtung: nicht mit 'uk' verwechseln!
  'by': 'be',      // Belarus: 'be' (Belarusian)
  'kz': 'kk',      // Kasachstan: 'kk'
  'uz': 'uz',      // Usbekistan: 'uz'
  'ir': 'fa',      // Iran: 'fa' (Persian)
  'iq': 'ar',      // Irak: 'ar'
  'sy': 'ar',      // Syrien: 'ar'
  'jo': 'ar',      // Jordanien: 'ar'
  'lb': 'ar',      // Libanon: 'ar'
  'ps': 'ar',      // Palästina: 'ar'
  'ma': 'ar',      // Marokko: 'ar'
  'dz': 'ar',      // Algerien: 'ar'
  'tn': 'ar',      // Tunesien: 'ar'
  'ly': 'ar',      // Libyen: 'ar'
  'sd': 'ar',      // Sudan: 'ar'
  'pk': 'ur',      // Pakistan: 'ur' (Urdu)
  'bd': 'bn',      // Bangladesch: 'bn' (Bengali)
  'lk': 'si',      // Sri Lanka: 'si' (Sinhala)
  'np': 'ne',      // Nepal: 'ne' (Nepali)
  'th': 'th',      // Thailand: 'th'
  'vn': 'vi',      // Vietnam: 'vi'
  'kh': 'km',      // Kambodscha: 'km' (Khmer)
  'mm': 'my',      // Myanmar: 'my' (Burmesisch)
  'my': 'ms',      // Malaysia: 'ms' (Malay)
  'id': 'id',      // Indonesien: 'id'
  'ph': 'tl',      // Philippinen: 'tl' (Tagalog)
  'ge': 'ka',      // Georgien: 'ka' (Georgian)
  'am': 'hy',      // Armenien: 'hy' (Armenian)
  'az': 'az',      // Aserbaidschan: 'az'
  'ee': 'et',      // Estland: 'et'
  'lv': 'lv',      // Lettland: 'lv'
  'lt': 'lt',      // Litauen: 'lt'
  'mt': 'mt',      // Malta: 'mt'
  'cy': 'el',      // Zypern: 'el'
  'is': 'is'       // Island: 'is'
};

// Max Programme pro Land – verhindert >100MB Dateien
const MAX_PROGRAMMES_PER_COUNTRY = 20000;

// Parallele Downloads
const CONCURRENCY = 3;

// Länder die temporär übersprungen werden (weil oft 404)
const SKIP_COUNTRIES = [
  // Diese Länder haben oft keine EPG-Daten
  'ba', 'ec', 'bo', 'py', 'uy',
  'tt', 'bb', 'jm', 'ht', 'do', 'pr', 'cu',
  'fj', 'pg', 'is', 'mt', 'cy'
];

const ALL_COUNTRIES = [
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

// Filtere übersprungene Länder
const COUNTRIES = ALL_COUNTRIES.filter(c => !SKIP_COUNTRIES.includes(c));

const OUTPUT_DIR = path.join(__dirname, '../public');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: true,
  trimValues: true,
  isArray: (name) => ['programme', 'channel'].includes(name)
});

function getSourceUrl(source, code) {
  // Für iptv-org: Mapping beachten
  const mappedCode = COUNTRY_CODE_MAP[code] || code;
  
  if (source.includes('iptv-org') || source.includes('github')) {
    return `${source}/${mappedCode}.xml`;
  } else if (source.includes('epg.pw')) {
    return `${source}/${code}.xml`;
  } else {
    return `${source}/epg-${code}.xml`;
  }
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  
  // Formate: "20251231000000 +0000" oder "20251231000000"
  const clean = dateStr.split(' ')[0].trim();
  
  if (clean.length === 14) {
    const year = clean.slice(0, 4);
    const month = clean.slice(4, 6);
    const day = clean.slice(6, 8);
    const hour = clean.slice(8, 10);
    const min = clean.slice(10, 12);
    const sec = clean.slice(12, 14);
    
    // Monat muss zwischen 1-12 sein
    const m = parseInt(month);
    if (m < 1 || m > 12) return null;
    
    return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);
  }
  
  return null;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function downloadEPG(code) {
  // Versuche alle Quellen
  for (const source of EPG_SOURCES) {
    const url = getSourceUrl(source, code);
    console.log(`📥 Lade ${code} von ${url}...`);

    try {
      const response = await fetch(url, {
        headers: { 
          'User-Agent': 'IPTV-EPG-Fetcher/1.0',
          'Accept-Encoding': 'gzip'
        },
        timeout: 15000 // 15 Sekunden
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

      const sizeKB = (text.length / 1024).toFixed(2);
      console.log(`   ✅ ${sizeKB} KB von ${source}`);
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
          ? (typeof displayName === 'string' ? displayName : (displayName[0] || displayName['#text'] || ''))
          : id;
        if (id) channels[id] = String(name);
      }
    }

    const totalFound = programmes.length;

    // Filter: Nur Programme der nächsten 7 Tage
    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // Auch 1 Tag zurück für laufende

    // Nach Datum filtern
    programmes = programmes
      .filter(p => {
        const start = parseDate(p.start || p['start']);
        return start && start >= sevenDaysAgo && start <= sevenDaysLater;
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

    if (programmes.length === 0) {
      console.log(`   ⚠️ ${countryCode}: Keine aktuellen Programme (nur ${totalFound} insgesamt)`);
      return null;
    }

    console.log(`   🔍 ${programmes.length} aktuelle Programme, ${Object.keys(channels).length} Kanäle`);

    return {
      updated: new Date().toISOString(),
      country: countryCode,
      count: programmes.length,
      totalAvailable: totalFound,
      channelCount: Object.keys(channels).length,
      channels: channels,
      programmes: programmes.map(p => ({
        c: String(p.channel || p['channel'] || ''),
        t: String(p.title || 'Unbekannt').substring(0, 200),
        s: String(p.start || p['start'] || ''),
        e: String(p.stop || p['stop'] || ''),
        d: String(p.desc || '').substring(0, 500),
        cat: String(p.category || '').substring(0, 100)
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
  console.log(`\n📊 Index erstellt: ${results.length} Länder, ${index.totalChannels} Kanäle, ${index.totalProgrammes} Programme`);
}

async function processInBatches(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    console.log(`\n📦 Batch ${Math.floor(i/batchSize)+1}/${Math.ceil(items.length/batchSize)} (${batch.join(', ')})`);
    
    const batchResults = await Promise.all(batch.map(code => fn(code).catch(e => {
      console.log(`   ❌ ${code}: ${e.message}`);
      return null;
    })));
    
    results.push(...batchResults.filter(Boolean));
    
    // Kurze Pause zwischen Batches
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
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
  console.log(`🌍 ${COUNTRIES.length} Länder (${SKIP_COUNTRIES.length} übersprungen)`);
  console.log(`📏 Max ${MAX_PROGRAMMES_PER_COUNTRY} Programme/Land`);
  console.log(`⚡ Parallele Downloads: ${CONCURRENCY}\n`);

  await ensureDir(OUTPUT_DIR);

  const results = await processInBatches(COUNTRIES, CONCURRENCY, processCountry);
  
  if (results.length > 0) {
    await createIndex(results);
    console.log(`\n✨ Fertig! ${results.length} Länder erfolgreich.`);
    
    // Zeige fehlgeschlagene Länder
    const failed = COUNTRIES.length - results.length;
    if (failed > 0) {
      console.log(`⚠️ ${failed} Länder fehlgeschlagen.`);
    }
  } else {
    console.log('\n❌ Keine Daten konnten geladen werden!');
  }
}

main().catch(console.error);
