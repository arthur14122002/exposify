import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);


console.log("SUPABASE URL:", process.env.SUPABASE_URL);
console.log("SUPABASE KEY da:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);

import express from "express";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import session from "express-session";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import puppeteer from "puppeteer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const css = fs.readFileSync(
path.join(__dirname, "public", "style.css"),
"utf8"
);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "30mb" }));
app.use(express.static("public"));

app.use(
session({
secret: "exposify-secret",
resave: false,
saveUninitialized: false
})
);

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY
});

function requireAuth(req, res, next) {
if (!req.session.user) {
return res.status(401).json({
success: false,
message: "Sie müssen angemeldet sein, um Exposés erstellen und bearbeiten zu können."
});
}
next();
}

function safeParseJson(text) {
try {
return JSON.parse(text);
} catch {
const match = text.match(/\{[\s\S]*\}/);
if (!match) return null;
try {
return JSON.parse(match[0]);
} catch {
return null;
}
}
}

function fallbackExposeTexts(data) {
const objekt =
data.objekttyp ||
data.objektart ||
"Immobilie";

const ort = data.ort || "guter Lage";
const baujahr = data.baujahr ? ` aus dem Baujahr ${data.baujahr}` : "";
const wohnflaeche = data.wohnflaeche ? ` mit ca. ${data.wohnflaeche} m² Wohnfläche` : "";
const grundstueck = data.grundstueck ? ` auf einem Grundstück von ca. ${data.grundstueck} m²` : "";
const zimmer = data.zimmer ? ` und ${data.zimmer} Zimmern` : "";
const vermarktung = (data.vermarktungsart || "").toLowerCase();
const istMiete = vermarktung.includes("miet");

const preisSatz = data.preis
? istMiete
? ` Die monatliche Miete beträgt ${data.preis} €.`
: ` Der Kaufpreis beträgt ${data.preis} €.`
: "";

const merkmale = data.merkmale
? `Besondere Highlights sind ${data.merkmale}.`
: "Die Immobilie überzeugt mit einer durchdachten Aufteilung und einem angenehmen Wohngefühl.";

const heizung = data.heizungsart ? ` Beheizt wird das Objekt über ${data.heizungsart}.` : "";
const park = data.park ? ` Parkmöglichkeiten: ${data.park}.` : "";
const stellplaetze = data.stellplaetze ? ` Zusätzlich stehen ${data.stellplaetze} Stellplätze zur Verfügung.` : "";

return {
title: `${objekt} in ${ort}`,
description: `Dieses ${objekt}${baujahr}${wohnflaeche}${grundstueck}${zimmer} bietet attraktive Voraussetzungen für ${istMiete ? "Mieter" : "Eigennutzer oder Kapitalanleger"}. ${merkmale}${preisSatz}`,
features: `Die Ausstattung präsentiert sich solide und alltagstauglich.${heizung}${park}${stellplaetze}`,
location: `Die Immobilie befindet sich in ${ort} und profitiert von einer guten Erreichbarkeit sowie einer soliden Infrastruktur im Umfeld.`
};
}

app.post("/register", async (req, res) => {
const { email, password } = req.body;

if (!email || !password) {
return res.json({ success: false, message: "Bitte E-Mail und Passwort eingeben." });
}

const { data: existing } = await supabase
.from("users")
.select("*")
.eq("email", email)
.single();

if (existing) {
return res.json({ success: false, message: "Dieses Konto existiert bereits." });
}

const hash = await bcrypt.hash(password, 10);

const { error } = await supabase.from("users").insert([
{
email,
password: hash
}
]);

if (error) {
console.error(error);
return res.json({ success: false, message: "Fehler beim Speichern." });
}

res.json({ success: true });
});

