// scripts/fetch-epg.js
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');

// Konfiguration - Sie können diese Länder anpassen!
const COUNTRIES = [
  'de', 'at', 'ch', 'it', 'fr', 'es',      // Westeuropa
  'uk', 'us', 'ca',                         // Englischsprachig
  'nl', 'be', 'se', 'no', 'dk', 'fi',       // Nordeuropa
  'pl', 'cz', 'hu', 'ro', 'bg', 'gr',        // Osteuropa
  'tr', 'ru', 'ua',                          // Ost-/Südeuropa
  'il', 'sa', 'ae', 'qa', 'kw'               // Naher Osten
];

const OUTPUT_DIR = path.join(__dirname, '../public');
const EPG_BASE_URL = 'https://iptv-org.github.io/epg/guides';

// XML Parser
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true
});

// Hilfsfunktion: Verzeichnis erstellen
async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

// EPG für ein Land herunterladen
async function downloadEPG(country) {
  const url = `${EPG_BASE_URL}/${country}.xml`;
  console.log(`📥 Lade ${country}...`);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`   ⚠️ ${country}: Status ${response.status}`);
      return null;
    }
    
    const text = await response.text();
    console.log(`   ✅ ${(text.length / 1024 / 1024).toFixed(2)} MB`);
    return text;
  } catch (error) {
    console.log(`   ❌ ${country}: ${error.message}`);
    return null;
  }
}

// EPG parsen und optimieren
function parseEPG(xmlText, country) {
  try {
    const result = parser.parse(xmlText);
    
    if (!result.tv || !result.tv.programme) {
      console.log(`   ⚠️ ${country}: Keine Programme`);
      return null;
    }
    
    // Programme in Array konvertieren (falls nur eines)
    const programmes = Array.isArray(result.tv.programme) 
      ? result.tv.programme 
      : [result.tv.programme];
    
    console.log(`   🔍 ${programmes.length} Programme gefunden`);
    
    // Vereinfachtes Format
    const simplified = {
      updated: new Date().toISOString(),
      country: country,
      count: programmes.length,
      programmes: programmes.slice(0, 1000).map(p => ({  // Max. 1000 pro Land
        c: p['@_channel'] || '',
        t: (p.title && (p.title['#text'] || p.title)) || 'Unbekannt',
        s: p['@_start'] || '',
        e: p['@_stop'] || '',
        d: (p.desc && (p.desc['#text'] || p.desc)) || '',
        cat: (p.category && (p.category['#text'] || p.category)) || ''
      }))
    };
    
    return simplified;
  } catch (error) {
    console.log(`   ❌ ${country}: Parse-Fehler - ${error.message}`);
    return null;
  }
}

// JSON speichern
async function saveJSON(data, country) {
  if (!data) return null;
  
  const filePath = path.join(OUTPUT_DIR, `${country}.json`);
  const jsonString = JSON.stringify(data);
  
  await fs.writeFile(filePath, jsonString);
  console.log(`   💾 ${(jsonString.length / 1024).toFixed(2)} KB gespeichert`);
  
  return {
    country: country,
    count: data.count || 0,
    size: jsonString.length
  };
}

// Index-Datei erstellen
async function createIndex(results) {
  const index = {
    lastUpdate: new Date().toISOString(),
    totalCountries: results.length,
    totalProgrammes: results.reduce((sum, r) => sum + (r.count || 0), 0),
    countries: results.map(r => ({
      code: r.country,
      programmes: r.count || 0,
      sizeKB: Math.round(r.size / 1024)
    }))
  };
  
  const indexPath = path.join(OUTPUT_DIR, 'index.json');
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
  console.log(`\n📊 Index-Datei erstellt mit ${results.length} Ländern`);
}

// Hauptfunktion
async function main() {
  console.log('🚀 EPG-Update gestartet\n');
  
  await ensureDir(OUTPUT_DIR);
  
  const results = [];
  let successCount = 0;
  
  for (const country of COUNTRIES) {
    try {
      const xmlText = await downloadEPG(country);
      if (!xmlText) continue;
      
      const data = parseEPG(xmlText, country);
      if (!data) continue;
      
      const result = await saveJSON(data, country);
      if (result) {
        results.push(result);
        successCount++;
      }
      
      console.log(''); // Leerzeile für Lesbarkeit
    } catch (error) {
      console.log(`   ❌ ${country}: ${error.message}\n`);
    }
  }
  
  await createIndex(results);
  
  console.log(`\n✨ Fertig! ${successCount} von ${COUNTRIES.length} Ländern erfolgreich geladen.`);
  console.log(`📁 Ausgabe: ${OUTPUT_DIR}`);
}

main().catch(console.error);
