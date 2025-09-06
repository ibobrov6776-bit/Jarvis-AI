import express from "express";
import cookieParser from "cookie-parser";
import pinGuard from "./public/pin-guard.js";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { fetch } from "undici";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cookieParser());
app.use(pinGuard(process.env.ACCESS_PIN || ""));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


/* ---------- helpers ---------- */
const B = `[\\s.,!?:;"'«»()\\-]`;
function normalizeText(text) {
  const dict = { "че":"что","чо":"что","шо":"что","изи":"легко","топчик":"очень хорошо","видос":"видео","го":"давай","лютый":"очень сильный","как жизнь":"как дела" };
  let norm = (text || "").toLowerCase().trim();
  for (const [slang, normal] of Object.entries(dict)) {
    norm = norm.replace(new RegExp(`(^|${B})${slang}(${B}|$)`, "gi"), `$1${normal}$2`);
  }
  return norm.replace(/\s+/g, " ");
}
function hasToken(str, token) { return new RegExp(`(^|${B})${token}(${B}|$)`,"i").test(str); }
function hasAnyToken(str, arr){ return arr.some(t => hasToken(str, t)); }
function hasPhrase(str, phrase){ return str.includes(phrase.toLowerCase()); }

function detectStyleAuto(text) {
  const t = (text || "").toLowerCase();
  const short = t.split(/\s+/).filter(Boolean).length <= 6;
  const slang = /(че|чо|изи|топчик|го|нормас|лютый|чел|бро|лол|ахах)/.test(t);
  const polite = /(пожалуйста|не могли бы|будьте добры|здравствуйте)/.test(t) || /(^|\s)вы(\s|$)/.test(t);
  if (polite && !slang) return "formal";
  if (slang || short) return "friendly";
  return "formal";
}
function applyStyleLock(autoStyle, styleLock) {
  if (styleLock === "friendly" || styleLock === "formal") return styleLock;
  return autoStyle;
}