app.post("/login", async (req, res) => {
const { email, password } = req.body;

const { data: user, error } = await supabase
.from("users")
.select("*")
.eq("email", email)
.single();

if (error || !user) {
return res.json({ success: false, message: "Login fehlgeschlagen." });
}

const valid = await bcrypt.compare(password, user.password);

if (!valid) {
return res.json({ success: false, message: "Login fehlgeschlagen." });
}

req.session.user = {
id: user.id,
email: user.email
};

res.json({ success: true });
});



app.post("/logout", (req, res) => {
req.session.destroy(() => {
res.json({ success: true });
});
});

app.get("/auth/status", (req, res) => {
res.json({
loggedIn: !!req.session.user,
user: req.session.user || null
});
});

app.get("/projects", requireAuth, async (req, res) => {
try {
const { data, error } = await supabase
.from("exposes")
.select("*")
.eq("user_id", req.session.user.id)
.order("created_at", { ascending: false });

if (error) {
console.error("Supabase GET /projects error:", error);
return res.status(500).json({
success: false,
message: "Projekte konnten nicht geladen werden."
});
}

const projects = (data || []).map((item) => ({
id: item.id,
userId: item.user_id,
createdAt: item.created_at,
updatedAt: item.updated_at,
title: item.title,
html: item.html,
data: item.data || {}
}));

res.json(projects);
} catch (error) {
console.error("GET /projects crash:", error);
res.status(500).json({
success: false,
message: "Projekte konnten nicht geladen werden."
});
}
});

app.get("/projects/:id", requireAuth, async (req, res) => {
try {
const { data, error } = await supabase
.from("exposes")
.select("*")
.eq("id", req.params.id)
.eq("user_id", req.session.user.id)
.single();

if (error || !data) {
console.error("Supabase GET /projects/:id error:", error);
return res.status(404).json({
success: false,
message: "Projekt nicht gefunden."
});
}

res.json({
id: data.id,
userId: data.user_id,
createdAt: data.created_at,
updatedAt: data.updated_at,
title: data.title,
html: data.html,
data: data.data || {}
});
} catch (error) {
console.error("GET /projects/:id crash:", error);
res.status(500).json({
success: false,
message: "Projekt konnte nicht geladen werden."
});
}
});

app.post("/projects", requireAuth, async (req, res) => {
try {
const payload = {
user_id: req.session.user.id,
title: req.body.title || "Immobilien-Exposé",
html: req.body.html || "",
data: req.body.data || {},
updated_at: new Date().toISOString()
};

const { data, error } = await supabase
.from("exposes")
.insert([payload])
.select()
.single();

if (error || !data) {
console.error("Supabase POST /projects error:", error);
return res.status(500).json({
success: false,
message: "Projekt konnte nicht gespeichert werden."
});
}

res.json({
success: true,
id: data.id,
project: {
id: data.id,
userId: data.user_id,
createdAt: data.created_at,
updatedAt: data.updated_at,
title: data.title,
html: data.html,
data: data.data || {}
}
});
} catch (error) {
console.error("POST /projects crash:", error);
res.status(500).json({
success: false,
message: "Projekt konnte nicht gespeichert werden."
});
}
});

app.put("/projects/:id", requireAuth, async (req, res) => {
try {
const { data, error } = await supabase
.from("exposes")
.update({
title: req.body.title,
html: req.body.html,
data: req.body.data,
updated_at: new Date().toISOString()
})
.eq("id", req.params.id)
.eq("user_id", req.session.user.id)
.select()
.single();

if (error || !data) {
return res.status(404).json({ success: false, message: "Projekt nicht gefunden." });
}

res.json({ success: true, project: data });
} catch (err) {
console.error(err);
res.status(500).json({ success: false });
}
});

app.delete("/projects/:id", requireAuth, async (req, res) => {
const { error } = await supabase
.from("exposes")
.delete()
.eq("id", req.params.id)
.eq("user_id", req.session.user.id);

if (error) {
return res.status(500).json({ success: false });
}

res.json({ success: true });
});

