const { chromium } = require("playwright");
const fs = require("fs");
const { Parser } = require("json2csv");

const SEARCH_QUERIES = [
  "flutter developer",
  "react native developer",
  "mobile ci/cd",
  "ios build pipeline",
  "android build pipeline",
  "testflight deploy",
  "fastlane ios",
  "codepush react native",
  "flutter build failed",
  "react native build failed",
  "ios ci pipeline",
  "android ci pipeline",
  "mobile devops",
  "fastlane problem",
  "bitrise problem",
  "github actions ios",
  "deploy ios app",
  "deploy android app"
];

const MAX_POSTS_PER_QUERY = 100;

const LEAD_KEYWORDS = [
  "react native",
  "flutter",
  "mobile build",
  "ci/cd",
  "continuous integration",
  "pipeline",
  "build pipeline",
  "android build",
  "ios build",
  "fastlane",
  "github actions",
  "bitrise",
  "jenkins",
  "circleci",
  "deploy app",
  "testflight",
  "play store deploy",
  "codepush",
  "ota update"
];

const CI_CD_PLATFORMS = ["bitrise", "github actions", "jenkins", "circleci", "app center", "buildkite", "azure devops", "gitlab ci", "teamcity"];
const MOBILE_STACK = ["react native", "flutter", "kotlin", "swift", "expo"];
const COMPLAINT_KEYWORDS = ["slow", "broken", "fail", "frustrating", "expensive", "buggy", "problem", "issue", "complain"];
const HIRING_KEYWORDS = ["we're hiring", "we are hiring", "looking for", "join our team", "hiring flutter", "hiring react native", "hiring ios", "hiring android"];
const QUESTION_KEYWORDS = ["ci", "pipeline", "deploy"];

if (!fs.existsSync("output")) fs.mkdirSync("output");

function parseNumber(str) {
  if (!str) return 0;
  str = str.replace(/,/g, '').toLowerCase();
  if (str.includes("k")) return Math.round(parseFloat(str) * 1000);
  if (str.includes("m")) return Math.round(parseFloat(str) * 1000000);
  const num = parseInt(str.replace(/\D/g, ""));
  return isNaN(num) ? 0 : num;
}

function detectLead(post) {
  const text = post.text.toLowerCase();
  return LEAD_KEYWORDS.some(keyword => text.includes(keyword));
}

function scoreLead(post) {
  let score = 0;
  const text = post.text.toLowerCase();
  if (text.includes("react native")) score += 5;
  if (text.includes("flutter")) score += 5;
  if (text.includes("ci")) score += 3;
  if (text.includes("pipeline")) score += 3;
  if (text.includes("build")) score += 3;
  if (text.includes("deploy")) score += 2;
  if (text.includes("testflight")) score += 3;
  if (text.includes("codepush")) score += 4;

  const likes = parseNumber(post.likes);
  const comments = parseNumber(post.comments);
  score += Math.min(likes / 20, 5);
  score += Math.min(comments / 5, 5);

  return Math.round(score);
}

function detectCIComplaint(post) {
  const text = post.text.toLowerCase();
  const platformsMentioned = CI_CD_PLATFORMS.filter(platform => text.includes(platform));
  const complaintMatches = COMPLAINT_KEYWORDS.filter(word => text.includes(word));

  const isComplaint = platformsMentioned.length > 0 && complaintMatches.length > 0;

  let ciComplaintText = "";
  if (isComplaint) {
    const sentences = text.split(/[\.\n]/);
    const relevant = sentences.filter(s =>
      CI_CD_PLATFORMS.some(p => s.includes(p)) &&
      COMPLAINT_KEYWORDS.some(c => s.includes(c))
    );
    ciComplaintText = relevant.join(". ").trim();
  }

  return { platformsMentioned, ciComplaintText };
}

function isPotentialCodemagicLead(post) {
  return post.isLead && post.ciComplaints.platformsMentioned.length > 0;
}

function extractCompany(headline) {
  if (!headline) return "";
  const match = headline.match(/@ ([^|]+)/i) || headline.match(/at ([^|]+)/i);
  return match ? match[1].trim() : "";
}

function detectHiring(post) {
  const text = post.text.toLowerCase();
  return HIRING_KEYWORDS.some(k => text.includes(k));
}

function detectQuestion(post) {
  const text = post.text.toLowerCase();
  return text.includes("?") && QUESTION_KEYWORDS.some(k => text.includes(k));
}

