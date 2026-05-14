let currentCoords = null;
let currentLabel = "";
let lastAnswer = "";
let lastResults = [];

const gpsBtn = document.getElementById("gpsBtn");
const duboisBtn = document.getElementById("duboisBtn");
const locationStatus = document.getElementById("locationStatus");
const queryInput = document.getElementById("queryInput");
const askBtn = document.getElementById("askBtn");
const voiceBtn = document.getElementById("voiceBtn");
const speakBtn = document.getElementById("speakBtn");
const voiceStatus = document.getElementById("voiceStatus");
const answerBox = document.getElementById("answerBox");
const cards = document.getElementById("cards");

const DUBOIS = { lat: 41.1192, lon: -78.7600, label: "DuBois, PA test mode" };

function setLocation(lat, lon, label) {
  currentCoords = { lat, lon };
  currentLabel = label;
  locationStatus.textContent = `Current location: ${label} (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
}

gpsBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    locationStatus.textContent = "GPS is not supported in this browser.";
    return;
  }

  locationStatus.textContent = "Requesting location permission...";
  navigator.geolocation.getCurrentPosition(
    pos => {
      setLocation(pos.coords.latitude, pos.coords.longitude, "your GPS location");
      runQuery(queryInput.value || "gas and coffee nearby");
    },
    err => {
      locationStatus.textContent = `Location error: ${err.message}. Try HTTPS/Netlify or use DuBois test mode.`;
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
});

duboisBtn.addEventListener("click", () => {
  setLocation(DUBOIS.lat, DUBOIS.lon, DUBOIS.label);
  runQuery(queryInput.value || "gas and coffee nearby");
});

function classifyQuery(query) {
  const q = query.toLowerCase();
  if (q.includes("gas") || q.includes("fuel")) return { label: "gas stations", tags: ['node["amenity"="fuel"]','way["amenity"="fuel"]','relation["amenity"="fuel"]'] };
  if (q.includes("coffee") || q.includes("cafe") || q.includes("café")) return { label: "coffee shops", tags: ['node["amenity"="cafe"]','way["amenity"="cafe"]','relation["amenity"="cafe"]'] };
  if (q.includes("food") || q.includes("eat") || q.includes("restaurant") || q.includes("lunch") || q.includes("dinner")) return { label: "food", tags: ['node["amenity"="restaurant"]','way["amenity"="restaurant"]','relation["amenity"="restaurant"]','node["amenity"="fast_food"]','way["amenity"="fast_food"]','relation["amenity"="fast_food"]'] };
  if (q.includes("scenic") || q.includes("park") || q.includes("trail") || q.includes("walk") || q.includes("view")) return { label: "scenic stops", tags: ['node["tourism"="viewpoint"]','way["tourism"="viewpoint"]','node["leisure"="park"]','way["leisure"="park"]','relation["leisure"="park"]','way["highway"="path"]','way["highway"="footway"]'] };
  if (q.includes("kid") || q.includes("children") || q.includes("break") || q.includes("playground")) return { label: "kid-friendly breaks", tags: ['node["leisure"="playground"]','way["leisure"="playground"]','node["leisure"="park"]','way["leisure"="park"]','relation["leisure"="park"]','node["amenity"="restaurant"]','node["amenity"="fast_food"]'] };
  if (q.includes("help") || q.includes("shelter") || q.includes("community") || q.includes("food pantry")) return { label: "community help", tags: ['node["amenity"="social_facility"]','way["amenity"="social_facility"]','node["amenity"="place_of_worship"]','way["amenity"="place_of_worship"]','node["office"="ngo"]','way["office"="ngo"]'] };
  return { label: "nearby places", tags: ['node["amenity"="fuel"]','node["amenity"="cafe"]','node["amenity"="restaurant"]','node["leisure"="park"]'] };
}

function buildOverpassQuery(lat, lon, tags, radius = 6000) {
  const parts = tags.map(t => `${t}(around:${radius},${lat},${lon});`).join("\n");
  return `[out:json][timeout:15];\n(\n${parts}\n);\nout center tags 25;`;
}

async function fetchOverpass(lat, lon, tags) {
  const query = buildOverpassQuery(lat, lon, tags);
  const url = "https://overpass-api.de/api/interpreter";
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: "data=" + encodeURIComponent(query)
  });

  if (!response.ok) throw new Error("Overpass request failed");
  const data = await response.json();

  return (data.elements || [])
    .map(el => {
      const pLat = el.lat || (el.center && el.center.lat);
      const pLon = el.lon || (el.center && el.center.lon);
      if (!pLat || !pLon) return null;
      const name = el.tags?.name || guessName(el.tags) || "Unnamed place";
      const type = readableType(el.tags);
      return {
        name,
        type,
        lat: pLat,
        lon: pLon,
        distance: distanceMiles(lat, lon, pLat, pLon),
        tags: el.tags || {}
      };
    })
    .filter(Boolean)
    .filter(p => p.name !== "Unnamed place")
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8);
}

function guessName(tags = {}) {
  if (tags.brand) return tags.brand;
  if (tags.operator) return tags.operator;
  if (tags.amenity === "fuel") return "Gas station";
  if (tags.amenity === "cafe") return "Coffee shop";
  if (tags.amenity === "restaurant") return "Restaurant";
  if (tags.amenity === "fast_food") return "Fast food";
  if (tags.leisure === "park") return "Park";
  if (tags.tourism === "viewpoint") return "Scenic viewpoint";
  if (tags.amenity === "place_of_worship") return "Place of worship";
  return "";
}

function readableType(tags = {}) {
  if (tags.amenity === "fuel") return "Gas";
  if (tags.amenity === "cafe") return "Coffee";
  if (tags.amenity === "restaurant") return "Restaurant";
  if (tags.amenity === "fast_food") return "Fast Food";
  if (tags.leisure === "park") return "Park";
  if (tags.leisure === "playground") return "Playground";
  if (tags.tourism === "viewpoint") return "Scenic View";
  if (tags.amenity === "social_facility") return "Community Help";
  if (tags.amenity === "place_of_worship") return "Church / Worship";
  if (tags.office === "ngo") return "Nonprofit";
  return "Place";
}

async function runQuery(query) {
  const clean = query.trim();
  if (!clean) return;

  queryInput.value = clean;

  if (!currentCoords) {
    answerBox.textContent = "Set your location first. Use GPS or DuBois test mode.";
    return;
  }

  const intent = classifyQuery(clean);
  answerBox.textContent = `Looking for ${intent.label} near ${currentLabel}...`;
  cards.innerHTML = `<div class="card"><h3>Searching live map data...</h3><p>This can take a few seconds.</p></div>`;

  try {
    const results = await fetchOverpass(currentCoords.lat, currentCoords.lon, intent.tags);
    lastResults = results;

    if (!results.length) {
      lastAnswer = `I could not find good ${intent.label} in the public map data nearby. Try a broader request like food, gas, coffee, or scenic stop.`;
      answerBox.textContent = lastAnswer;
      cards.innerHTML = `<div class="card"><h3>No live results found</h3><p>OpenStreetMap may not have enough data here yet, or the search was too specific.</p></div>`;
      return;
    }

    const first = results[0];
    lastAnswer = `I found ${results.length} ${intent.label} near ${currentLabel}. Closest good match is ${first.name}, about ${first.distance.toFixed(1)} miles away. Want directions or another type of stop?`;
    answerBox.textContent = lastAnswer;
    renderCards(results);
  } catch (err) {
    lastAnswer = "Live lookup failed. This can happen if the public map server is busy or the browser blocks the request.";
    answerBox.textContent = lastAnswer;
    cards.innerHTML = `<div class="card"><h3>Lookup failed</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function renderCards(results) {
  cards.innerHTML = results.map(place => {
    const maps = `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lon}`;
    const osm = `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=16/${place.lat}/${place.lon}`;
    const desc = `${place.type} · ${place.distance.toFixed(1)} miles away`;
    return `<article class="card">
      <h3>${escapeHtml(place.name)}</h3>
      <div class="meta">${escapeHtml(desc)}</div>
      <p>${escapeHtml(makeDescription(place))}</p>
      <div class="card-actions">
        <a class="blue" href="${maps}" target="_blank" rel="noopener">Open in Google Maps</a>
        <a class="dark" href="${osm}" target="_blank" rel="noopener">Open in OSM</a>
        <a class="green" href="#" onclick="speakText('${escapeAttr(place.name)}. ${escapeAttr(desc)}.'); return false;">Speak</a>
      </div>
    </article>`;
  }).join("");
}

function makeDescription(place) {
  if (place.type === "Gas") return "Good candidate for fuel or a quick travel stop. Verify hours before relying on it late at night.";
  if (place.type === "Coffee") return "Coffee or cafe option nearby. Good for a short break.";
  if (place.type === "Restaurant" || place.type === "Fast Food") return "Food option nearby. Open the map to check hours, reviews, and directions.";
  if (place.type === "Park" || place.type === "Playground" || place.type === "Scenic View") return "Potential stretch-your-legs stop. Check access and conditions before going.";
  if (place.type === "Community Help" || place.type === "Church / Worship" || place.type === "Nonprofit") return "Possible community support location. Call or verify details before visiting.";
  return "Nearby place found from public map data.";
}

function speakText(text) {
  if (!("speechSynthesis" in window)) {
    alert("Speech playback is not supported in this browser.");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.98;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function toRad(deg) { return deg * Math.PI / 180; }

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}
function escapeAttr(text) {
  return String(text).replace(/['"\\]/g, "");
}

askBtn.addEventListener("click", () => runQuery(queryInput.value));
queryInput.addEventListener("keydown", e => { if (e.key === "Enter") runQuery(queryInput.value); });
document.querySelectorAll(".quick").forEach(btn => btn.addEventListener("click", () => runQuery(btn.dataset.query)));
speakBtn.addEventListener("click", () => speakText(lastAnswer || answerBox.textContent));

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  voiceBtn.addEventListener("click", () => {
    voiceStatus.textContent = "Listening...";
    recognition.start();
  });

  recognition.onresult = event => {
    const transcript = event.results[0][0].transcript;
    voiceStatus.textContent = `Heard: ${transcript}`;
    runQuery(transcript);
  };

  recognition.onerror = event => {
    voiceStatus.textContent = `Voice error: ${event.error}. Try typing instead.`;
  };
} else {
  voiceBtn.disabled = true;
  voiceBtn.textContent = "🎙️ Voice not supported";
  voiceStatus.textContent = "Speech recognition is not supported in this browser. Text input still works.";
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js"));
}
