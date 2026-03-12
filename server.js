const express = require("express");
const { runScraper, requestStop } = require("./scraper");

const app = express();

app.use(express.json());
app.use(express.static("public")); // serve index.html automatically

let progress = {
  running: false,
  currentQuery: "",
  completed: 0,
  total: 0
};

// Get current progress
app.get("/progress", (req, res) => {
  res.json(progress);
});

// Start scraper
app.post("/start-scraper", async (req, res) => {
  const { searchQueries } = req.body;

  if (!searchQueries || !searchQueries.length) {
    return res.status(400).json({ error: "No queries provided" });
  }

  progress.running = true;
  progress.completed = 0;
  progress.total = searchQueries.length;

  try {
    const leads = await runScraper(searchQueries, progress);
    progress.running = false;
    res.json(leads); // frontend expects array
  } catch (err) {
    progress.running = false;
    res.status(500).json({ error: err.message });
  }
});

// Stop scraper
app.post("/stop-scraper", (req, res) => {
  requestStop();
  progress.running = false;
  res.json({ success: true });
});

// Serve index.html for root
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.listen(3000, () => console.log("Server running at http://localhost:3000"));