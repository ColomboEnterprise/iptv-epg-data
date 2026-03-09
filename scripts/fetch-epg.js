// scripts/fetch-epg.js
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);

// ✅ EINZIGE VERLÄSSLICHE EPG-QUELLE
const EPG_SOURCES = [
  {
    url: 'https://iptvx.one/epg/epg.xml.gz',
    name: 'iptvx.one - Europa (primär)',
    type: 'gz'
  }
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

async function downloadAndParseEPG(source) {
  console.log(`\n   📡 Quelle: ${source.name}`);
  console.log(`   URL: ${source.url}`);
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(source.url, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (compatible; EPG-Fetcher/2.0)',
        'Accept': 'application/xml, text/xml, application/gzip, */*'
      },
      signal: controller.signal,
      timeout: 30000
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.log(`   ⚠️ HTTP ${response.status} - ${response.statusText}`);
      return null;
    }

    console.log(`   ⬇️ Lade Daten...`);
    const buffer = await response.buffer();
    let xmlText;

    if (source.type === 'gz' || source.url.endsWith('.gz')) {
      try {
        const decompressed = await gunzip(buffer);
        xmlText = decompressed.toString('utf-8');
        console.log(`   ✅ Dekomprimiert: ${(xmlText.length / 1024 / 1024).toFixed(2)} MB`);
      } catch (e) {
        xmlText = buffer.toString('utf-8');
      }
    } else {
      xmlText = buffer.toString('utf-8');
    }

    console.log(`   🔍 Parse XML...`);
    const data = parseEPG(xmlText, source.name);
    
    if (data && data.programmes.length > 0) {
      console.log(`   ✅ ${data.programmes.length} Programme gefunden!`);
      return data;
    } else {
      console.log(`   ⚠️ Keine Programme gefunden`);
      return null;
    }
    
  } catch (error) {
    console.log(`   ❌ Fehler: ${error.message}`);
    return null;
  }
}

function parseEPG(xmlText, sourceName) {
  try {
    const result = parser.parse(xmlText);
    if (!result.tv) return null;

    const programmes = Array.isArray(result.tv.programme) 
      ? result.tv.programme 
      : (result.tv.programme ? [result.tv.programme] : []);

    const channels = {};
    if (result.tv.channel) {
      const chList = Array.isArray(result.tv.channel) 
        ? result.tv.channel 
        : [result.tv.channel];
      
      for (const ch of chList) {
        if (ch.id) {
          let name = ch.id;
          if (ch['display-name']) {
            if (Array.isArray(ch['display-name'])) {
              name = ch['display-name'][0] || ch.id;
            } else if (typeof ch['display-name'] === 'string') {
              name = ch['display-name'];
            }
          }
          channels[ch.id] = String(name).trim();
        }
      }
    }

    console.log(`   📊 Rohdaten: ${programmes.length} Programme, ${Object.keys(channels).length} Kanäle`);

    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      let clean = String(dateStr).split(' ')[0].trim();
      if (clean.length >= 14) {
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

    const filteredProgrammes = programmes
      .filter(p => {
        const start = parseDate(p.start || p['start']);
        return start && start <= sevenDaysLater;
      })
      .map(p => ({
        c: String(p.channel || p['channel'] || '').trim(),
        t: String(p.title || 'Unbekannt').substring(0, 200),
        s: String(p.start || p['start'] || ''),
        e: String(p.stop || p['stop'] || ''),
        d: String(p.desc || '').substring(0, 500),
        cat: String(p.category || '').substring(0, 100)
      }));

    return {
      updated: new Date().toISOString(),
      source: sourceName,
      programmes: filteredProgrammes,
      channels: channels,
      totalProgrammes: filteredProgrammes.length,
      totalChannels: Object.keys(channels).length
    };
    
  } catch (error) {
    console.log(`   ❌ Parse-Fehler: ${error.message}`);
    return null;
  }
}

async function saveJSON(data) {
  if (!data) return;

  const filePath = path.join(OUTPUT_DIR, 'epg.json');
  const jsonString = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, jsonString);
  
  const sizeMB = (jsonString.length / 1024 / 1024).toFixed(2);
  console.log(`\n💾 epg.json gespeichert: ${sizeMB} MB`);

  const gzippedPath = path.join(OUTPUT_DIR, 'epg.json.gz');
  const gzipped = zlib.gzipSync(jsonString);
  await fs.writeFile(gzippedPath, gzipped);
  
  const gzipSizeMB = (gzipped.length / 1024 / 1024).toFixed(2);
  console.log(`   📦 epg.json.gz: ${gzipSizeMB} MB`);
  
  console.log(`   📊 Statistiken:`);
  console.log(`      - Kanäle: ${data.totalChannels}`);
  console.log(`      - Programme: ${data.totalProgrammes}`);
}

async function createIndex(data) {
  const indexData = {
    lastUpdate: new Date().toISOString(),
    source: data.source,
    totalChannels: data.totalChannels,
    totalProgrammes: data.totalProgrammes,
    fileSizeKB: Math.round(JSON.stringify(data).length / 1024),
    fileSizeCompressedKB: Math.round(zlib.gzipSync(JSON.stringify(data)).length / 1024)
  };
  
  await fs.writeFile(
    path.join(OUTPUT_DIR, 'index.json'), 
    JSON.stringify(indexData, null, 2)
  );
  console.log(`📊 index.json erstellt`);
}

async function main() {
  console.log('🚀 EPG-Update gestartet');
  console.log('='.repeat(60));
  
  await ensureDir(OUTPUT_DIR);

  console.log(`\n📡 Lade EPG-Quelle...\n`);
  
  const data = await downloadAndParseEPG(EPG_SOURCES[0]);
  
  if (!data) {
    console.error('\n❌ EPG-Daten konnten nicht geladen werden!');
    process.exit(1);
  }

  await saveJSON(data);
  await createIndex(data);
  
  console.log(`\n✨ EPG-Update erfolgreich abgeschlossen!`);
}

main().catch(console.error);
