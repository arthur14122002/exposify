const loadingOverlay = document.getElementById("loadingOverlay");
const exposeEditor = document.getElementById("exposeEditor");

const imageInput = document.getElementById("images");
const titleImageInput = document.getElementById("titleImage");
const logoInput = document.getElementById("logoUpload");
const fotoInput = document.getElementById("fotoUpload");

const previewImages = document.getElementById("previewImages");
const titlePreview = document.getElementById("titlePreview");
const logoPreview = document.getElementById("logoPreview");
const fotoPreview = document.getElementById("fotoPreview");

const generateBtn = document.getElementById("generateBtn");
const generateHint = document.getElementById("generateHint");

const authModal = document.getElementById("authModal");
const authModalOk = document.getElementById("authModalOk");

let imageFiles = [];
let titleImageFile = null;
let logoFile = null;
let fotoFile = null;
let isUserLoggedIn = false;

if (authModalOk) {
authModalOk.addEventListener("click", () => {
authModal.classList.add("hidden");
authModal.style.display = "none";
});
}

if (imageInput) {
imageInput.addEventListener("change", handleImageUpload);
}

if (titleImageInput) {
titleImageInput.addEventListener("change", handleTitleImageUpload);
}

if (logoInput) {
logoInput.addEventListener("change", handleLogoUpload);
}

if (fotoInput) {
fotoInput.addEventListener("change", handleFotoUpload);
}

function showLoading(show) {
if (!loadingOverlay) return;
loadingOverlay.classList.toggle("hidden", !show);
loadingOverlay.style.display = show ? "flex" : "none";
}

function showAuthModal() {
if (!authModal) return;
authModal.classList.remove("hidden");
authModal.style.display = "flex";
}

function showNotice(message) {
if (authModal) {
const text = authModal.querySelector("p");
if (text) text.textContent = message;
authModal.classList.remove("hidden");
authModal.style.display = "flex";
return;
}
window.alert(message);
}

function closeAllModals() {
document.querySelectorAll(".modalOverlay").forEach((modal) => {
if (!modal.classList.contains("hidden")) {
modal.classList.add("hidden");
modal.style.display = "none";
}
});
}

document.addEventListener("keydown", (e) => {
if (e.key === "Enter") {

const openModal = document.querySelector(".modalOverlay:not(.hidden)");

if (openModal) {
e.preventDefault();
closeAllModals();
}

}
});

async function checkAuthStatus() {
try {
const res = await fetch("/auth/status");
const data = await res.json();
isUserLoggedIn = !!data.loggedIn;
} catch (error) {
console.error("Auth check failed:", error);
isUserLoggedIn = false;
}
}

function fileToDataUrl(file) {
return new Promise((resolve, reject) => {
const reader = new FileReader();
reader.onload = () => resolve(reader.result);
reader.onerror = () => reject();
reader.readAsDataURL(file);
});
}

function getValue(id) {
const el = document.getElementById(id);
return el ? el.value.trim() : "";
}

function createEditorPage(innerHtml) {
return `
<div class="editorPage">
<div class="editorPageInner">
${innerHtml}
</div>
</div>
`;
}

async function getImageSize(src, maxWidth = 300) {
return new Promise((resolve) => {
const img = new Image();

img.onload = () => {
let width = img.naturalWidth;
let height = img.naturalHeight;

if (width > maxWidth) {
const ratio = maxWidth / width;
width = Math.round(width * ratio);
height = Math.round(height * ratio);
}

resolve({ width, height });
};

img.onerror = () => {
resolve({ width: 260, height: 180 });
};

img.src = src;
});
}

async function buildFlowImageGrid(images) {
if (!images.length) return "";

const blocks = [];

for (let i = 0; i < images.length; i++) {
const src = images[i];
const size = await getImageSize(src, 300);

blocks.push(`
<div class="editorImageWrapper" style="width:${size.width}px; height:${size.height}px; left:${40 + (i * 30)}px; top:${40 + (i * 30)}px;">
<img
src="${src}"
alt="Objektbild"
draggable="false"
contenteditable="false"
style="width:100%; height:100%; max-width:none; max-height:none; object-fit:contain; background:transparent; border-radius:0;"
>
</div>
`);
}

return blocks.join("");
}

async function handleImageUpload(e) {
const files = Array.from(e.target.files || []);
const remaining = 11 - imageFiles.length;
const toAdd = files.slice(0, remaining);

imageFiles = [...imageFiles, ...toAdd];
await renderImagePreview();

e.target.value = "";
}

async function handleTitleImageUpload(e) {
const file = e.target.files?.[0];
if (!file) return;

titleImageFile = file;
await renderSinglePreview(titlePreview, titleImageFile, "title");

e.target.value = "";
}

