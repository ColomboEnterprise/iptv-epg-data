// scripts/fetch-epg.js
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);

/// ✅ IHRE FUNKTIONIERENDE EPG-QUELLE
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

/**
 * Erstellt das Ausgabeverzeichnis falls es nicht existiert
 */
async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Lädt eine EPG-Quelle herunter und parst sie - MIT BROWSER-EMULATION
 */
async function downloadAndParseEPG(source) {
  console.log(`\n   📡 Quelle: ${source.name}`);
  console.log(`   URL: ${source.url}`);
  
  // Maximale Browser-Emulation für GitHub Actions
  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    'Referer': 'https://iptvx.one/',
    'Origin': 'https://iptvx.one'
  };
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    // ERSTER VERSUCH: Mit maximalen Browser-Headern
    let response = await fetch(source.url, {
      headers: browserHeaders,
      signal: controller.signal,
      timeout: 30000,
      follow: 5, // Folge Redirects
      compress: true // Erlaubt komprimierte Antworten
    });

    // ZWEITER VERSUCH: Falls erster fehlschlägt, mit minimalen Headern
    if (!response.ok) {
      console.log(`   ⚠️ Versuch 1 fehlgeschlagen (${response.status}), versuche einfachen Request...`);
      
      const simpleHeaders = {
        'User-Agent': 'Mozilla/5.0 (compatible; EPG-Fetcher/1.0)',
        'Accept': 'application/xml, text/xml, */*'
      };
      
      response = await fetch(source.url, {
        headers: simpleHeaders,
        signal: controller.signal,
        timeout: 30000,
        follow: 5
      });
    }

    clearTimeout(timeout);

    if (!response.ok) {
      console.log(`   ❌ HTTP ${response.status} - ${response.statusText}`);
      
      // Versuche den Response-Text zu lesen (für Debug)
      try {
        const errorText = await response.text();
        console.log(`   📄 Server-Antwort (Auszug): ${errorText.substring(0, 200)}`);
      } catch (e) {
        // Ignorieren
      }
      
      return null;
    }

    console.log(`   ✅ HTTP ${response.status} - ${response.statusText}`);
    console.log(`   📦 Content-Type: ${response.headers.get('content-type')}`);
    console.log(`   📏 Content-Length: ${response.headers.get('content-length') || 'unbekannt'} Bytes`);
    
    const buffer = await response.buffer();
    let xmlText;
    let usedGzip = false;

    // Prüfen ob GZIP-komprimiert (entweder durch Header oder Dateiendung)
    const isGzipped = source.type === 'gz' || 
                      source.url.endsWith('.gz') || 
                      response.headers.get('content-encoding')?.includes('gzip');

    if (isGzipped) {
      try {
        console.log(`   🔓 Versuche GZIP-Dekompression...`);
        const decompressed = await gunzip(buffer);
        xmlText = decompressed.toString('utf-8');
        usedGzip = true;
        console.log(`   ✅ Dekomprimiert: ${(xmlText.length / 1024 / 1024).toFixed(2)} MB`);
      } catch (e) {
        console.log(`   ⚠️ GZIP-Dekompression fehlgeschlagen: ${e.message}`);
        console.log(`   ⚠️ Versuche als normaler Text...`);
        xmlText = buffer.toString('utf-8');
      }
    } else {
      xmlText = buffer.toString('utf-8');
      console.log(`   ✅ Geladen: ${(xmlText.length / 1024 / 1024).toFixed(2)} MB`);
    }

    // Prüfen ob wir HTML statt XML bekommen haben (häufiger Fehler)
    if (xmlText.trim().toLowerCase().startsWith('<!doctype html>') || 
        xmlText.trim().toLowerCase().startsWith('<html')) {
      console.log(`   ⚠️ WARNUNG: HTML statt XML empfangen!`);
      console.log(`   📄 Erste 300 Zeichen:`);
      console.log(`   ${xmlText.substring(0, 300).replace(/\n/g, ' ')}`);
      
      // Trotzdem versuchen zu parsen? Nein, besser abbrechen.
      return null;
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
    clearTimeout(timeout);
    
    if (error.name === 'AbortError' || error.code === 'ETIMEDOUT') {
      console.log(`   ⏱️ Timeout - Verbindung abgebrochen`);
    } else if (error.code === 'ENOTFOUND') {
      console.log(`   🌐 Domain nicht gefunden - Server nicht erreichbar`);
    } else if (error.code === 'ECONNREFUSED') {
      console.log(`   🔌 Verbindung verweigert - Server ablehnend`);
    } else if (error.type === 'invalid-json') {
      console.log(`   ❌ Ungültige JSON-Antwort`);
    } else {
      console.log(`   ❌ Fehler: ${error.message}`);
      console.log(`   📚 Fehlertyp: ${error.type || 'unbekannt'}`);
      console.log(`   🔢 Error-Code: ${error.code || 'kein Code'}`);
    }
    
    return null;
  }
}

/**
 * Parst XMLTV in unser internes Format
 */
function parseEPG(xmlText, sourceName) {
  try {
    // Entferne mögliche BOM (Byte Order Mark)
    if (xmlText.charCodeAt(0) === 0xFEFF) {
      xmlText = xmlText.substring(1);
    }
    
    const result = parser.parse(xmlText);
    
    if (!result.tv) {
      console.log('   ⚠️ Kein <tv> Element in der XML gefunden');
      
      // Prüfe auf häufige Fehler
      if (xmlText.includes('Access Denied')) {
        console.log('   🔒 Server blockiert den Zugriff (Access Denied)');
      } else if (xmlText.includes('404 Not Found')) {
        console.log('   🚫 Datei nicht gefunden (404)');
      }
      
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
    
    // Zeige den fehlerhaften XML-Ausschnitt für Debug
    console.log(`   📄 XML-Ausschnitt (erste 200 Zeichen):`);
    console.log(`   ${xmlText.substring(0, 200).replace(/\n/g, ' ')}`);
    
    return null;
  }
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
    fileSizeCompressedKB: Math.round(zlib.gzipSync(JSON.stringify(data)).length / 1024)
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
  console.log(`📡 ${EPG_SOURCES.length} EPG-Quelle konfiguriert`);
  console.log(`🌐 GitHub Actions: ${process.env.GITHUB_ACTIONS === 'true' ? 'JA' : 'NEIN'}`);
  
  const startTime = Date.now();

  // Ausgabeverzeichnis erstellen
  await ensureDir(OUTPUT_DIR);

  console.log(`\n📡 Lade EPG-Quelle...\n`);
  
  const data = await downloadAndParseEPG(EPG_SOURCES[0]);
  
  if (!data) {
    console.error('\n❌ EPG-Daten konnten nicht geladen werden!');
    
    // In GitHub Actions: Fehlercode zurückgeben
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.log('⚠️ GitHub Actions erkannt - Workflow wird mit Fehler beendet');
    }
    
    process.exit(1);
  }

  await saveJSON(data);
  await createIndex(data);
  
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
