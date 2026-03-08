// scripts/fetch-epg.js
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');

// NEUE URL für globetvapp EPG
const EPG_BASE_URL = 'https://raw.githubusercontent.com/globetvapp/epg/main';

const COUNTRIES = [
  { code: 'de', file: 'Germany/germany1.xml' },
  { code: 'at', file: 'Austria/austria1.xml' },
  { code: 'ch', file: 'Switzerland/switzerland1.xml' },
  { code: 'it', file: 'Italy/italy1.xml' },
  { code: 'fr', file: 'France/france1.xml' },
  { code: 'es', file: 'Spain/spain1.xml' },
  { code: 'gb', file: 'Unitedkingdom/uk1.xml' },
  { code: 'us', file: 'Usa/usa1.xml' }
];

const OUTPUT_DIR = path.join(__dirname, '../public');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true
});

async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

async function downloadEPG(country) {
  const url = `${EPG_BASE_URL}/${country.file}`;
  console.log(`📥 Lade ${country.code} von ${url}...`);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`   ⚠️ ${country.code}: Status ${response.status}`);
      return null;
    }
    
    const text = await response.text();
    console.log(`   ✅ ${(text.length / 1024 / 1024).toFixed(2)} MB`);
    return text;
  } catch (error) {
    console.log(`   ❌ ${country.code}: ${error.message}`);
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
    
    console.log(`   🔍 ${programmes.length} Programme gefunden`);
    
    const simplified = {
      updated: new Date().toISOString(),
      country: countryCode,
      count: programmes.length,
      programmes: programmes.slice(0, 2000).map(p => ({
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
    console.log(`   ❌ ${countryCode}: Parse-Fehler - ${error.message}`);
    return null;
  }
}

async function saveJSON(data, countryCode) {
  if (!data) return null;
  
  const filePath = path.join(OUTPUT_DIR, `${countryCode}.json`);
  const jsonString = JSON.stringify(data);
  
  await fs.writeFile(filePath, jsonString);
  console.log(`   💾 ${(jsonString.length / 1024).toFixed(2)} KB gespeichert`);
  
  return {
    country: countryCode,
    count: data.count || 0,
    size: jsonString.length
  };
}

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

async function main() {
  console.log('🚀 EPG-Update gestartet\n');
  
  await ensureDir(OUTPUT_DIR);
  
  const results = [];
  let successCount = 0;
  
  for (const country of COUNTRIES) {
    try {
      const xmlText = await downloadEPG(country);
      if (!xmlText) continue;
      
      const data = parseEPG(xmlText, country.code);
      if (!data) continue;
      
      const result = await saveJSON(data, country.code);
      if (result) {
        results.push(result);
        successCount++;
      }
      
      console.log('');
    } catch (error) {
      console.log(`   ❌ ${country.code}: ${error.message}\n`);
    }
  }
  
  await createIndex(results);
  
  console.log(`\n✨ Fertig! ${successCount} von ${COUNTRIES.length} Ländern erfolgreich geladen.`);
  console.log(`📁 Ausgabe: ${OUTPUT_DIR}`);
}

main().catch(console.error);
