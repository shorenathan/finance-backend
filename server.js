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
   FETCH EMAILS (STRUCTURE DEBUG MODE)
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

        const payload = full.data.payload;

        results.push({
          id: msg.id,

          // Gmail metadata
          snippet: full.data.snippet,
          mimeType: payload?.mimeType || null,

          // structure inspection
          hasBody: !!payload?.body?.data,
          hasParts: !!payload?.parts,

          // decoded body (if any exists)
          decoded: extractBody(payload)
        });

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
   EMAIL BODY EXTRACTOR (DEBUG VERSION)
------------------------------*/
function extractBody(payload) {
  let bodyData = "";

  // Case 1: simple email body
  if (payload?.body?.data) {
    bodyData = payload.body.data;
  }

  // Case 2: multipart emails (VERY COMMON)
  else if (payload?.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        bodyData = part.body.data;
        break;
      }

      if (part.mimeType === "text/html" && part.body?.data && !bodyData) {
        bodyData = part.body.data;
      }
    }
  }

  if (!bodyData) return "";

  return Buffer.from(bodyData, "base64").toString("utf-8");
}

/* -----------------------------
   START SERVER
------------------------------*/
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
