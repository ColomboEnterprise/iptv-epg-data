// scripts/fetch-epg.js
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');

// FUNKTIONIERENDE EPG-Quellen (Stand März 2026)
const EPG_SOURCES = [
  // Primär: zsdc.eu.org - 130+ Kanäle, 7 Tage Voraus, tägliche Updates
  { 
    url: 'https://epg.zsdc.eu.org/t.xml.gz',
    name: 'zsdc.eu.org'
  },
  // Fallback 1: epg.one - große Abdeckung
  { 
    url: 'http://epg.one/epg.xml.gz',
    name: 'epg.one'
  },
  // Fallback 2: iptvx.one - gute deutsche Abdeckung
  { 
    url: 'https://iptvx.one/epg/epg.xml.gz',
    name: 'iptvx.one'
  },
  // Fallback 3: teleguide.info - russische Quelle
  { 
    url: 'http://www.teleguide.info/download/new3/xmltv.xml.gz',
    name: 'teleguide.info'
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

async function downloadEPG() {
  let lastError = null;
  
  for (const source of EPG_SOURCES) {
    console.log(`\n📡 Versuche Quelle: ${source.name} (${source.url})`);
    
    try {
      const response = await fetch(source.url, {
        headers: { 
          'User-Agent': 'IPTV-EPG-Fetcher/1.0',
          'Accept-Encoding': 'gzip'
        },
        timeout: 30000
      });

      if (!response.ok) {
        console.log(`   ⚠️ HTTP ${response.status}`);
        lastError = `HTTP ${response.status}`;
        continue;
      }

      console.log(`   ⬇️ Lade Daten...`);
      
      // Gzip-Dekompression
      const buffer = await response.buffer();
      const zlib = require('zlib');
      let xmlText;
      
      try {
        xmlText = zlib.gunzipSync(buffer).toString();
        console.log(`   ✅ Dekomprimiert: ${(xmlText.length / 1024 / 1024).toFixed(2)} MB`);
      } catch (e) {
        // Falls nicht komprimiert
        xmlText = buffer.toString();
        console.log(`   ✅ Ungzip: ${(xmlText.length / 1024 / 1024).toFixed(2)} MB`);
      }

      console.log(`   🔍 Parse XML...`);
      const data = parseEPG(xmlText, source.name);
      
      if (data) {
        console.log(`   ✅ Erfolg mit ${source.name}!`);
        return data;
      }
      
    } catch (error) {
      console.log(`   ❌ Fehler: ${error.message}`);
      lastError = error.message;
    }
  }
  
  throw new Error(`Alle Quellen fehlgeschlagen. Letzter Fehler: ${lastError}`);
}

function parseEPG(xmlText, sourceName) {
  try {
    const result = parser.parse(xmlText);
    
    if (!result.tv) {
      throw new Error('Kein <tv> Element gefunden');
    }

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
            } else if (ch['display-name']['#text']) {
              name = ch['display-name']['#text'];
            }
          }
          channels[ch.id] = String(name).trim();
        }
      }
    }

    console.log(`   📊 ${programmes.length} Programme, ${Object.keys(channels).length} Kanäle`);

    // Nächste 7 Tage filtern
    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      const clean = dateStr.split(' ')[0].trim();
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

    console.log(`   🎯 ${filteredProgrammes.length} aktuelle Programme`);

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

  // Als epg.json speichern
  const filePath = path.join(OUTPUT_DIR, 'epg.json');
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  
  const sizeMB = (JSON.stringify(data).length / 1024 / 1024).toFixed(2);
  console.log(`\n💾 epg.json gespeichert: ${sizeMB} MB`);
  console.log(`   📺 ${data.totalChannels} Kanäle, ${data.totalProgrammes} Programme`);
}

async function main() {
  console.log('🚀 EPG-Update gestartet');
  console.log('📡 Kombinierte EPG-Quellen werden versucht...\n');

  await ensureDir(OUTPUT_DIR);

  try {
    const data = await downloadEPG();
    await saveJSON(data);
    
    console.log('\n✨ EPG-Update erfolgreich abgeschlossen!');
    
  } catch (error) {
    console.error(`\n❌ Fataler Fehler: ${error.message}`);
    process.exit(1);
  }
}

main().catch(console.error);
