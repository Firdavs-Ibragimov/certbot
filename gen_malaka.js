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

nunjucks.configure(TEMPLATES_DIR, { autoescape: true });

async function ensure() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(USED_IDS_FILE))
    await writeFile(USED_IDS_FILE, JSON.stringify({}, null, 2), "utf8");
}

async function loadUsed() {
  try {
    const txt = await readFile(USED_IDS_FILE, "utf8");
    return JSON.parse(txt || "{}");
  } catch (e) {
    return {};
  }
}
async function saveUsed(obj) {
  await writeFile(USED_IDS_FILE, JSON.stringify(obj, null, 2), "utf8");
}

function generateUniqueId(usedIds, prefix) {
  const list = usedIds[prefix] || [];
  while (true) {
    const num = Math.floor(1000 + Math.random() * 9000);
    const code = `${prefix}${num}`;
    if (!list.includes(code)) {
      list.push(code);
      usedIds[prefix] = list;
      return code;
    }
  }
}

async function imageToBase64(imgPath) {
  try {
    const buf = await readFile(imgPath);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch (e) {
    return "";
  }
}

async function createMalaka(name, date) {
  await ensure();
  const used = await loadUsed();
  const prefix = "MO";
  const certId = generateUniqueId(used, prefix);
  await saveUsed(used);

  const tpl = await readFile(path.join(TEMPLATES_DIR, "temp2.html"), "utf8");
  const bg = await imageToBase64(BG_PNG);

  const html = nunjucks.renderString(tpl, {
    name: name.toUpperCase(),
    date,
    cert_id: certId,
    background: bg,
  });

  const safeName = name.replace(/[^a-zA-Z0-9]/g, "_");
  const outPath = path.join(OUTPUT_DIR, `malaka_${safeName}.pdf`);

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 3508, height: 2480 });
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.pdf({
    path: outPath,
    width: "297mm",
    height: "210mm",
    printBackground: true,
    margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
  });
  await browser.close();

  return outPath;
}

(async () => {
  const argv = process.argv.slice(2);
  const name = argv[0] || "Foydalanuvchi Test";
  const date =
    argv[1] || new Date().toLocaleDateString("ru-RU").split("/").join(".");
  try {
    const pdf = await createMalaka(name, date);
    console.log("Created PDF:", pdf);
  } catch (e) {
    console.error("Error creating PDF:", e);
    process.exit(1);
  }
})();
