// scripts/fetch-epg.js
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');

// FUNKTIONIERENDE EPG-Quellen (Stand März 2026)
const EPG_SOURCES = [
  // Primär: zsdc.eu.org (zuverlässig)
  { 
    url: 'https://epg.zsdc.eu.org/t.xml.gz',
    type: 'combined'  // Eine Datei für alle Länder
  },
  // Fallback 1: epg.one
  { 
    url: 'http://epg.one/epg.xml.gz',
    type: 'combined'
  },
  // Fallback 2: iptvx.one
  { 
    url: 'https://iptvx.one/epg/epg.xml.gz',
    type: 'combined'
  },
  // Fallback 3: teleguide.info
  { 
    url: 'http://www.teleguide.info/download/new3/xmltv.xml.gz',
    type: 'combined'
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

async function downloadCombinedEPG(source) {
  console.log(`📥 Lade EPG von ${source.url}...`);
  
  try {
    const response = await fetch(source.url, {
      headers: { 'User-Agent': 'IPTV-EPG-Fetcher/1.0' },
      timeout: 30000
    });

    if (!response.ok) {
      console.log(`   ⚠️ Status ${response.status}`);
      return null;
    }

    // Gzip-Dekompression falls nötig
    let text;
    if (source.url.endsWith('.gz')) {
      const buffer = await response.buffer();
      const zlib = require('zlib');
      text = zlib.gunzipSync(buffer).toString();
    } else {
      text = await response.text();
    }

    console.log(`   ✅ ${(text.length/1024/1024).toFixed(2)} MB geladen`);
    return parseCombinedEPG(text);
  } catch (error) {
    console.log(`   ❌ ${error.message}`);
    return null;
  }
}

function parseCombinedEPG(xmlText) {
  try {
    const result = parser.parse(xmlText);
    if (!result.tv || !result.tv.programme) return null;

    const programmes = Array.isArray(result.tv.programme) 
      ? result.tv.programme 
      : [result.tv.programme];

    // Kanäle parsen
    const channels = {};
    if (result.tv.channel) {
      const chList = Array.isArray(result.tv.channel) 
        ? result.tv.channel 
        : [result.tv.channel];
      for (const ch of chList) {
        if (ch.id) {
          const displayName = ch['display-name'];
          channels[ch.id] = displayName 
            ? (typeof displayName === 'string' ? displayName : displayName[0] || ch.id)
            : ch.id;
        }
      }
    }

    console.log(`   📊 ${programmes.length} Programme, ${Object.keys(channels).length} Kanäle`);
    
    return {
      programmes,
      channels,
      totalCount: programmes.length
    };
  } catch (error) {
    console.log(`   ❌ Parse-Fehler: ${error.message}`);
    return null;
  }
}

async function saveJSON(data, filename) {
  const filePath = path.join(OUTPUT_DIR, filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  console.log(`   💾 ${filename} gespeichert (${(JSON.stringify(data).length/1024).toFixed(2)} KB)`);
}

async function main() {
  console.log('🚀 EPG-Update gestartet\n');
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  let success = false;
  
  // Versuche jede Quelle der Reihe nach
  for (const source of EPG_SOURCES) {
    console.log(`\n🔄 Versuche Quelle: ${source.url}`);
    const data = await downloadCombinedEPG(source);
    
    if (data) {
      // Speichere die komplette EPG
      await saveJSON({
        updated: new Date().toISOString(),
        source: source.url,
        programmes: data.programmes,
        channels: data.channels
      }, 'epg.json');
      
      // Erstelle auch länderspezifische Dateien für Kompatibilität
      const byCountry = {};
      for (const prog of data.programmes) {
        const channelId = prog.channel || prog['channel'];
        // Hier könnten Sie nach Ländercode filtern (z.B. .de, .fr in der channelId)
        // Für jetzt speichern wir alles in einer Datei
      }
      
      console.log(`\n✅ Erfolg mit Quelle: ${source.url}`);
      success = true;
      break;
    }
  }

  if (!success) {
    console.log('\n❌ Alle Quellen fehlgeschlagen!');
    process.exit(1);
  }

  // Erstelle Index
  const index = {
    lastUpdate: new Date().toISOString(),
    source: 'multiple',
    programmes: 0, // Könnte man auslesen
    channels: 0
  };
  await saveJSON(index, 'index.json');
  
  console.log('\n✨ EPG-Update abgeschlossen!');
}

main().catch(console.error);
