/** @format */

import { NextResponse } from "next/server";
import puppeteer from "puppeteer";

// CORS headers
const headers = {
	"Access-Control-Allow-Origin": "*",
	"Content-Type": "application/json",
};

// Handle OPTIONS requests (CORS preflight)
export async function OPTIONS() {
	return new NextResponse(null, { status: 204, headers });
}

export const config = {
	api: {
		bodyParser: {
			sizeLimit: "10mb",
		},
	},
};

export async function POST(req) {
	let browser = null;

	try {
		// Configurar los límites de tamaño para la solicitud
		const contentLength = req.headers.get("content-length");
		if (contentLength && parseInt(contentLength) > 50 * 1024 * 1024) {
			// 50MB limit
			return NextResponse.json(
				{ error: "Payload too large" },
				{ status: 413, headers }
			);
		}

		// Leer el cuerpo de la solicitud en chunks
		let chunks = [];
		const reader = req.body.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
		}

		// Combinar los chunks y parsear el JSON
		const text = new TextDecoder().decode(Buffer.concat(chunks));
		let body;
		try {
			body = JSON.parse(text);
		} catch (e) {
			console.error("Error parsing request body:", e);
			return NextResponse.json(
				{ error: "Invalid JSON in request body" },
				{ status: 400, headers }
			);
		}

		const { url, selectedProduct, statusData } = body;

		// Validar la URL del modelo
		if (!url || !url.startsWith("http")) {
			console.error("URL inválida:", url);
			return NextResponse.json(
				{
					error: "Invalid model URL",
					detail: "URL must be a valid HTTP/HTTPS URL",
				},
				{ status: 400, headers }
			);
		}

		console.log("Received data:", {
			url,
			selectedProduct,
			statusDataLength: statusData?.length,
			metricsKeys: selectedProduct?.metrics
				? Object.keys(selectedProduct.metrics)
				: [],
		});

		if (
			!url ||
			!selectedProduct ||
			!statusData ||
			!Array.isArray(statusData) ||
			!selectedProduct.metrics
		) {
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

		// Usar los datos del statusData que vienen en el body
		console.log("Using status data from request body");

		// Preparar la configuración con los datos recibidos
		const viewerConfig = {
			statusData,
			selectedProduct,
		};
		// console.log("ViewerConfig prepared:", viewerConfig);

		// Cargar el viewer y renderizar el modelo
		console.log("Loading viewer page...");
		await page.goto("http://localhost:3500/viewer.html");

		console.log("Evaluating model in viewer...");
		try {
			// Esperar a que el canvas esté disponible
			await page.waitForSelector('#myCanvas');

			// Esperar a que el viewer esté inicializado
			await page.waitForFunction(() => window.viewer !== null, { timeout: 5000 });

			// Cargar el modelo
			await page.evaluate(async (modelUrl) => {
				console.log('Intentando cargar modelo desde:', modelUrl);
				if (!window.viewer) {
					throw new Error('Viewer no está inicializado');
				}
				if (typeof window.loadModelAndCapture !== 'function') {
					throw new Error('loadModelAndCapture no está definido');
				}
				await window.loadModelAndCapture(modelUrl);
			}, url);
		} catch (error) {
			console.error('Error al cargar el modelo:', error);
			throw error;
		}

		// Esperar 1 segundo para asegurar que el modelo esté cargado
		console.log("Waiting for model to load completely...");
		await new Promise((resolve) => setTimeout(resolve, 2000));

		// Una vez que el modelo está cargado, aplicar los colores
		await page.evaluate((config) => {
			const viewer = window.viewer;
			if (!viewer || !viewer.scene || !viewer.scene.objects) {
				console.error("Viewer no inicializado correctamente");
				return;
			}

			// Funciones de colores
			const getStatusColor = (status) => {
	
				switch (status) {

					case "Curing":
						return [1, 1, 0]; // Amarillo
					case "Detailing Approved":
						return [1, 0.455, 1]; // Rosa
					case "Elements in Workshop":
						return [1, 0.4, 0]; // Naranja
					case "Transit":
						return [0.004, 0.686, 0.933]; // Azul claro
					case "Elements Onsite":
						return [0, 0.439, 0.753]; // Azul oscuro
					case "Precast Reception":
						return [0.004, 0.439, 0.749]; // Azul oscuro
					case "Early":
						return [0.012, 0.686, 0.318]; // Verde
					case "On Time":
						return [0.5, 0.5, 0.5]; // Gris
          case "Late":
            return [0.988, 0.016, 0.008]; // Rojo
					case "Precast Approved":
						return [1, 0.753, 0.012]; // Amarillo dorado
            case "#03af51":
						return [0.988, 0.016, 0.008]; // Rojo
					case "#aaaaaa":
						return [0.012, 0.686, 0.318]; // Verde
					default:
						return [1, 1, 1]; // Blanco
				}
			};

			const getStatusColorMetrica = (atencion) => {
				switch (atencion) {
					case "No Atendió":
						return [0.988, 0.016, 0.008]; // Rojo
					case "Atención Total":
						return [0.012, 0.686, 0.318]; // Verde
					default:
						return [0.012, 0.686, 0.318];
				}
			};

			const hexToRgb = (hex) => {
				const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
				return result
					? [
							parseInt(result[1], 16) / 255,
							parseInt(result[2], 16) / 255,
							parseInt(result[3], 16) / 255,
					  ]
					: [0.5, 0.5, 0.5];
			};

			// Aplicar colores
			const { statusData, selectedProduct } = config;
			const objects = viewer.scene.objects;
			console.log("Objetos encontrados:", Object.keys(objects).length);
			console.log("Total statusData:", statusData.length);
			console.log("Total metrics:", selectedProduct.metrics.length);

			// Crear un mapa de métricas por nombre para búsqueda rápida
			const metricsMap = new Map();
			selectedProduct.metrics.forEach((metric) => {
				metricsMap.set(metric.name, metric);
			});

			// Encontrar niveles únicos
			const uniqueNiveles = [...new Set(statusData.map(item => item.TSC_NIVEL))];
			uniqueNiveles.sort((a, b) => {
				const numA = parseInt(a.split(" ")[1]) || 0;
				const numB = parseInt(b.split(" ")[1]) || 0;
				return numB - numA;
			});
			const highestLevel = uniqueNiveles[0] || "";

			for (const objectId in objects) {
				const object = objects[objectId];
				console.log("Procesando objeto ID:", objectId);

				// Buscar el objeto en statusData por su ID
				const statusItem = statusData.find((item) => item.ID === objectId);
				if (!statusItem) {
		
					object.colorize = [0, 0, 0];
					object.opacity = 0;
					object.visible = false;
					continue;
				}

				// Manejar SECTORIZACION y NIVELES
				if (statusItem.TSC_PRODUCTO === "SECTORIZACION") {
					if (statusItem.TSC_NIVEL === highestLevel) {
						object.colorize = [0, 0, 0];
						object.opacity = 0.8;
						object.visible = true;
					} else {
						object.colorize = [0, 0, 0];
						object.opacity = 0;
						object.visible = false;
					}
					continue;
				}

				if (statusItem.TSC_PRODUCTO === "NIVELES") {
					if (uniqueNiveles.includes(statusItem.TSC_NIVEL)) {
						object.colorize = [0, 0, 0];
						object.opacity = 0.8;
						object.visible = true;
					} else {
						object.colorize = [0, 0, 0];
						object.opacity = 0;
						object.visible = false;
					}
					continue;
				}

				// Buscar la métrica correspondiente usando TSC_ACEDIM o TSC_CONCRETO
				const metricName = statusItem.TSC_ACEDIM || statusItem.TSC_CONCRETO;
				const metric = metricsMap.get(metricName);

				if (!metric) {
		
					// Si no hay métrica pero está en un nivel válido, mostrar en gris
					if (uniqueNiveles.includes(statusItem.TSC_NIVEL)) {
						object.colorize = [0, 0, 0];
						object.opacity = 0.2;
						object.visible = true;
					} else {
						object.colorize = [0, 0, 0];
						object.opacity = 0;
						object.visible = false;
					}
					continue;
				}

	

				// Aplicar colores basados en el estado
				let statusColor = [0.667, 0.667, 0.667]; // Color por defecto
				let opacity = 1.0;

				// Aplicar colores basados en el estado y modo
				if (metric.Atencion) {
					// Modo ATENCION
					statusColor = getStatusColorMetrica(metric.Atencion);
		
				} else if (metric.EstadoPlanner) {
					// Modo LLEGADA con EstadoPlanner
					statusColor = getStatusColor(metric.EstadoPlanner);
		
				} else {
					// Modo LLEGADA basado en delay
					console.log(`Verificando delay para ${objectId}:`, {
						delay: metric.delay,
						type: typeof metric.delay,
						metricData: metric
					});

					// Convertir delay a número si es string
					const delayNum = Number(metric.delay);

					if (isNaN(delayNum)) {
			
						statusColor = [0.667, 0.667, 0.667]; // Gris por defecto
					} else if (delayNum < 0) {
						statusColor = getStatusColor("Early");
			
					} else if (delayNum === 0) {
						statusColor = getStatusColor("On Time");
			
					} else {
						statusColor = getStatusColor("Late");
			
					}
				}

				// Aplicar el color final
				const finalColor = statusColor || hexToRgb(metric.ColorEstadoReal || "#aaaaaa");
	

				// Aplicar colores al objeto
				try {
					object.colorize = finalColor;
					object.opacity = opacity;
					object.visible = true;
				} catch (error) {
					console.error(`Error al colorear objeto ${objectId}:`, error);
				}

			}
		}, viewerConfig);

		// Wait until modelIsReady is set
		console.log("Waiting for model to be ready...");
		await page.waitForFunction(() => window.modelIsReady === true);

		// Esperar 2 segundos adicionales para asegurar que todo esté renderizado
		console.log("Waiting additional time for rendering...");
		await new Promise((resolve) => setTimeout(resolve, 2000));

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