async function handleLogoUpload(e) {
const file = e.target.files?.[0];
if (!file) return;

logoFile = file;
await renderSinglePreview(logoPreview, logoFile, "logo");

e.target.value = "";
}

async function handleFotoUpload(e) {
const file = e.target.files?.[0];
if (!file) return;

fotoFile = file;
await renderSinglePreview(fotoPreview, fotoFile, "foto");

e.target.value = "";
}

async function renderImagePreview() {
if (!previewImages) return;

previewImages.innerHTML = "";

for (let i = 0; i < imageFiles.length; i++) {
const dataUrl = await fileToDataUrl(imageFiles[i]);

const item = document.createElement("div");
item.className = "previewItem";

const img = document.createElement("img");
img.src = dataUrl;

const removeBtn = document.createElement("button");
removeBtn.className = "removeBtn";
removeBtn.innerHTML = "×";

removeBtn.onclick = async (e) => {
e.stopPropagation();
imageFiles.splice(i, 1);
await renderImagePreview();
};

item.appendChild(img);
item.appendChild(removeBtn);

previewImages.appendChild(item);
}
}

async function renderSinglePreview(container, file, type) {
if (!container) return;

container.innerHTML = "";

const dataUrl = await fileToDataUrl(file);

const item = document.createElement("div");
item.className = "previewItem";

const img = document.createElement("img");
img.src = dataUrl;

const removeBtn = document.createElement("button");
removeBtn.className = "removeBtn";
removeBtn.innerHTML = "×";

removeBtn.onclick = (e) => {
e.stopPropagation();

if (type === "title") titleImageFile = null;
if (type === "logo") logoFile = null;
if (type === "foto") fotoFile = null;

container.innerHTML = "";
};

item.appendChild(img);
item.appendChild(removeBtn);

container.appendChild(item);
}

function countFilledFields() {
const fields = [
"ort",
"wohnflaeche",
"zimmer",
"grundstueck",
"heizung",
"baujahr",
"park",
"stellplaetze",
"schlafzimmer",
"badezimmer",
"objektart",
"objekttyp",
"nutzungsart",
"preis",
"merkmale"
];

let count = 0;

fields.forEach((id) => {
if (getValue(id)) count++;
});

return count;
}

function updateGenerateState() {
if (!generateBtn) return;

const filled = countFilledFields();

if (filled >= 3) {
generateBtn.disabled = false;
if (generateHint) generateHint.style.display = "none";
} else {
generateBtn.disabled = true;
if (generateHint) generateHint.style.display = "block";
}
}

async function generateExpose() {
try {
showLoading(true);

const data = {
ort: getValue("ort"),
wohnflaeche: getValue("wohnflaeche"),
zimmer: getValue("zimmer"),
grundstueck: getValue("grundstueck"),
heizungsart: getValue("heizung"),
baujahr: getValue("baujahr"),
park: getValue("park"),
stellplaetze: getValue("stellplaetze"),
schlafzimmer: getValue("schlafzimmer"),
badezimmer: getValue("badezimmer"),
objektart: getValue("objektart"),
objekttyp: getValue("objekttyp"),
nutzungsart: getValue("nutzungsart"),
vermarktungsart: getValue("vermarktung"),
preis: getValue("preis"),
merkmale: getValue("merkmale"),
maklerName: getValue("maklerName"),
firma: getValue("maklerFirma"),
telefon: getValue("maklerTelefon"),
email: getValue("maklerMail")
};

const res = await fetch("/generate", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(data)
});

if (res.status === 401) {
showAuthModal();
showLoading(false);
return;
}

const ai = await res.json();

if (!res.ok) {
showNotice(ai?.message || "Fehler beim Erstellen.");
return;
}

const titleImageDataUrl = titleImageFile ? await fileToDataUrl(titleImageFile) : "";

const imageDataUrls = [];
for (const file of imageFiles) {
imageDataUrls.push(await fileToDataUrl(file));
}

const logoDataUrl = logoFile ? await fileToDataUrl(logoFile) : "";
const fotoDataUrl = fotoFile ? await fileToDataUrl(fotoFile) : "";

const allImageDataUrls = [...imageDataUrls];

if (fotoDataUrl) allImageDataUrls.push(fotoDataUrl);
if (logoDataUrl) allImageDataUrls.push(logoDataUrl);

const pageThreeImages = allImageDataUrls.slice(0, 6);
const pageFourImages = allImageDataUrls.slice(6, 12);

const maklerTextHtml =
data.firma || data.maklerName || data.telefon || data.email
? `
${data.firma ? `<p>${data.firma}</p>` : ""}
${data.maklerName ? `<p>${data.maklerName}</p>` : ""}
${data.telefon ? `<p>${data.telefon}</p>` : ""}
${data.email ? `<p>${data.email}</p>` : ""}
`
: "";

const textAndMaklerHtml = `
<h3>Beschreibung</h3>
<p>${ai.description || ""}</p>

<h3>Ausstattung</h3>
<p>${ai.features || ""}</p>

<h3>Lage</h3>
<p>${ai.location || ""}</p>

${maklerTextHtml}
`;

const pages = [];

if (titleImageDataUrl) {
pages.push(createEditorPage(`
<h1>${ai.title || "Immobilien-Exposé"}</h1>
<img class="heroImage" src="${titleImageDataUrl}" alt="Titelbild">
`));

pages.push(createEditorPage(`
${textAndMaklerHtml}
`));
} else {
pages.push(createEditorPage(`
<h1>${ai.title || "Immobilien-Exposé"}</h1>
${textAndMaklerHtml}
`));
}

if (pageThreeImages.length) {
pages.push(createEditorPage(`
${await buildFlowImageGrid(pageThreeImages)}
`));
}

if (pageFourImages.length) {
pages.push(createEditorPage(`
${await buildFlowImageGrid(pageFourImages)}
`));
}

const exposeHtml = pages.join("");

const save = await fetch("/projects", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
title: ai.title || "Immobilien-Exposé",
html: exposeHtml,
data
})
});

