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
import Stripe from "stripe";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const css = fs.readFileSync(
path.join(__dirname, "public", "style.css"),
"utf8"
);

const app = express();
const port = process.env.PORT || 3000;

app.post("/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
let event;

try {
const signature = req.headers["stripe-signature"];

event = stripe.webhooks.constructEvent(
req.body,
signature,
process.env.STRIPE_WEBHOOK_SECRET
);
} catch (err) {
console.error("Webhook signature error:", err.message);
return res.status(400).send(`Webhook Error: ${err.message}`);
}

try {
switch (event.type) {
case "checkout.session.completed": {
const session = event.data.object;
const userId = session.metadata?.user_id;
const plan = session.metadata?.plan;
const stripeCustomerId = session.customer || null;
const stripeSubscriptionId = session.subscription || null;

if (!userId || !plan) {
break;
}

if (plan === "pro") {
const { error } = await supabase
.from("users")
.update({
plan: "pro",
payment_status: "active",
stripe_customer_id: stripeCustomerId,
stripe_subscription_id: stripeSubscriptionId,
single_credits: 0,
trial_used: true,
trial_started_at: new Date().toISOString(),
})
.eq("id", userId);

if (error) {
console.error("Webhook update pro error:", error);
}
}

if (plan === "single") {
const { data: existingUser, error: fetchError } = await supabase
.from("users")
.select("single_credits")
.eq("id", userId)
.single();

if (fetchError || !existingUser) {
console.error("Webhook fetch single user error:", fetchError);
} else {
const newCredits = Number(existingUser.single_credits || 0) + 1;

const { error } = await supabase
.from("users")
.update({
plan: "single",
payment_status: "active",
stripe_customer_id: stripeCustomerId,
single_credits: newCredits
})
.eq("id", userId);

if (error) {
console.error("Webhook update single error:", error);
}
}
}
break;
}

case "customer.subscription.updated": {
const subscription = event.data.object;

const { error } = await supabase
.from("users")
.update({
payment_status: subscription.status === "active" ? "active" : subscription.status
})
.eq("stripe_subscription_id", subscription.id);

if (error) {
console.error("Webhook subscription updated error:", error);
}
break;
}

case "customer.subscription.deleted": {
const subscription = event.data.object;

const { error } = await supabase
.from("users")
.update({
plan: "free",
payment_status: "inactive",
stripe_subscription_id: null
})
.eq("stripe_subscription_id", subscription.id);

if (error) {
console.error("Webhook subscription deleted error:", error);
}
break;
}

default:
break;
}

res.json({ received: true });
} catch (error) {
console.error("Stripe webhook handling error:", error);
res.status(500).json({ success: false });
}
});

app.use(express.json({ limit: "30mb" }));

app.get("/", (req, res) => {
res.sendFile(path.join(__dirname, "public", "landing.html"));
});

