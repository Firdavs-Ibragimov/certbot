const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const nunjucks = require("nunjucks");
const puppeteer = require("puppeteer");
const cert = require("./certificate");
const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error("TOKEN not found in env. Create .env with TOKEN=...");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

const BASE = __dirname; // c:\...\bot\js da
const TEMPLATES_DIR = path.join(BASE, "templates");
const OUTPUT_DIR = path.join(BASE, "outputs");
const USED_IDS_FILE = path.join(BASE, "used_ids.json");
const BG_PNG = path.join(BASE, "templates", "template.png"); // use parent template.png

async function ensure() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(USED_IDS_FILE))
    await writeFile(USED_IDS_FILE, JSON.stringify({}, null, 2), "utf8");
}

let usedIds = {};
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

nunjucks.configure(TEMPLATES_DIR, { autoescape: true });

// Bot state per chat
const user = {};

const COURSES = [
  "Web dasturlash",
  "Kiberhavfsizlik",
  "Kompyuter savodxonlik",
  "Grafik dizayn",
  "Python (Data Science)",
];

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  // Reset any previous state and start from the beginning
  try {
    delete user[chatId];
  } catch (e) {}
  user[chatId] = { step: "name" };
  bot.sendMessage(chatId, "Ism familiyangizni kiriting:", {
    reply_markup: { remove_keyboard: true },
  });
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  if (!user[chatId]) return;
  const state = user[chatId];
  if (state.step === "name" && msg.text) {
    state.name = msg.text.trim();
    state.step = "date";

    const tz = new Date(Date.now() + 5 * 3600000);
    const format = (d) =>
      `0${d.getDate()}`.slice(-2) +
      "." +
      `0${d.getMonth() + 1}`.slice(-2) +
      "." +
      d.getFullYear();
    const today = format(tz);
    const yesterday = format(new Date(tz.getTime() - 86400000));
    const tomorrow = format(new Date(tz.getTime() + 86400000));

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: `Bugun (${today})`, callback_data: "d_today" },
            { text: `Kecha (${yesterday})`, callback_data: "d_yest" },
          ],
          [{ text: `Ertaga (${tomorrow})`, callback_data: "d_tom" }],
          [{ text: "Boshqa sana", callback_data: "d_custom" }],
        ],
      },
    };
    bot.sendMessage(chatId, "Sana tanlang:", opts);
  } else if (state.step === "custom_date" && msg.text) {
    state.date = msg.text.trim();
    state.step = "type";
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Oddiy Kurs Sertifikati", callback_data: "t_kurs" },
            { text: "Malaka Oshirish Sertifikati", callback_data: "t_malaka" },
          ],
        ],
      },
    };
    bot.sendMessage(chatId, "Sertifikat turini tanlang:", opts);
  }
});

bot.on("callback_query", async (q) => {
  const data = q.data;
  const chatId = q.message.chat.id;
  if (!user[chatId]) user[chatId] = {};
  // date selection
  if (data.startsWith("d_")) {
    const tz = new Date(Date.now() + 5 * 3600000);
    const fmt = (d) =>
      `0${d.getDate()}`.slice(-2) +
      "." +
      `0${d.getMonth() + 1}`.slice(-2) +
      "." +
      d.getFullYear();
    if (data === "d_today") user[chatId].date = fmt(tz);
    else if (data === "d_yest")
      user[chatId].date = fmt(new Date(tz.getTime() - 86400000));
    else if (data === "d_tom")
      user[chatId].date = fmt(new Date(tz.getTime() + 86400000));
    else {
      user[chatId].step = "custom_date";
      bot.sendMessage(chatId, "Sanani kiriting (masalan: 09.08.2024):");
      return;
    }
    user[chatId].step = "type";
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Oddiy Kurs Sertifikati", callback_data: "t_kurs" },
            { text: "Malaka Oshirish Sertifikati", callback_data: "t_malaka" },
          ],
        ],
      },
    };
    bot.sendMessage(chatId, "Sertifikat turini tanlang:", opts);
    bot.answerCallbackQuery(q.id);
    return;
  }

  // type selection
  if (data.startsWith("t_")) {
    const t = data.split("_")[1];
    user[chatId].type = t;
    if (t === "kurs") {
      // show course inline
      const rows = COURSES.map((c, i) => [
        { text: c, callback_data: `c_${i}` },
      ]);
      // group rows into single column
      const keyboard = rows.map((r) => r);
      bot.sendMessage(chatId, "Kursni tanlang:", {
        reply_markup: { inline_keyboard: keyboard },
      });
      bot.answerCallbackQuery(q.id);
      return;
    }
    // malaka
    bot.sendMessage(
      chatId,
      "Sertifikat tayyorlanmoqda... 10–20 sekund kuting."
    );
    const name = user[chatId].name;
    const date = user[chatId].date;
    const course = user[chatId].course || "";
    try {
      const pdf = await cert.createCertificate(name, "malaka", date, course);
      await bot.sendDocument(
        chatId,
        fs.createReadStream(pdf),
        {},
        { filename: `${name}.pdf` }
      );
    } catch (e) {
      console.error(e);
      bot.sendMessage(chatId, "Xatolik yuz berdi.");
    }
    bot.sendMessage(
      chatId,
      "Tayyor! Yana sertifikat yaratish uchun /start bosib qayta boshlang."
    );
    delete user[chatId];
    bot.answerCallbackQuery(q.id);
    return;
  }

  // course selection callbacks
  if (data.startsWith("c_")) {
    const idx = parseInt(data.split("_")[1], 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= COURSES.length) {
      bot.sendMessage(chatId, "Noto'g'ri tanlov.");
      bot.answerCallbackQuery(q.id);
      return;
    }
    const course = COURSES[idx];
    user[chatId].course = course;
    user[chatId].type = "kurs";
    bot.sendMessage(
      chatId,
      "Sertifikat tayyorlanmoqda... 10–20 sekund kuting."
    );
    const name = user[chatId].name;
    const date = user[chatId].date;
    try {
      const pdf = await cert.createCertificate(name, "kurs", date, course);
      await bot.sendDocument(
        chatId,
        fs.createReadStream(pdf),
        {},
        { filename: `${name}.pdf` }
      );
    } catch (e) {
      console.error(e);
      bot.sendMessage(chatId, "Xatolik yuz berdi.");
    }
    bot.sendMessage(
      chatId,
      "Tayyor! Yana sertifikat yaratish uchun /start bosib qayta boshlang."
    );
    delete user[chatId];
    bot.answerCallbackQuery(q.id);
    return;
  }

  bot.answerCallbackQuery(q.id);
});

(async () => {
  await ensure();
  await loadUsed();
  // also load used ids in certificate module
  if (cert && typeof cert.loadUsed === "function") await cert.loadUsed();
  console.log("JS bot running.");
})();
