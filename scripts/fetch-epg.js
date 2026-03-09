// scripts/fetch-epg.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');
const zlib = require('zlib');
const { Transform } = require('stream');
const { promisify } = require('util');
const pipeline = promisify(require('stream').pipeline);
const { Readable } = require('stream');

/// ✅ IHRE EPG-QUELLE
const EPG_SOURCES = [
  {
    url: 'https://iptvx.one/epg/epg.xml.gz',
    name: 'iptvx.one - Europa (primär)',
    type: 'gz'
  }
];

const OUTPUT_DIR = path.join(__dirname, '../public');
const TEMP_DIR = path.join(__dirname, '../temp');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: true,
  trimValues: true,
  isArray: (name) => ['programme', 'channel'].includes(name)
});

/**
 * Erstellt Verzeichnisse
 */
async function ensureDirs() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(TEMP_DIR, { recursive: true });
}

/**
 * Extrahiert relevante EPG-Daten aus einem XML-Stream
 */
class EPGExtractor extends Transform {
  constructor() {
    super({ readableObjectMode: true });
    this.buffer = '';
    this.programmes = [];
    this.channels = {};
    this.inProgramme = false;
    this.inChannel = false;
    this.currentElement = '';
    this.currentData = {};
    this.count = 0;
    this.maxProgrammes = 200000; // Limit für Cloudflare
  }

  _transform(chunk, encoding, callback) {
    this.buffer += chunk.toString();
    
    // Nur relevante Tags extrahieren (vereinfachte Stream-Parsing)
    const programmeMatches = this.buffer.matchAll(/<programme[^>]*channel="([^"]*)"[^>]*start="([^"]*)"[^>]*stop="([^"]*)"[^>]*>.*?<title>(.*?)<\/title>.*?(?:<desc>(.*?)<\/desc>)?.*?<\/programme>/gs);
    
    for (const match of programmeMatches) {
      if (this.programmes.length >= this.maxProgrammes) break;
      
      this.programmes.push({
        c: match[1],
        s: match[2],
        e: match[3],
        t: match[4].substring(0, 200),
        d: match[5] ? match[5].substring(0, 500) : '',
        cat: ''
      });
      
      this.count++;
      if (this.count % 10000 === 0) {
        console.log(`      📊 ${this.count} Programme extrahiert...`);
      }
    }
    
    // Channels extrahieren
    const channelMatches = this.buffer.matchAll(/<channel id="([^"]*)">.*?<display-name>(.*?)<\/display-name>.*?<\/channel>/gs);
    for (const match of channelMatches) {
      this.channels[match[1]] = match[2];
    }
    
    // Buffer begrenzen (nur letzte 10KB behalten)
    if (this.buffer.length > 10240) {
      this.buffer = this.buffer.slice(-10240);
    }
    
    callback();
  }

  _flush(callback) {
    console.log(`      ✅ Extraktion abgeschlossen: ${this.programmes.length} Programme, ${Object.keys(this.channels).length} Kanäle`);
    this.push({ programmes: this.programmes, channels: this.channels });
    callback();
  }
}

/**
 * Lädt EPG mit Stream-Verarbeitung
 */