app.get("/app", (req, res) => {
res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(express.static("public"));

app.use(
session({
secret: "exposify-secret",
resave: false,
saveUninitialized: false,
cookie: {
maxAge: 1000 * 60 * 60 * 24 * 30
}
})
);

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const resend = new Resend(process.env.RESEND_API_KEY);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function requireAuth(req, res, next) {
if (!req.session.user) {
return res.status(401).json({
success: false,
message: "Du musst angemeldet sein, um Exposés erstellen und bearbeiten zu können."
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

function isPasswordValid(password) {
return typeof password === "string" && password.length >= 8 && /\d/.test(password);
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

if (!isPasswordValid(password)) {
return res.json({
success: false,
message: "Passwort muss mindestens 8 Zeichen enthalten und mindestens eine Zahl haben."
});
}

// Email basic check
if (!email.includes("@")) {
return res.json({
success: false,
message: "Bitte gib eine gültige E-Mail-Adresse ein."
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
email_verified: false,
last_verification_sent_at: new Date().toISOString(),
plan: "free",
single_credits: 0,
single_used: false,
stripe_customer_id: null,
stripe_subscription_id: null,
payment_status: "inactive"
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
from: "Exposify <hello@exposifyapp.com>",
to: email,
subject: "Bitte bestätige deine E-Mail-Adresse",
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
Bitte bestätige deine E-Mail-Adresse, um dein Konto zu aktivieren und Exposify vollständig nutzen zu können.
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
<p style="margin:0 0 8px 0; font-family:Arial, sans-serif; font-size:12px; line-height:1.6; color:#6b7280;">
Falls der Button nicht funktioniert, kannst du diesen Link in deinen Browser kopieren:
</p>
<p style="margin:0; font-family:Arial, sans-serif; font-size:12px; line-height:1.6; text-align:center;">
<a
href="${verifyLink}"
style="color:#2563eb; text-decoration:underline; word-break:break-all;"
>
${verifyLink}
</a>
</p>
</div>

<hr style="border:none; border-top:1px solid #e5e7eb; margin:30px 0 22px 0;">

<p style="margin:0 0 8px 0; font-family:Arial, sans-serif; font-size:13px; line-height:1.6; color:#6b7280;">
Exposify – Dein Tool zur Erstellung professioneller Immobilien-Exposés
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
Falls du dich nicht bei Exposify registriert hast, kannst du diese E-Mail einfach ignorieren.
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

app.post("/resend-verification", async (req, res) => {
try {
const { email } = req.body;

if (!email) {
return res.json({
success: false,
message: "E-Mail fehlt."
});
}

const { data: user, error: userError } = await supabase
.from("users")
.select("*")
.eq("email", email)
.single();

if (userError || !user) {
return res.json({
success: false,
message: "Benutzer nicht gefunden."
});
}

if (user.email_verified) {
return res.json({
success: false,
message: "Diese E-Mail-Adresse wurde bereits bestätigt."
});
}

const now = Date.now();
const lastSent = user.last_verification_sent_at
? new Date(user.last_verification_sent_at).getTime()
: 0;

const diffSeconds = Math.floor((now - lastSent) / 1000);

if (diffSeconds < 60) {
return res.json({
success: false,
message: `Bitte warte noch ${60 - diffSeconds} Sekunden, bevor du die E-Mail erneut anforderst.`
});
}

const token = createVerificationToken();

const { error: updateError } = await supabase
.from("users")
.update({
verification_token: token,
last_verification_sent_at: new Date().toISOString()
})
.eq("email", email);

if (updateError) {
console.error(updateError);
return res.json({
success: false,
message: "Verifizierungs-Mail konnte nicht vorbereitet werden."
});
}

const verifyLink = `https://exposifyapp.com/verify?token=${token}`;

const rawName = email.split("@")[0];

const name = rawName
.replace(/[._-]+/g, " ")
.split(" ")
.filter(Boolean)
.map(word => word.charAt(0).toUpperCase() + word.slice(1))
.join(" ");

const mailResult = await resend.emails.send({
from: "Exposify <hello@exposifyapp.com>",
to: email,
subject: "Bitte bestätige deine E-Mail-Adresse",
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
Bitte bestätige deine E-Mail-Adresse, um dein Konto zu aktivieren und Exposify vollständig nutzen zu können.
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
<p style="margin:0 0 8px 0; font-family:Arial, sans-serif; font-size:12px; line-height:1.6; color:#6b7280;">
Falls der Button nicht funktioniert, kannst du diesen Link in deinen Browser kopieren:
</p>
<p style="margin:0; font-family:Arial, sans-serif; font-size:12px; line-height:1.6; text-align:center;">
<a
href="${verifyLink}"
style="color:#2563eb; text-decoration:underline; word-break:break-all;"
>
${verifyLink}
</a>
</p>
</div>

<hr style="border:none; border-top:1px solid #e5e7eb; margin:30px 0 22px 0;">

<p style="margin:0 0 8px 0; font-family:Arial, sans-serif; font-size:13px; line-height:1.6; color:#6b7280;">
Exposify – Dein Tool zur Erstellung professioneller Immobilien-Exposés
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
Falls du dich nicht bei Exposify registriert hast, kannst du diese E-Mail einfach ignorieren.
</p>

</div>
</div>
</div>
`
});

console.log("RESEND VERIFICATION RESULT:", mailResult);

return res.json({
success: true,
message: "Verifizierungs-Mail wurde erneut gesendet."
});

} catch (err) {
console.error("Resend verification crash:", err);
return res.json({
success: false,
message: "E-Mail konnte nicht erneut gesendet werden."
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

const welcomeHtml = `
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

<h1 style="margin:0 0 18px 0; font-family:Arial, sans-serif; font-size:28px; line-height:1.25; font-weight:700; color:#111827;">
Willkommen bei Exposify
</h1>

<p style="margin:0 0 14px 0; font-family:Arial, sans-serif; font-size:18px; line-height:1.5; color:#111827;">
Schön, dass du dabei bist.
</p>

<p style="margin:0 0 30px 0; font-family:Arial, sans-serif; font-size:15px; line-height:1.7; color:#4b5563;">
Mit Exposify kannst du professionelle Immobilien-Exposés in wenigen Minuten erstellen,
flexibel bearbeiten und direkt als PDF exportieren.
</p>

<a
href="https://exposifyapp.com/"
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
"
>
Jetzt starten
</a>

<div style="margin-top:32px; padding:18px 16px; background-color:#f9fafb; border-radius:10px; text-align:center;">

<p style="margin:0 0 8px 0; font-family:Arial, sans-serif; font-size:12px; line-height:1.6; color:#6b7280;">
Fragen?
</p>

<p style="margin:0 0 12px 0; font-family:Arial, sans-serif; font-size:12px;">
<a href="mailto:support@exposifyapp.com" style="color:#2563eb; text-decoration:underline;">
support@exposifyapp.com
</a>
</p>

<p style="margin:0 0 6px 0; font-family:Arial, sans-serif; font-size:12px; color:#6b7280;">
Feedback oder Ideen:
</p>

<p style="margin:0; font-family:Arial, sans-serif; font-size:12px;">
<a href="mailto:arthur@exposifyapp.com" style="color:#2563eb; text-decoration:underline;">
arthur@exposifyapp.com
</a>
</p>

</div>

<hr style="border:none; border-top:1px solid #e5e7eb; margin:30px 0 22px 0;">

<p style="margin:0 0 8px 0; font-family:Arial, sans-serif; font-size:13px; line-height:1.6; color:#6b7280;">
Exposify – Dein Tool zur Erstellung professioneller Immobilien-Exposés
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

</div>
</div>
</div>
`;

// ✅ Willkommens-Mail senden
try {
await resend.emails.send({
from: "Exposify <hello@exposifyapp.com>",
to: user.email,
subject: "Willkommen bei Exposify",
html: welcomeHtml
});
} catch (mailError) {
console.error("Welcome mail error:", mailError);
}

// Weiterleitung
return res.redirect("/login.html?verified=success");
} catch (err) {
console.error("Verify crash:", err);
return res.redirect("/login.html?verified=error");
}
});

app.post("/delete-account", requireAuth, async (req, res) => {
try {
const userId = req.session.user.id;

const { data: currentUser, error: fetchError } = await supabase
.from("users")
.select("stripe_subscription_id")
.eq("id", userId)
.single();

if (fetchError || !currentUser) {
console.error("Delete account fetch user error:", fetchError);
return res.status(404).json({
success: false,
message: "Benutzer nicht gefunden."
});
}

// Falls ein aktives Stripe-Abo existiert: zuerst kündigen
if (currentUser.stripe_subscription_id) {
try {
await stripe.subscriptions.cancel(currentUser.stripe_subscription_id);
} catch (stripeError) {
console.error("Stripe cancel before account delete error:", stripeError);
return res.status(500).json({
success: false,
message: "Abo konnte vor dem Löschen nicht beendet werden."
});
}
}

// Erst alle Exposés löschen
const { error: exposesDeleteError } = await supabase
.from("exposes")
.delete()
.eq("user_id", userId);

if (exposesDeleteError) {
console.error("Delete account exposes error:", exposesDeleteError);
return res.status(500).json({
success: false,
message: "Exposés konnten nicht gelöscht werden."
});
}

// Dann User löschen
const { error: userDeleteError } = await supabase
.from("users")
.delete()
.eq("id", userId);

if (userDeleteError) {
console.error("Delete account user error:", userDeleteError);
return res.status(500).json({
success: false,
message: "Account konnte nicht gelöscht werden."
});
}

req.session.destroy(() => {
return res.json({
success: true
});
});

} catch (error) {
console.error("Delete account crash:", error);
return res.status(500).json({
success: false,
message: "Fehler beim Löschen des Accounts."
});
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
message: "Bitte bestätige zuerst deine E-Mail-Adresse."
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

req.session.save((err) => {
if (err) {
console.error("Session save error:", err);
return res.status(500).json({
success: false,
message: "Login konnte nicht gespeichert werden."
});
}

return res.json({
success: true
});
});
});

app.post("/forgot-password", async (req, res) => {
try {
const { email } = req.body;

if (!email) {
return res.json({
success: false,
message: "Bitte E-Mail eingeben."
});
}

const { data: user, error } = await supabase
.from("users")
.select("*")
.eq("email", email)
.single();

if (error || !user) {
return res.json({
success: false,
message: "Benutzer nicht gefunden."
});
}

const token = createVerificationToken();

const { error: updateError } = await supabase
.from("users")
.update({
reset_token: token,
reset_token_created_at: new Date().toISOString()
})
.eq("email", email);

if (updateError) {
console.error(updateError);
return res.json({
success: false,
message: "Reset-Link konnte nicht vorbereitet werden."
});
}

const resetLink = `https://exposifyapp.com/reset-password.html?token=${token}`;

const rawName = email.split("@")[0];
const name = rawName
.replace(/[._-]+/g, " ")
.split(" ")
.filter(Boolean)
.map(word => word.charAt(0).toUpperCase() + word.slice(1))
.join(" ");

const mailResult = await resend.emails.send({
from: "Exposify <hello@exposifyapp.com>",
to: email,
subject: "Passwort zurücksetzen",
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
Passwort zurücksetzen
</h1>

<p style="margin:0 0 30px 0; font-family:Arial, sans-serif; font-size:15px; line-height:1.7; color:#4b5563;">
Du hast eine Zurücksetzung deines Passworts angefordert. Klicke auf den folgenden Button, um ein neues Passwort festzulegen.
</p>

<a
href="${resetLink}"
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
"
>
Passwort zurücksetzen
</a>

<div style="margin-top:32px; padding:18px 16px; background-color:#f9fafb; border-radius:10px; text-align:center;">
<p style="margin:0 0 8px 0; font-family:Arial, sans-serif; font-size:12px; line-height:1.6; color:#6b7280;">
Falls der Button nicht funktioniert, kannst du diesen Link in deinen Browser kopieren:
</p>
<p style="margin:0; font-family:Arial, sans-serif; font-size:12px; line-height:1.6; text-align:center;">
<a
href="${resetLink}"
style="color:#2563eb; text-decoration:underline; word-break:break-all;"
>
${resetLink}
</a>
</p>
</div>

<hr style="border:none; border-top:1px solid #e5e7eb; margin:30px 0 22px 0;">

<p style="margin:0 0 8px 0; font-family:Arial, sans-serif; font-size:13px; line-height:1.6; color:#6b7280;">
Exposify – Dein Tool zur Erstellung professioneller Immobilien-Exposés
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
Falls du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.
</p>

</div>
</div>
</div>
`
});

console.log("RESET MAIL RESULT:", mailResult);

return res.json({
success: true,
message: "Reset-Link wurde gesendet."
});

} catch (err) {
console.error("Forgot password crash:", err);
return res.json({
success: false,
message: "Fehler beim Senden des Reset-Links."
});
}
});

app.post("/reset-password", async (req, res) => {
try {
const { token, password } = req.body;

if (!token || !password) {
return res.json({
success: false,
message: "Token oder Passwort fehlt."
});
}

if (!isPasswordValid(password)) {
return res.json({
success: false,
message: "Passwort muss mindestens 8 Zeichen enthalten und mindestens eine Zahl haben."
});
}

const { data: user, error } = await supabase
.from("users")
.select("*")
.eq("reset_token", token)
.single();

if (error || !user) {
return res.json({
success: false,
message: "Ungültiger oder abgelaufener Reset-Link."
});
}

const createdAt = user.reset_token_created_at
? new Date(user.reset_token_created_at).getTime()
: 0;

const now = Date.now();
const diffMinutes = (now - createdAt) / (1000 * 60);

if (!createdAt || diffMinutes > 60) {
return res.json({
success: false,
message: "Dieser Reset-Link ist abgelaufen. Bitte forder einen neuen an."
});
}

const hashedPassword = await bcrypt.hash(password, 10);

const { error: updateError } = await supabase
.from("users")
.update({
password: hashedPassword,
reset_token: null,
reset_token_created_at: null
})
.eq("id", user.id);

if (updateError) {
console.error(updateError);
return res.json({
success: false,
message: "Passwort konnte nicht aktualisiert werden."
});
}

return res.json({
success: true,
message: "Passwort wurde erfolgreich aktualisiert."
});

} catch (err) {
console.error("Reset password crash:", err);
return res.json({
success: false,
message: "Fehler beim Zurücksetzen des Passworts."
});
}
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

app.get("/auth/status", async (req, res) => {
try {
if (!req.session.user) {
return res.json({
loggedIn: false,
user: null,
plan: "free",
single_credits: 0,
payment_status: "inactive",
single_used: false,
});
}

const { data: user, error } = await supabase
.from("users")
.select("id, email, plan, single_credits, single_used, payment_status")
.eq("id", req.session.user.id)
.single();

if (error || !user) {
return res.json({
loggedIn: false,
user: null,
plan: "free",
single_credits: 0,
payment_status: "inactive"
});
}

return res.json({
loggedIn: true,
user: {
id: user.id,
email: user.email
},
plan: user.plan || "free",
single_credits: Number(user.single_credits || 0),
single_used: !!user.single_used,
payment_status: user.payment_status || "inactive"
});
} catch (error) {
console.error("Auth status error:", error);
return res.json({
loggedIn: false,
user: null,
plan: "free",
single_credits: 0,
payment_status: "inactive"
});
}
});

app.post("/create-checkout-session", requireAuth, async (req, res) => {
try {
const { plan } = req.body;

const { data: currentUser, error: userError } = await supabase
.from("users")
.select("trial_used")
.eq("id", req.session.user.id)
.single();

if (userError || !currentUser) {
return res.status(500).json({
success: false,
message: "Benutzer konnte nicht geladen werden."
});
}

let priceId = "";
let mode = "payment";

if (plan === "pro") {
priceId = process.env.STRIPE_PRO_PRICE_ID;
mode = "subscription";
} else if (plan === "single") {
priceId = process.env.STRIPE_SINGLE_PRICE_ID;
mode = "payment";
} else {
return res.status(400).json({
success: false,
message: "Ungültiger Plan."
});
}

if (!priceId) {
return res.status(500).json({
success: false,
message: "Stripe Preis-ID fehlt."
});
}

const sessionConfig = {
mode,
line_items: [
{
price: priceId,
quantity: 1
}
],
success_url: "https://exposifyapp.com/checkout-success.html?session_id={CHECKOUT_SESSION_ID}",
cancel_url: "https://exposifyapp.com/pricing.html",
client_reference_id: req.session.user.id,
customer_email: req.session.user.email,
metadata: {
user_id: req.session.user.id,
plan
}
};

if (plan === "pro" && !currentUser.trial_used) {
sessionConfig.subscription_data = {
trial_period_days: 30
};
}

const session = await stripe.checkout.sessions.create(sessionConfig);

return res.json({
success: true,
url: session.url
});
} catch (error) {
console.error("Stripe checkout error:", error);
return res.status(500).json({
success: false,
message: "Checkout konnte nicht gestartet werden."
});
}
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
const { data: currentUser, error: userError } = await supabase
.from("users")
.select("plan, single_credits, payment_status")
.eq("id", req.session.user.id)
.single();

if (userError || !currentUser) {
console.error("Supabase user fetch error:", userError);
return res.status(500).json({
success: false,
message: "Benutzerstatus konnte nicht geladen werden."
});
}

const plan = currentUser.plan || "free";
const paymentStatus = currentUser.payment_status || "inactive";
const singleCredits = Number(currentUser.single_credits || 0);

const hasProAccess = plan === "pro" && paymentStatus === "active";
const hasSingleAccess = paymentStatus === "active" && singleCredits > 0;

if (!hasProAccess && !hasSingleAccess) {
return res.status(403).json({
success: false,
message: "Du hast aktuell keinen aktiven Zugriff auf Exposify."
});
}

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

if (!hasProAccess && hasSingleAccess) {
const newCredits = Math.max(0, singleCredits - 1);

const updatePayload = {
single_credits: newCredits
};

if (newCredits === 0) {
updatePayload.plan = "free";
updatePayload.payment_status = "inactive";
}

const { error: updateError } = await supabase
.from("users")
.update(updatePayload)
.eq("id", req.session.user.id);

if (updateError) {
console.error("Single credits update error:", updateError);
}
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

app.post("/generate-demo", async (req, res) => {
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
merkmale: data.merkmale || ""
};

const instructions = `
Du schreibst professionelle deutsche Immobilientexte für eine Demo-Version eines Immobilien-Exposé-Tools.
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
- description: 2 bis 4 Sätze
- features: 2 bis 3 Sätze
- location: 2 bis 3 Sätze
- title: kurz, hochwertig, maklertauglich
- Keine Aufzählungszeichen
- Keine doppelte Nennung desselben Fakts
- Es handelt sich um eine Demo-Vorschau, daher soll der Text kompakt und überzeugend sein
`;

const response = await openai.responses.create({
model: "gpt-5",
reasoning: { effort: "low" },
instructions,
input: `Erstelle eine deutsche Demo-Vorschau für ein Immobilien-Exposé auf Basis dieser Daten:\n${JSON.stringify(promptData, null, 2)}`
});

const text = response.output_text || "";
const parsed = safeParseJson(text);

if (!parsed) {
const fallback = fallbackExposeTexts(data);
return res.json(fallback);
}

return res.json({
title: parsed.title || fallbackExposeTexts(data).title,
description: parsed.description || fallbackExposeTexts(data).description,
features: parsed.features || fallbackExposeTexts(data).features,
location: parsed.location || fallbackExposeTexts(data).location
});
} catch (error) {
console.error("Generate demo error:", error);

const fallback = fallbackExposeTexts(req.body || {});
return res.json(fallback);
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
