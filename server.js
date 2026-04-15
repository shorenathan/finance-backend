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
   IN-MEMORY DATA
------------------------------*/
let transactions = [];

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
   TRANSACTIONS
------------------------------*/
app.get("/transactions", (req, res) => {
  res.json(transactions);
});

app.post("/transactions", (req, res) => {
  const { desc, amount } = req.body;

  if (!desc || amount === undefined) {
    return res.status(400).json({ error: "Invalid data" });
  }

  transactions.push({
    id: Date.now(),
    desc,
    amount
  });

  res.json({ success: true });
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
   AUTH STATUS
------------------------------*/
app.get("/auth/status", (req, res) => {
  res.json({
    loggedIn: !!req.session.tokens
  });
});

/* -----------------------------
   TEST GMAIL
------------------------------*/
app.get("/test-gmail", async (req, res) => {
  try {
    if (!req.session.tokens) {
      return res.status(401).json({ error: "Not logged in" });
    }

    oauth2Client.setCredentials(req.session.tokens);

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const response = await gmail.users.messages.list({
      userId: "me",
      maxResults: 5
    });

    res.json(response.data);

  } catch (err) {
    console.error("TEST GMAIL ERROR:", err);
    res.status(500).json({
      error: "Test Gmail failed",
      message: err.message
    });
  }
});

/* -----------------------------
   FETCH + PARSE EMAILS (FIXED)
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
          id: msg.id
        });

        /* -----------------------------
           FIX #1 + #2: REAL EMAIL BODY EXTRACTION
        ------------------------------*/
        const payload = full.data.payload;

        let text = "";

        if (payload?.body?.data) {
          text = Buffer.from(payload.body.data, "base64").toString("utf-8");
        } else if (full.data.snippet) {
          text = full.data.snippet;
        }

        const parsed = parseTransaction(text);

        if (parsed) {
          results.push({
            id: msg.id,
            raw: text,
            ...parsed
          });
        }

      } catch (innerErr) {
        console.log("Skipping email:", msg.id, innerErr.message);
        continue;
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
   PARSER
------------------------------*/
function parseTransaction(text) {
  const lower = text.toLowerCase();

  const cleanText = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/=09/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");

  const amountMatch = cleanText.match(/amount:\s*\$?([\d,]+(\.\d{1,2})?)/i);
  if (!amountMatch) return null;

  const amount = parseFloat(amountMatch[1].replace(/,/g, ""));

  let merchant = "unknown";

  const merchantMatch = cleanText.match(/merchant:\s*([^\n]+)/i);
  if (merchantMatch) {
    merchant = merchantMatch[1].trim();
  }

  const dateMatch = cleanText.match(/date:\s*([^\n]+)/i);
  const date = dateMatch
    ? new Date(dateMatch[1].trim())
    : new Date();

  const isIncome =
    lower.includes("deposit") ||
    lower.includes("payroll") ||
    lower.includes("refund");

  return {
    merchant,
    amount: isIncome ? amount : -amount,
    type: isIncome ? "income" : "expense",
    category: categorizeMerchant(merchant),
    date: date.toISOString()
  };
}

/* -----------------------------
   CATEGORY ENGINE
------------------------------*/
function categorizeMerchant(merchant) {
  const m = merchant.toLowerCase();
  const clean = m.replace(/[^a-z0-9 ]/g, " ");

  if (
    clean.includes("gas") ||
    clean.includes("fuel") ||
    clean.includes("shell") ||
    clean.includes("chevron") ||
    clean.includes("exxon") ||
    clean.includes("qt")
  ) return "gas";

  if (
    clean.includes("uber") ||
    clean.includes("lyft") ||
    clean.includes("parking") ||
    clean.includes("toll")
  ) return "transport";

  if (
    clean.includes("amazon") ||
    clean.includes("walmart") ||
    clean.includes("target")
  ) return "shopping";

  if (
    clean.includes("mcdonald") ||
    clean.includes("starbucks") ||
    clean.includes("restaurant") ||
    clean.includes("food")
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
