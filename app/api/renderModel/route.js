/** @format */

import { NextResponse } from "next/server";
import puppeteer from "puppeteer";

// CORS headers
const headers = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Handle OPTIONS requests (CORS preflight)
export async function OPTIONS() {
	return new NextResponse(null, { status: 204, headers });
}

export async function POST(req) {
	let browser = null;

	try {
		const { url, configProducts, selectedProduct, token, projectId } =
			await req.json();

		if (!url || !token || !projectId) {
			return NextResponse.json(
				{ error: "Missing required parameters" },
				{ status: 400, headers }
			);
		}

		browser = await puppeteer.launch({
			headless: "new",
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		});

		const page = await browser.newPage();
		page.on("console", (msg) => console.log("PAGE LOG:", msg.text()));
		await page.setViewport({ width: 1280, height: 720 });

		// Obtener datos del estado y productos
		console.log("Fetching data with token and projectId:", projectId);

		const API_URL = "https://dtwin-back.vercel.app/api/status/";
		console.log("Using API URL:", API_URL);

		// Obtener sheetData
		console.log("Fetching status data...");
		const statusResponse = await fetch(`${API_URL}?projectId=${projectId}`, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
			},
		});

		if (!statusResponse.ok) {
			const errorText = await statusResponse.text();
			throw new Error(
				`Status API error: ${statusResponse.status} - ${errorText}`
			);
		}

		const sheetData = await statusResponse.json();
		console.log("Status data received:", sheetData ? "success" : "empty");

		// Obtener productos
		console.log("Fetching productos data...");
		const productosResponse = await fetch(
			`${API_URL}getProductos?projectId=${projectId}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/json",
				},
			}
		);

		if (!productosResponse.ok) {
			const errorText = await productosResponse.text();
			throw new Error(
				`Productos API error: ${productosResponse.status} - ${errorText}`
			);
		}

		const productos = await productosResponse.json();
		console.log("Productos data received:", productos ? "success" : "empty");

		// Preparar la configuración con los datos obtenidos
		const viewerConfig = {
			sheetData,
			productos,
			selectedProduct,
			configProducts,
		};

		// Cargar el viewer y renderizar el modelo
		console.log("Loading viewer page...");
		await page.goto("http://localhost:3000/viewer.html");

		console.log("Evaluating model in viewer...");
		await page.evaluate(
			async (modelUrl, config) => {
				await window.loadModelAndCapture(modelUrl, config);
			},
			url,
			viewerConfig
		);

		// Wait until modelIsReady is set
		console.log("Waiting for model to be ready...");
		await page.waitForFunction(() => window.modelIsReady === true);

		console.log("Taking screenshot...");
		const buffer = await page.screenshot({ encoding: "base64" });
		const base64 = `data:image/png;base64,${buffer}`;

		return NextResponse.json({ image: base64 }, { headers });
	} catch (error) {
		console.error("Error in renderModel:", error);
		return NextResponse.json(
			{ error: "Failed to render image", detail: error.message },
			{ status: 500, headers }
		);
	} finally {
		if (browser) {
			console.log("Closing browser...");
			await browser.close();
		}
	}
}
