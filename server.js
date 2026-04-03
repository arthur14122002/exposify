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
import { Resend } from "resend";
import crypto from "crypto";

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

const resend = new Resend(process.env.RESEND_API_KEY);

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

function createVerificationToken() {
return crypto.randomBytes(32).toString("hex");
}

app.post("/register", async (req, res) => {
try {
const { email, password } = req.body;

if (!email || !password) {
return res.json({
success: false,
message: "Bitte E-Mail und Passwort eingeben."
});
}

// Email basic check
if (!email.includes("@")) {
return res.json({
success: false,
message: "Bitte geben Sie eine gültige E-Mail-Adresse ein."
});
}

// Prüfen ob User existiert
const { data: existingUser } = await supabase
.from("users")
.select("*")
.eq("email", email)
.single();

if (existingUser) {
return res.json({
success: false,
message: "E-Mail bereits registriert."
});
}

// Passwort hashen
const hashedPassword = await bcrypt.hash(password, 10);

// Token erstellen
const token = createVerificationToken();

// User speichern
const { error } = await supabase.from("users").insert([
{
email,
password: hashedPassword,
verification_token: token,
email_verified: false
}
]);

if (error) {
console.error(error);
return res.json({
success: false,
message: "Registrierung fehlgeschlagen."
});
}

// Verifizierungslink erstellen
const verifyLink = `https://exposifyapp.com/verify?token=${token}`;

try {
const rawName = email.split("@")[0];

const name = rawName
.replace(/[._-]+/g, " ")
.split(" ")
.filter(Boolean)
.map(word => word.charAt(0).toUpperCase() + word.slice(1))
.join(" ");

const mailResult = await resend.emails.send({
from: "Exposify <noreply@exposifyapp.com>",
to: email,
subject: "Bitte bestätigen Sie Ihre E-Mail-Adresse",
html: `
<div style="margin:0; padding:0; background-color:#f4f6f8;">
<div style="width:100%; background-color:#f4f6f8; padding:40px 20px;">

<div style="max-width:520px; margin:0 auto; background-color:#ffffff; border-radius:14px; padding:40px 32px; text-align:center; box-sizing:border-box;">

<div style="text-align:center; margin:0 0 24px 0;">
<img
src="https://exposifyapp.com/assets/favicon.png"
alt="Exposify"
width="52"
height="52"
style="display:block; margin:0 auto 10px auto; width:52px; height:52px;"
/>
<div style="font-family:Arial, sans-serif; font-size:22px; font-weight:700; line-height:1.2; color:#111827;">
Exposify
</div>
</div>

<p style="margin:0 0 14px 0; font-family:Arial, sans-serif; font-size:18px; line-height:1.5; color:#111827;">
Hallo ${name},
</p>

<h1 style="margin:0 0 18px 0; font-family:Arial, sans-serif; font-size:28px; line-height:1.25; font-weight:700; color:#111827;">
Willkommen bei Exposify
</h1>

<p style="margin:0 0 30px 0; font-family:Arial, sans-serif; font-size:15px; line-height:1.7; color:#4b5563;">
Bitte bestätigen Sie Ihre E-Mail-Adresse, um Ihr Konto zu aktivieren und Exposify vollständig nutzen zu können.
</p>

<a
href="${verifyLink}"
style="
display:inline-block;
padding:14px 28px;
background-color:#2563eb;
color:#ffffff;
text-decoration:none;
border-radius:30px;
font-family:Arial, sans-serif;
font-size:15px;
font-weight:700;
line-height:1;
mso-padding-alt:0;
"
>
E-Mail-Adresse bestätigen
</a>

<div style="margin-top:32px; padding:18px 16px; background-color:#f9fafb; border-radius:10px; text-align:center;">

<p style="margin:0 0 10px 0; font-family:Arial, sans-serif; font-size:12px; line-height:1.6; color:#6b7280;">
Falls der Button nicht funktioniert, können Sie diesen Link in Ihren Browser kopieren:
</p>

<div style="font-family:Arial, sans-serif; font-size:12px; line-height:1.6; text-align:center; word-break:break-word;">

<div style="color:#2563eb;">
https://exposifyapp.com/verify?
</div>

<div style="color:#2563eb;">
${verifyLink.split("token=")[1] ? "token=" + verifyLink.split("token=")[1] : ""}
</div>

</div>

</div>

<hr style="border:none; border-top:1px solid #e5e7eb; margin:30px 0 22px 0;">

<p style="margin:0 0 8px 0; font-family:Arial, sans-serif; font-size:13px; line-height:1.6; color:#6b7280;">
Exposify – Ihr Tool zur Erstellung professioneller Immobilien-Exposés
</p>

<p style="margin:0 0 6px 0; font-family:Arial, sans-serif; font-size:12px; line-height:1.6; color:#9ca3af;">
Exposify<br>
Fährstraße 217<br>
40221 Düsseldorf
</p>

<p style="margin:0 0 10px 0; font-family:Arial, sans-serif; font-size:12px; line-height:1.6; color:#9ca3af;">
<a href="https://exposifyapp.com/impressum.html" style="color:#9ca3af; text-decoration:underline;">
Impressum
</a>
</p>

<p style="margin:0; font-family:Arial, sans-serif; font-size:12px; line-height:1.6; color:#9ca3af;">
Falls Sie sich nicht bei Exposify registriert haben, können Sie diese E-Mail einfach ignorieren.
</p>

</div>
</div>
</div>
`
});

console.log("RESEND RESULT:", mailResult);

return res.json({
success: true,
message: "Verifizierungs-Mail wurde gesendet."
});

} catch (mailError) {
console.error("RESEND MAIL ERROR:", mailError);

return res.json({
success: false,
message: "E-Mail konnte nicht gesendet werden."
});
}

} catch (err) {
console.error("Register crash:", err);
res.json({
success: false,
message: "Fehler beim Registrieren."
});
}
});

