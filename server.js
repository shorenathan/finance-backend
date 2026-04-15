const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

let transactions = [];

app.get("/transactions", (req, res) => {
  res.json(transactions);
});

app.post("/transactions", (req, res) => {
  const { desc, amount } = req.body;

  if (!desc || !amount) {
    return res.status(400).json({ error: "Invalid data" });
  }

  transactions.push({ desc, amount });
  res.json({ success: true });
});

app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
