const express = require("express");
const { runScraper, requestStop } = require("./scraper");

const app = express();

app.use(express.json());
app.use(express.static("public"));

let progress = {
  running: false,
  currentQuery: "",
  completed: 0,
  total: 0
};

app.get("/progress", (req, res) => {
  res.json(progress);
});

app.post("/run", async (req, res) => {

  const { queries } = req.body;

  progress.running = true;
  progress.completed = 0;
  progress.total = queries.length;

  try {

    const leads = await runScraper(queries, progress);

    progress.running = false;

    res.json({
      success: true,
      leads
    });

  } catch (err) {

    progress.running = false;

    res.status(500).json({
      success: false,
      error: err.message
    });

  }

});

app.post("/stop", (req, res) => {

  requestStop();

  progress.running = false;

  res.json({
    success: true
  });

});

app.listen(3000, () =>
  console.log("Server running http://localhost:3000")
);