const saved = await save.json();

if (!saved?.id) {
showNotice("Projekt konnte nicht gespeichert werden.");
return;
}

window.location.href = `/viewer.html?id=${saved.id}`;
} catch (err) {
console.error(err);
showNotice("Fehler beim Erstellen");
} finally {
showLoading(false);
}
}

function newProject() {
window.location.href = "/";
}

function loadProjects() {
window.location.href = "/dashboard.html";
}

function goLogin() {
if (isUserLoggedIn) {
showNotice("Du bist bereits angemeldet.");
return;
}

window.location.href = "/login.html";
}

async function logout() {
isUserLoggedIn = false;
await fetch("/logout", { method: "POST" });
window.location.href = "/login.html";
}

const formFields = [
"ort",
"wohnflaeche",
"zimmer",
"grundstueck",
"heizung",
"baujahr",
"park",
"stellplaetze",
"schlafzimmer",
"badezimmer",
"objektart",
"objekttyp",
"nutzungsart",
"vermarktung",
"preis",
"merkmale"
];

formFields.forEach((id) => {
const el = document.getElementById(id);

if (!el) return;

el.addEventListener("input", updateGenerateState);
el.addEventListener("change", updateGenerateState);
el.addEventListener("keyup", updateGenerateState);
});

(async () => {
await checkAuthStatus();
updateGenerateState();
})();

function updatePreisPlaceholder() {
const vermarktung = document.getElementById("vermarktung");
const preisInput = document.getElementById("preis");

if (!vermarktung || !preisInput) return;

if (vermarktung.value === "Mieten") {
preisInput.placeholder = "Miete pro Monat";
} else {
preisInput.placeholder = "Kaufpreis";
}
}

// Listener setzen
document.getElementById("vermarktung")?.addEventListener("change", updatePreisPlaceholder);

// Beim Laden direkt setzen
document.addEventListener("DOMContentLoaded", updatePreisPlaceholder);

const helpBtn = document.getElementById("helpBtn");
const helpModal = document.getElementById("helpModal");
const helpClose = document.getElementById("helpClose");

// Button Klick
if (helpBtn) {
helpBtn.addEventListener("click", () => {
helpModal.classList.remove("hidden");
});
}

// Schließen
if (helpClose) {
helpClose.addEventListener("click", () => {
helpModal.classList.add("hidden");
});
}

if (!localStorage.getItem("editorHelpSeen")) {
helpModal.classList.remove("hidden");
localStorage.setItem("editorHelpSeen", "true");
}

const welcomeModal = document.getElementById("welcomeModal");
const welcomeModalOk = document.getElementById("welcomeModalOk");

function openWelcomeModal() {
if (!welcomeModal) return;
welcomeModal.classList.remove("hidden");
welcomeModal.style.display = "flex";
}

function closeWelcomeModal() {
if (!welcomeModal) return;
welcomeModal.classList.add("hidden");
welcomeModal.style.display = "none";
}

if (welcomeModalOk) {
welcomeModalOk.addEventListener("click", () => {
closeWelcomeModal();
});
}

window.addEventListener("DOMContentLoaded", () => {
if (welcomeModal) {
welcomeModal.classList.add("hidden");
welcomeModal.style.display = "none";
}

const shouldShowWelcome = localStorage.getItem("showWelcomePopup") === "true";

if (shouldShowWelcome) {
openWelcomeModal();
localStorage.removeItem("showWelcomePopup");
}
});
