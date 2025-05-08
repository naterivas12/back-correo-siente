
import { NextResponse } from "next/server";
import puppeteer from "puppeteer";

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Handle OPTIONS requests (CORS preflight)
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(req) {
  // Headers are now defined globally
  const { url } = await req.json();

  if (!url) {
    return NextResponse.json({ error: "Missing model URL" }, { status: 400, headers });
  }

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    page.on("console", (msg) => console.log("PAGE LOG:", msg.text()));
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto("http://localhost:3000/viewer.html");

    await page.evaluate(async (modelUrl) => {
      await window.loadModelAndCapture(modelUrl);
    }, url);

    // Wait until modelIsReady is set
    await page.waitForFunction(() => window.modelIsReady === true);

    const buffer = await page.screenshot({ encoding: "base64" });
    const base64 = `data:image/png;base64,${buffer}`;

    await browser.close();

    return NextResponse.json({ image: base64 }, { headers });
  } catch (err) {
    await browser.close();
    return NextResponse.json({ error: "Failed to render image", detail: err.message }, { status: 500, headers });
  }
}
