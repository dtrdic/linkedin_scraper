const { chromium } = require("playwright");
const fs = require("fs");
const { Parser } = require("json2csv");

let stopRequested = false;

function requestStop() {
  stopRequested = true;
}

const MAX_POSTS_PER_QUERY = 100;

const LEAD_KEYWORDS = [
  "react native",
  "flutter",
  "ci/cd",
  "pipeline",
  "android build",
  "ios build",
  "fastlane",
  "github actions",
  "bitrise",
  "jenkins",
  "deploy",
  "testflight",
  "play store",
  "codepush"
];

const CI_CD_PLATFORMS = [
  "bitrise",
  "github actions",
  "jenkins",
  "circleci",
  "app center",
  "buildkite",
  "azure devops",
  "gitlab ci"
];

const MOBILE_STACK = [
  "react native",
  "flutter",
  "kotlin",
  "swift",
  "expo"
];

const COMPLAINT_KEYWORDS = [
  "slow",
  "broken",
  "fail",
  "failing",
  "frustrating",
  "expensive",
  "buggy",
  "problem",
  "issue"
];

const JOB_SEEKING_KEYWORDS = [
  "open to work",
  "looking for a job",
  "seeking opportunities",
  "available for work"
];

const HIRING_KEYWORDS = [
  "we're hiring",
  "we are hiring",
  "join our team",
  "hiring flutter",
  "hiring react native"
];

if (!fs.existsSync("output")) fs.mkdirSync("output");

function detectLead(post) {
  const text = post.text.toLowerCase();
  return LEAD_KEYWORDS.some(k => text.includes(k));
}

function detectCIComplaint(post) {
  const text = post.text.toLowerCase();

  const platformsMentioned =
    CI_CD_PLATFORMS.filter(p => text.includes(p));

  const complaints =
    COMPLAINT_KEYWORDS.filter(c => text.includes(c));

  const isComplaint =
    platformsMentioned.length > 0 &&
    complaints.length > 0;

  let ciComplaintText = "";

  if (isComplaint) {
    const sentences = text.split(/[\.\n]/);
    const relevant = sentences.filter(s =>
      platformsMentioned.some(p => s.includes(p)) &&
      complaints.some(c => s.includes(c))
    );
    ciComplaintText = relevant.join(". ").trim();
  }

  return { platformsMentioned, ciComplaintText };
}

function detectHiring(post) {
  const text = post.text.toLowerCase();
  return HIRING_KEYWORDS.some(k => text.includes(k));
}

function detectJobSeeker(post) {
  const text = (post.text + " " + post.headline).toLowerCase();
  return JOB_SEEKING_KEYWORDS.some(k => text.includes(k));
}

function detectStack(post) {
  const text = post.text.toLowerCase();
  return MOBILE_STACK.filter(s => text.includes(s));
}

function extractCompany(headline) {
  if (!headline) return "";
  const match =
    headline.match(/@ ([^|]+)/i) ||
    headline.match(/at ([^|]+)/i);
  return match ? match[1].trim() : "";
}

function generateLeadReason(post, ciComplaints, hiring) {
  if (ciComplaints.ciComplaintText) {
    return `CI complaint about ${ciComplaints.platformsMentioned.join(", ")}: ${ciComplaints.ciComplaintText}`;
  }
  if (ciComplaints.platformsMentioned.length) {
    return `Mentions CI tool: ${ciComplaints.platformsMentioned.join(", ")}`;
  }
  if (hiring) {
    return "Hiring mobile developers";
  }
  return "Mobile dev discussion";
}

async function runScraper(searchQueries, progress) {
  stopRequested = false;

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  if (fs.existsSync("cookies.json")) {
    const cookies = JSON.parse(fs.readFileSync("cookies.json"));
    await context.addCookies(cookies);
  }

  const page = await context.newPage();
  await page.goto("https://www.linkedin.com");

  if (!fs.existsSync("cookies.json")) {
    console.log("Login manually...");
    await page.waitForTimeout(60000);
    const cookies = await context.cookies();
    fs.writeFileSync("cookies.json", JSON.stringify(cookies, null, 2));
  }

  let allPosts = [];

  for (const query of searchQueries) {

    if (stopRequested) break;

    progress.currentQuery = query;

    console.log(`Searching: ${query}`);
    const url = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}`;
    await page.goto(url);
    await page.waitForSelector("div.feed-shared-update-v2");

    let posts = [];
    let previousHeight = 0;

    while (posts.length < MAX_POSTS_PER_QUERY) {

      if (stopRequested) break;

      const newPosts = await page.$$eval("div.feed-shared-update-v2", elements =>
        elements.map(el => {
          const textElement = el.querySelector(".feed-shared-update-v2__description");
          return {
            id: el.getAttribute("data-urn"),
            text: textElement?.innerText || "",
            author: el.querySelector(".update-components-actor__name")?.innerText || "",
            headline: el.querySelector(".update-components-actor__description")?.innerText || "",
            profileUrl: el.querySelector(".update-components-actor__meta-link")?.href || "",
            timestamp: el.querySelector(".update-components-actor__sub-description")?.innerText || ""
          };
        })
      );

      posts = [...new Map([...posts, ...newPosts].map(p => [p.id, p])).values()];

      if (posts.length >= MAX_POSTS_PER_QUERY) break;

      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(3000 + Math.random() * 3000);

      const height = await page.evaluate(() => document.body.scrollHeight);
      if (height === previousHeight) break;
      previousHeight = height;
    }

    // Scrape comments for each post
    for (let post of posts) {
      if (stopRequested) break;

      const postUrl = post.profileUrl;
      try {
        const postPage = await context.newPage();
        await postPage.goto(postUrl);
        // Expand comments section
        await postPage.$$eval("button.comment-button", btns => btns.forEach(b => b.click()));
        const comments = await postPage.$$eval(".comments-comment-item__main-content", els =>
          els.map(el => el.innerText)
        );
        if (comments.length) {
          post.text += "\n" + comments.join("\n");
        }
        await postPage.close();
      } catch (err) {
        console.log("Failed to scrape comments for post", postUrl);
      }
    }

    allPosts.push(...posts.map(post => {
      const ciComplaints = detectCIComplaint(post);
      const hiring = detectHiring(post);
      const jobSeeker = detectJobSeeker(post);
      const stack = detectStack(post);
      const company = extractCompany(post.headline);

      const isLead = detectLead(post);
      const hotLead = ciComplaints.ciComplaintText.length > 0;

      return {
        author: post.author,
        company,
        profileUrl: post.profileUrl,
        searchQuery: query,
        stack: stack.join(", "),
        leadReason: generateLeadReason(post, ciComplaints, hiring),
        hotLead,
        ciTool: ciComplaints.platformsMentioned.join(", "),
        ciComplaint: ciComplaints.ciComplaintText,
        postText: post.text,
        isLead,
        jobSeeker
      };
    }));

    progress.completed += 1;
  }

  const leads = allPosts.filter(p => p.isLead && !p.jobSeeker);
  const parser = new Parser();
  fs.writeFileSync("output/leads.csv", parser.parse(leads));

  await browser.close();
  progress.running = false;

  return leads;
}

module.exports = { runScraper, requestStop };