app.post("/generate", requireAuth, async (req, res) => {
try {
const data = req.body || {};

if (!process.env.OPENAI_API_KEY) {
const fallback = fallbackExposeTexts(data);
return res.json(fallback);
}

const promptData = {
ort: data.ort || "",
wohnflaeche: data.wohnflaeche || "",
zimmer: data.zimmer || "",
grundstueck: data.grundstueck || "",
heizungsart: data.heizungsart || "",
baujahr: data.baujahr || "",
park: data.park || "",
stellplaetze: data.stellplaetze || "",
schlafzimmer: data.schlafzimmer || "",
badezimmer: data.badezimmer || "",
objektart: data.objektart || "",
objekttyp: data.objekttyp || "",
nutzungsart: data.nutzungsart || "",
vermarktungsart: data.vermarktungsart || "",
preis: data.preis || "",
merkmale: data.merkmale || "",
layout: data.layout || "classic"
};

const instructions = `
Du schreibst professionelle deutsche Immobilientexte für Exposés.
Antworte ausschließlich als gültiges JSON ohne Markdown und ohne Zusatztext.

Verwende exakt dieses Format:
{
"title": "string",
"description": "string",
"features": "string",
"location": "string"
}

Regeln:
- Sprache: professionelles, flüssiges Deutsch
- Kein erfundener Unsinn
- Nur Informationen verwenden, die plausibel aus den Daten ableitbar sind
- Fehlende Angaben elegant auslassen
- Wenn vermarktungsart "Mieten" ist und ein preis vorhanden ist, nenne die monatliche Miete ausdrücklich im Text.
- Wenn vermarktungsart "Kaufen" ist und ein preis vorhanden ist, nenne den Kaufpreis ausdrücklich im Text.
- description: 3 bis 5 Sätze
- features: 2 bis 4 Sätze
- location: 2 bis 4 Sätze
- title: kurz, hochwertig, maklertauglich
- Keine Aufzählungszeichen
- Keine doppelte Nennung desselben Fakts
`;

const response = await openai.responses.create({
model: "gpt-5",
reasoning: { effort: "low" },
instructions,
input: `Erstelle ein deutsches Immobilien-Exposé auf Basis dieser Daten:\n${JSON.stringify(promptData, null, 2)}`
});

const text = response.output_text || "";
const parsed = safeParseJson(text);

if (!parsed) {
const fallback = fallbackExposeTexts(data);
return res.json(fallback);
}

res.json({
title: parsed.title || fallbackExposeTexts(data).title,
description: parsed.description || fallbackExposeTexts(data).description,
features: parsed.features || fallbackExposeTexts(data).features,
location: parsed.location || fallbackExposeTexts(data).location
});
} catch (error) {
console.error("Generate Fehler:", error);

const fallback = fallbackExposeTexts(req.body || {});
res.json(fallback);
}
});

app.post("/pdf", requireAuth, async (req, res) => {
try {
const html = req.body.html;

console.log("HTML START");
console.log(html);
console.log("HTML END");

if (!html) {
return res.status(400).json({ success: false, message: "Kein HTML erhalten." });
}


const browser = await puppeteer.launch({
args: ["--no-sandbox", "--disable-setuid-sandbox"],
headless: "new"
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1800 });

await page.setContent(html, { waitUntil: "networkidle0" });

await page.emulateMediaType("screen");

const pdf = await page.pdf({
format: "A4",
printBackground: true,
margin: {
top: "0mm",
right: "0mm",
bottom: "0mm",
left: "0mm"
}
});

await browser.close();

res.setHeader("Content-Type", "application/pdf");
res.setHeader("Content-Disposition", 'attachment; filename="expose.pdf"');
res.end(pdf);
} catch (error) {
console.error("PDF Fehler:", error);
res.status(500).json({
success: false,
message: "PDF konnte nicht erstellt werden."
});
}
});

app.listen(port, () => {
console.log("Server läuft auf http://localhost:3000");
});