app.get("/verify", async (req, res) => {
try {
const { token } = req.query;

if (!token) {
return res.redirect("/login.html?verified=missing");
}

const { data: user, error: findError } = await supabase
.from("users")
.select("*")
.eq("verification_token", token)
.single();

if (findError || !user) {
return res.redirect("/login.html?verified=invalid");
}

const { error: updateError } = await supabase
.from("users")
.update({
email_verified: true,
verification_token: null
})
.eq("id", user.id);

if (updateError) {
console.error("Verify update error:", updateError);
return res.redirect("/login.html?verified=error");
}

return res.redirect("/login.html?verified=success");
} catch (err) {
console.error("Verify crash:", err);
return res.redirect("/login.html?verified=error");
}
});

app.post("/login", async (req, res) => {
const { email, password } = req.body;

const { data: user, error } = await supabase
.from("users")
.select("*")
.eq("email", email)
.single();

if (error || !user) {
return res.json({
success: false,
message: "User nicht gefunden"
});
}

if (!user.email_verified) {
return res.json({
success: false,
message: "Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse."
});
}

const validPassword = await bcrypt.compare(password, user.password);

if (!validPassword) {
return res.json({
success: false,
message: "Falsches Passwort"
});
}

req.session.user = {
id: user.id,
email: user.email
};

return res.json({
success: true
});
});

app.post("/resend-confirmation", async (req, res) => {
try {
const { email } = req.body;

if (!email) {
return res.json({
success: false,
message: "Bitte E-Mail eingeben."
});
}

const { error } = await supabase.auth.resend({
type: "signup",
email
});

if (error) {
console.error("Resend error:", error);
return res.json({
success: false,
message: "E-Mail konnte nicht erneut gesendet werden."
});
}

res.json({
success: true,
message: "Bestätigungs-E-Mail wurde erneut gesendet."
});

} catch (err) {
console.error("Resend crash:", err);
res.json({
success: false,
message: "Fehler beim Senden."
});
}
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
