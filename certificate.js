const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const nunjucks = require("nunjucks");
const puppeteer = require("puppeteer");

const BASE = __dirname;
const TEMPLATES_DIR = path.join(BASE, "templates");
const OUTPUT_DIR = path.join(BASE, "outputs");
const USED_IDS_FILE = path.join(BASE, "used_ids.json");
const BG_PNG = path.join(TEMPLATES_DIR, "template.png");

let usedIds = {};
nunjucks.configure(TEMPLATES_DIR, { autoescape: true });

async function ensure() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(USED_IDS_FILE))
    await writeFile(USED_IDS_FILE, JSON.stringify({}, null, 2), "utf8");
}

async function loadUsed() {
  try {
    const txt = await readFile(USED_IDS_FILE, "utf8");
    usedIds = JSON.parse(txt || "{}");
  } catch (e) {
    usedIds = {};
  }
}

async function saveUsed() {
  await writeFile(USED_IDS_FILE, JSON.stringify(usedIds, null, 2), "utf8");
}

function generateUniqueId(prefix) {
  const list = usedIds[prefix] || [];
  while (true) {
    const num = Math.floor(1000 + Math.random() * 9000);
    const code = `${prefix}${num}`;
    if (!list.includes(code)) {
      list.push(code);
      usedIds[prefix] = list;
      saveUsed();
      return code;
    }
  }
}

function makePrefixFromCourse(course, certType) {
  const mapping = {
    "Web dasturlash": "WB",
    Kiberhavfsizlik: "KB",
    "Kompyuter savodxonlik": "KS",
    "Grafik dizayn": "GD",
    "Python (Data Science)": "PY",
  };
  if (course) {
    const p = mapping[course.trim()];
    if (p) return p;
    const first = (course.split(" ")[0] || "").replace(/[^a-zA-Z]/g, "");
    if (first.length >= 2) return (first[0] + first.slice(-1)).toUpperCase();
    return first.slice(0, 2).padEnd(2, "X").toUpperCase();
  }
  return certType === "malaka" ? "MO" : "CR";
}

async function imageToBase64(imgPath) {
  try {
    const buf = await readFile(imgPath);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch (e) {
    return "";
  }
}

async function createCertificate(name, certType, date, course) {
  await ensure();
  if (!usedIds || Object.keys(usedIds).length === 0) await loadUsed();

  const prefix = makePrefixFromCourse(course, certType);
  const certId = generateUniqueId(prefix);

  const templateFile = certType === "malaka" ? "temp2.html" : "template.html";
  const templateStr = await readFile(
    path.join(TEMPLATES_DIR, templateFile),
    "utf8"
  );
  const bg = await imageToBase64(BG_PNG);

  // minimal normalization for templates
  let tpl = templateStr.replace(/\.upper\(\)/g, " | upper ");
  tpl = tpl.replace(/course\|length if course else 0/g, "course | length");

  // determine adaptive name font size (pt) based on length
  const nlen = (name || "").trim().length;
  let name_font_size = 52; // default in template
  if (nlen > 44) name_font_size = 34;
  else if (nlen > 34) name_font_size = 40;
  else if (nlen > 26) name_font_size = 46;

  // small horizontal shift for certain long course labels
  let text2_shift_px = 0;
  if ((course || "").toLowerCase().includes("kompyuter savodxonlik")) {
    text2_shift_px = -4;
  }

  const html = nunjucks.renderString(tpl, {
    name: (name || "").toUpperCase(),
    date,
    course: course || "",
    cert_id: certId,
    background: bg,
    name_font_size,
    text2_shift_px,
  });

  const safeName = name.replace(/[^a-zA-Z0-9]/g, "_");
  const pdfPath = path.join(OUTPUT_DIR, `${safeName}_${certId}.pdf`);

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 3508, height: 2480 });
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.pdf({
    path: pdfPath,
    width: "297mm",
    height: "210mm",
    printBackground: true,
    margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
  });
  await browser.close();

  return pdfPath;
}

module.exports = {
  createCertificate,
  makePrefixFromCourse,
  generateUniqueId,
  loadUsed,
  saveUsed,
};
