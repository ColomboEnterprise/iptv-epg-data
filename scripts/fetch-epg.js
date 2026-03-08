// scripts/fetch-epg.js
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');

// NEUE URL für globetvapp EPG
const EPG_BASE_URL = 'https://raw.githubusercontent.com/globetvapp/epg/main';

const COUNTRIES = [
  // Europa
  { code: 'de', file: 'Germany/germany1.xml' },
  { code: 'at', file: 'Austria/austria1.xml' },
  { code: 'ch', file: 'Switzerland/switzerland1.xml' },
  { code: 'it', file: 'Italy/italy1.xml' },
  { code: 'fr', file: 'France/france1.xml' },
  { code: 'es', file: 'Spain/spain1.xml' },
  { code: 'pt', file: 'Portugal/portugal1.xml' },
  { code: 'gb', file: 'Unitedkingdom/uk1.xml' }, // KORRIGIERT: Unitedkingdom (ohne Leerzeichen)
  { code: 'ie', file: 'Ireland/ireland1.xml' },
  { code: 'nl', file: 'Netherlands/netherlands1.xml' },
  { code: 'be', file: 'Belgium/belgium1.xml' },
  { code: 'lu', file: 'Luxembourg/luxembourg1.xml' },
  { code: 'dk', file: 'Denmark/denmark1.xml' },
  { code: 'se', file: 'Sweden/sweden1.xml' },
  { code: 'no', file: 'Norway/norway1.xml' },
  { code: 'fi', file: 'Finland/finland1.xml' },
  { code: 'is', file: 'Iceland/iceland1.xml' },
  { code: 'pl', file: 'Poland/poland1.xml' },
  { code: 'cz', file: 'Czech/czech1.xml' },
  { code: 'sk', file: 'Slovakia/slovakia1.xml' },
  { code: 'hu', file: 'Hungary/hungary1.xml' },
  { code: 'ro', file: 'Romania/romania1.xml' },
  { code: 'bg', file: 'Bulgaria/bulgaria1.xml' },
  { code: 'gr', file: 'Greece/greece1.xml' },
  { code: 'hr', file: 'Croatia/croatia1.xml' },
  { code: 'si', file: 'Slovenia/slovenia1.xml' },
  { code: 'rs', file: 'Serbia/serbia1.xml' },
  { code: 'ba', file: 'Bosnia/bosnia1.xml' },
  { code: 'me', file: 'Montenegro/montenegro1.xml' },
  { code: 'al', file: 'Albania/albania1.xml' },
  { code: 'mk', file: 'Macedonia/macedonia1.xml' },
  { code: 'tr', file: 'Turkey/turkey1.xml' },
  { code: 'ru', file: 'Russia/russia1.xml' },
  { code: 'ua', file: 'Ukraine/ukraine1.xml' },
  { code: 'by', file: 'Belarus/belarus1.xml' },
  { code: 'lt', file: 'Lithuania/lithuania1.xml' },
  { code: 'lv', file: 'Latvia/latvia1.xml' },
  { code: 'ee', file: 'Estonia/estonia1.xml' },
  { code: 'md', file: 'Moldova/moldova1.xml' },
  { code: 'cy', file: 'Cyprus/cyprus1.xml' },
  { code: 'mt', file: 'Malta/malta1.xml' },

  // Nordamerika
  { code: 'us', file: 'Usa/usa1.xml' },
  { code: 'ca', file: 'Canada/canada1.xml' },
  { code: 'mx', file: 'Mexico/mexico1.xml' },

  // Südamerika
  { code: 'br', file: 'Brazil/brazil1.xml' },
  { code: 'ar', file: 'Argentina/argentina1.xml' },
  { code: 'cl', file: 'Chile/chile1.xml' },
  { code: 'co', file: 'Colombia/colombia1.xml' },
  { code: 'pe', file: 'Peru/peru1.xml' },
  { code: 've', file: 'Venezuela/venezuela1.xml' },
  { code: 'ec', file: 'Ecuador/ecuador1.xml' },
  { code: 'bo', file: 'Bolivia/bolivia1.xml' },
  { code: 'py', file: 'Paraguay/paraguay1.xml' },
  { code: 'uy', file: 'Uruguay/uruguay1.xml' },
  { code: 'gy', file: 'Guyana/guyana1.xml' },
  { code: 'sr', file: 'Suriname/suriname1.xml' },

  // Asien
  { code: 'jp', file: 'Japan/japan1.xml' },
  { code: 'kr', file: 'Korea/korea1.xml' },
  { code: 'cn', file: 'China/china1.xml' },
  { code: 'tw', file: 'Taiwan/taiwan1.xml' },
  { code: 'hk', file: 'Hongkong/hongkong1.xml' },
  { code: 'mo', file: 'Macau/macau1.xml' },
  { code: 'in', file: 'India/india1.xml' },
  { code: 'pk', file: 'Pakistan/pakistan1.xml' },
  { code: 'bd', file: 'Bangladesh/bangladesh1.xml' },
  { code: 'lk', file: 'Srilanka/srilanka1.xml' },
  { code: 'np', file: 'Nepal/nepal1.xml' },
  { code: 'bt', file: 'Bhutan/bhutan1.xml' },
  { code: 'mv', file: 'Maldives/maldives1.xml' },
  { code: 'id', file: 'Indonesia/indonesia1.xml' },
  { code: 'my', file: 'Malaysia/malaysia1.xml' },
  { code: 'sg', file: 'Singapore/singapore1.xml' },
  { code: 'th', file: 'Thailand/thailand1.xml' },
  { code: 'vn', file: 'Vietnam/vietnam1.xml' },
  { code: 'ph', file: 'Philippines/philippines1.xml' },
  { code: 'mm', file: 'Myanmar/myanmar1.xml' },
  { code: 'kh', file: 'Cambodia/cambodia1.xml' },
  { code: 'la', file: 'Laos/laos1.xml' },
  { code: 'mn', file: 'Mongolia/mongolia1.xml' },
  { code: 'af', file: 'Afghanistan/afghanistan1.xml' },
  { code: 'ir', file: 'Iran/iran1.xml' },
  { code: 'iq', file: 'Iraq/iraq1.xml' },
  { code: 'sa', file: 'Saudiarabia/saudiarabia1.xml' },
  { code: 'ye', file: 'Yemen/yemen1.xml' },
  { code: 'sy', file: 'Syria/syria1.xml' },
  { code: 'jo', file: 'Jordan/jordan1.xml' },
  { code: 'lb', file: 'Lebanon/lebanon1.xml' },
  { code: 'il', file: 'Israel/israel1.xml' },
  { code: 'ps', file: 'Palestine/palestine1.xml' },
  { code: 'kw', file: 'Kuwait/kuwait1.xml' },
  { code: 'bh', file: 'Bahrain/bahrain1.xml' },
  { code: 'qa', file: 'Qatar/qatar1.xml' },
  { code: 'ae', file: 'Uae/uae1.xml' },
  { code: 'om', file: 'Oman/oman1.xml' },
  { code: 'uz', file: 'Uzbekistan/uzbekistan1.xml' },
  { code: 'kz', file: 'Kazakhstan/kazakhstan1.xml' },
  { code: 'kg', file: 'Kyrgyzstan/kyrgyzstan1.xml' },
  { code: 'tj', file: 'Tajikistan/tajikistan1.xml' },
  { code: 'tm', file: 'Turkmenistan/turkmenistan1.xml' },
  { code: 'ge', file: 'Georgia/georgia1.xml' },
  { code: 'az', file: 'Azerbaijan/azerbaijan1.xml' },
  { code: 'am', file: 'Armenia/armenia1.xml' },

  // Afrika
  { code: 'eg', file: 'Egypt/egypt1.xml' },
  { code: 'za', file: 'Southafrica/southafrica1.xml' },
  { code: 'ng', file: 'Nigeria/nigeria1.xml' },
  { code: 'ke', file: 'Kenya/kenya1.xml' },
  { code: 'gh', file: 'Ghana/ghana1.xml' },
  { code: 'ma', file: 'Morocco/morocco1.xml' },
  { code: 'dz', file: 'Algeria/algeria1.xml' },
  { code: 'tn', file: 'Tunisia/tunisia1.xml' },
  { code: 'ly', file: 'Libya/libya1.xml' },
  { code: 'sd', file: 'Sudan/sudan1.xml' },
  { code: 'et', file: 'Ethiopia/ethiopia1.xml' },
  { code: 'ug', file: 'Uganda/uganda1.xml' },
  { code: 'tz', file: 'Tanzania/tanzania1.xml' },
  { code: 'zm', file: 'Zambia/zambia1.xml' },
  { code: 'zw', file: 'Zimbabwe/zimbabwe1.xml' },
  { code: 'mw', file: 'Malawi/malawi1.xml' },
  { code: 'mg', file: 'Madagascar/madagascar1.xml' },
  { code: 'mu', file: 'Mauritius/mauritius1.xml' },
  { code: 're', file: 'Reunion/reunion1.xml' },
  { code: 'ci', file: 'Ivorycoast/ivorycoast1.xml' },
  { code: 'sn', file: 'Senegal/senegal1.xml' },
  { code: 'ml', file: 'Mali/mali1.xml' },
  { code: 'bf', file: 'Burkinafaso/burkinafaso1.xml' },
  { code: 'ne', file: 'Niger/niger1.xml' },
  { code: 'td', file: 'Chad/chad1.xml' },
  { code: 'cm', file: 'Cameroon/cameroon1.xml' },
  { code: 'ga', file: 'Gabon/gabon1.xml' },
  { code: 'cg', file: 'Congo/congo1.xml' },
  { code: 'cd', file: 'DrCongo/drcongo1.xml' },
  { code: 'ao', file: 'Angola/angola1.xml' },
  { code: 'na', file: 'Namibia/namibia1.xml' },
  { code: 'bw', file: 'Botswana/botswana1.xml' },
  { code: 'sz', file: 'Swaziland/swaziland1.xml' },
  { code: 'ls', file: 'Lesotho/lesotho1.xml' },

  // Ozeanien
  { code: 'au', file: 'Australia/australia1.xml' },
  { code: 'nz', file: 'Newzealand/newzealand1.xml' },
  { code: 'nc', file: 'Newcaledonia/newcaledonia1.xml' },
  { code: 'pf', file: 'Polynesia/polynesia1.xml' },
  { code: 'fj', file: 'Fiji/fiji1.xml' },
  { code: 'pg', file: 'Papua/papua1.xml' },

  // Karibik
  { code: 'cu', file: 'Cuba/cuba1.xml' },
  { code: 'jm', file: 'Jamaica/jamaica1.xml' },
  { code: 'ht', file: 'Haiti/haiti1.xml' },
  { code: 'do', file: 'Dominican/dominican1.xml' },
  { code: 'pr', file: 'Puertorico/puertorico1.xml' },
  { code: 'bs', file: 'Bahamas/bahamas1.xml' },
  { code: 'tt', file: 'Trinidad/trinidad1.xml' },
  { code: 'bb', file: 'Barbados/barbados1.xml' }
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
