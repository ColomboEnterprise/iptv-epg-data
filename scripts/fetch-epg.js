// scripts/fetch-epg.js
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);

// EPG-QUELLEN - Basierend auf Ihrer funktionierenden Quelle
const EPG_SOURCES = [
  // ✅ IHRE FUNKTIONIERENDE QUELLE
  {
    url: 'https://iptvx.one/epg/epg.xml.gz',
    name: 'iptvx.one - Europa (primär)',
    type: 'gz'
  },
  // ⚠️ Backup falls die primäre Quelle ausfällt
  {
    url: 'https://raw.githubusercontent.com/evo-lua/EPG/main/guide.xml',
    name: 'GitHub Community EPG (Backup)',
    type: 'xml'
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

/**
 * Erstellt das Ausgabeverzeichnis falls es nicht existiert
 */
async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Lädt eine EPG-Quelle herunter und parst sie
 */
async function downloadAndParseEPG(source) {
  console.log(`\n   📡 Quelle: ${source.name}`);
  console.log(`   URL: ${source.url}`);
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60 Sekunden Timeout

    const response = await fetch(source.url, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (compatible; EPG-Fetcher/2.0; +https://github.com/ihr-repo)',
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

    console.log(`   ⬇️ Lade Daten (${response.headers.get('content-length') || 'unbekannt'} Bytes)...`);
    
    const buffer = await response.buffer();
    let xmlText;

    // GZIP Dekompression falls nötig
    if (source.type === 'gz' || source.url.endsWith('.gz')) {
      try {
        const decompressed = await gunzip(buffer);
        xmlText = decompressed.toString('utf-8');
        console.log(`   ✅ Dekomprimiert: ${(xmlText.length / 1024 / 1024).toFixed(2)} MB`);
      } catch (e) {
        console.log(`   ⚠️ Kein gültiges GZIP, versuche als normaler Text: ${e.message}`);
        xmlText = buffer.toString('utf-8');
      }
    } else {
      xmlText = buffer.toString('utf-8');
      console.log(`   ✅ Geladen: ${(xmlText.length / 1024 / 1024).toFixed(2)} MB`);
    }

    // XML parsen
    console.log(`   🔍 Parse XML...`);
    const data = parseEPG(xmlText, source.name);
    
    if (data && data.programmes.length > 0) {
      console.log(`   ✅ ${data.programmes.length} Programme gefunden!`);
      return data;
    } else {
      console.log(`   ⚠️ Keine Programme in der XML gefunden`);
      return null;
    }
    
  } catch (error) {
    if (error.name === 'AbortError' || error.code === 'ETIMEDOUT') {
      console.log(`   ⏱️ Timeout - Verbindung abgebrochen`);
    } else if (error.code === 'ENOTFOUND') {
      console.log(`   🌐 Domain nicht gefunden - Server nicht erreichbar`);
    } else {
      console.log(`   ❌ Fehler: ${error.message}`);
    }
    return null;
  }
}

/**
 * Parst XMLTV in unser internes Format
 */
function parseEPG(xmlText, sourceName) {
  try {
    const result = parser.parse(xmlText);
    
    if (!result.tv) {
      console.log('   ⚠️ Kein <tv> Element in der XML gefunden');
      return null;
    }

    // Programme sammeln
    const programmes = Array.isArray(result.tv.programme) 
      ? result.tv.programme 
      : (result.tv.programme ? [result.tv.programme] : []);

    // Kanäle sammeln
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

    console.log(`   📊 Rohdaten: ${programmes.length} Programme, ${Object.keys(channels).length} Kanäle`);

    // Datum parsen (verschiedene Formate)
    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      
      // Entferne Zeitzone und Whitespace
      let clean = String(dateStr).split(' ')[0].trim().split('+')[0].split('-')[0];
      
      // XMLTV Format: 20260309143000
      if (clean.length >= 14) {
        const year = clean.slice(0, 4);
        const month = clean.slice(4, 6);
        const day = clean.slice(6, 8);
        const hour = clean.slice(8, 10);
        const min = clean.slice(10, 12);
        const sec = clean.slice(12, 14);
        return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);
      }
      
      // Fallback: ISO String
      const date = new Date(dateStr);
      return isNaN(date.getTime()) ? null : date;
    };

    // Nur Programme der nächsten 7 Tage behalten
    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const filteredProgrammes = programmes
      .filter(p => {
        const start = parseDate(p.start || p['start']);
        return start && start <= sevenDaysLater;
      })
      .map(p => ({
        c: String(p.channel || p['channel'] || '').trim(),
        t: String(p.title || p['title'] || 'Unbekannt').substring(0, 200),
        s: String(p.start || p['start'] || ''),
        e: String(p.stop || p['stop'] || ''),
        d: String(p.desc || p['desc'] || '').substring(0, 500),
        cat: String(p.category || p['category'] || '').substring(0, 100)
      }));

    console.log(`   🎯 Nach Filterung: ${filteredProgrammes.length} aktuelle Programme (7 Tage)`);

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

/**
 * Merged mehrere EPG-Datenquellen und entfernt Duplikate
 */
function mergeEPGData(dataArray) {
  if (!dataArray || dataArray.length === 0) return null;
  
  console.log(`\n🔄 Merge ${dataArray.length} EPG-Quellen...`);
  
  const mergedProgrammes = [];
  const mergedChannels = {};
  const seenProgrammes = new Set(); // Für Duplikaterkennung
  
  for (const data of dataArray) {
    if (!data || !data.programmes) continue;
    
    console.log(`   📥 ${data.source}: ${data.programmes.length} Programme, ${data.totalChannels} Kanäle`);
    
    // Channels mergen
    Object.assign(mergedChannels, data.channels);
    
    // Programme mergen (mit Duplikaterkennung)
    for (const prog of data.programmes) {
      // Eindeutiger Schlüssel: Kanal + Startzeit + Titel
      const key = `${prog.c}|${prog.s}|${prog.t}`;
      if (!seenProgrammes.has(key)) {
        seenProgrammes.add(key);
        mergedProgrammes.push(prog);
      }
    }
  }
  
  console.log(`\n📊 Merge-Ergebnis:`);
  console.log(`   📺 Kanäle insgesamt: ${Object.keys(mergedChannels).length}`);
  console.log(`   📺 Programme insgesamt: ${mergedProgrammes.length}`);
  console.log(`   🗑️ Entfernte Duplikate: ${dataArray.reduce((sum, d) => sum + (d?.programmes?.length || 0), 0) - mergedProgrammes.length}`);
  
  return {
    updated: new Date().toISOString(),
    source: `Merged from ${dataArray.length} sources`,
    programmes: mergedProgrammes,
    channels: mergedChannels,
    totalProgrammes: mergedProgrammes.length,
    totalChannels: Object.keys(mergedChannels).length
  };
}

/**
 * Speichert die EPG-Daten als JSON und GZIP
 */
async function saveJSON(data) {
  if (!data) return;

  console.log(`\n💾 Speichere EPG-Daten...`);

  // Als JSON speichern
  const filePath = path.join(OUTPUT_DIR, 'epg.json');
  const jsonString = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, jsonString);
  
  const sizeMB = (jsonString.length / 1024 / 1024).toFixed(2);
  console.log(`   ✅ epg.json: ${sizeMB} MB`);

  // Auch als komprimierte Version für schnellere Downloads
  const gzippedPath = path.join(OUTPUT_DIR, 'epg.json.gz');
  const gzipped = zlib.gzipSync(jsonString);
  await fs.writeFile(gzippedPath, gzipped);
  
  const gzipSizeMB = (gzipped.length / 1024 / 1024).toFixed(2);
  const compressionRatio = ((1 - gzipped.length / jsonString.length) * 100).toFixed(1);
  console.log(`   ✅ epg.json.gz: ${gzipSizeMB} MB (${compressionRatio}% komprimiert)`);
  
  console.log(`   📊 Statistiken:`);
  console.log(`      - Kanäle: ${data.totalChannels}`);
  console.log(`      - Programme: ${data.totalProgrammes}`);
  console.log(`      - Letztes Update: ${data.updated}`);
  console.log(`      - Quelle: ${data.source}`);
}

/**
 * Erstellt eine Index-Datei mit Metadaten für Cloudflare
 */
async function createIndex(data) {
  const indexData = {
    lastUpdate: new Date().toISOString(),
    source: data.source,
    totalChannels: data.totalChannels,
    totalProgrammes: data.totalProgrammes,
    fileSizeKB: Math.round(JSON.stringify(data).length / 1024),
    fileSizeCompressedKB: Math.round(zlib.gzipSync(JSON.stringify(data)).length / 1024),
    sources: EPG_SOURCES.map(s => s.name)
  };
  
  await fs.writeFile(
    path.join(OUTPUT_DIR, 'index.json'), 
    JSON.stringify(indexData, null, 2)
  );
  console.log(`\n📊 index.json erstellt mit Metadaten`);
}

/**
 * Hauptfunktion
 */
async function main() {
  console.log('🚀 EPG-Update gestartet');
  console.log('='.repeat(60));
  console.log(`📅 ${new Date().toLocaleString()}`);
  console.log(`📡 ${EPG_SOURCES.length} EPG-Quellen konfiguriert`);
  
  const startTime = Date.now();

  // Ausgabeverzeichnis erstellen
  await ensureDir(OUTPUT_DIR);

  // Alle Quellen parallel laden
  console.log(`\n📡 Lade EPG-Quellen parallel...\n`);
  
  const promises = EPG_SOURCES.map(source => downloadAndParseEPG(source));
  const results = await Promise.allSettled(promises);
  
  // Erfolgreiche Ergebnisse filtern
  const successfulData = results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);
  
  console.log(`\n✅ Erfolgreiche Quellen: ${successfulData.length}/${EPG_SOURCES.length}`);
  
  if (successfulData.length === 0) {
    console.error('\n❌ KEINE EPG-Daten konnten geladen werden!');
    console.error('   Bitte überprüfen Sie:');
    console.error('   - Internetverbindung');
    console.error('   - Ob die URLs manuell im Browser erreichbar sind');
    console.error('   - Ob firewall/proxy Zugriffe blockiert');
    process.exit(1);
  }

  // Daten mergen
  const mergedData = mergeEPGData(successfulData);
  
  if (!mergedData || mergedData.programmes.length === 0) {
    console.error('\n❌ Merge fehlgeschlagen oder keine Programme vorhanden!');
    process.exit(1);
  }

  // Speichern
  await saveJSON(mergedData);
  await createIndex(mergedData);
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✨ EPG-Update erfolgreich abgeschlossen in ${duration} Sekunden!`);
  console.log('='.repeat(60));
}

// Fehlerbehandlung für unbehandelte Promise-Rejections
process.on('unhandledRejection', (error) => {
  console.error('\n❌ Unbehandelter Fehler:', error);
  process.exit(1);
});

// Skript ausführen
main().catch(error => {
  console.error('\n❌ Fataler Fehler:', error);
  process.exit(1);
});