/* ---------- WEATHER utils ---------- */
const CITY_FORMS = new Map([
  ["москве","москва"],["москов","москва"],
  ["санкт-петербурге","санкт-петербург"],["питере","санкт-петербург"],["питер","санкт-петербург"],
  ["нью-йорке","нью-йорк"],["нью йорке","нью-йорк"],["нью йорк","нью-йорк"],
  ["токио","токио"],["париже","париж"],["риме","рим"],["берлине","берлин"],
  ["лондоне","лондон"],["мехико","мехико"],["пекине","пекин"],["стамбуле","стамбул"],
  ["анкаре","анкара"],["мадриде","мадрид"]
]);
const COUNTRY_TO_CAPITAL = new Map([
  ["россия","москва"],["украина","киев"],["италия","рим"],["япония","токио"],["китай","пекин"],
  ["германия","берлин"],["франция","париж"],["испания","мадрид"],["португалия","лиссабон"],
  ["великобритания","лондон"],["англия","лондон"],["британия","лондон"],["uk","лондон"],["united kingdom","лондон"],
  ["сша","вашингтон"],["соединенные штаты","вашингтон"],["соединённые штаты","вашингтон"],["штаты","вашингтон"],["америка","нью-йорк"],
  ["канада","оттава"],["мексика","мехико"],["турция","анкара"],["польша","варшава"],
  ["кыргызстан","бишкек"],["казахстан","астана"],["узбекистан","ташкент"],
  ["чехия","прага"],["швеция","стокгольм"],["норвегия","осло"],["финляндия","хельсинки"],
  ["швейцария","берн"]
]);
function tidyPlace(raw){
  if (!raw) return null;
  let s = raw.toLowerCase().trim();
  s = s.replace(/[.,!?;:()«»"'`]+$/g, "").trim();
  s = s.replace(/\b(город|страна|в\s+городе|в\s+стране)\b/g, "").trim();
  if (CITY_FORMS.has(s)) return CITY_FORMS.get(s);
  s = s.replace(/(е|и|у|ю|ой|ей|ии|ий|ая|ые|ом|ым|ам|ям)$/i, "");
  return s.trim();
}
function extractPlace(query){
  const q = normalizeText(query);
  let m = q.match(/погод[аеы]?\s+(в|во)\s+(.+)/);
  if (m) return tidyPlace(m[2]);
  m = q.match(/прогноз\s+(в|во)\s+(.+)/);
  if (m) return tidyPlace(m[2]);
  m = q.match(/(в|во)\s+([a-zа-яё\-\s]+)\s+(сейчас|сегодня)/i);
  if (m) return tidyPlace(m[2]);
  m = q.match(/\b(в|во)\s+([a-zа-яё0-9\-\s]+)$/i);
  if (m) return tidyPlace(m[2]);
  if (/погод|температур|дожд|снег|прогноз/.test(q)) {
    const tail = q.replace(/(какая|какой|текущая|сейчас|сегодня|погода|прогноз|в|во)/g," ").replace(/\s+/g," ").trim();
    if (tail) return tidyPlace(tail);
  }
  return null;
}
async function geocode(place){
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=ru&format=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Geocode ${r.status}`);
  const j = await r.json();
  const loc = j.results?.[0];
  if (!loc) return null;
  return { name: loc.name, admin1: loc.admin1 || "", country: loc.country || "", lat: loc.latitude, lon: loc.longitude };
}
async function forecast(lat, lon){
  const url = `https://api.open-meteo.com/v1/forecast`+
              `?latitude=${lat}&longitude=${lon}`+
              `&current_weather=true`+
              `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max`+
              `&timezone=auto`;
  const ac = new AbortController();
  const t = setTimeout(()=>ac.abort(), 8000);
  const r = await fetch(url, { signal: ac.signal }).catch(e=>{
    if (e.name === 'AbortError') throw new Error('Forecast timeout');
    throw e;
  });
  clearTimeout(t);
  if (!r.ok) throw new Error(`Forecast ${r.status}`);
  return r.json();
}
const WMO = {0:"ясно",1:"в основном ясно",2:"переменная облачность",3:"пасмурно",45:"туман",48:"изморозь",51:"лёгкая морось",53:"морось",55:"сильная морось",56:"ледяная морось",57:"сильная ледяная морось",61:"небольшой дождь",63:"дождь",65:"сильный дождь",66:"ледяной дождь",67:"сильный ледяной дождь",71:"небольшой снег",73:"снег",75:"сильный снег",77:"снежные зёрна",80:"ливни",81:"сильные ливни",82:"очень сильные ливни",85:"снегопад",86:"сильный снегопад",95:"гроза",96:"гроза с градом",99:"сильная гроза с градом"};

/* ---------- intents ---------- */
function detectIntent(query) {
  const q = normalizeText(query);
  if (!q) return "EMPTY";
  const words = q.split(/\s+/).filter(Boolean);
  const hasQ = /[?]/.test(q) || /(кто|что|где|когда|почему|зачем|как|сколько)/.test(q);
  if (hasAnyToken(q, ["привет","здравствуй","здравствуйте","йо","хай","прив","дарова"])) return "GREETING";
  if (hasAnyToken(q, ["как дела","что нового","как ты","как жизнь"])) return "HOW_ARE_YOU";
  if (hasAnyToken(q, ["спасибо","благодарю","мерси"])) return "THANKS";
  if (hasAnyToken(q, ["пока","до встречи","увидимся","бай"])) return "BYE";
  if (hasPhrase(q,"сколько времени") || hasPhrase(q,"сколько время") || hasAnyToken(q,["который час"]) || hasAnyToken(q,["время"])) return "TIME";
  if (/погод|температур|дожд|снег|прогноз/.test(q)) return "WEATHER";
  if (hasAnyToken(q, ["новости","тренды","ситуация","объясни","google","браузер"]) ||
      hasPhrase(q,"расскажи про") || hasPhrase(q,"расскажи об") || hasAnyToken(q,["найди","поищи","в гугле","в интернете"])) return "WEB_SEARCH";
  if (hasQ && words.length >= 4) return "WEB_SEARCH";
  if (words.length <= 3) return "SMALL_TALK";
  return "GENERAL_CHAT";
}

/* ---------- search (Brave) ---------- */
function getKey() {
  const k = (process.env.BRAVE_KEY || "").trim();
  const ascii = /^[\x00-\x7F]*$/.test(k);
  return { k, ascii, len: k.length };
}
async function braveSearch(q) {
  const { k, ascii } = getKey();
  if (!k || !ascii) return { disabled: true, items: [] };
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=3&freshness=day`;
  const res = await fetch(url, { headers: { "X-Subscription-Token": k } });
  if (!res.ok) {
    const body = await res.text().catch(()=> "");
    throw new Error(`Brave API ${res.status}: ${body}`);
  }
  const data = await res.json();
  const items = (data.web?.results ?? []).map(r => ({ title: r.title, url: r.url, snippet: r.snippet || r.description || "" }));
  return { disabled: false, items };
}

/* ---------- routes ---------- */
app.get("/healthz", (_req,res)=>res.json({ok:true,time:new Date().toISOString()}));
app.get("/api/meta", (_req,res)=>{
  const k = getKey();
  res.json({ status:"online", web_search_enabled: !!(k.k && k.ascii) });
});

app.post("/api/assist", async (req,res)=>{
  const started = Date.now();
  let meta = { provider:"local", ok:true };
  try{
    const query = (req.body?.query || "").trim();
    const styleLock = (req.body?.styleLock || "auto");
    if (!query) return res.status(400).json({ reply: "Пустой запрос.", style: "formal", intent:"EMPTY", meta:{provider:"local", ok:false, tookMs: Date.now()-started} });

    const intent = detectIntent(query);
    const autoStyle = detectStyleAuto(query);
    const style = applyStyleLock(autoStyle, styleLock);

    console.log(`[assist] intent=${intent} style=${style} query="${query}"`);

    if (intent === "GREETING")
      return res.json({ reply: style==="friendly"?"Йо! 👋 Рад тебя видеть 😎":"Здравствуйте!", style, intent, meta:{provider:"local", ok:true, tookMs: Date.now()-started} });
    if (intent === "HOW_ARE_YOU")
      return res.json({ reply: style==="friendly"?"Да нормас, всё чётко 😎 А у тебя как?":"У меня всё хорошо, спасибо. Как у вас дела?", style, intent, meta:{provider:"local", ok:true, tookMs: Date.now()-started} });
    if (intent === "THANKS")
      return res.json({ reply: style==="friendly"?"Пожалуйста! 🙌":"Пожалуйста.", style, intent, meta:{provider:"local", ok:true, tookMs: Date.now()-started} });
    if (intent === "BYE")
      return res.json({ reply: style==="friendly"?"До связи! 👋":"До свидания!", style, intent, meta:{provider:"local", ok:true, tookMs: Date.now()-started} });
    if (intent === "TIME") {
      const now = new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
      return res.json({ reply: style==="friendly"?`Бро, сейчас ${now} 😉`:`Сейчас ${now}.`, style, intent, meta:{provider:"local", ok:true, tookMs: Date.now()-started} });
    }

    if (intent === "WEATHER") {
      meta.provider = "open-meteo";
      const raw = extractPlace(query);
      let place = raw;
      if (place && COUNTRY_TO_CAPITAL.has(place)) place = COUNTRY_TO_CAPITAL.get(place);
      if (place && CITY_FORMS.has(place)) place = CITY_FORMS.get(place);
      if (!place) {
        const ask = style==="friendly" ? "Скажи город: «погода в Токио»" : "Уточните город: «погода в Токио».";
        return res.json({ reply: ask, style, intent, meta:{...meta, tookMs: Date.now()-started} });
      }
      let loc = await geocode(place);
      if (!loc && COUNTRY_TO_CAPITAL.has(place)) loc = await geocode(COUNTRY_TO_CAPITAL.get(place));
      if (!loc) {
        const msg = style==="friendly" ? `Не нашёл локацию «${place}» 😅` : `Локация «${place}» не найдена.`;
        return res.json({ reply: msg, style, intent, meta:{...meta, ok:false, tookMs: Date.now()-started} });
      }
      const fc = await forecast(loc.lat, loc.lon);
      const cur = fc.current_weather || {};
      const w = WMO[cur.weathercode] || "погода";
      const t = typeof cur.temperature === "number" ? Math.round(cur.temperature) : null;
      const wind = typeof cur.windspeed === "number" ? Math.round(cur.windspeed) : null;
      const d0 = (fc.daily || {});
      const tmax = Array.isArray(d0.temperature_2m_max) ? Math.round(d0.temperature_2m_max[0]) : null;
      const tmin = Array.isArray(d0.temperature_2m_min) ? Math.round(d0.temperature_2m_min[0]) : null;
      const pprec = Array.isArray(d0.precipitation_probability_max) ? d0.precipitation_probability_max[0] : null;

      const label = [loc.name, loc.admin1, loc.country].filter(Boolean).join(", ");
      let line = style==="friendly"
        ? `В ${label} сейчас ${t!==null?`${t}°C`: "—"} (${w}). Ветер ${wind!==null?`${wind} м/с`:"—"}.`
        : `Сейчас в ${label}: ${t!==null?`${t}°C`: "—"} (${w}). Ветер ${wind!==null?`${wind} м/с`:"—"}.`;
      if (tmax!=null && tmin!=null) line += ` Диапазон на сегодня: ${tmin}…${tmax}°C.`;
      if (pprec!=null) line += style==="friendly" ? ` Осадки: ${pprec}%` : ` Вероятность осадков: ${pprec}%`;

      const src = `https://open-meteo.com/`;
      return res.json({ reply: `${line}\nИсточник: ${src}`, style, intent, meta:{...meta, tookMs: Date.now()-started}, actions:[{ type:"open_url", url: src }] });
    }

    if (intent === "SMALL_TALK")
      return res.json({ reply: style==="friendly"?"Понял 👍 Спроси что-то конкретнее.":"Понимаю. Уточните, пожалуйста.", style, intent, meta:{provider:"local", ok:true, tookMs: Date.now()-started} });

    if (intent === "GENERAL_CHAT")
      return res.json({ reply: style==="friendly"?"Окей, понял тебя. Могу добавить фактов или ссылок, если надо 😉":"Понимаю. Если нужно, могу добавить справку или ссылки.", style, intent, meta:{provider:"local", ok:true, tookMs: Date.now()-started} });

    meta.provider = "brave";
    const { disabled, items } = await braveSearch(normalizeText(query));
    if (disabled) return res.json({ reply: "Поиск временно недоступен (ключ не задан/не ASCII).", style, intent, meta:{...meta, ok:false, tookMs: Date.now()-started} });
    if (!items.length) return res.json({ reply: `Ничего не найдено по «${query}».`, style, intent, meta:{...meta, ok:false, tookMs: Date.now()-started} });

    const top = items[0];
    return res.json({ reply: `${top.snippet || ""}\nПодробнее: ${top.url}`, style, intent, meta:{...meta, tookMs: Date.now()-started}, actions:[{type:"open_url",url:top.url}] });

  } catch(e) {
    console.error(e);
    return res.status(500).json({ reply:"Ошибка при обработке запроса.", style:"formal", intent:"ERROR", meta:{provider:"local", ok:false, tookMs: Date.now()-started} });
  }
});

/* ---------- start ---------- */
app.get("/healthz", (req,res)=>res.json({ ok:true, time:new Date().toISOString() }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server ready: http://0.0.0.0:${PORT}`);
  console.log(`🔎 Health:  http://0.0.0.0:${PORT}/healthz`);
  console.log(`ℹ️  Meta:    http://0.0.0.0:${PORT}/api/meta`);
});

  console.log(`BRAVE len=${k.len} ascii=${k.ascii}`);
  console.log(`✅ Server ready: http://localhost:${PORT}`);
  console.log(`🔎 Health:  http://localhost:${PORT}/healthz`);
  console.log(`ℹ️  Meta:    http://localhost:${PORT}/api/meta`);
});