function classifyLead({ ciComplaints, hiring, question, stack }) {
  if (ciComplaints.platformsMentioned.length) return "CI Pain";
  if (hiring) return "Hiring";
  if (question) return "Question";
  if (stack.length) return "Mobile Dev";
  return "Other";
}

(async () => {
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

  for (const query of SEARCH_QUERIES) {
    console.log(`\nSearching: ${query}`);
    const url = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}`;
    await page.goto(url);
    await page.waitForSelector("div.feed-shared-update-v2");

    let posts = [];
    let previousHeight = 0;

    while (posts.length < MAX_POSTS_PER_QUERY) {
      const newPosts = await page.$$eval(
        "div.feed-shared-update-v2",
        elements => elements.map(el => {
          const textElement = el.querySelector(".feed-shared-update-v2__description");
          return {
            id: el.getAttribute("data-urn"),
            text: textElement?.innerText || "",
            author: el.querySelector(".update-components-actor__name")?.innerText || "",
            headline: el.querySelector(".update-components-actor__description")?.innerText || "",
            profileUrl: el.querySelector(".update-components-actor__meta-link")?.href || "",
            timestamp: el.querySelector(".update-components-actor__sub-description")?.innerText || "",
            likes: el.querySelector(".social-details-social-counts__reactions-count")?.innerText || "0",
            comments: el.querySelector(".social-details-social-counts__comments")?.innerText || "0"
          };
        })
      );

      posts = [...new Map([...posts, ...newPosts].map(p => [p.id, p])).values()];
      console.log(`Collected: ${posts.length}`);

      if (posts.length >= MAX_POSTS_PER_QUERY) break;
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(3000 + Math.random() * 4000);

      const height = await page.evaluate(() => document.body.scrollHeight);
      if (height === previousHeight) break;
      previousHeight = height;
    }

    const processedPosts = posts.slice(0, MAX_POSTS_PER_QUERY).map(post => {
      const likes = parseNumber(post.likes);
      const comments = parseNumber(post.comments);
      const leadScore = scoreLead(post);
      const ciComplaints = detectCIComplaint(post);
      const isLead = detectLead(post);
      const hiring = detectHiring(post);
      const question = detectQuestion(post);
      const stack = MOBILE_STACK.filter(s => post.text.toLowerCase().includes(s));
      const company = extractCompany(post.headline);

      return {
        ...post,
        searchQuery: query,
        likesParsed: likes,
        commentsParsed: comments,
        engagement: likes + comments * 2,
        isLead,
        leadScore: leadScore + (hiring ? 6 : 0) + (question ? 7 : 0),
        hotLead: leadScore >= 8,
        ciComplaints,
        potentialCodemagicLead: isPotentialCodemagicLead({ ...post, isLead, ciComplaints }),
        hiring,
        question,
        stack,
        company,
        leadType: classifyLead({ ciComplaints, hiring, question, stack })
      };
    });

    allPosts.push(...processedPosts);
  }

  allPosts = [...new Map(allPosts.map(p => [p.id, p])).values()];

  const leads = allPosts.filter(p => p.isLead);
  const hotLeads = leads.sort((a, b) => b.leadScore - a.leadScore).slice(0, 50);
  const potentialLeads = allPosts.filter(p => p.potentialCodemagicLead);

  if (!fs.existsSync("output")) fs.mkdirSync("output");
  const parser = new Parser();
  fs.writeFileSync("output/all_posts.json", JSON.stringify(allPosts, null, 2));
  fs.writeFileSync("output/leads.json", JSON.stringify(leads, null, 2));
  fs.writeFileSync("output/hot_leads.json", JSON.stringify(hotLeads, null, 2));
  fs.writeFileSync("output/potential_codemagic_leads.json", JSON.stringify(potentialLeads, null, 2));
  fs.writeFileSync("output/leads.csv", parser.parse(leads));
  fs.writeFileSync("output/hot_leads.csv", parser.parse(hotLeads));
  fs.writeFileSync("output/potential_codemagic_leads.csv", parser.parse(potentialLeads));

  console.log(`\nDone. Total posts: ${allPosts.length}, Leads: ${leads.length}, Hot leads: ${hotLeads.length}, Potential Codemagic leads: ${potentialLeads.length}`);
  await browser.close();
})();

