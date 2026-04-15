const express = require("express");
const session = require("express-session");
const cors = require("cors");
const { google } = require("googleapis");

const app = express();

/* -----------------------------
   MIDDLEWARE
------------------------------*/
app.use(cors({
  origin: "https://shorenathan.github.io",
  credentials: true
}));

app.use(express.json());

app.use(session({
  secret: "finance_secret_key",
  resave: false,
  saveUninitialized: true
}));

/* -----------------------------
   OAUTH CLIENT
------------------------------*/
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

/* -----------------------------
   BASIC ROUTE
------------------------------*/
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

/* -----------------------------
   AUTH STATUS
------------------------------*/
app.get("/auth/status", (req, res) => {
  res.json({
    loggedIn: !!req.session.tokens
  });
});

/* -----------------------------
   GOOGLE AUTH
------------------------------*/
app.get("/auth/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/userinfo.email"
    ]
  });

  res.redirect(url);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code } = req.query;

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    req.session.tokens = tokens;

    res.send("Login successful 🚀 You can close this tab.");
  } catch (err) {
    console.error(err);
    res.status(500).send("OAuth failed");
  }
});

/* -----------------------------
   FETCH EMAILS (FIXED PIPELINE)
------------------------------*/
app.get("/fetch-emails", async (req, res) => {
  try {
    if (!req.session.tokens) {
      return res.status(401).json({ error: "Not logged in" });
    }

    oauth2Client.setCredentials(req.session.tokens);

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const list = await gmail.users.messages.list({
      userId: "me",
      maxResults: 50
    });

    const messages = list.data.messages || [];

    let results = [];

    for (let msg of messages) {
      try {
        const full = await gmail.users.messages.get({
          userId: "me",
          id: msg.id,
          format: "full"
        });

        const snippet = full.data.snippet || "";
        const body = extractFullBody(full.data.payload);

        // choose best source
        const sourceText = body && body.length > 20 ? body : snippet;

        const parsed = parseTransaction(sourceText);

        if (parsed) {
          results.push({
            id: msg.id,
            ...parsed
          });
        }

      } catch (err) {
        console.log("Skipping:", msg.id, err.message);
      }
    }

    res.json(results);

  } catch (err) {
    console.error("FETCH EMAILS ERROR:", err);
    res.status(500).json({
      error: "Fetch failed",
      message: err.message
    });
  }
});

/* -----------------------------
   BODY EXTRACTOR
------------------------------*/
function extractFullBody(payload) {
  let data = "";

  if (payload?.body?.data) {
    data = payload.body.data;
  }

  else if (payload?.parts) {
    const stack = [...payload.parts];

    while (stack.length) {
      const part = stack.pop();

      if (part?.body?.data) {
        data = part.body.data;
        break;
      }

      if (part?.parts) {
        stack.push(...part.parts);
      }
    }
  }

  if (!data) return "";

  try {
    return Buffer.from(data, "base64").toString("utf-8");
  } catch {
    return data;
  }
}

/* -----------------------------
   TRANSACTION PARSER (FIXED CLEANING)
------------------------------*/
function parseTransaction(text) {
  if (!text) return null;

  // STEP 1: normalize EVERYTHING
  const clean = text
    .replace(/\\u003Cbr\\u003E/g, "\n")
    .replace(/\\u003cbr\\s*\/?\\u003e/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/=09/g, "")
    .replace(/\r/g, "")
    .replace(/\t/g, " ");

  // STEP 2: split into lines
  const lines = clean.split("\n").map(l => l.trim());

  let merchant = null;
  let amount = null;
  let date = null;

  for (let line of lines) {
    const lower = line.toLowerCase();

    if (lower.startsWith("merchant:")) {
      merchant = line.split(":")[1]?.trim();
    }

    if (lower.startsWith("amount:")) {
      const match = line.match(/\$?([\d,]+(\.\d{1,2})?)/);
      if (match) amount = parseFloat(match[1].replace(/,/g, ""));
    }

    if (lower.startsWith("date:")) {
      const value = line.split(":")[1]?.trim();
      date = value ? new Date(value) : new Date();
    }
  }

  // MUST HAVE at least amount + merchant
  if (!amount || !merchant) return null;

  return {
    merchant,
    amount: -Math.abs(amount),
    type: "expense",
    category: categorizeMerchant(merchant),
    date: (date || new Date()).toISOString()
  };
}

/* -----------------------------
   CATEGORY ENGINE
------------------------------*/
function categorizeMerchant(merchant) {
  const m = merchant.toLowerCase();

  if (
    m.includes("gas") ||
    m.includes("fuel") ||
    m.includes("shell") ||
    m.includes("chevron") ||
    m.includes("exxon") ||
    m.includes("qt")
  ) return "gas";

  if (
    m.includes("uber") ||
    m.includes("lyft") ||
    m.includes("parking") ||
    m.includes("toll")
  ) return "transport";

  if (
    m.includes("amazon") ||
    m.includes("walmart") ||
    m.includes("target")
  ) return "shopping";

  if (
    m.includes("mcdonald") ||
    m.includes("starbucks") ||
    m.includes("restaurant") ||
    m.includes("food")
  ) return "food";

  return "other";
}

/* -----------------------------
   START SERVER
------------------------------*/
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
