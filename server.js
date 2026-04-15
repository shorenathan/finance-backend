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
   FETCH EMAILS (TRANSACTION ENGINE)
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

        const snippet = full.data.snippet || "";

        const parsed = parseTransactionFromSnippet(snippet);

        if (parsed) {
          results.push({
            id: msg.id,
            ...parsed
          });
        }

      } catch (err) {
        console.log("Skipping email:", msg.id, err.message);
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
   SNIPPET TRANSACTION PARSER
------------------------------*/
function parseTransactionFromSnippet(snippet) {
  const text = snippet.replace(/\s+/g, " ").trim();

  // Must have an amount
  const amountMatch = text.match(/\$([\d,]+(\.\d{1,2})?)/);
  if (!amountMatch) return null;

  const amount = parseFloat(amountMatch[1].replace(/,/g, ""));

  // Merchant extraction (handles inline format)
  let merchant = "unknown";

  const merchantMatch =
    text.match(/merchant:\s*(.+?)\sdate:/i) ||
    text.match(/merchant:\s*(.+?)\samount:/i);

  if (merchantMatch) {
    merchant = merchantMatch[1].trim();
  }

  // Date extraction
  const dateMatch = text.match(/date:\s*([a-z0-9, ]+)/i);
  const date = dateMatch ? new Date(dateMatch[1]) : new Date();

  return {
    merchant,
    amount: -Math.abs(amount), // default expense
    type: "expense",
    category: categorizeMerchant(merchant),
    date: date.toISOString()
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