async function downloadAndParseEPGStreaming(source) {
  console.log(`\n   📡 Quelle: ${source.name}`);
  console.log(`   URL: ${source.url}`);
  
  try {
    const response = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*'
      }
    });

    if (!response.ok) {
      console.log(`   ❌ HTTP ${response.status}`);
      return null;
    }

    console.log(`   ✅ HTTP ${response.status}`);
    console.log(`   📦 Grösse: ${response.headers.get('content-length')} Bytes`);
    
    // Temporäre Datei für Stream
    const tempFile = path.join(TEMP_DIR, `epg-${Date.now()}.xml`);
    const extractor = new EPGExtractor();
    
    console.log(`   🔄 Verarbeite Stream...`);
    
    // Response in einen Readable Stream verwandeln
    const responseStream = Readable.from(response.body);
    
    // Stream-Pipeline: Download -> Gzip -> Extractor
    let xmlStream;
    
    if (source.type === 'gz' || source.url.endsWith('.gz')) {
      const gunzip = zlib.createGunzip();
      xmlStream = responseStream.pipe(gunzip);
      console.log(`   🔓 Dekomprimiere GZIP...`);
    } else {
      xmlStream = responseStream;
    }
    
    // XML streamen und extrahieren
    const extractionPromise = new Promise((resolve, reject) => {
      const extractor = new EPGExtractor();
      
      xmlStream.on('data', (chunk) => {
        extractor._transform(chunk, null, (err) => {
          if (err) reject(err);
        });
      });
      
      xmlStream.on('end', () => {
        extractor._flush((err) => {
          if (err) reject(err);
          else resolve(extractor);
        });
      });
      
      xmlStream.on('error', reject);
    });
    
    const extractorResult = await extractionPromise;
    
    // Daten aufbereiten
    const programmes = extractorResult.programmes.slice(0, 200000); // Max 200k für Cloudflare
    const channels = extractorResult.channels;
    
    // Nur Programme der nächsten 7 Tage behalten
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
    
    const filteredProgrammes = programmes.filter(p => {
      const start = parseDate(p.s);
      return start && start <= sevenDaysLater;
    });
    
    console.log(`   🎯 ${filteredProgrammes.length} aktuelle Programme (7 Tage)`);
    
    return {
      updated: new Date().toISOString(),
      source: source.name,
      programmes: filteredProgrammes,
      channels: channels,
      totalProgrammes: filteredProgrammes.length,
      totalChannels: Object.keys(channels).length
    };
    
  } catch (error) {
    console.log(`   ❌ Fehler: ${error.message}`);
    console.log(error.stack);
    return null;
  } finally {
    // Aufräumen
    try {
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
    } catch (e) {
      // Ignorieren
    }
  }
}

/**
 * Speichert die EPG-Daten
 */
async function saveEPG(data) {
  if (!data) return;

  console.log(`\n💾 Speichere EPG-Daten...`);

  // Optimierte Ausgabe: Kompakteres JSON
  const output = {
    updated: data.updated,
    source: data.source,
    programmes: data.programmes,
    channels: data.channels,
    stats: {
      totalProgrammes: data.totalProgrammes,
      totalChannels: data.totalChannels
    }
  };
  
  // JSON ohne pretty-printing für kleinere Datei
  const jsonString = JSON.stringify(output);
  
  const filePath = path.join(OUTPUT_DIR, 'epg.json');
  await fs.writeFile(filePath, jsonString);
  
  const sizeMB = (jsonString.length / 1024 / 1024).toFixed(2);
  console.log(`   ✅ epg.json: ${sizeMB} MB`);

  // GZIP komprimieren
  const gzippedPath = path.join(OUTPUT_DIR, 'epg.json.gz');
  const gzipped = zlib.gzipSync(jsonString);
  await fs.writeFile(gzippedPath, gzipped);
  
  const gzipSizeMB = (gzipped.length / 1024 / 1024).toFixed(2);
  console.log(`   ✅ epg.json.gz: ${gzipSizeMB} MB`);
  
  console.log(`   📊 Statistiken:`);
  console.log(`      - Kanäle: ${data.totalChannels}`);
  console.log(`      - Programme: ${data.totalProgrammes}`);
}

/**
 * Hauptfunktion
 */
async function main() {
  console.log('🚀 EPG-Update gestartet');
  console.log('='.repeat(60));
  console.log(`📅 ${new Date().toLocaleString()}`);
  console.log(`🌐 GitHub Actions: ${process.env.GITHUB_ACTIONS === 'true' ? 'JA' : 'NEIN'}`);
  
  await ensureDirs();

  console.log(`\n📡 Lade EPG-Quelle...\n`);
  
  const data = await downloadAndParseEPGStreaming(EPG_SOURCES[0]);
  
  if (!data || data.programmes.length === 0) {
    console.error('\n❌ EPG-Daten konnten nicht geladen werden!');
    process.exit(1);
  }

  await saveEPG(data);
  
  // Index-Datei für Cloudflare
  const indexData = {
    lastUpdate: data.updated,
    totalChannels: data.totalChannels,
    totalProgrammes: data.totalProgrammes,
    source: data.source
  };
  
  await fs.writeFile(
    path.join(OUTPUT_DIR, 'index.json'),
    JSON.stringify(indexData, null, 2)
  );
  
  console.log(`\n✨ EPG-Update erfolgreich abgeschlossen!`);
}

main().catch(error => {
  console.error('\n❌ Fataler Fehler:', error);
  process.exit(1);
});
