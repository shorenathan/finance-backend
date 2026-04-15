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
   RAW EMAIL INSPECTOR
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
      maxResults: 20 // keep small for debugging
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

        const payload = full.data.payload;

        results.push({
          id: msg.id,

          /* -------------------------
             META INFO
          -------------------------*/
          snippet: full.data.snippet,
          historyId: full.data.historyId,
          internalDate: full.data.internalDate,

          /* -------------------------
             HEADERS (SUBJECT, FROM, ETC)
          -------------------------*/
          headers: payload?.headers || [],

          /* -------------------------
             MIME STRUCTURE
          -------------------------*/
          mimeType: payload?.mimeType || null,

          /* -------------------------
             RAW BODY (BASE64)
          -------------------------*/
          rawBody: payload?.body || null,

          /* -------------------------
             FULL PAYLOAD (DEBUG GOLD)
          -------------------------*/
          payload: payload,

          /* -------------------------
             DECODED BODY (BEST EFFORT)
          -------------------------*/
          decodedBody: extractFullBody(payload),

          /* -------------------------
             MULTIPART STRUCTURE
          -------------------------*/
          parts: payload?.parts || null
        });

      } catch (err) {
        console.log("Skipping:", msg.id, err.message);
      }
    }

    res.json(results);

  } catch (err) {
    console.error("RAW FETCH ERROR:", err);
    res.status(500).json({
      error: "Fetch failed",
      message: err.message
    });
  }
});

/* -----------------------------
   FULL BODY EXTRACTOR
------------------------------*/
function extractFullBody(payload) {
  let data = "";

  // direct body
  if (payload?.body?.data) {
    data = payload.body.data;
  }

  // multipart traversal
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
   START SERVER
------------------------------*/
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
